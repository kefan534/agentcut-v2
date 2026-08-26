# Based on Toonflow by HBAI-Ltd, licensed under Apache-2.0 + Supplemental License.
"""Short-drama (Toonflow) API router.

P1: project CRUD. P3: script CRUD. P4: novel (chapter) CRUD + event extraction.
Route tree mirrors the AgentCut frontend ``/drama/*`` shell.
AI-driven parts (novel event extraction, script agent streaming) reuse the
P0.5 process-local agent / gateway.
"""
import asyncio
import uuid
from uuid import UUID
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.drama import DramaProject, DramaNovel, DramaScript, DramaAsset, DramaStoryboard, DramaVideo, DramaArtStyle, DramaLockCard
from app.services.drama_agent import extract_novel_events, generate_storyboards_from_script
from app.schemas.drama import (
    DramaProjectCreate,
    DramaProjectUpdate,
    DramaProjectOut,
    DramaNovelCreate,
    DramaNovelUpdate,
    DramaNovelOut,
    DramaScriptCreate,
    DramaScriptUpdate,
    DramaScriptOut,
    DramaAssetCreate,
    DramaAssetUpdate,
    DramaAssetGenerate,
    DramaAssetOut,
    DramaStoryboardCreate,
    DramaStoryboardUpdate,
    DramaStoryboardOut,
    DramaVideoCreate,
    DramaVideoOut,
    DramaArtStyleCreate,
    DramaArtStyleUpdate,
    DramaArtStyleOut,
)

router = APIRouter(prefix="/drama", tags=["drama"])


class _ExtractEventsBody(BaseModel):
    project_id: UUID
    novel_ids: List[UUID] = Field(default_factory=list)


class _GenerateStoryboardsBody(BaseModel):
    project_id: UUID
    script_id: UUID


class _ComposeVideosBody(BaseModel):
    project_id: UUID
    video_ids: List[UUID] = Field(default_factory=list)  # 按此顺序合成


def _get_owned_project(project_id: UUID, user_id: UUID, db: Session) -> DramaProject:
    """Return the project if it exists, is not deleted, and belongs to user."""
    project = db.query(DramaProject).filter(
        DramaProject.id == project_id,
        DramaProject.user_id == user_id,
        DramaProject.is_deleted == "N",
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Drama project not found")
    return project


# --- Projects ---


@router.get("/projects", response_model=List[DramaProjectOut])
def list_drama_projects(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return (
        db.query(DramaProject)
        .filter(
            DramaProject.user_id == current_user.id,
            DramaProject.is_deleted == "N",
        )
        .order_by(DramaProject.updated_at.desc())
        .all()
    )


@router.post("/projects", response_model=DramaProjectOut)
def create_drama_project(
    payload: DramaProjectCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = DramaProject(user_id=current_user.id, **payload.model_dump())
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.get("/projects/{project_id}", response_model=DramaProjectOut)
def get_drama_project(
    project_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = db.query(DramaProject).filter(
        DramaProject.id == project_id,
        DramaProject.user_id == current_user.id,
        DramaProject.is_deleted == "N",
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Drama project not found")
    return project


@router.put("/projects/{project_id}", response_model=DramaProjectOut)
def update_drama_project(
    project_id: UUID,
    payload: DramaProjectUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = db.query(DramaProject).filter(
        DramaProject.id == project_id,
        DramaProject.user_id == current_user.id,
        DramaProject.is_deleted == "N",
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Drama project not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(project, field, value)

    db.commit()
    db.refresh(project)
    return project


@router.delete("/projects/{project_id}")
def delete_drama_project(
    project_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = db.query(DramaProject).filter(
        DramaProject.id == project_id,
        DramaProject.user_id == current_user.id,
        DramaProject.is_deleted == "N",
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Drama project not found")

    project.is_deleted = "Y"
    db.commit()
    return {"detail": "Drama project deleted"}


# --- Task board (任务看板，聚合视图) ---


@router.get("/tasks/summary")
def get_drama_tasks_summary(
    project_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """聚合项目各模块的生成进度（任务看板）。"""
    _get_owned_project(project_id, current_user.id, db)

    def _count(model, extra: Optional[dict] = None):
        q = db.query(model).filter(
            model.user_id == current_user.id,
            model.project_id == project_id,
            model.is_deleted == "N",
        )
        if extra:
            q = q.filter(*extra)
        return q.count()

    scripts_total = _count(DramaScript)
    scripts_extracted = _count(DramaScript, [DramaScript.content.isnot(None)])
    assets_total = _count(DramaAsset)
    assets_done = _count(DramaAsset, [DramaAsset.image_state == "已完成"])
    assets_failed = _count(DramaAsset, [DramaAsset.image_state == "生成失败"])
    storyboards_total = _count(DramaStoryboard)
    storyboards_done = _count(DramaStoryboard, [DramaStoryboard.image_state == "已完成"])
    videos_total = _count(DramaVideo)
    videos_success = _count(DramaVideo, [DramaVideo.state == "成功"])
    videos_failed = _count(DramaVideo, [DramaVideo.state == "失败"])

    return {
        "project_id": project_id,
        "scripts": {"total": scripts_total, "with_content": scripts_extracted},
        "assets": {"total": assets_total, "done": assets_done, "failed": assets_failed},
        "storyboards": {"total": storyboards_total, "done": storyboards_done},
        "videos": {"total": videos_total, "success": videos_success, "failed": videos_failed},
    }


# --- Novels (小说原文) ---


@router.get("/novels", response_model=List[DramaNovelOut])
def list_drama_novels(
    project_id: UUID,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_owned_project(project_id, current_user.id, db)
    return (
        db.query(DramaNovel)
        .filter(
            DramaNovel.user_id == current_user.id,
            DramaNovel.project_id == project_id,
            DramaNovel.is_deleted == "N",
        )
        .order_by(DramaNovel.chapter_index.asc())
        .offset((page - 1) * limit)
        .limit(limit)
        .all()
    )


@router.post("/novels", response_model=List[DramaNovelOut])
def create_drama_novels(
    payload: DramaNovelCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_owned_project(payload.project_id, current_user.id, db)
    # Continue chapter_index from the last chapter of this project.
    last = (
        db.query(DramaNovel)
        .filter(
            DramaNovel.project_id == payload.project_id,
            DramaNovel.is_deleted == "N",
        )
        .order_by(DramaNovel.chapter_index.desc())
        .first()
    )
    next_index = (last.chapter_index + 1) if last else 0

    created = []
    for item in payload.items:
        novel = DramaNovel(
            user_id=current_user.id,
            project_id=payload.project_id,
            chapter_index=next_index,
            reel=item.reel,
            chapter=item.chapter,
            chapter_data=item.chapter_data,
            event_state=0,
        )
        db.add(novel)
        created.append(novel)
        next_index += 1

    db.commit()
    for n in created:
        db.refresh(n)
    return created


@router.put("/novels/{novel_id}", response_model=DramaNovelOut)
def update_drama_novel(
    novel_id: UUID,
    payload: DramaNovelUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    novel = db.query(DramaNovel).filter(
        DramaNovel.id == novel_id,
        DramaNovel.user_id == current_user.id,
        DramaNovel.is_deleted == "N",
    ).first()
    if not novel:
        raise HTTPException(status_code=404, detail="Novel chapter not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(novel, field, value)

    db.commit()
    db.refresh(novel)
    return novel


@router.delete("/novels/{novel_id}")
def delete_drama_novel(
    novel_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    novel = db.query(DramaNovel).filter(
        DramaNovel.id == novel_id,
        DramaNovel.user_id == current_user.id,
        DramaNovel.is_deleted == "N",
    ).first()
    if not novel:
        raise HTTPException(status_code=404, detail="Novel chapter not found")

    novel.is_deleted = "Y"
    db.commit()
    return {"detail": "Novel chapter deleted"}


@router.post("/novels/extract-events")
async def extract_novel_events_endpoint(
    payload: _ExtractEventsBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """异步抽取小说章节事件摘要，写回 event 字段（P4）。"""
    _get_owned_project(payload.project_id, current_user.id, db)
    novel_ids = [str(nid) for nid in payload.novel_ids]
    # 后台异步执行，前端轮询 event_state。
    asyncio.create_task(extract_novel_events(str(current_user.id), str(payload.project_id), novel_ids))
    return {"ok": True, "detail": "事件抽取已开始，请稍后刷新查看结果"}


# --- Scripts (剧本) ---


@router.get("/scripts", response_model=List[DramaScriptOut])
def list_drama_scripts(
    project_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_owned_project(project_id, current_user.id, db)
    return (
        db.query(DramaScript)
        .filter(
            DramaScript.user_id == current_user.id,
            DramaScript.project_id == project_id,
            DramaScript.is_deleted == "N",
        )
        .order_by(DramaScript.updated_at.desc())
        .all()
    )


@router.post("/scripts", response_model=DramaScriptOut)
def create_drama_script(
    payload: DramaScriptCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_owned_project(payload.project_id, current_user.id, db)
    script = DramaScript(
        user_id=current_user.id,
        project_id=payload.project_id,
        name=payload.name,
        content=payload.content,
        extract_state=0,
    )
    db.add(script)
    db.commit()
    db.refresh(script)
    return script


@router.get("/scripts/{script_id}", response_model=DramaScriptOut)
def get_drama_script(
    script_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    script = db.query(DramaScript).filter(
        DramaScript.id == script_id,
        DramaScript.user_id == current_user.id,
        DramaScript.is_deleted == "N",
    ).first()
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    return script


@router.put("/scripts/{script_id}", response_model=DramaScriptOut)
def update_drama_script(
    script_id: UUID,
    payload: DramaScriptUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    script = db.query(DramaScript).filter(
        DramaScript.id == script_id,
        DramaScript.user_id == current_user.id,
        DramaScript.is_deleted == "N",
    ).first()
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(script, field, value)

    db.commit()
    db.refresh(script)
    return script


@router.delete("/scripts/{script_id}")
def delete_drama_script(
    script_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    script = db.query(DramaScript).filter(
        DramaScript.id == script_id,
        DramaScript.user_id == current_user.id,
        DramaScript.is_deleted == "N",
    ).first()
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")

    script.is_deleted = "Y"
    db.commit()
    return {"detail": "Script deleted"}


# --- Assets (资产) ---

_ASSET_TYPE_LABELS = {"role": "角色", "scene": "场景", "tool": "道具"}


def _build_asset_prompt(asset: DramaAsset, project: DramaProject) -> str:
    """Build an image-generation prompt for a short-drama asset (mirrors Toonflow)."""
    cfg_label = _ASSET_TYPE_LABELS.get(asset.type or "", asset.type or "资产")
    prompt_title = {"role": "角色标准四视图", "scene": "标准场景图", "tool": "标准道具图"}.get(asset.type or "", f"{cfg_label}图")
    return (
        f"请根据以下参数生成{prompt_title}：\n"
        f"- 画风风格：{project.art_style or '未指定'}\n"
        f"- {cfg_label}名称：{asset.name}\n"
        f"- 提示词：{asset.prompt or asset.describe or ''}\n"
        f"请严格按照规范生成{prompt_title}。"
    )


@router.get("/assets", response_model=List[DramaAssetOut])
def list_drama_assets(
    project_id: UUID,
    asset_type: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_owned_project(project_id, current_user.id, db)
    q = db.query(DramaAsset).filter(
        DramaAsset.user_id == current_user.id,
        DramaAsset.project_id == project_id,
        DramaAsset.is_deleted == "N",
    )
    if asset_type:
        q = q.filter(DramaAsset.type == asset_type)
    return q.order_by(DramaAsset.created_at.desc()).all()


@router.post("/assets", response_model=DramaAssetOut)
def create_drama_asset(
    payload: DramaAssetCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_owned_project(payload.project_id, current_user.id, db)
    asset = DramaAsset(user_id=current_user.id, **payload.model_dump())
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return asset


@router.put("/assets/{asset_id}", response_model=DramaAssetOut)
def update_drama_asset(
    asset_id: UUID,
    payload: DramaAssetUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = db.query(DramaAsset).filter(
        DramaAsset.id == asset_id,
        DramaAsset.user_id == current_user.id,
        DramaAsset.is_deleted == "N",
    ).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(asset, field, value)

    db.commit()
    db.refresh(asset)
    return asset


@router.delete("/assets/{asset_id}")
def delete_drama_asset(
    asset_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = db.query(DramaAsset).filter(
        DramaAsset.id == asset_id,
        DramaAsset.user_id == current_user.id,
        DramaAsset.is_deleted == "N",
    ).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    asset.is_deleted = "Y"
    db.commit()
    return {"detail": "Asset deleted"}


@router.post("/assets/{asset_id}/generate", response_model=DramaAssetOut)
async def generate_drama_asset(
    asset_id: UUID,
    payload: DramaAssetGenerate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """调用图像模型为资产生成图片，写回 image_url（P5）。"""
    from app.services.model_service import resolve_source_for_variable
    from app.services.gateway_service import call_upstream
    from app.api.gateway.router import _save_generated_media

    asset = db.query(DramaAsset).filter(
        DramaAsset.id == asset_id,
        DramaAsset.user_id == current_user.id,
        DramaAsset.is_deleted == "N",
    ).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    project = _get_owned_project(asset.project_id, current_user.id, db)

    source = resolve_source_for_variable(db, payload.model, current_user)
    if not source or source.modal_category != "image":
        raise HTTPException(status_code=404, detail=f"图像模型不可用：{payload.model}")

    # 标记生成中
    asset.image_state = "生成中"
    asset.image_model = payload.model
    asset.error_reason = None
    db.commit()

    prompt = _build_asset_prompt(asset, project)
    # 图像生成统一走 /images/generations（OpenAI 兼容 + flux-art 均支持），
    # model 显式传真实上游模型名（source.model_version）。
    body = {"model": source.model_version, "prompt": prompt, "size": payload.size, "n": 1}

    try:
        result = await call_upstream(
            source, body, endpoint_override="/images/generations", user_id=str(current_user.id)
        )
        urls = await _save_generated_media(result, current_user, "image")
        if urls:
            asset.image_url = urls[0]
            asset.image_state = "已完成"
        else:
            asset.image_state = "生成失败"
            asset.error_reason = "模型未返回图片"
    except Exception as exc:  # noqa: BLE001
        asset.image_state = "生成失败"
        asset.error_reason = str(exc)[:500]

    db.commit()
    db.refresh(asset)
    return asset


# --- Assets (资产) end ---


# --- Storyboard (分镜) ---


@router.get("/storyboards", response_model=List[DramaStoryboardOut])
def list_drama_storyboards(
    project_id: UUID,
    script_id: Optional[UUID] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_owned_project(project_id, current_user.id, db)
    q = db.query(DramaStoryboard).filter(
        DramaStoryboard.user_id == current_user.id,
        DramaStoryboard.project_id == project_id,
        DramaStoryboard.is_deleted == "N",
    )
    if script_id:
        q = q.filter(DramaStoryboard.script_id == script_id)
    return q.order_by(DramaStoryboard.index.asc()).all()


@router.post("/storyboards", response_model=DramaStoryboardOut)
def create_drama_storyboard(
    payload: DramaStoryboardCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_owned_project(payload.project_id, current_user.id, db)
    sb = DramaStoryboard(user_id=current_user.id, **payload.model_dump())
    db.add(sb)
    db.commit()
    db.refresh(sb)
    return sb


@router.post("/storyboards/generate-from-script")
async def generate_storyboards_from_script_endpoint(
    payload: _GenerateStoryboardsBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """从剧本自动拆解分镜序列（P6）。body: project_id + script_id。"""
    _get_owned_project(payload.project_id, current_user.id, db)
    result = await generate_storyboards_from_script(str(current_user.id), str(payload.project_id), str(payload.script_id))
    if not result.get("ok"):
        raise HTTPException(status_code=422, detail=result.get("error", "分镜拆解失败"))
    return {"ok": True, "count": result.get("count", 0)}


@router.put("/storyboards/{storyboard_id}", response_model=DramaStoryboardOut)
def update_drama_storyboard(
    storyboard_id: UUID,
    payload: DramaStoryboardUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sb = db.query(DramaStoryboard).filter(
        DramaStoryboard.id == storyboard_id,
        DramaStoryboard.user_id == current_user.id,
        DramaStoryboard.is_deleted == "N",
    ).first()
    if not sb:
        raise HTTPException(status_code=404, detail="Storyboard not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(sb, field, value)

    db.commit()
    db.refresh(sb)
    return sb


@router.delete("/storyboards/{storyboard_id}")
def delete_drama_storyboard(
    storyboard_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sb = db.query(DramaStoryboard).filter(
        DramaStoryboard.id == storyboard_id,
        DramaStoryboard.user_id == current_user.id,
        DramaStoryboard.is_deleted == "N",
    ).first()
    if not sb:
        raise HTTPException(status_code=404, detail="Storyboard not found")

    sb.is_deleted = "Y"
    db.commit()
    return {"detail": "Storyboard deleted"}


@router.post("/storyboards/{storyboard_id}/generate-image", response_model=DramaStoryboardOut)
async def generate_storyboard_image(
    storyboard_id: UUID,
    payload: DramaAssetGenerate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """调用图像模型为分镜生成画面图（P6）。"""
    from app.services.model_service import resolve_source_for_variable
    from app.services.gateway_service import call_upstream, compute_cost
    from app.services.credit_service import freeze_credits, settle_frozen_credits, release_frozen_credits
    from app.api.gateway.router import _save_generated_media

    sb = db.query(DramaStoryboard).filter(
        DramaStoryboard.id == storyboard_id,
        DramaStoryboard.user_id == current_user.id,
        DramaStoryboard.is_deleted == "N",
    ).first()
    if not sb:
        raise HTTPException(status_code=404, detail="Storyboard not found")

    project = _get_owned_project(sb.project_id, current_user.id, db)
    source = resolve_source_for_variable(db, payload.model, current_user)
    if not source or source.modal_category != "image":
        raise HTTPException(status_code=404, detail=f"图像模型不可用：{payload.model}")

    prompt = sb.prompt or f"{project.art_style or ''} 分镜画面：{sb.video_desc or ''}"
    body = {"model": source.model_version, "prompt": prompt, "size": payload.size, "n": 1}

    # R2-#5: drama 计费接入 —— 冻结→成功结算/失败释放
    cost = compute_cost(db, payload.model, body, "image")
    try:
        freeze_credits(db=db, user_id=current_user.id, amount=cost, reference_id=str(storyboard_id))
    except ValueError as exc:
        raise HTTPException(status_code=402, detail=str(exc))

    sb.image_state = "生成中"
    sb.error_reason = None
    db.commit()

    generated_ok = False
    try:
        result = await call_upstream(
            source, body, endpoint_override="/images/generations", user_id=str(current_user.id)
        )
        urls = await _save_generated_media(result, current_user, "image")
        if urls:
            sb.image_url = urls[0]
            sb.image_state = "已完成"
            generated_ok = True
        else:
            sb.image_state = "生成失败"
            sb.error_reason = "模型未返回图片"
    except Exception as exc:  # noqa: BLE001
        sb.image_state = "生成失败"
        sb.error_reason = str(exc)[:500]

    if generated_ok:
        try:
            settle_frozen_credits(db=db, user_id=current_user.id, amount=cost, reference_id=str(storyboard_id))
        except ValueError:
            try:
                release_frozen_credits(db=db, user_id=current_user.id, amount=cost, reference_id=str(storyboard_id))
            except ValueError:
                pass
    else:
        try:
            release_frozen_credits(db=db, user_id=current_user.id, amount=cost, reference_id=str(storyboard_id))
        except ValueError:
            pass

    db.commit()
    db.refresh(sb)
    return sb


# --- Video (视频) ---


@router.get("/videos", response_model=List[DramaVideoOut])
def list_drama_videos(
    project_id: UUID,
    script_id: Optional[UUID] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_owned_project(project_id, current_user.id, db)
    q = db.query(DramaVideo).filter(
        DramaVideo.user_id == current_user.id,
        DramaVideo.project_id == project_id,
        DramaVideo.is_deleted == "N",
    )
    if script_id:
        q = q.filter(DramaVideo.script_id == script_id)
    return q.order_by(DramaVideo.created_at.desc()).all()


@router.post("/videos", response_model=DramaVideoOut)
async def create_drama_video(
    payload: DramaVideoCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_owned_project(payload.project_id, current_user.id, db)
    video = DramaVideo(
        user_id=current_user.id,
        project_id=payload.project_id,
        script_id=payload.script_id,
        storyboard_id=payload.storyboard_id,
        prompt=payload.prompt,
        duration=payload.duration,
        model=payload.model,
        state="生成中",
    )
    db.add(video)
    db.commit()
    db.refresh(video)
    asyncio.create_task(_run_video_generation(str(video.id), str(current_user.id)))
    return video


async def _run_video_generation(video_id: str, user_id: str) -> None:
    """后台生成视频：冻结积分 → 调视频模型 → 成功结算/失败释放，写回 video_url/state。"""
    from app.services.model_service import resolve_source_for_variable
    from app.services.gateway_service import call_upstream, _is_fluxart_source, compute_cost
    from app.services.credit_service import freeze_credits, settle_frozen_credits, release_frozen_credits
    from app.api.gateway.router import _save_generated_media

    db = next(get_db())
    try:
        video = db.query(DramaVideo).filter(DramaVideo.id == video_id).first()
        user = db.query(User).filter(User.id == user_id).first()
        if not video or not video.model or not user:
            return
        source = resolve_source_for_variable(db, video.model, user)
        if not source or source.modal_category != "video":
            video.state = "失败"
            video.error_reason = f"视频模型不可用：{video.model}"
            db.commit()
            return

        # 若关联分镜图，作为参考图传入（图生视频）
        reference_urls = []
        if video.storyboard_id:
            sb = db.query(DramaStoryboard).filter(DramaStoryboard.id == video.storyboard_id).first()
            if sb and sb.image_url:
                reference_urls = [sb.image_url]

        body = {
            "model": source.model_version,
            "prompt": video.prompt or "",
            "duration": video.duration,
            "video_mode": "i2v_first" if reference_urls else "t2v",
        }
        if reference_urls:
            body["image_urls"] = reference_urls

        # R2-#5: drama 计费接入 —— 冻结→成功结算/失败释放。
        # 启动恢复路径复用本函数：main.py 先做孤儿冻结对账再恢复任务，不会重复扣费。
        cost = compute_cost(db, video.model, body, "video")
        try:
            freeze_credits(db=db, user_id=user.id, amount=cost, reference_id=str(video_id))
        except ValueError as exc:
            video.state = "失败"
            video.error_reason = str(exc)[:200]
            db.commit()
            return

        generated_ok = False
        try:
            # flux-art（Grok）走 /videos/generations + 轮询；其余模型走各自适配器。
            endpoint = "/videos/generations" if _is_fluxart_source(source) else None
            result = await call_upstream(source, body, endpoint_override=endpoint, user_id=user_id)
            urls = await _save_generated_media(result, user, "video")
            if urls:
                video.video_url = urls[0]
                video.state = "成功"
                generated_ok = True
            else:
                video.state = "失败"
                video.error_reason = "模型未返回视频"
        except Exception as exc:  # noqa: BLE001
            video.state = "失败"
            video.error_reason = str(exc)[:500]

        if generated_ok:
            try:
                settle_frozen_credits(db=db, user_id=user.id, amount=cost, reference_id=str(video_id))
            except ValueError:
                try:
                    release_frozen_credits(db=db, user_id=user.id, amount=cost, reference_id=str(video_id))
                except ValueError:
                    pass
        else:
            try:
                release_frozen_credits(db=db, user_id=user.id, amount=cost, reference_id=str(video_id))
            except ValueError:
                pass
    finally:
        db.commit()
        db.close()


@router.delete("/videos/{video_id}")
def delete_drama_video(
    video_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    video = db.query(DramaVideo).filter(
        DramaVideo.id == video_id,
        DramaVideo.user_id == current_user.id,
        DramaVideo.is_deleted == "N",
    ).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    video.is_deleted = "Y"
    db.commit()
    return {"detail": "Video deleted"}


@router.post("/videos/compose", response_model=DramaVideoOut)
async def compose_drama_videos(
    payload: _ComposeVideosBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """把多个视频片段按顺序合成成片（P1，服务端 ffmpeg）。"""
    _get_owned_project(payload.project_id, current_user.id, db)
    if not payload.video_ids:
        raise HTTPException(status_code=400, detail="video_ids 不能为空")

    # 按传入顺序取视频（校验归属）
    videos = []
    for vid in payload.video_ids:
        v = db.query(DramaVideo).filter(
            DramaVideo.id == vid,
            DramaVideo.user_id == current_user.id,
            DramaVideo.project_id == payload.project_id,
            DramaVideo.is_deleted == "N",
        ).first()
        if not v:
            raise HTTPException(status_code=404, detail=f"视频不存在：{vid}")
        if not v.video_url:
            raise HTTPException(status_code=400, detail=f"视频尚未生成完成：{v.id}")
        videos.append(v)

    from app.services.media_service import compose_videos
    from app.services import cos_service
    from app.services.credit_service import deduct_credits, add_credits
    from app.core.config import settings
    from pathlib import Path
    import uuid as _uuid

    # R2-#5: 合成按次固定计费，失败全额退款
    _COMPOSE_CREDITS = 10
    try:
        deduct_credits(
            db=db, user_id=current_user.id, amount=_COMPOSE_CREDITS,
            reason="compose", reference_id=str(payload.project_id),
        )
    except ValueError as exc:
        raise HTTPException(status_code=402, detail=str(exc))

    try:
        composed_bytes = await compose_videos([v.video_url for v in videos])

        # 上传成片（COS 优先，本地 fallback）
        if cos_service.is_configured():
            key = cos_service.upload_bytes(
                composed_bytes, prefix="generated", user_id=current_user.id,
                content_type="video/mp4", ext="mp4",
            )
            composed_url = cos_service.get_presigned_url(key, expires_in=86400 * 7)
        else:
            user_dir = Path(settings.UPLOAD_DIR) / str(current_user.id)
            user_dir.mkdir(parents=True, exist_ok=True)
            fname = f"{_uuid.uuid4().hex}.mp4"
            (user_dir / fname).write_bytes(composed_bytes)
            composed_url = f"/api/v1/upload/{current_user.id}/{fname}"
    except Exception:
        # 合成/上传失败：退回本次扣减的积分
        add_credits(
            db=db, user_id=current_user.id, delta=_COMPOSE_CREDITS,
            reason="refund", reference_id=str(payload.project_id),
        )
        raise

    # 写回成片记录
    composed = DramaVideo(
        user_id=current_user.id,
        project_id=payload.project_id,
        script_id=videos[0].script_id,
        prompt=f"合成成片（{len(videos)} 个片段）",
        video_url=composed_url,
        duration=sum(v.duration or 0 for v in videos),
        model="ffmpeg-compose",
        state="成功",
    )
    db.add(composed)
    db.commit()
    db.refresh(composed)
    return composed


# --- Storyboard / Video end ---


# --- Art style (画风) ---


@router.get("/art-styles", response_model=List[DramaArtStyleOut])
def list_drama_art_styles(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return (
        db.query(DramaArtStyle)
        .filter(
            DramaArtStyle.user_id == current_user.id,
            DramaArtStyle.is_deleted == "N",
        )
        .order_by(DramaArtStyle.created_at.desc())
        .all()
    )


@router.post("/art-styles", response_model=DramaArtStyleOut)
def create_drama_art_style(
    payload: DramaArtStyleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    style = DramaArtStyle(user_id=current_user.id, **payload.model_dump())
    db.add(style)
    db.commit()
    db.refresh(style)
    return style


@router.put("/art-styles/{style_id}", response_model=DramaArtStyleOut)
def update_drama_art_style(
    style_id: UUID,
    payload: DramaArtStyleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    style = db.query(DramaArtStyle).filter(
        DramaArtStyle.id == style_id,
        DramaArtStyle.user_id == current_user.id,
        DramaArtStyle.is_deleted == "N",
    ).first()
    if not style:
        raise HTTPException(status_code=404, detail="Art style not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(style, field, value)

    db.commit()
    db.refresh(style)
    return style


@router.delete("/art-styles/{style_id}")
def delete_drama_art_style(
    style_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    style = db.query(DramaArtStyle).filter(
        DramaArtStyle.id == style_id,
        DramaArtStyle.user_id == current_user.id,
        DramaArtStyle.is_deleted == "N",
    ).first()
    if not style:
        raise HTTPException(status_code=404, detail="Art style not found")

    style.is_deleted = "Y"
    db.commit()
    return {"detail": "Art style deleted"}


# --- Models (模型与部署设置页) ---


@router.get("/models")
def get_drama_models(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """聚合可用模型按模态分组（设置页展示），复用 AgentCut 模型路由。"""
    from app.models.model import VariableMapping
    from app.services.model_service import resolve_source_for_variable, first_active_source_by_category

    groups: dict = {"text": [], "image": [], "video": [], "audio": []}
    seen = set()
    for m in db.query(VariableMapping).filter(VariableMapping.modal_category.in_(groups.keys())).all():
        if m.variable_name in seen:
            continue
        source = resolve_source_for_variable(db, m.variable_name, current_user)
        if not source:
            continue
        seen.add(m.variable_name)
        groups.setdefault(m.modal_category, []).append({
            "variable_name": m.variable_name,
            "vendor": source.vendor,
            "model_version": source.model_version,
        })

    # 兜底：直接按模态取活跃源
    for cat in ("text", "image", "video", "audio"):
        if not groups.get(cat):
            source = first_active_source_by_category(db, cat, current_user)
            if source:
                groups[cat].append({
                    "variable_name": source.model_version,
                    "vendor": source.vendor,
                    "model_version": source.model_version,
                })

    return {"ok": True, "models": groups}


# --- Art style / Models end ---


# ---------------------------------------------------------------------------
# P1-6 全局锁定卡（Global Lock Card）
# ---------------------------------------------------------------------------

class DramaLockCardBody(BaseModel):
    style: Optional[str] = None
    characters: Optional[str] = None
    scenes: Optional[str] = None
    props: Optional[str] = None
    hard_rules: Optional[str] = None


def _lock_card_payload(card: Optional[DramaLockCard], project_id: UUID) -> dict:
    return {
        "exists": card is not None,
        "project_id": str(project_id),
        "style": card.style if card else None,
        "characters": card.characters if card else None,
        "scenes": card.scenes if card else None,
        "props": card.props if card else None,
        "hard_rules": card.hard_rules if card else None,
    }


@router.get("/{project_id}/lock-card")
def get_lock_card(
    project_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取项目的全局锁定卡（不存在时返回 exists=false）。"""
    _get_owned_project(project_id, current_user.id, db)
    card = (
        db.query(DramaLockCard)
        .filter(DramaLockCard.project_id == project_id, DramaLockCard.is_deleted == "N")
        .first()
    )
    return _lock_card_payload(card, project_id)


@router.put("/{project_id}/lock-card")
def upsert_lock_card(
    project_id: UUID,
    body: DramaLockCardBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """创建或更新项目的全局锁定卡（每个项目唯一一张）。"""
    _get_owned_project(project_id, current_user.id, db)
    card = (
        db.query(DramaLockCard)
        .filter(DramaLockCard.project_id == project_id, DramaLockCard.is_deleted == "N")
        .first()
    )
    if not card:
        card = DramaLockCard(id=uuid.uuid4(), user_id=current_user.id, project_id=project_id)
        db.add(card)
    card.style = body.style
    card.characters = body.characters
    card.scenes = body.scenes
    card.props = body.props
    card.hard_rules = body.hard_rules
    db.commit()
    db.refresh(card)
    return _lock_card_payload(card, project_id)
