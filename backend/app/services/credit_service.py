from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.models.user import User, CreditLedger


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
