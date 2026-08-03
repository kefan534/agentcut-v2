import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text, Integer, Float, ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.db.session import Base


class CallLog(Base):
    __tablename__ = "call_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    request_id = Column(String(64), nullable=False, index=True)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    variable_name = Column(String(64), nullable=False, index=True)
    source_id = Column(Integer, ForeignKey("api_sources.id"), nullable=True)
    modal_category = Column(String(32), nullable=False)
    status = Column(String(16), nullable=False, default="pending")  # pending | success | failed
    status_code = Column(Integer, nullable=True)
    latency_ms = Column(Float, nullable=False, default=0)
    error_message = Column(Text, nullable=True)
    cost_credits = Column(Integer, nullable=False, default=0)
    request_body = Column(JSONB, nullable=True)
    response_summary = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_call_logs_user_created", "user_id", "created_at"),
        Index("ix_call_logs_created", "created_at"),
    )
