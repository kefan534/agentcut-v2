"""成本中心（Billing）接口：余额汇总、预算上限、计费事件明细。

路由前缀：/api/v1/billing
所有接口均按 current_user.id 过滤，仅返回当前用户的数据。

注意：本模块顶部导入了 UserPreference（app.models.preference），
应用启动时（main.py 的 Base.metadata.create_all）会因此自动建表，
请勿在 main.py 之外重复导入或手动建表。
"""

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import CreditLedger, User
# 关键：导入 UserPreference 以在应用启动时注册表结构（见模块 docstring）。
from app.models.preference import UserPreference

router = APIRouter(prefix="/billing", tags=["billing"])

BUDGET_CAP_KEY = "budget_cap"
DEFAULT_BUDGET_CAP = 1000


class BudgetUpdate(BaseModel):
    budget_cap: int = Field(..., ge=0, le=10_000_000)


def _serialize_ledger(row: CreditLedger) -> dict:
    return {
        "id": str(row.id),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "reason": row.reason,
        "delta": row.delta,
        "balance_after": row.balance_after,
        "reference_id": row.reference_id,
    }


def _get_budget_cap(db: Session, user_id) -> int:
    pref = (
        db.query(UserPreference)
        .filter(UserPreference.user_id == user_id, UserPreference.key == BUDGET_CAP_KEY)
        .first()
    )
    if pref and pref.value is not None:
        try:
            return int(pref.value)
        except (TypeError, ValueError):
            return DEFAULT_BUDGET_CAP
    return DEFAULT_BUDGET_CAP


@router.get("/summary")
def get_billing_summary(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    user_id = current_user.id

    total_earned = (
        db.query(func.coalesce(func.sum(CreditLedger.delta), 0))
        .filter(CreditLedger.user_id == user_id, CreditLedger.delta > 0)
        .scalar()
        or 0
    )

    total_spent = (
        db.query(func.coalesce(func.sum(func.abs(CreditLedger.delta)), 0))
        .filter(CreditLedger.user_id == user_id, CreditLedger.delta < 0)
        .scalar()
        or 0
    )

    by_reason_rows = (
        db.query(
            CreditLedger.reason,
            func.count(CreditLedger.id),
            func.coalesce(func.sum(CreditLedger.delta), 0),
        )
        .filter(CreditLedger.user_id == user_id)
        .group_by(CreditLedger.reason)
        .all()
    )
    by_reason = [
        {"reason": reason, "count": int(count), "sum": int(s)}
        for (reason, count, s) in by_reason_rows
    ]

    recent_rows = (
        db.query(CreditLedger)
        .filter(CreditLedger.user_id == user_id)
        .order_by(CreditLedger.created_at.desc())
        .limit(20)
        .all()
    )
    recent = [_serialize_ledger(r) for r in recent_rows]

    return {
        "balance": current_user.credits,
        # 冻结积分：异步任务进行中被保留的积分（users.frozen_balance）
        "frozen_balance": current_user.frozen_balance,
        "total_earned": int(total_earned),
        "total_spent": int(total_spent),
        "budget_cap": _get_budget_cap(db, user_id),
        "by_reason": by_reason,
        "recent": recent,
    }


@router.get("/budget")
def get_budget(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return {"budget_cap": _get_budget_cap(db, current_user.id)}


@router.put("/budget")
def set_budget(
    payload: BudgetUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    if payload.budget_cap < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="budget_cap 必须为非负整数",
        )

    pref = (
        db.query(UserPreference)
        .filter(UserPreference.user_id == current_user.id, UserPreference.key == BUDGET_CAP_KEY)
        .first()
    )
    if pref is None:
        pref = UserPreference(
            user_id=current_user.id,
            key=BUDGET_CAP_KEY,
            value=str(payload.budget_cap),
        )
        db.add(pref)
    else:
        pref.value = str(payload.budget_cap)
        pref.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(pref)
    return {"budget_cap": payload.budget_cap}


@router.get("/events")
def list_events(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> List[dict]:
    rows = (
        db.query(CreditLedger)
        .filter(CreditLedger.user_id == current_user.id)
        .order_by(CreditLedger.created_at.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )
    return [_serialize_ledger(r) for r in rows]
