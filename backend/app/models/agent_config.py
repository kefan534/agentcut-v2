"""Agent configuration model — per-scope tunables for the in-process agents.

Replaces hard-coded constants (system prompts, step limits, tool timeouts) with
DB-backed configuration so admins can tune the global agent and the short-drama
script agent from the admin console without redeploying.
"""
from datetime import datetime

from sqlalchemy import Column, String, DateTime, Text, Integer
from sqlalchemy.dialects.postgresql import JSONB

from app.db.session import Base


class AgentConfig(Base):
    __tablename__ = "agent_config"

    id = Column(Integer, primary_key=True, autoincrement=True)
    scope = Column(String(64), unique=True, nullable=False, index=True)  # global | script_agent
    system_prompt = Column(Text, nullable=True)
    model_variable = Column(String(64), nullable=True)   # 文本模型变量名（None = 默认解析）
    enabled_tools = Column(JSONB, nullable=True)         # 启用的工具名列表（None = 全部内置）
    max_steps = Column(Integer, nullable=True)           # 工具调用循环最大步数
    tool_timeout_sec = Column(Integer, nullable=True)    # 单工具执行超时（秒）
    updated_at = Column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )
