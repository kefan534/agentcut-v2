"""P2: Skill 解锁 + 30% 分成的经济模型。

解锁规则：
1. 用户首次启用 (user_skill_bindings 无记录) → 扣 price_credits
2. 如果 Skill 有 submitter_id 且 submitter_id != user_id → 30% 积分入投稿者余额
3. 管理员创建的 Skill (submitter_id IS NULL) → 全额归平台
4. free=0 积分 Skill → 直接解锁，不触发分成
"""
from __future__ import annotations

from uuid import UUID
from sqlalchemy.orm import Session

from app.models.skill import AdminSkill, UserSkillBinding, SkillReview
from app.models.user import CreditLedger, User
from app.models.agent_audit_log import AgentAuditLog
from app.services import credit_service


def unlock_skill(db: Session, user_id: UUID, skill_id: UUID) -> dict:
    """解锁一个 Skill 并处理分成。返回结果字典。

    幂等：已解锁再次调用返回 success=true, alreadyUnlocked=true。
    """
    skill = db.query(AdminSkill).filter(AdminSkill.id == skill_id).first()
    if not skill:
        return {"ok": False, "error": "Skill not found"}
    if skill.status != "published":
        return {"ok": False, "error": f"Skill is not published (status={skill.status})"}

    existing = db.query(UserSkillBinding).filter(
        UserSkillBinding.user_id == user_id,
        UserSkillBinding.skill_id == skill_id,
    ).first()
    if existing:
        skill.enabled_count = max(0, skill.enabled_count)  # already counted
        return {"ok": True, "alreadyUnlocked": True, "message": "Already unlocked", "costPaid": 0}

    price = max(0, skill.price_credits or 0)
    if price > 0:
        try:
            new_balance = credit_service.deduct_credits(
                db=db, user_id=user_id, amount=price, reason="skill_unlock", reference_id=str(skill_id),
            )
        except ValueError as exc:
            # 余额不足
            current = db.query(User).filter(User.id == user_id).first()
            balance = current.credits if current else 0
            return {"ok": False, "error": f"Insufficient credits. Need {price}, have {balance}"}

    binding = UserSkillBinding(user_id=user_id, skill_id=skill_id, cost_paid=price if price > 0 else 0)
    db.add(binding)

    if skill.enabled_count is None:
        skill.enabled_count = 0
    skill.enabled_count += 1

    # Revenue share (30% to submitter if not self-unlocking)
    revenue = 0
    if price > 0 and skill.submitter_id and skill.submitter_id != user_id:
        ratio = skill.revenue_ratio if skill.revenue_ratio is not None else 0.3
        revenue = max(1, int(price * ratio))
        submitter = db.query(User).filter(User.id == skill.submitter_id).first()
        if submitter:
            credit_service.add_credits(
                db=db, user_id=skill.submitter_id, delta=revenue,
                reason="skill_revenue", reference_id=f"{skill_id}:{user_id}",
            )
            skill.total_revenue = (skill.total_revenue or 0) + revenue

    # Audit log
    audit = AgentAuditLog(
        user_id=user_id, event="skill_enable", target_id=str(skill_id),
        tool_name="skill_enable", status="success",
        meta={"skillName": skill.name, "price": price, "revenueSplit": revenue},
        cost_credits=price,
    )
    db.add(audit)

    db.commit()
    return {"ok": True, "alreadyUnlocked": False, "message": "Skill unlocked", "costPaid": price, "revenueSplit": revenue}
