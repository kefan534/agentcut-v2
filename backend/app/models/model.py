import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Integer, Boolean, Text, ForeignKey, ARRAY, JSON, Numeric
from sqlalchemy.dialects.postgresql import UUID
from app.db.session import Base


class ApiSource(Base):
    __tablename__ = "api_sources"

    id = Column(Integer, primary_key=True, autoincrement=True)
    modal_category = Column(String(32), nullable=False, index=True)  # text | image | audio | video
    vendor = Column(String(64), nullable=False, index=True)  # openai | tencent_hunyuan | volcengine | seedance
    model_version = Column(String(64), nullable=False)  # gpt-4o | hunyuan-turbo | sd-xl
    source_name = Column(String(64), nullable=False)  # official | proxy_1 | self_hosted

    priority = Column(Integer, nullable=False, default=100)
    base_url = Column(Text, nullable=False)
    endpoint_path = Column(String(255), nullable=False, default="/v1/chat/completions")
    api_key_encrypted = Column(Text, nullable=False)
    timeout_ms = Column(Integer, nullable=False, default=30000)
    retry_count = Column(Integer, nullable=False, default=2)
    is_active = Column(Boolean, nullable=False, default=True)

    cost_level = Column(String(16), nullable=False, default="medium")  # low | medium | high
    quality_level = Column(String(16), nullable=False, default="medium")  # low | medium | high
    allowed_user_levels = Column(ARRAY(String), nullable=False, default=["free", "paid", "vip"])

    extra_headers = Column(JSON, nullable=True, default={})
    extra_body = Column(JSON, nullable=True, default={})

    # 上游账户余额（手动维护）
    balance_remaining = Column(Numeric(18, 4), nullable=True)  # 剩余余额（金额或积分）
    balance_type = Column(String(16), nullable=False, default="credits")  # credits 积分 | money 金额
    balance_updated_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        # Ensure uniqueness of the 4-level model
        # modal_category + vendor + model_version + source_name
        # handled in application or with a unique constraint
    )


class VariableMapping(Base):
    __tablename__ = "variable_mappings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    variable_name = Column(String(64), unique=True, nullable=False, index=True)  # IMAGE_MODEL | VIDEO_MODEL | TEXT_MODEL | AUDIO_MODEL
    modal_category = Column(String(32), nullable=False)
    default_source_id = Column(Integer, ForeignKey("api_sources.id"), nullable=False)
    fallback_source_ids = Column(ARRAY(Integer), nullable=False, default=[])
    condition_rules = Column(JSON, nullable=False, default={})  # e.g. {"user_level": {"vip": source_id}}
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class ModelPlugin(Base):
    __tablename__ = "model_plugins"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(128), nullable=False)
    modal_category = Column(String(32), nullable=False)
    api_source_id = Column(Integer, ForeignKey("api_sources.id"), nullable=True)
    script_content = Column(Text, nullable=False)  # Python script executed in sandbox
    is_active = Column(Boolean, nullable=False, default=True)
    created_by = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
