# Based on Toonflow by HBAI-Ltd, licensed under Apache-2.0 + Supplemental License.
"""Pydantic schemas for the short-drama (Toonflow) module."""
import re
from datetime import datetime
from typing import Optional, List
from uuid import UUID

from pydantic import BaseModel, field_validator

_TAG_RE = re.compile(r"<[^>]*>")


def strip_html(value: str) -> str:
    """Strip HTML tags from user text (defense-in-depth against stored XSS)."""
    if not isinstance(value, str):
        return value
    return _TAG_RE.sub("", value).strip()


class DramaProjectBase(BaseModel):
    name: str
    intro: Optional[str] = None
    project_type: Optional[str] = None
    type: Optional[str] = None
    art_style: Optional[str] = None
    director_manual: Optional[str] = None
    video_ratio: Optional[str] = None
    image_model: Optional[str] = None
    video_model: Optional[str] = None
    image_quality: Optional[str] = None
    mode: Optional[str] = None

    @field_validator("name", "intro", "art_style", "director_manual", mode="before")
    @classmethod
    def _clean_text(cls, v):
        return strip_html(v) if isinstance(v, str) else v


class DramaProjectCreate(DramaProjectBase):
    pass


class DramaProjectUpdate(BaseModel):
    name: Optional[str] = None
    intro: Optional[str] = None
    project_type: Optional[str] = None
    type: Optional[str] = None
    art_style: Optional[str] = None
    director_manual: Optional[str] = None
    video_ratio: Optional[str] = None
    image_model: Optional[str] = None
    video_model: Optional[str] = None
    image_quality: Optional[str] = None
    mode: Optional[str] = None

    @field_validator("name", "intro", "art_style", "director_manual", mode="before")
    @classmethod
    def _clean_text(cls, v):
        return strip_html(v) if isinstance(v, str) else v


class DramaProjectOut(DramaProjectBase):
    id: UUID
    user_id: UUID
    is_deleted: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# --- Novel (小说原文) ---


class DramaNovelItemIn(BaseModel):
    """单章小说导入项，对应 Toonflow addNovel 的 data 数组元素."""
    reel: Optional[str] = None
    chapter: Optional[str] = None
    chapter_data: Optional[str] = None


class DramaNovelCreate(BaseModel):
    project_id: UUID
    items: List[DramaNovelItemIn]


class DramaNovelUpdate(BaseModel):
    reel: Optional[str] = None
    chapter: Optional[str] = None
    chapter_data: Optional[str] = None


class DramaNovelOut(BaseModel):
    id: UUID
    user_id: UUID
    project_id: UUID
    chapter_index: int
    reel: Optional[str]
    chapter: Optional[str]
    chapter_data: Optional[str]
    event_state: int
    event: Optional[str]
    error_reason: Optional[str]
    is_deleted: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# --- Script (剧本) ---


class DramaScriptCreate(BaseModel):
    project_id: UUID
    name: str
    content: Optional[str] = None


class DramaScriptUpdate(BaseModel):
    name: Optional[str] = None
    content: Optional[str] = None


class DramaScriptOut(BaseModel):
    id: UUID
    user_id: UUID
    project_id: UUID
    name: str
    content: Optional[str]
    extract_state: int
    error_reason: Optional[str]
    is_deleted: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# --- Asset (资产) ---


class DramaAssetCreate(BaseModel):
    project_id: UUID
    name: str
    type: Optional[str] = None  # role | scene | tool
    describe: Optional[str] = None
    prompt: Optional[str] = None
    remark: Optional[str] = None


class DramaAssetUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    describe: Optional[str] = None
    prompt: Optional[str] = None
    remark: Optional[str] = None


class DramaAssetGenerate(BaseModel):
    model: str  # 图像模型的 variable_name（如 "Midjourney V7 Imagine"）
    size: Optional[str] = "1024x1024"


class DramaAssetOut(BaseModel):
    id: UUID
    user_id: UUID
    project_id: UUID
    name: str
    describe: Optional[str]
    type: Optional[str]
    prompt: Optional[str]
    remark: Optional[str]
    image_url: Optional[str]
    image_model: Optional[str]
    image_state: Optional[str]
    error_reason: Optional[str]
    is_deleted: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# --- Storyboard (分镜) ---


class DramaStoryboardCreate(BaseModel):
    project_id: UUID
    script_id: Optional[UUID] = None
    index: int = 0
    prompt: Optional[str] = None
    video_desc: Optional[str] = None
    duration: int = 5


class DramaStoryboardUpdate(BaseModel):
    index: Optional[int] = None
    prompt: Optional[str] = None
    video_desc: Optional[str] = None
    duration: Optional[int] = None
    image_url: Optional[str] = None


class DramaStoryboardOut(BaseModel):
    id: UUID
    user_id: UUID
    project_id: UUID
    script_id: Optional[UUID]
    index: int
    prompt: Optional[str]
    video_desc: Optional[str]
    duration: Optional[int]
    image_url: Optional[str]
    image_state: Optional[str]
    error_reason: Optional[str]
    is_deleted: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# --- Video (视频) ---


class DramaVideoCreate(BaseModel):
    project_id: UUID
    script_id: Optional[UUID] = None
    storyboard_id: Optional[UUID] = None
    prompt: Optional[str] = None
    duration: int = 5
    model: str  # 视频模型 variable_name


class DramaVideoOut(BaseModel):
    id: UUID
    user_id: UUID
    project_id: UUID
    script_id: Optional[UUID]
    storyboard_id: Optional[UUID]
    prompt: Optional[str]
    video_url: Optional[str]
    duration: Optional[int]
    model: Optional[str]
    state: str
    error_reason: Optional[str]
    is_deleted: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# --- Art style (画风) ---


class DramaArtStyleCreate(BaseModel):
    name: str
    prompt: Optional[str] = None
    image_url: Optional[str] = None


class DramaArtStyleUpdate(BaseModel):
    name: Optional[str] = None
    prompt: Optional[str] = None
    image_url: Optional[str] = None


class DramaArtStyleOut(BaseModel):
    id: UUID
    user_id: UUID
    name: str
    prompt: Optional[str]
    image_url: Optional[str]
    is_deleted: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
