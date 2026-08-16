"""Pricing rule model — flexible per-model credit pricing.

Replaces the hard-coded ``COST_MAP`` (fixed credits per modal category) with
per-variable pricing tiers. A rule matches when its ``param_conditions`` hold
against the request parameters (e.g. image size 1K/2K/4K, video duration, or
text ``input_tokens_max``). Rules are evaluated in ``sort_order``; the first
match wins, and unmatched requests fall back to ``COST_MAP``.
"""
from datetime import datetime

from sqlalchemy import Column, String, DateTime, Integer, Boolean
from sqlalchemy.dialects.postgresql import JSONB

from app.db.session import Base


class PricingRule(Base):
    __tablename__ = "pricing_rules"

    id = Column(Integer, primary_key=True, autoincrement=True)
    variable_name = Column(String(64), nullable=False, index=True)  # 模型变量名（关联 variable_mappings）
    param_conditions = Column(JSONB, nullable=False, default={})  # 参数条件，如 {"size":"2K"} 或 {"input_tokens_max":1024}
    credits = Column(Integer, nullable=False)  # 命中后扣的积分
    sort_order = Column(Integer, nullable=False, default=0)  # 匹配优先级（越小越优先）
    enabled = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
