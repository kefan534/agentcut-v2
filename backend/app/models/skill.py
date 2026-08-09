"""P2: Skill 商店数据模型（管理员/运营上架制）

PRD v1.5 §3.4：
- admin_skills    — Skill 定义（声明式配置，不含脚本）
- user_skill_bindings — 用户已解锁/启用记录
- skill_reviews   — 用户评论/评分
"""
import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text, Integer, Float, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.db.session import Base


class AdminSkill(Base):
    __tablename__ = "admin_skills"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String(64), nullable=False, index=True)
    tags = Column(JSONB, nullable=False, default=[])  # text[]
    prompt_fragment = Column(Text, nullable=True)     # 注入到 Agent 系统提示
    tool_overrides = Column(JSONB, nullable=True)     # json
    resource_files = Column(JSONB, nullable=True)     # json
    price_credits = Column(Integer, nullable=False, default=0)
    submitter_id = Column(UUID(as_uuid=True), nullable=True, index=True)  # 投稿者
    revenue_ratio = Column(Float, nullable=False, default=0.3)  # 投稿者分成比例
    total_revenue = Column(Integer, nullable=False, default=0)  # 给投稿者累计积分
    avg_rating = Column(Float, nullable=True)
    review_count = Column(Integer, nullable=False, default=0)
    enabled_count = Column(Integer, nullable=False, default=0)
    palette = Column(JSONB, nullable=True)  # [color1, color2]
    badge = Column(String(16), nullable=True)
    status = Column(String(16), nullable=False, default="draft", index=True)
    # draft | submitted | reviewing | published | disabled | rejected
    review_comment = Column(Text, nullable=True)
    created_by = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_admin_skills_status_cat", "status", "category"),
    )


class UserSkillBinding(Base):
    __tablename__ = "user_skill_bindings"

    user_id = Column(UUID(as_uuid=True), primary_key=True, nullable=False, index=True)
    skill_id = Column(UUID(as_uuid=True), primary_key=True, nullable=False, index=True)
    enabled_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    config = Column(JSONB, nullable=False, default={})
    cost_paid = Column(Integer, nullable=True)  # 解锁时实际消耗积分

    __table_args__ = (
        Index("ix_skill_bindings_user", "user_id", "skill_id"),
    )


class SkillReview(Base):
    __tablename__ = "skill_reviews"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    skill_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    rating = Column(Integer, nullable=False)  # 1-5
    comment = Column(Text, nullable=True)
    hidden = Column(Integer, nullable=False, default=0)  # 0=visible, 1=hidden by admin
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("skill_id", "user_id", name="uq_skill_review_per_user"),
    )
