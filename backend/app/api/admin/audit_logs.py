"""P0: admin 审计日志查询 API（PRD §4.6）。"""
from typing import Optional
from uuid import UUID
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.deps import require_admin
from app.models.agent_audit_log import AgentAuditLog
from app.models.user import User

router = APIRouter(prefix="/admin/audit-logs", tags=["admin-audit-logs"])


@router.get("")
def list_audit_logs(
    user_id: Optional[UUID] = Query(None),
    event: Optional[str] = Query(None),
    target_id: Optional[str] = Query(None),
    days: int = Query(30, ge=1, le=90, description="查看最近 N 天"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """列出审计日志（默认最近 30 天，最长 90 天）。"""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    q = db.query(AgentAuditLog).filter(AgentAuditLog.created_at >= since)
    if user_id:
        q = q.filter(AgentAuditLog.user_id == user_id)
    if event:
        q = q.filter(AgentAuditLog.event == event)
    if target_id:
        q = q.filter(AgentAuditLog.target_id == target_id)
    rows = q.order_by(AgentAuditLog.created_at.desc()).offset(offset).limit(limit).all()
    total = q.count()
    return {
        "ok": True,
        "total": total,
        "items": [
            {
                "id": str(r.id),
                "userId": str(r.user_id) if r.user_id else None,
                "event": r.event,
                "targetId": r.target_id,
                "toolName": r.tool_name,
                "status": r.status,
                "meta": r.meta,
                "costCredits": r.cost_credits,
                "createdAt": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
    }


@router.delete("/cleanup")
def cleanup_old_logs(
    days: int = Query(90, ge=30),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """清理 N 天前的审计日志（PRD §4.6: 保留 90 天）。"""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    deleted = db.query(AgentAuditLog).filter(AgentAuditLog.created_at < cutoff).delete()
    db.commit()
    return {"ok": True, "deleted": deleted}