"""Agent 审计日志表（P0）

记录所有 Agent 工具调用、附件上传、模型切换、Skill 启用等行为，
用于：
- 提示注入检测（资料中出现工具调用语句）
- 越权审计
- 成本与配额分析
- 安全事件回溯
"""
import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text, Integer, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB, INET
from app.db.session import Base


class AgentAuditLog(Base):
    __tablename__ = "agent_audit_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    # event 类型: asset_upload / asset_get_text / ima_search / model_switch /
    #            skill_enable / skill_submit / tool_call / unauthorized_access
    event = Column(String(64), nullable=False, index=True)
    # 关联目标 ID（asset_id / skill_id / source_id 等）
    target_id = Column(String(64), nullable=True)
    # 工具名（如果是工具调用）
    tool_name = Column(String(64), nullable=True)
    # 状态: success / failed / denied / injection_detected
    status = Column(String(32), nullable=False, default="success")
    # 详细元数据（JSONB）
    meta = Column(JSONB, nullable=False, default={})
    # 错误信息（如果失败）
    error_message = Column(Text, nullable=True)
    # 客户端 IP
    ip = Column(String(64), nullable=True)
    # 会话 ID（用于关联 Agent 对话）
    session_id = Column(String(64), nullable=True, index=True)
    cost_credits = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, index=True)

    __table_args__ = (
        Index("ix_audit_user_event_time", "user_id", "event", "created_at"),
    )
