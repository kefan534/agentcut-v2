import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text, ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.db.session import Base


class GenerationSession(Base):
    __tablename__ = "generation_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    modal_category = Column(String(32), nullable=False, index=True)
    task_type = Column(String(32), nullable=False, default="text")  # text | reference
    prompt = Column(Text, nullable=False)
    model = Column(String(128), nullable=False)
    status = Column(String(16), nullable=False, default="pending")  # pending | success | failed
    reference_urls = Column(JSONB, nullable=False, default=list)
    result_urls = Column(JSONB, nullable=False, default=list)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_generation_sessions_user_category_created", "user_id", "modal_category", "created_at"),
    )
