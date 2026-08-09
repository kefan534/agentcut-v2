"""P2: 用户站内消息/通知表。

PRD §3.4.4: 投稿被审核后通过此表通知用户（已上架 / 已拒绝 + 拒绝理由）。
"""
import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text, Boolean, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.db.session import Base


class UserNotification(Base):
    __tablename__ = "user_notifications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    kind = Column(String(32), nullable=False)  # skill_approved / skill_rejected / skill_disabled
    title = Column(String(255), nullable=False)
    body = Column(Text, nullable=True)
    meta = Column(JSONB, nullable=True)  # {"skillId": ..., "reviewComment": ...}
    is_read = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_user_notif_user_unread", "user_id", "is_read", "created_at"),
    )