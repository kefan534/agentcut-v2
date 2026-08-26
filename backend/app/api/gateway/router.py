import uuid
import time
import json
import base64
import asyncio
import logging
from pathlib import Path
from typing import Any, Dict, Optional, List
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Request, File, UploadFile
from fastapi.responses import StreamingResponse, JSONResponse, FileResponse, Response
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from app.db.session import get_db
from app.core.deps import get_current_user, get_current_user_optional
from app.models.user import User
from app.models.model import ApiSource
from app.services.model_service import resolve_source_for_variable, list_available_models, build_catalog
from app.services.provider_adapters import list_provider_adapters
from app.services.gateway_service import call_upstream, stream_upstream, log_call, _is_private_url, _is_backend_upload_url
from app.services.credit_service import deduct_credits
from app.services.async_job_service import create_job, get_job, submit_and_run, list_jobs_for_user
from app.services.upload_service import save_upload_file, get_upload_file_path
from app.schemas.model import AvailableModelOut, CatalogModelOut
from app.schemas.log import CallLogOut
from app.models.log import CallLog
from app.api.gateway import sessions as sessions_router

router = APIRouter(prefix="/gateway", tags=["gateway"])
router.include_router(sessions_router.router)


def _get_request_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    return forwarded.split(",")[0].strip() if forwarded else request.client.host if request.client else ""


# ---------------------------------------------------------------------------
# Model catalog / listing
# ---------------------------------------------------------------------------

@router.get("/models", response_model=list[AvailableModelOut])
def get_models(
    current_user: Optional[User] = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    return list_available_models(db, current_user)


@router.get("/models/catalog", response_model=list[CatalogModelOut])
def get_model_catalog(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Palmier-compatible model catalog."""
    return build_catalog(db, current_user)


@router.get("/adapters")
def list_adapters(current_user: User = Depends(get_current_user)):
    """P2-10 多供应商格式适配器注册表（只读能力登记，供模型控制台展示）。"""
    return {"providers": list_provider_adapters()}


class QuoteRequest(BaseModel):
    variable_name: str
    params: Dict[str, Any] = {}
    modal_category: Optional[str] = None


@router.post("/quote")
def quote_credits(payload: QuoteRequest, db: Session = Depends(get_db)):
    """报价：根据模型变量名 + 参数，返回本次生成要扣的积分（供前端按钮预览）。"""
    from app.services.gateway_service import resolve_credits
    credits = resolve_credits(db, payload.variable_name, payload.params, payload.modal_category)
    return {"variable_name": payload.variable_name, "credits": credits}


@router.get("/logs", response_model=list[CallLogOut])
def get_generation_logs(
    modal_category: str,
    limit: int = 50,
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the current user's generation history for a given modal category."""
    query = db.query(CallLog).filter(
        CallLog.user_id == current_user.id,
        CallLog.modal_category == modal_category,
    ).order_by(CallLog.created_at.desc())
    return query.offset(offset).limit(limit).all()


# ---------------------------------------------------------------------------
# Media upload (replaces Convex staging upload)
# ---------------------------------------------------------------------------

@router.post("/upload")
async def gateway_upload(
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """Upload a media file and receive a storageId usable by transcription/generation."""
    result = await save_upload_file(request, file, current_user)
    return {
        "storageId": result["storage_key"],
        "filename": result["filename"],
        "content_type": result["content_type"],
        "url": result["url"],
    }


# ---------------------------------------------------------------------------
# Transcription jobs (replaces Convex transcriptions:*)
# ---------------------------------------------------------------------------

class TranscriptionSubmit(BaseModel):
    storageId: str
    durationSeconds: float = 0
    language: Optional[str] = None
    projectId: Optional[str] = None


@router.post("/transcription/submit")
async def transcription_submit(
    payload: TranscriptionSubmit,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Submit an async transcription job. Returns a jobId to poll."""
    # Validate the uploaded file exists and belongs to the caller.
    try:
        file_path = get_upload_file_path(payload.storageId, current_user)
    except HTTPException:
        raise HTTPException(status_code=404, detail="Storage file not found")

    request_body = {
        "storageId": payload.storageId,
        "durationSeconds": payload.durationSeconds,
        "language": payload.language,
        "projectId": payload.projectId,
        "file_path": str(file_path),
        "content_type": None,
    }

    job_id = create_job("TRANSCRIPTION", request_body, str(current_user.id), kind="transcription")
    asyncio.create_task(_run_transcription_job(job_id, request_body, str(current_user.id)))

    job = get_job(job_id)
    return {
        "jobId": job_id,
        "status": job["status"],
        "createdAt": job["created_at"],
    }


@router.get("/transcription/{job_id}/status")
def transcription_status(
    job_id: str,
    current_user: User = Depends(get_current_user),
):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if str(job.get("user_id")) != str(current_user.id):
        raise HTTPException(status_code=403, detail="Not your job")

    return {
        "jobId": job["id"],
        "status": job["status"],
        "errorMessage": job.get("error_message"),
        "createdAt": job.get("created_at"),
        "completedAt": job.get("completed_at"),
    }


@router.get("/transcription/{job_id}/result")
async def transcription_result(
    job_id: str,
    current_user: User = Depends(get_current_user),
):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if str(job.get("user_id")) != str(current_user.id):
        raise HTTPException(status_code=403, detail="Not your job")
    if job.get("status") != "succeeded":
        raise HTTPException(status_code=400, detail="Transcription not ready")

    result_path = _transcription_result_path(job_id)
    if not result_path.exists():
        raise HTTPException(status_code=404, detail="Transcription result not found")

    return FileResponse(result_path, media_type="application/json")


def _transcription_result_path(job_id: str):
    from pathlib import Path
    from app.core.config import settings
    path = Path(settings.UPLOAD_DIR) / "transcriptions"
    path.mkdir(parents=True, exist_ok=True)
    return path / f"{job_id}.json"


async def _run_transcription_job(job_id: str, request_body: Dict[str, Any], user_id: str):
    """Background worker for transcription. Falls back to a local mock if no upstream is configured."""
    from app.db.session import SessionLocal
    from uuid import UUID

    job = get_job(job_id)
    if job is None:
        return

    db = SessionLocal()
    try:
        try:
            uid = UUID(user_id)
        except ValueError:
            job["status"] = "failed"
            job["error_message"] = "Invalid user id"
            job["completed_at"] = _now_ms()
            return

        user = db.query(User).filter(User.id == uid, User.status == "active").first()
        if not user:
            job["status"] = "failed"
            job["error_message"] = "User not found or banned"
            job["completed_at"] = _now_ms()
            return

        source = resolve_source_for_variable(db, "TRANSCRIPTION", user)
        from app.services.gateway_service import resolve_credits
        cost = resolve_credits(db, "TRANSCRIPTION", {}, "audio")

        try:
            deduct_credits(
                db=db,
                user_id=user.id,
                amount=cost,
                reason="transcription",
                reference_id=job_id,
            )
        except ValueError:
            job["status"] = "failed"
            job["error_message"] = "Insufficient credits"
            job["completed_at"] = _now_ms()
            return

        job["status"] = "running"
        job["cost_credits"] = cost

        try:
            if source:
                # Forward to an upstream transcription service if configured.
                payload = {
                    "storageId": request_body["storageId"],
                    "durationSeconds": request_body["durationSeconds"],
                    "language": request_body.get("language"),
                    "projectId": request_body.get("projectId"),
                }
                result = await call_upstream(source, payload, user_id=user_id)
            else:
                # Local mock: produce a placeholder transcript so the Palmier UI works.
                duration = request_body.get("durationSeconds") or 0
                placeholder_text = "（本地转写占位）未配置上游转写服务。请在 infinite-canvas-backend 后台添加 TRANSCRIPTION 变量对应的 API source。"
                segment = {
                    "start": 0.0,
                    "end": max(duration, 1.0),
                    "text": placeholder_text,
                    "speaker": None,
                }
                result = {
                    "text": placeholder_text,
                    "language": request_body.get("language") or "auto",
                    "words": [],
                    "segments": [segment],
                }

            result_path = _transcription_result_path(job_id)
            with open(result_path, "w", encoding="utf-8") as f:
                json.dump(result, f, ensure_ascii=False)

            job["status"] = "succeeded"
            job["result_urls"] = [f"/api/v1/gateway/transcription/{job_id}/result"]
            job["completed_at"] = _now_ms()
        except Exception as e:
            from app.services.credit_service import add_credits
            add_credits(
                db=db,
                user_id=user.id,
                delta=cost,
                reason="refund",
                reference_id=job_id,
            )
            job["status"] = "failed"
            job["error_message"] = str(e)[:500]
            job["completed_at"] = _now_ms()
    finally:
        db.close()


def _now_ms() -> int:
    return int(time.time() * 1000)


# (removed) legacy gateway/agent/stream endpoint — superseded by /api/v1/agent (local agent loop).
# Kept as a marker so the route file structure is preserved; do not re-add the
# hard-coded "TEXT_MODEL" branch here.

# ---------------------------------------------------------------------------
# Generic gateway generation (sync / async / proxy)
# ---------------------------------------------------------------------------

async def _save_generated_media(
    result: Any,
    current_user: User,
    modal_category: str,
) -> List[str]:
    """Persist generated media (image base64 or external URL) to COS.
    Returns public COS URLs that can be displayed by the frontend."""
    from app.core.config import settings
    from app.services import cos_service
    urls: List[str] = []
    if not isinstance(result, dict):
        return urls

    data_arr = result.get("data")
    items = data_arr if isinstance(data_arr, list) else [result]

    cos_ready = cos_service.is_configured()
    user_dir = Path(settings.UPLOAD_DIR) / str(current_user.id)
    if not cos_ready:
        user_dir.mkdir(parents=True, exist_ok=True)

    for item in items:
        if not isinstance(item, dict):
            continue
        b64 = item.get("b64_json") or item.get("b64")
        if b64:
            try:
                raw = base64.b64decode(b64)
            except Exception:
                continue
            mime = item.get("mime_type") or item.get("mimeType") or ""
            ext = ".png"
            content_type = "image/png"
            if "jpeg" in mime or "jpg" in mime:
                ext = ".jpg"; content_type = "image/jpeg"
            elif "webp" in mime:
                ext = ".webp"; content_type = "image/webp"
            elif "gif" in mime:
                ext = ".gif"; content_type = "image/gif"
            elif "mp4" in mime:
                ext = ".mp4"; content_type = "video/mp4"
            # 上传 COS（优先），否则写本地
            if cos_ready:
                try:
                    cos_url = cos_service.upload_bytes(
                        raw, prefix="generated", user_id=current_user.id,
                        content_type=content_type, ext=ext.lstrip("."),
                    )
                    urls.append(cos_url)
                    continue
                except Exception:
                    pass  # fallback to local
            fname = f"{uuid.uuid4().hex}{ext}"
            fpath = user_dir / fname
            fpath.write_bytes(raw)
            urls.append(f"/api/v1/upload/{current_user.id}/{fname}")
            continue
        # External URL: download → upload to COS
        ext_url = item.get("url") or item.get("video_url") or item.get("audio_url")
        if isinstance(ext_url, str) and ext_url:
            saved_url = await _persist_external_url(ext_url, user_dir, current_user.id, modal_category)
            if saved_url:
                urls.append(saved_url)
            else:
                logger.warning("External URL persistence failed and was skipped to avoid returning a potentially expired URL: %s", ext_url)
    return urls


async def _persist_external_url(url: str, user_dir: Path, user_id: int | str, modal_category: str) -> Optional[str]:
    """Download an external media URL and upload to COS (or save locally as fallback)."""
    import httpx
    from app.services import cos_service

    # SSRF guard: refuse private / loopback / metadata URLs before fetching.
    if _is_private_url(url):
        logger.warning("Blocked fetch of private URL (SSRF guard): %s", url)
        return None

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=15.0), follow_redirects=False) as client:
            # R2-#4: 禁用自动跟随重定向，改为手动逐跳（≤3 跳）并每跳重新过 SSRF 检查，
            # 防止上游返回 302 到内网/云元数据地址绕过预检。
            from urllib.parse import urljoin
            current_url: str = url
            response: Optional[httpx.Response] = None
            for _hop in range(3):
                if _is_private_url(current_url):
                    logger.warning("Blocked fetch of private URL (SSRF guard): %s", current_url)
                    return None
                response = await client.get(current_url)
                if response.is_redirect:
                    loc = response.headers.get("location")
                    if not loc:
                        return None
                    current_url = urljoin(current_url, loc)
                    continue
                break
            else:
                # 连续 3 跳仍在重定向：放弃该 URL
                logger.warning("Redirect hop limit exceeded, giving up: %s", url)
                return None
            if response is None or response.status_code >= 400:
                return None
            content_type = response.headers.get("content-type", "").lower()
            ext = ".bin"
            if "mp4" in content_type:
                ext = ".mp4"
            elif "webm" in content_type:
                ext = ".webm"
            elif "png" in content_type:
                ext = ".png"
            elif "jpeg" in content_type or "jpg" in content_type:
                ext = ".jpg"
            elif "webp" in content_type:
                ext = ".webp"
            elif "gif" in content_type:
                ext = ".gif"
            elif modal_category == "video":
                ext = ".mp4"
            elif modal_category == "audio":
                ext = ".mp3"
            elif modal_category == "image":
                ext = ".png"
            fname = f"{uuid.uuid4().hex}{ext}"
            # 优先上传 COS
            if cos_service.is_configured():
                try:
                    cos_url = cos_service.upload_bytes(
                        response.content, prefix="generated", user_id=user_id,
                        content_type=content_type or "application/octet-stream", ext=ext.lstrip("."),
                    )
                    return cos_url
                except Exception:
                    pass  # fallback to local
            fpath = user_dir / fname
            fpath.write_bytes(response.content)
            return f"/api/v1/upload/{user_id}/{fname}"
    except Exception:
        return None


async def _save_binary_response(
    content: bytes,
    current_user: User,
    content_type: str,
) -> str:
    """Save a binary upstream response (e.g. video bytes) to disk and return its URL."""
    from app.core.config import settings
    ext = ".bin"
    ct = (content_type or "").lower()
    if "mp4" in ct:
        ext = ".mp4"
    elif "webm" in ct:
        ext = ".webm"
    elif "png" in ct:
        ext = ".png"
    elif "jpeg" in ct or "jpg" in ct:
        ext = ".jpg"
    elif "webp" in ct:
        ext = ".webp"
    # 优先上传 COS
    from app.services import cos_service
    if cos_service.is_configured():
        try:
            return cos_service.upload_bytes(
                content, prefix="generated", user_id=current_user.id,
                content_type=ct or "application/octet-stream", ext=ext.lstrip("."),
            )
        except Exception:
            pass
    user_dir = Path(settings.UPLOAD_DIR) / str(current_user.id)
    user_dir.mkdir(parents=True, exist_ok=True)
    fname = f"{uuid.uuid4().hex}{ext}"
    fpath = user_dir / fname
    fpath.write_bytes(content)
    return f"/api/v1/upload/{current_user.id}/{fname}"


async def _run_gateway(
    variable_name: str,
    body: Dict[str, Any],
    current_user: User,
    db: Session,
    endpoint_override: Optional[str] = None,
    raw_stream: bool = False,
    raw_response: bool = False,
):
    source = resolve_source_for_variable(db, variable_name, current_user)
    if not source:
        raise HTTPException(status_code=404, detail=f"No active model for variable {variable_name}")

    modal_category = source.modal_category
    # R2-#1: 统一计费口径 —— 与异步任务/报价共用 compute_cost（定价规则优先，COST_MAP 兜底）
    from app.services.gateway_service import compute_cost
    cost = compute_cost(db, variable_name, body, modal_category)

    try:
        deduct_credits(
            db=db,
            user_id=current_user.id,
            amount=cost,
            reason="generation",
            reference_id=str(uuid.uuid4()),
        )
    except ValueError:
        raise HTTPException(status_code=402, detail="Insufficient credits")

    # P0-2: 扣费成功后登记任务，供统一任务中心聚合
    gen_job_id = create_job(variable_name, dict(body), str(current_user.id))
    gen_job = get_job(gen_job_id)
    if gen_job:
        gen_job["cost_credits"] = cost

    request_id = str(uuid.uuid4())
    start = time.time()

    try:
        stream = body.pop("stream", False) if endpoint_override is None else False
        if raw_stream:
            stream = True

        if stream and modal_category == "text":
            async def event_stream():
                try:
                    async for chunk in stream_upstream(source, body, endpoint_override=endpoint_override):
                        yield chunk
                except Exception as e:
                    # P1-2：流式生成中途失败，退回已扣积分
                    from app.services.credit_service import add_credits
                    try:
                        add_credits(
                            db=db,
                            user_id=current_user.id,
                            delta=cost,
                            reason="refund",
                            reference_id=request_id,
                        )
                        log_call(
                            db=db,
                            request_id=request_id,
                            user=current_user,
                            variable_name=variable_name,
                            source=source,
                            modal_category=modal_category,
                            status="failed",
                            status_code=None,
                            latency_ms=0,
                            error_message=str(e)[:500],
                            cost_credits=0,
                            request_body=body,
                            response_summary={},
                        )
                    except Exception:
                        pass
                    yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"

            log_call(
                db=db,
                request_id=request_id,
                user=current_user,
                variable_name=variable_name,
                source=source,
                modal_category=modal_category,
                status="pending",
                status_code=None,
                latency_ms=0,
                error_message=None,
                cost_credits=cost,
                request_body=body,
                response_summary={"stream": True},
            )
            return StreamingResponse(event_stream(), media_type="text/event-stream")

        if gen_job:
            gen_job["status"] = "running"
        result = await call_upstream(source, body, endpoint_override=endpoint_override, user_id=str(current_user.id))
        latency = (time.time() - start) * 1000

        # Persist generated media so it survives page reloads.
        if isinstance(result, bytes):
            content_type = "application/octet-stream"
            saved_url = await _save_binary_response(result, current_user, content_type)
            generated_files = [saved_url]
        else:
            generated_files = await _save_generated_media(result, current_user, modal_category)

        if gen_job:
            gen_job["status"] = "succeeded"
            gen_job["result_urls"] = generated_files
            gen_job["completed_at"] = _now_ms()

        log_call(
            db=db,
            request_id=request_id,
            user=current_user,
            variable_name=variable_name,
            source=source,
            modal_category=modal_category,
            status="success",
            status_code=200,
            latency_ms=latency,
            error_message=None,
            cost_credits=cost,
            request_body=body,
            response_summary={"upstream_status": "ok", "generated_files": generated_files},
        )

        # Proxy mode returns the raw upstream response so the web UI parsers work.
        if isinstance(result, bytes):
            return Response(
                content=result,
                media_type="application/octet-stream",
                headers={"X-Generated-Files": json.dumps(generated_files)},
            )
        if raw_response:
            return JSONResponse(content={
                **result,
                "generated_files": generated_files,
            })
        return JSONResponse(content={
            "request_id": request_id,
            "variable_name": variable_name,
            "source": {
                "vendor": source.vendor,
                "model_version": source.model_version,
                "source_name": source.source_name,
            },
            "data": result,
            "generated_files": generated_files,
        })

    except Exception as e:
        if gen_job:
            gen_job["status"] = "failed"
            gen_job["error_message"] = str(e)[:500]
            gen_job["completed_at"] = _now_ms()
        latency = (time.time() - start) * 1000
        from app.services.credit_service import add_credits
        add_credits(
            db=db,
            user_id=current_user.id,
            delta=cost,
            reason="refund",
            reference_id=request_id,
        )
        log_call(
            db=db,
            request_id=request_id,
            user=current_user,
            variable_name=variable_name,
            source=source,
            modal_category=modal_category,
            status="failed",
            status_code=None,
            latency_ms=latency,
            error_message=str(e)[:500],
            cost_credits=0,
            request_body=body,
            response_summary={},
        )
        raise HTTPException(status_code=502, detail=f"Upstream error: {e}")


class ProxyPayload(BaseModel):
    endpoint: str
    body: Dict[str, Any]
    stream: bool = False


@router.post("/{variable_name}/proxy")
async def gateway_proxy(
    variable_name: str,
    payload: ProxyPayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return await _run_gateway(
        variable_name,
        payload.body,
        current_user,
        db,
        endpoint_override=payload.endpoint,
        raw_stream=payload.stream,
        raw_response=True,
    )


class SubmitJobResponse(BaseModel):
    job_id: str
    status: str
    created_at: int


@router.post("/{variable_name}/submit", response_model=SubmitJobResponse)
async def gateway_submit(
    variable_name: str,
    body: Dict[str, Any],
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Submit an async generation job. Returns immediately; poll /status/{job_id}."""
    source = resolve_source_for_variable(db, variable_name, current_user)
    if not source:
        raise HTTPException(status_code=404, detail=f"No active model for variable {variable_name}")

    job_id = create_job(variable_name, body, str(current_user.id))
    # Fire-and-forget background task
    asyncio.create_task(submit_and_run(job_id, variable_name, body, str(current_user.id)))

    job = get_job(job_id)
    return SubmitJobResponse(
        job_id=job_id,
        status=job["status"],
        created_at=job["created_at"],
    )


@router.get("/{variable_name}/status/{job_id}")
def gateway_status(
    variable_name: str,
    job_id: str,
    current_user: User = Depends(get_current_user),
):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if str(job.get("user_id")) != str(current_user.id):
        raise HTTPException(status_code=403, detail="Not your job")
    return {
        "job_id": job["id"],
        "variable_name": job["variable_name"],
        "status": job["status"],
        "result_urls": job.get("result_urls"),
        "error_message": job.get("error_message"),
        "cost_credits": job.get("cost_credits"),
        "created_at": job.get("created_at"),
        "completed_at": job.get("completed_at"),
    }


# ---------------------------------------------------------------------------
# Unified task center: list + retry (P0-2)
# Registered BEFORE /{variable_name} so that "jobs" is not captured as a
# path variable by the generic generation route below.
# ---------------------------------------------------------------------------

@router.get("/jobs")
def list_user_jobs(
    current_user: User = Depends(get_current_user),
):
    """List the current user's generation tasks (sync + async jobs)."""
    jobs = list_jobs_for_user(str(current_user.id))
    return [
        {
            "job_id": j["id"],
            "variable_name": j["variable_name"],
            "status": j["status"],
            "cost_credits": j.get("cost_credits"),
            "result_urls": j.get("result_urls"),
            "error_message": j.get("error_message"),
            "created_at": j.get("created_at"),
            "completed_at": j.get("completed_at"),
        }
        for j in jobs
    ]


@router.post("/jobs/{job_id}/retry")
async def retry_user_job(
    job_id: str,
    current_user: User = Depends(get_current_user),
):
    """Retry a task with its original request body (re-runs via async worker).

    仅允许重试「failed」任务：失败任务已退款（净 0），重试重新计费是正确的；
    对 queued/running/succeeded 任务重试会造成重复扣费或并发重复执行。
    """
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if str(job.get("user_id")) != str(current_user.id):
        raise HTTPException(status_code=403, detail="Not your job")
    if job.get("status") != "failed":
        raise HTTPException(status_code=400, detail="仅失败的任务可重试")
    request_body = dict(job.get("request_body") or {})
    request_body.pop("stream", None)  # 移除流式标记，重试按普通异步任务执行
    # R2-#3: 按任务 kind 分发到对应执行器，避免转写任务被当成通用生成跑
    kind = job.get("kind") or "generation"
    new_id = create_job(job["variable_name"], request_body, str(current_user.id), kind=kind)
    if kind == "transcription":
        asyncio.create_task(_run_transcription_job(new_id, request_body, str(current_user.id)))
    else:
        asyncio.create_task(submit_and_run(new_id, job["variable_name"], request_body, str(current_user.id)))
    new_job = get_job(new_id)
    return {
        "job_id": new_id,
        "status": new_job["status"],
        "created_at": new_job["created_at"],
    }


# Generic sync generation endpoint. Must be registered AFTER the specific
# /{variable_name}/... sub-routes so that /proxy, /submit and /status are
# not shadowed by this path parameter.
@router.post("/{variable_name}")
async def gateway_generate(
    variable_name: str,
    body: Dict[str, Any],
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return await _run_gateway(variable_name, body, current_user, db)
