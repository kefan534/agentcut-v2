# Based on Toonflow by HBAI-Ltd, licensed under Apache-2.0 + Supplemental License.
"""Export / import a drama (short-drama) project as a self-contained JSON bundle.

Endpoints (mounted under the drama router prefix /api/v1/drama):
- GET  /{project_id}/export  -> download a JSON bundle of the project + all children
- POST /import               -> create a brand new project (+children) for the caller

The bundle is fully owned by the current user: every id is regenerated on import,
and only ``current_user``'s data is ever read or written.
"""
import json
import uuid
from datetime import datetime
from typing import Any, Dict, List
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.drama import (
    DramaArtStyle,
    DramaAsset,
    DramaNovel,
    DramaProject,
    DramaScript,
    DramaStoryboard,
    DramaVideo,
)
from app.models.user import User

router = APIRouter(prefix="/drama", tags=["drama-export-import"])

# Columns that are internal bookkeeping and never part of the public bundle.
_INTERNAL_COLUMNS = {"created_at", "updated_at", "is_deleted"}


# --------------------------------------------------------------------------- #
# Request / response models
# --------------------------------------------------------------------------- #
class DramaExportBundle(BaseModel):
    """A serialized drama project tree (matches the export payload)."""

    version: int = 1
    project: Dict[str, Any]
    novels: List[Dict[str, Any]] = Field(default_factory=list)
    scripts: List[Dict[str, Any]] = Field(default_factory=list)
    assets: List[Dict[str, Any]] = Field(default_factory=list)
    storyboards: List[Dict[str, Any]] = Field(default_factory=list)
    videos: List[Dict[str, Any]] = Field(default_factory=list)
    art_styles: List[Dict[str, Any]] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _to_public_dict(obj) -> Dict[str, Any]:
    """Serialize a SQLAlchemy row to a plain dict, dropping internal columns."""
    data: Dict[str, Any] = {}
    for col in obj.__table__.columns:
        name = col.name
        if name in _INTERNAL_COLUMNS:
            continue
        value = getattr(obj, name)
        if isinstance(value, uuid.UUID):
            value = str(value)
        elif isinstance(value, datetime):
            value = value.isoformat()
        data[name] = value
    return data


def _build_instance(Model, raw: Dict[str, Any], *, new_id: uuid.UUID, user_id: uuid.UUID, project_id: uuid.UUID | None, extra_fk: Dict[str, Any] | None = None) -> Any:
    """Create a model instance from a raw bundle dict.

    ``id`` / ``user_id`` / ``project_id`` are always overridden. Optional FK
    columns (e.g. storyboard.script_id) are supplied through ``extra_fk``.
    """
    controlled = {"id", "user_id", "project_id", "created_at", "updated_at", "is_deleted"}
    if extra_fk:
        controlled |= set(extra_fk.keys())

    data: Dict[str, Any] = {}
    for col in Model.__table__.columns:
        name = col.name
        if name in controlled:
            continue
        if name in raw:
            value = raw[name]
            # 字符串字段按列长度截断，防止超长字段撑爆数据库
            col_type = col.type
            if isinstance(value, str) and getattr(col_type, "length", None):
                value = value[: col_type.length]
            data[name] = value

    instance = Model(id=new_id, user_id=user_id, **data)
    if project_id is not None and "project_id" in Model.__table__.columns:
        instance.project_id = project_id
    if extra_fk:
        for fk_name, fk_value in extra_fk.items():
            setattr(instance, fk_name, fk_value)
    return instance


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #
@router.get("/{project_id}/export")
def export_drama_project(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> JSONResponse:
    """Download a JSON bundle of the project and all its non-deleted children."""
    project = (
        db.query(DramaProject)
        .filter(
            DramaProject.id == project_id,
            DramaProject.user_id == current_user.id,
            DramaProject.is_deleted == "N",
        )
        .first()
    )
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在或无权访问")

    novels = (
        db.query(DramaNovel)
        .filter(
            DramaNovel.project_id == project_id,
            DramaNovel.user_id == current_user.id,
            DramaNovel.is_deleted == "N",
        )
        .all()
    )
    scripts = (
        db.query(DramaScript)
        .filter(
            DramaScript.project_id == project_id,
            DramaScript.user_id == current_user.id,
            DramaScript.is_deleted == "N",
        )
        .all()
    )
    assets = (
        db.query(DramaAsset)
        .filter(
            DramaAsset.project_id == project_id,
            DramaAsset.user_id == current_user.id,
            DramaAsset.is_deleted == "N",
        )
        .all()
    )
    storyboards = (
        db.query(DramaStoryboard)
        .filter(
            DramaStoryboard.project_id == project_id,
            DramaStoryboard.user_id == current_user.id,
            DramaStoryboard.is_deleted == "N",
        )
        .all()
    )
    videos = (
        db.query(DramaVideo)
        .filter(
            DramaVideo.project_id == project_id,
            DramaVideo.user_id == current_user.id,
            DramaVideo.is_deleted == "N",
        )
        .all()
    )
    # Art styles are user-scoped (no project_id); export the caller's active ones.
    art_styles = (
        db.query(DramaArtStyle)
        .filter(
            DramaArtStyle.user_id == current_user.id,
            DramaArtStyle.is_deleted == "N",
        )
        .all()
    )

    bundle = {
        "version": 1,
        "project": _to_public_dict(project),
        "novels": [_to_public_dict(n) for n in novels],
        "scripts": [_to_public_dict(s) for s in scripts],
        "assets": [_to_public_dict(a) for a in assets],
        "storyboards": [_to_public_dict(s) for s in storyboards],
        "videos": [_to_public_dict(v) for v in videos],
        "art_styles": [_to_public_dict(a) for a in art_styles],
    }

    raw_name = (project.name or "drama").strip() or "drama"
    ascii_name = quote(raw_name)
    disposition = f"attachment; filename=\"{ascii_name}_export.json\"; filename*=UTF-8''{ascii_name}_export.json"

    return JSONResponse(
        content=bundle,
        media_type="application/json",
        headers={"Content-Disposition": disposition},
    )


@router.post("/import")
def import_drama_bundle(
    bundle: DramaExportBundle,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Create a brand new project (+children) for the current user from a bundle."""
    new_project_id = uuid.uuid4()

    # 校验：项目名称必填；各类子表数量上限（防恶意大包批量插入 DoS）
    name = str(bundle.project.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="导入包缺少项目名称")

    _MAX_ITEMS = 500
    for label, items in (
        ("novels", bundle.novels),
        ("scripts", bundle.scripts),
        ("assets", bundle.assets),
        ("storyboards", bundle.storyboards),
        ("videos", bundle.videos),
        ("art_styles", bundle.art_styles),
    ):
        if len(items) > _MAX_ITEMS:
            raise HTTPException(status_code=400, detail=f"{label} 数量超过上限 {_MAX_ITEMS}")

    # 只复制 DramaProject 真实存在的列，避免未知字段触发 TypeError
    _controlled = {"id", "user_id", "created_at", "updated_at", "is_deleted", "name"}
    project_fields = {
        col.name: bundle.project[col.name]
        for col in DramaProject.__table__.columns
        if col.name not in _controlled and col.name in bundle.project
    }
    project = DramaProject(
        id=new_project_id,
        user_id=current_user.id,
        is_deleted="N",
        name=name,
        **project_fields,
    )
    db.add(project)

    # Old id -> new id maps, used to rewire cross-table references.
    novel_map: Dict[str, uuid.UUID] = {}
    for raw in bundle.novels:
        nid = uuid.uuid4()
        old_id = raw.get("id")
        if old_id is not None:
            novel_map[str(old_id)] = nid
        db.add(
            _build_instance(
                DramaNovel,
                raw,
                new_id=nid,
                user_id=current_user.id,
                project_id=new_project_id,
            )
        )

    script_map: Dict[str, uuid.UUID] = {}
    for raw in bundle.scripts:
        sid = uuid.uuid4()
        old_id = raw.get("id")
        if old_id is not None:
            script_map[str(old_id)] = sid
        db.add(
            _build_instance(
                DramaScript,
                raw,
                new_id=sid,
                user_id=current_user.id,
                project_id=new_project_id,
            )
        )

    for raw in bundle.assets:
        aid = uuid.uuid4()
        db.add(
            _build_instance(
                DramaAsset,
                raw,
                new_id=aid,
                user_id=current_user.id,
                project_id=new_project_id,
            )
        )

    storyboard_map: Dict[str, uuid.UUID] = {}
    for raw in bundle.storyboards:
        sid = uuid.uuid4()
        old_id = raw.get("id")
        if old_id is not None:
            storyboard_map[str(old_id)] = sid
        extra_fk: Dict[str, Any] = {}
        old_script = raw.get("script_id")
        if old_script is not None:
            extra_fk["script_id"] = script_map.get(str(old_script))
        db.add(
            _build_instance(
                DramaStoryboard,
                raw,
                new_id=sid,
                user_id=current_user.id,
                project_id=new_project_id,
                extra_fk=extra_fk,
            )
        )

    for raw in bundle.videos:
        vid = uuid.uuid4()
        extra_fk = {}
        old_script = raw.get("script_id")
        if old_script is not None:
            extra_fk["script_id"] = script_map.get(str(old_script))
        old_storyboard = raw.get("storyboard_id")
        if old_storyboard is not None:
            extra_fk["storyboard_id"] = storyboard_map.get(str(old_storyboard))
        db.add(
            _build_instance(
                DramaVideo,
                raw,
                new_id=vid,
                user_id=current_user.id,
                project_id=new_project_id,
                extra_fk=extra_fk,
            )
        )

    # 画风库按 name 去重，避免每次导入重复复制整套画风
    existing_art_style_names = {
        n
        for (n,) in db.query(DramaArtStyle.name)
        .filter(DramaArtStyle.user_id == current_user.id, DramaArtStyle.is_deleted == "N")
        .all()
    }
    for raw in bundle.art_styles:
        nm = str(raw.get("name") or "").strip()
        if nm and nm in existing_art_style_names:
            continue
        aid = uuid.uuid4()
        if nm:
            existing_art_style_names.add(nm)
        # DramaArtStyle has no project_id column.
        db.add(
            _build_instance(
                DramaArtStyle,
                raw,
                new_id=aid,
                user_id=current_user.id,
                project_id=None,
            )
        )

    db.commit()

    return {"project_id": str(new_project_id), "name": project.name}
