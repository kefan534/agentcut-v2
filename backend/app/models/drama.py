# Based on Toonflow by HBAI-Ltd, licensed under Apache-2.0 + Supplemental License.
"""Short-drama (Toonflow) data models.

These tables port Toonflow's SQLite schema (``o_*`` tables) into AgentCut's
PostgreSQL stack. Naming follows AgentCut conventions: UUID primary keys,
snake_case columns, soft-delete via ``is_deleted``, and ``user_id`` pointing
to ``users.id`` (logical relation, no DB-level FK, matching ``projects``).

Only ``drama_project`` is created in P1 (project CRUD). The remaining
``drama_*`` tables (novel/script/assets/storyboard/video/...) land in P3-P6.
"""
import uuid
from datetime import datetime

from sqlalchemy import Column, String, DateTime, Text, Integer, Index
from sqlalchemy.dialects.postgresql import UUID

from app.db.session import Base


class DramaProject(Base):
    """Port of Toonflow ``o_project`` (short-drama project)."""

    __tablename__ = "drama_project"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)  # -> users.id

    name = Column(String(255), nullable=False)
    intro = Column(Text, nullable=True)
    project_type = Column(String(64), nullable=True)   # o_project.projectType
    type = Column(String(64), nullable=True)           # o_project.type
    art_style = Column(Text, nullable=True)            # o_project.artStyle
    director_manual = Column(Text, nullable=True)      # o_project.directorManual
    video_ratio = Column(String(32), nullable=True)    # o_project.videoRatio
    image_model = Column(String(255), nullable=True)   # o_project.imageModel
    video_model = Column(String(255), nullable=True)   # o_project.videoModel
    image_quality = Column(String(64), nullable=True)  # o_project.imageQuality
    mode = Column(String(32), nullable=True)           # o_project.mode

    is_deleted = Column(String(1), nullable=False, default="N")  # Soft delete
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    __table_args__ = (
        Index("ix_drama_project_user_updated", "user_id", "updated_at"),
    )


class DramaNovel(Base):
    """Port of Toonflow ``o_novel`` (novel source chapters)."""

    __tablename__ = "drama_novel"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)     # -> users.id
    project_id = Column(UUID(as_uuid=True), nullable=False, index=True)  # -> drama_project.id

    chapter_index = Column(Integer, nullable=False, default=0)  # o_novel.chapterIndex
    reel = Column(Text, nullable=True)                          # o_novel.reel (卷/集)
    chapter = Column(Text, nullable=True)                       # o_novel.chapter (章节标题)
    chapter_data = Column(Text, nullable=True)                  # o_novel.chapterData (章节正文)
    event_state = Column(Integer, nullable=False, default=0)    # 0=未抽取 1=成功 -1=失败
    event = Column(Text, nullable=True)                         # 事件抽取结果 (JSON string)
    error_reason = Column(Text, nullable=True)

    is_deleted = Column(String(1), nullable=False, default="N")
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    __table_args__ = (
        Index("ix_drama_novel_project_index", "project_id", "chapter_index"),
    )


class DramaScript(Base):
    """Port of Toonflow ``o_script`` (script documents)."""

    __tablename__ = "drama_script"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)     # -> users.id
    project_id = Column(UUID(as_uuid=True), nullable=False, index=True)  # -> drama_project.id

    name = Column(Text, nullable=False)
    content = Column(Text, nullable=True)               # 剧本正文
    extract_state = Column(Integer, nullable=False, default=0)  # 资产提取状态
    error_reason = Column(Text, nullable=True)

    is_deleted = Column(String(1), nullable=False, default="N")
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    __table_args__ = (
        Index("ix_drama_script_project_updated", "project_id", "updated_at"),
    )


class DramaAsset(Base):
    """Port of Toonflow ``o_assets`` + ``o_image`` (short-drama asset).

    A short-drama asset is a role / scene / prop with an optional generated
    image. We merge ``o_image`` into one table: ``image_url`` / ``image_state``
    carry the generation result (agentcut stores generated media on COS / uploads).
    """

    __tablename__ = "drama_assets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)     # -> users.id
    project_id = Column(UUID(as_uuid=True), nullable=False, index=True)  # -> drama_project.id

    name = Column(String(255), nullable=False)
    describe = Column(Text, nullable=True)          # o_assets.describe
    type = Column(String(32), nullable=True)        # role | scene | tool
    prompt = Column(Text, nullable=True)            # 生成提示词
    remark = Column(Text, nullable=True)

    image_url = Column(Text, nullable=True)         # o_image.filePath -> COS/upload URL
    image_model = Column(String(255), nullable=True)  # 生成用的图像模型 variable_name
    image_state = Column(String(32), nullable=True)   # "" | 生成中 | 已完成 | 生成失败
    error_reason = Column(Text, nullable=True)

    is_deleted = Column(String(1), nullable=False, default="N")
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    __table_args__ = (
        Index("ix_drama_assets_project_type", "project_id", "type"),
    )


class DramaStoryboard(Base):
    """Port of Toonflow ``o_storyboard`` (short-drama storyboard shot).

    Each shot belongs to a script, has a prompt (画面/镜头描述), an optional
    generated frame image, and a duration for video synthesis.
    """

    __tablename__ = "drama_storyboard"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)     # -> users.id
    project_id = Column(UUID(as_uuid=True), nullable=False, index=True)  # -> drama_project.id
    script_id = Column(UUID(as_uuid=True), nullable=True, index=True)    # -> drama_script.id

    index = Column(Integer, nullable=False, default=0)   # 分镜序号
    prompt = Column(Text, nullable=True)                 # 分镜画面/镜头提示词
    video_desc = Column(Text, nullable=True)             # 视频生成描述（动作/运镜）
    duration = Column(Integer, nullable=True, default=5) # 时长（秒）
    image_url = Column(Text, nullable=True)              # 分镜图（生成或手动）
    image_state = Column(String(32), nullable=True)      # "" | 生成中 | 已完成 | 生成失败
    error_reason = Column(Text, nullable=True)

    is_deleted = Column(String(1), nullable=False, default="N")
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    __table_args__ = (
        Index("ix_drama_storyboard_script_index", "script_id", "index"),
    )


class DramaVideo(Base):
    """Port of Toonflow ``o_video`` (short-drama generated video clip)."""

    __tablename__ = "drama_video"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)     # -> users.id
    project_id = Column(UUID(as_uuid=True), nullable=False, index=True)  # -> drama_project.id
    script_id = Column(UUID(as_uuid=True), nullable=True, index=True)    # -> drama_script.id
    storyboard_id = Column(UUID(as_uuid=True), nullable=True)            # -> drama_storyboard.id

    prompt = Column(Text, nullable=True)
    video_url = Column(Text, nullable=True)
    duration = Column(Integer, nullable=True, default=5)
    model = Column(String(255), nullable=True)
    state = Column(String(32), nullable=False, default="生成中")  # 生成中 | 成功 | 失败
    error_reason = Column(Text, nullable=True)

    is_deleted = Column(String(1), nullable=False, default="N")
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    __table_args__ = (
        Index("ix_drama_video_project_updated", "project_id", "updated_at"),
    )


class DramaArtStyle(Base):
    """Port of Toonflow ``o_artStyle`` (art-style preset for reuse across projects/assets)."""

    __tablename__ = "drama_art_style"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)

    name = Column(String(255), nullable=False)
    prompt = Column(Text, nullable=True)   # 画风描述（用于生成 prompt）
    image_url = Column(Text, nullable=True)  # 示例图

    is_deleted = Column(String(1), nullable=False, default="N")
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )
