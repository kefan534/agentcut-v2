from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.models.user import User, CreditLedger


def _explicit_budget_cap(db: Session, user_id) -> int | None:
    """用户显式设置过的预算上限（R2-#11）。

    仅当 user_preference 里存在 budget_cap 记录时返回数值；
    未设置过返回 None（默认展示值 1000 不参与硬拦截，避免误伤存量用户）。
    """
    from app.models.preference import UserPreference

    pref = (
        db.query(UserPreference)
        .filter(UserPreference.user_id == user_id, UserPreference.key == "budget_cap")
        .first()
    )
    if pref is None or pref.value is None:
        return None
    try:
        cap = int(pref.value)
    except (TypeError, ValueError):
        return None
    return cap if cap >= 0 else None


def check_budget(db: Session, user_id, additional: int) -> None:
    """预算硬拦截（R2-#11）：自然月内累计消费 + 本次 ≤ 显式设置的 budget_cap。

    未显式设置预算的用户不做任何拦截。超限抛 ValueError。
    """
    from datetime import datetime, timezone
    from sqlalchemy import func

    cap = _explicit_budget_cap(db, user_id)
    if cap is None or additional <= 0:
        return

    month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    spent = (
        db.query(func.coalesce(func.sum(func.abs(CreditLedger.delta)), 0))
        .filter(
            CreditLedger.user_id == user_id,
            CreditLedger.delta < 0,
            CreditLedger.created_at >= month_start,
        )
        .scalar()
        or 0
    )
    if int(spent) + additional > cap:
        raise ValueError(f"预算不足：本月已消费 {int(spent)} 积分，本次需 {additional}，超出预算上限 {cap}")


def get_user_credits(db: Session, user_id: UUID) -> int:
    result = db.execute(
        text("SELECT credits FROM users WHERE id = :uid FOR UPDATE"),
        {"uid": str(user_id)},
    ).fetchone()
    return result[0] if result else 0


def add_credits(
    db: Session,
    user_id: UUID,
    delta: int,
    reason: str,
    reference_id: str = None,
    metadata_json: str = None,
) -> int:
    if delta <= 0:
        raise ValueError("delta must be positive for add_credits")

    new_balance = db.execute(
        text("""
            UPDATE users
            SET credits = credits + :delta, updated_at = NOW()
            WHERE id = :uid
            RETURNING credits
        """),
        {"delta": delta, "uid": str(user_id)},
    ).scalar()

    ledger = CreditLedger(
        user_id=user_id,
        delta=delta,
        balance_after=new_balance,
        reason=reason,
        reference_id=reference_id,
        metadata_json=metadata_json,
    )
    db.add(ledger)
    db.commit()
    return new_balance


def deduct_credits(
    db: Session,
    user_id: UUID,
    amount: int,
    reason: str,
    reference_id: str = None,
    metadata_json: str = None,
) -> int:
    if amount <= 0:
        raise ValueError("amount must be positive")

    # R2-#11: 显式预算硬拦截（自然月口径，未设置预算的用户不受影响）
    check_budget(db, user_id, amount)

    # Atomic update with check to prevent negative balance / race condition
    result = db.execute(
        text("""
            UPDATE users
            SET credits = credits - :amount, updated_at = NOW()
            WHERE id = :uid AND credits >= :amount
            RETURNING credits
        """),
        {"amount": amount, "uid": str(user_id)},
    ).fetchone()

    if not result:
        raise ValueError("Insufficient credits")

    new_balance = result[0]
    ledger = CreditLedger(
        user_id=user_id,
        delta=-amount,
        balance_after=new_balance,
        reason=reason,
        reference_id=reference_id,
        metadata_json=metadata_json,
    )
    db.add(ledger)
    db.commit()
    return new_balance


def freeze_credits(db: Session, user_id: UUID, amount: int, reference_id: str = None) -> int:
    """将「可用积分」转成「冻结积分」（异步任务开始前的保留）。

    R2-#6: 写一条 delta=0 的 freeze 流水（带 reference_id），使每笔冻结可审计、
    可对账；聚合统计按 delta>0 / delta<0 过滤，不受影响。
    返回冻结后的 frozen_balance。可用积分不足时抛 ValueError。
    """
    if amount <= 0:
        raise ValueError("amount must be positive")

    # R2-#11: 显式预算硬拦截（自然月口径，未设置预算的用户不受影响）
    check_budget(db, user_id, amount)

    result = db.execute(
        text("""
            UPDATE users
            SET credits = credits - :amount,
                frozen_balance = frozen_balance + :amount,
                updated_at = NOW()
            WHERE id = :uid AND credits >= :amount
            RETURNING frozen_balance, credits
        """),
        {"amount": amount, "uid": str(user_id)},
    ).fetchone()

    if not result:
        raise ValueError("Insufficient credits")

    new_frozen, available = result
    db.add(CreditLedger(
        user_id=user_id,
        delta=0,
        balance_after=available,
        reason="freeze",
        reference_id=reference_id,
    ))
    db.commit()
    return new_frozen


def settle_frozen_credits(
    db: Session,
    user_id: UUID,
    amount: int,
    reason: str = "generation",
    reference_id: str = None,
) -> int:
    """把「冻结积分」结算为「已消费」（异步任务成功），记一条负向流水。

    返回结算后的 frozen_balance。冻结额度不足时抛 ValueError。
    """
    if amount <= 0:
        raise ValueError("amount must be positive")

    result = db.execute(
        text("""
            UPDATE users
            SET frozen_balance = frozen_balance - :amount, updated_at = NOW()
            WHERE id = :uid AND frozen_balance >= :amount
            RETURNING frozen_balance, credits
        """),
        {"amount": amount, "uid": str(user_id)},
    ).fetchone()

    if not result:
        raise ValueError("Insufficient frozen credits")

    new_frozen, available = result
    ledger = CreditLedger(
        user_id=user_id,
        delta=-amount,
        balance_after=available,
        reason=reason,
        reference_id=reference_id,
    )
    db.add(ledger)
    db.commit()
    return new_frozen


def release_frozen_credits(db: Session, user_id: UUID, amount: int, reference_id: str = None) -> int:
    """把「冻结积分」释放回「可用积分」（异步任务失败）。

    R2-#6: 写一条 delta=0 的 release 流水（带 reference_id），可审计可对账；
    聚合统计按 delta>0 / delta<0 过滤，不受影响。
    返回释放后的 frozen_balance。冻结额度不足时抛 ValueError。
    """
    if amount <= 0:
        raise ValueError("amount must be positive")

    result = db.execute(
        text("""
            UPDATE users
            SET frozen_balance = frozen_balance - :amount,
                credits = credits + :amount,
                updated_at = NOW()
            WHERE id = :uid AND frozen_balance >= :amount
            RETURNING frozen_balance, credits
        """),
        {"amount": amount, "uid": str(user_id)},
    ).fetchone()

    if not result:
        raise ValueError("Insufficient frozen credits")

    new_frozen, available = result
    db.add(CreditLedger(
        user_id=user_id,
        delta=0,
        balance_after=available,
        reason="release",
        reference_id=reference_id,
    ))
    db.commit()
    return new_frozen
