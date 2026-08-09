"""P0: model_pricing 表 — 模型白名单（PRD §3.2.3 + §3.2.4）

按 `enabled` 字段决定用户是否可选用。set_model 服务端强制校验。
"""
import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, Float, DateTime, Boolean, Text, Index
from sqlalchemy.dialects.postgresql import UUID
from app.db.session import Base


class ModelPricing(Base):
    __tablename__ = "model_pricing"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    model_id = Column(String(128), nullable=False, unique=True, index=True)
    name = Column(String(255), nullable=False)
    enabled = Column(Boolean, nullable=False, default=True)
    supports_tools = Column(Boolean, nullable=False, default=False)
    cost_per_turn = Column(Integer, nullable=False, default=1)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_model_pricing_enabled", "enabled"),
    )