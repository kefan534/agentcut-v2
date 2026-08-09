from uuid import UUID
from typing import List, Optional
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.config import settings
from app.core.deps import get_current_user
from app.models.user import User
from app.models.asset import Asset
from app.schemas.asset import AssetCreate, AssetUpdate, AssetOut
from app.services import doc_processing_service
from app.services import cos_service
from app.services import upload_service

router = APIRouter(prefix="/assets", tags=["assets"])


def _append_url(asset: Asset) -> dict:
    data = AssetOut.model_validate(asset).model_dump()
    # storage_key 可能是 COS key 或本地路径，resolve_asset_url 自动适配
    data["url"] = cos_service.resolve_asset_url(asset.storage_key)
    data["text"] = asset.text
    data["text_status"] = asset.text_status
    data["text_length"] = asset.text_length
    data["text_error"] = asset.text_error
    data["ocr_used"] = asset.ocr_used
    return data


# P1: multipart 上传（前端 asset_upload 工具 / 用户手动上传）
@router.post("/upload")
async def upload_asset(
    file: UploadFile = File(...),
    project_id: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """PRD FR-1.7: 50MB 上限 + 速率限制 + 魔数校验 + COS 存储 + 异步解析。"""
    # 速率限制
    from app.services.rate_limiter import check_user_rate
    if not check_user_rate(f"asset_upload:{current_user.id}", limit=20, window_sec=60):
        raise HTTPException(status_code=429, detail="上传过于频繁，请稍后再试")

    raw = await file.read()
    if len(raw) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="单文件超过 50MB 限额")

    # 魔数 + 扩展名校验（防伪扩展名）
    name = file.filename or "upload"
    safe_name = upload_service.sanitize_filename(name)
    ok, reason, mime = upload_service.validate_magic_bytes(raw, safe_name)
    if not ok:
        raise HTTPException(status_code=400, detail=f"文件类型校验失败：{reason}")

    # 推断 asset_type
    if mime and mime.startswith("image/"):
        asset_type = "image"
    elif mime and mime.startswith("video/"):
        asset_type = "video"
    elif mime and mime.startswith("audio/"):
        asset_type = "audio"
    else:
        asset_type = "document"

    # 上传 COS（私有）或 fallback 写本地
    if cos_service.is_configured():
        try:
            ext = Path(safe_name).suffix.lstrip(".") or "bin"
            storage_key = cos_service.upload_bytes(
                raw, prefix="assets", user_id=current_user.id,
                content_type=mime or "application/octet-stream", ext=ext,
            )
        except Exception:
            storage_key = _save_to_local(current_user.id, raw, safe_name)
    else:
        storage_key = _save_to_local(current_user.id, raw, safe_name)

    # 创建 Asset 记录
    asset = Asset(
        user_id=current_user.id,
        asset_type=asset_type,
        name=safe_name,
        storage_key=storage_key,
        mime_type=mime,
        size_bytes=len(raw),
        project_id=UUID(project_id) if project_id else None,
    )
    db.add(asset)
    db.flush()

    # 审计
    import hashlib
    from app.models.agent_audit_log import AgentAuditLog
    db.add(AgentAuditLog(
        user_id=current_user.id, event="asset_upload", target_id=str(asset.id),
        tool_name="asset_upload", status="success",
        meta={"nameHash": hashlib.sha1(safe_name.encode("utf-8")).hexdigest()[:16], "type": asset_type, "size": len(raw)},
    ))

    # 异步解析/OCR（图片/文档）
    if asset_type in ("document", "image"):
        asset.text_status = "pending"
        db.flush()
        _schedule_parse(asset.id, current_user.id, asset_type, mime, raw if not cos_service.is_configured() else None, storage_key)

    db.commit()
    db.refresh(asset)

    url = cos_service.resolve_asset_url(storage_key)
    out = _append_url(asset)
    return {
        "ok": True,
        "assetId": str(asset.id),
        "name": safe_name,
        "kind": asset_type,
        "mimeType": mime,
        "size": len(raw),
        "url": url,
        "thumbnailUrl": url if asset_type == "image" else None,
        "textPreview": asset.text or "",
        "textStatus": asset.text_status or "pending",
    }


def _save_to_local(user_id, data: bytes, filename: str) -> str:
    import uuid
    user_dir = Path(settings.UPLOAD_DIR) / str(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}{Path(filename).suffix}"
    (user_dir / name).write_bytes(data)
    return f"{user_id}/{name}"


def _schedule_parse(asset_id, user_id, asset_type, mime, raw_local_bytes, storage_key):
    """同步触发后台异步解析（与 create_asset 复用）"""
    import asyncio
    import tempfile
    import httpx as _httpx
    from app.models.asset import Asset as _Asset
    from app.services import doc_processing_service as _dps

    async def _parse_bg():
        db2 = next(get_db())
        try:
            a = db2.query(_Asset).filter(_Asset.id == asset_id).first()
            if not a: return
            from pathlib import Path as _P
            if raw_local_bytes:
                with tempfile.NamedTemporaryFile(suffix=_P(filename if False else ".bin").suffix or ".bin", delete=False) as f:
                    f.write(raw_local_bytes); tmp = f.name
                try:
                    result = _dps.parse_asset(_P(tmp))
                finally:
                    import os; os.unlink(tmp)
            elif storage_key.startswith("http"):
                try:
                    with _httpx.Client(timeout=60.0, follow_redirects=True) as c:
                        r = c.get(storage_key); r.raise_for_status()
                        ext = "." + (r.headers.get("content-type","").split("/")[-1].split(";")[0] or "bin")
                        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as f:
                            f.write(r.content); tmp = f.name
                    try:
                        result = _dps.parse_asset(_P(tmp))
                    finally:
                        import os; os.unlink(tmp)
                except Exception as exc:
                    result = {"text": None, "text_status": "failed", "text_error": str(exc)[:500]}
            else:
                result = {"text": None, "text_status": "failed", "text_error": "no data"}
            a.text = result.get("text"); a.text_status = result.get("text_status", "failed")
            a.text_length = result.get("text_length"); a.text_error = result.get("text_error"); a.ocr_used = result.get("ocr_used")
            db2.commit()
        except Exception: db2.rollback()
        finally: db2.close()

    try:
        loop = asyncio.get_event_loop()
        loop.create_task(_parse_bg())
    except RuntimeError: pass


@router.get("", response_model=List[AssetOut])
def list_assets(
    asset_type: Optional[str] = Query(None),
    project_id: Optional[UUID] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Asset).filter(Asset.user_id == current_user.id)
    if asset_type:
        q = q.filter(Asset.asset_type == asset_type)
    if project_id:
        q = q.filter(Asset.project_id == project_id)
    assets = q.order_by(Asset.created_at.desc()).all()
    return [_append_url(a) for a in assets]


@router.post("", response_model=AssetOut)
def create_asset(payload: AssetCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # P0: PRD FR-1.7 限额：单文件 ≤ 50MB
    if payload.size_bytes and payload.size_bytes > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="单文件超过 50MB 限额")

    # P0: PRD FR-1.7 速率限制：同一用户 20 次/分钟（内存计数）
    import time as _time
    from app.services.rate_limiter import check_user_rate
    if not check_user_rate(f"asset_upload:{current_user.id}", limit=20, window_sec=60):
        raise HTTPException(status_code=429, detail="上传过于频繁，请稍后再试")

    asset = Asset(
        user_id=current_user.id,
        asset_type=payload.asset_type,
        name=payload.name,
        storage_key=payload.storage_key,
        mime_type=payload.mime_type,
        size_bytes=payload.size_bytes,
        width=payload.width,
        height=payload.height,
        duration_seconds=payload.duration_seconds,
        prompt=payload.prompt,
        meta=payload.meta or {},
        project_id=payload.project_id,
    )
    db.add(asset)
    db.flush()

    # P0: PRD §4.6 审计：记录上传人、文件名 hash、解析状态
    import hashlib as _hl
    from app.models.agent_audit_log import AgentAuditLog
    name_hash = _hl.sha1(payload.name.encode("utf-8")).hexdigest()[:16] if payload.name else ""
    db.add(AgentAuditLog(
        user_id=current_user.id, event="asset_upload", target_id=str(asset.id),
        tool_name="asset_upload", status="success",
        meta={"nameHash": name_hash, "type": payload.asset_type, "size": payload.size_bytes},
    ))

    # P0: 标记为 pending，异步后台解析/OCR（不阻塞 API 响应）
    if payload.asset_type in ("document", "image") and payload.storage_key:
        asset.text_status = "pending"
        db.flush()
        import asyncio
        import tempfile
        import httpx as _httpx
        from pathlib import Path
        from app.services import doc_processing_service as _dps
        from app.models.asset import Asset as _Asset
        asset_id = asset.id
        storage_key = payload.storage_key
        user = current_user

        async def _parse_in_background():
            db2 = next(get_db())
            try:
                a = db2.query(_Asset).filter(_Asset.id == asset_id).first()
                if not a:
                    return
                path = _get_asset_path(storage_key, user)
                if path and path.exists():
                    try:
                        result = _dps.parse_asset(path)
                    except Exception as exc:
                        result = {"text": None, "text_status": "failed", "text_error": str(exc)[:500]}
                elif storage_key.startswith("http"):
                    # COS / 远程 URL 模式：先下载到临时文件再解析
                    try:
                        with _httpx.Client(timeout=60.0, follow_redirects=True) as c:
                            resp = c.get(storage_key)
                            resp.raise_for_status()
                            ctype = resp.headers.get("content-type", "").lower()
                            suffix = ".png"
                            if "jpeg" in ctype or "jpg" in ctype: suffix = ".jpg"
                            elif "webp" in ctype: suffix = ".webp"
                            elif "pdf" in ctype: suffix = ".pdf"
                            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
                                f.write(resp.content)
                                tmp_path = f.name
                        result = _dps.parse_asset(Path(tmp_path))
                        import os as _os
                        _os.unlink(tmp_path)
                    except Exception as exc:
                        result = {"text": None, "text_status": "failed", "text_error": f"download/parse error: {exc}"}
                else:
                    result = {"text": None, "text_status": "failed", "text_error": "file not on disk and not a URL"}
                a.text = result.get("text")
                a.text_status = result.get("text_status", "failed")
                a.text_length = result.get("text_length")
                a.text_error = result.get("text_error")
                a.ocr_used = result.get("ocr_used")
                db2.commit()
            except Exception:
                db2.rollback()
            finally:
                db2.close()

        try:
            loop = asyncio.get_event_loop()
            loop.create_task(_parse_in_background())
        except RuntimeError:
            pass

    db.commit()
    db.refresh(asset)
    return _append_url(asset)


def _get_asset_path(storage_key: str, user: User):
    """Resolve local disk path for an uploaded asset (before COS)."""
    from pathlib import Path
    from app.core.config import settings
    parts = storage_key.split("/", 1)
    if len(parts) != 2:
        return None
    uid, filename = parts
    path = Path(settings.UPLOAD_DIR) / uid / Path(filename).name
    return path if path.exists() else None


@router.get("/{asset_id}", response_model=AssetOut)
def get_asset(asset_id: UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.user_id == current_user.id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return _append_url(asset)


@router.put("/{asset_id}", response_model=AssetOut)
def update_asset(
    asset_id: UUID,
    payload: AssetUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.user_id == current_user.id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(asset, field, value)

    db.commit()
    db.refresh(asset)
    return _append_url(asset)


@router.delete("/{asset_id}")
def delete_asset(asset_id: UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.user_id == current_user.id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    db.delete(asset)
    db.commit()
    return {"detail": "Asset deleted"}
