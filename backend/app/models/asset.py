import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text, ForeignKey, Integer, Float, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.db.session import Base


class Asset(Base):
    __tablename__ = "assets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    asset_type = Column(String(32), nullable=False, index=True)  # image | video | audio | text
    name = Column(String(255), nullable=False)
    storage_key = Column(String(512), nullable=False)  # local path or object key
    mime_type = Column(String(128), nullable=True)
    size_bytes = Column(Integer, nullable=True)
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)
    duration_seconds = Column(Float, nullable=True)
    prompt = Column(Text, nullable=True)
    meta = Column(JSONB, nullable=False, default={})
    project_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_assets_user_type_created", "user_id", "asset_type", "created_at"),
    )
