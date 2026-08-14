"""Short-drama (Toonflow) API router.

P1: project CRUD. P3: script CRUD. P4: novel (chapter) CRUD + event extraction.
Route tree mirrors the AgentCut frontend ``/drama/*`` shell.
AI-driven parts (novel event extraction, script agent streaming) reuse the
P0.5 process-local agent / gateway.
"""
import asyncio
from uuid import UUID
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.drama import DramaProject, DramaNovel, DramaScript, DramaAsset, DramaStoryboard, DramaVideo
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
)

router = APIRouter(prefix="/drama", tags=["drama"])


class _ExtractEventsBody(BaseModel):
    project_id: UUID
    novel_ids: List[UUID] = Field(default_factory=list)


class _GenerateStoryboardsBody(BaseModel):
    project_id: UUID
    script_id: UUID


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
    body = {"prompt": prompt, "size": payload.size, "n": 1}

    try:
        result = await call_upstream(source, body, user_id=str(current_user.id))
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
    from app.services.gateway_service import call_upstream
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

    sb.image_state = "生成中"
    sb.error_reason = None
    db.commit()

    prompt = sb.prompt or f"{project.art_style or ''} 分镜画面：{sb.video_desc or ''}"
    body = {"prompt": prompt, "size": payload.size, "n": 1}

    try:
        result = await call_upstream(source, body, user_id=str(current_user.id))
        urls = await _save_generated_media(result, current_user, "image")
        if urls:
            sb.image_url = urls[0]
            sb.image_state = "已完成"
        else:
            sb.image_state = "生成失败"
            sb.error_reason = "模型未返回图片"
    except Exception as exc:  # noqa: BLE001
        sb.image_state = "生成失败"
        sb.error_reason = str(exc)[:500]

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
    """后台生成视频：调视频模型，写回 video_url/state。"""
    from app.services.model_service import resolve_source_for_variable
    from app.services.gateway_service import call_upstream
    from app.api.gateway.router import _save_generated_media

    db = next(get_db())
    try:
        video = db.query(DramaVideo).filter(DramaVideo.id == video_id).first()
        user = db.query(User).filter(User.id == user_id).first()
        if not video or not video.model:
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

        body = {"prompt": video.prompt or "", "duration": video.duration, "n": 1}
        if reference_urls:
            body["image_urls"] = reference_urls

        result = await call_upstream(source, body, user_id=user_id)
        urls = await _save_generated_media(result, user, "video")
        if urls:
            video.video_url = urls[0]
            video.state = "成功"
        else:
            video.state = "失败"
            video.error_reason = "模型未返回视频"
    except Exception as exc:  # noqa: BLE001
        video.state = "失败"
        video.error_reason = str(exc)[:500]
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


# --- Storyboard / Video end ---
