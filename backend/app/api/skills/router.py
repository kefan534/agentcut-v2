"""P2: Skill 商店 API（用户浏览 / 投稿 / 管理员审核 / 解锁 / 评论）

路由映射：
  GET    /api/v1/skills              → 已上架 Skill 列表（含分类筛选 + 搜索）
  GET    /api/v1/skills/{id}         → Skill 详情
  POST   /api/v1/skills/submit       → 用户投稿
  GET    /api/v1/skills/my           → 我的投稿列表
  POST   /api/v1/skills/{id}/unlock  → 解锁（扣积分 + 分成）
  POST   /api/v1/skills/{id}/review  → 评论/评分
  GET    /api/v1/admin/skills        → 管理后台 Skill 列表（含状态筛选）
  PUT    /api/v1/admin/skills/{id}   → 审核/上下架/编辑
"""
from uuid import UUID
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.db.session import get_db
from app.core.deps import get_current_user, get_current_user_optional
from app.models.user import User
from app.models.skill import AdminSkill, UserSkillBinding, SkillReview
from app.models.agent_audit_log import AgentAuditLog
from app.services.skill_service import unlock_skill
from app.services.credit_service import get_user_credits

router = APIRouter(prefix="/skills", tags=["skills"])
admin_router = APIRouter(prefix="/admin/skills", tags=["admin-skills"])


# ── 用户端 ──────────────────────────────────────────────────────────

@router.get("")
def list_skills(
    category: Optional[str] = Query(None),
    keyword: Optional[str] = Query(None),
    tag: Optional[str] = Query(None, description="按标签筛选（精确匹配一个 tag）"),
    status: Optional[str] = Query("published"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    q = db.query(AdminSkill).filter(AdminSkill.status == status)
    if category:
        q = q.filter(AdminSkill.category == category)
    if tag:
        q = q.filter(AdminSkill.tags.contains([tag]))
    if keyword:
        kw = f"%{keyword}%"
        q = q.filter(or_(AdminSkill.name.ilike(kw), AdminSkill.description.ilike(kw)))
    total = q.count()
    items = q.order_by(AdminSkill.enabled_count.desc(), AdminSkill.created_at.desc()).offset(offset).limit(limit).all()

    # 批量查 submitter 渲染名字
    submitter_ids = {s.submitter_id for s in items if s.submitter_id}
    submitter_map: dict = {}
    if submitter_ids:
        for u in db.query(User).filter(User.id.in_(submitter_ids)).all():
            submitter_map[u.id] = u

    return {
        "ok": True,
        "total": total,
        "items": [_skill_out(s, submitter_map.get(s.submitter_id)) for s in items],
    }


@router.get("/{skill_id}")
def get_skill(skill_id: UUID, db: Session = Depends(get_db)):
    skill = db.query(AdminSkill).filter(AdminSkill.id == skill_id).first()
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")
    submitter = db.query(User).filter(User.id == skill.submitter_id).first() if skill.submitter_id else None
    return {"ok": True, "item": _skill_out(skill, submitter)}


@router.post("/submit")
async def submit_skill(request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    body = await request.json()
    body = body if isinstance(body, dict) else {}

    skill = AdminSkill(
        name=body.get("name", ""),
        description=body.get("description", ""),
        category=body.get("category", "通用技能"),
        tags=body.get("tags", []),
        prompt_fragment=body.get("promptFragment", body.get("prompt_fragment", "")),
        tool_overrides=body.get("toolOverrides", body.get("tool_overrides", None)),
        resource_files=body.get("resourceFiles", body.get("resource_files", [])),
        palette=body.get("palette", None),
        badge=body.get("badge", "技能"),
        submitter_id=current_user.id,
        status="submitted",
        created_by=current_user.id,
    )
    if not skill.name:
        raise HTTPException(status_code=400, detail="name is required")

    # P2: PRD §3.4.6 审核清单自动校验（run a checklist before insert）
    issues = _audit_skill_checklist(skill.prompt_fragment or "", skill.tool_overrides or {})
    db.add(skill)
    audit = AgentAuditLog(
        user_id=current_user.id, event="skill_submit", target_id=str(skill.id),
        tool_name="skill_submit", status="success",
        meta={"skillName": skill.name, "category": skill.category, "audit_issues": issues},
    )
    db.add(audit)
    db.commit()
    db.refresh(skill)
    submitter = db.query(User).filter(User.id == skill.submitter_id).first() if skill.submitter_id else None
    return {"ok": True, "item": _skill_out(skill, submitter)}


@router.get("/my/list")
def my_skills(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    items = db.query(AdminSkill).filter(
        AdminSkill.submitter_id == current_user.id,
    ).order_by(AdminSkill.created_at.desc()).all()
    return {"ok": True, "items": [_skill_out(s, current_user) for s in items]}


@router.post("/{skill_id}/unlock")
def unlock(skill_id: UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = unlock_skill(db, current_user.id, skill_id)
    if not result.get("ok"):
        raise HTTPException(status_code=402, detail=result.get("error"))
    return result


@router.post("/{skill_id}/review")
async def review_skill(
    skill_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # 必须已解锁才能评价
    binding = db.query(UserSkillBinding).filter(
        UserSkillBinding.user_id == current_user.id,
        UserSkillBinding.skill_id == skill_id,
    ).first()
    if not binding:
        raise HTTPException(status_code=403, detail="Must unlock the skill first")

    body = await request.json()
    body = body if isinstance(body, dict) else {}
    rating = body.get("rating", 0)
    if not (1 <= rating <= 5):
        raise HTTPException(status_code=400, detail="Rating must be 1-5")
    comment = body.get("comment", "")

    existing = db.query(SkillReview).filter(
        SkillReview.skill_id == skill_id,
        SkillReview.user_id == current_user.id,
    ).first()
    if existing:
        existing.rating = rating
        existing.comment = comment
    else:
        review = SkillReview(skill_id=skill_id, user_id=current_user.id, rating=rating, comment=comment)
        db.add(review)

    # Recalculate avg
    skill = db.query(AdminSkill).filter(AdminSkill.id == skill_id).first()
    if skill:
        all_reviews = db.query(SkillReview).filter(SkillReview.skill_id == skill_id, SkillReview.hidden == 0).all()
        skill.review_count = len(all_reviews)
        skill.avg_rating = round(sum(r.rating for r in all_reviews) / len(all_reviews), 1) if all_reviews else None

    db.commit()
    return {"ok": True, "message": "Review submitted"}


@router.get("/{skill_id}/reviews")
def list_reviews(skill_id: UUID, db: Session = Depends(get_db)):
    """获取 Skill 的评论列表（visible only）。"""
    rows = db.query(SkillReview).filter(
        SkillReview.skill_id == skill_id,
        SkillReview.hidden == 0,
    ).order_by(SkillReview.created_at.desc()).limit(50).all()
    return {
        "ok": True,
        "items": [
            {
                "user_id": str(r.user_id),
                "rating": r.rating,
                "comment": r.comment,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
    }


# ── 管理端 ──────────────────────────────────────────────────────────

@admin_router.get("")
def admin_list_skills(
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    q = db.query(AdminSkill)
    if status:
        q = q.filter(AdminSkill.status == status)
    items = q.order_by(AdminSkill.created_at.desc()).all()
    submitter_ids = {s.submitter_id for s in items if s.submitter_id}
    submitter_map = {u.id: u for u in db.query(User).filter(User.id.in_(submitter_ids)).all()} if submitter_ids else {}
    return {"ok": True, "items": [_skill_out(s, submitter_map.get(s.submitter_id)) for s in items]}


@admin_router.put("/{skill_id}")
async def admin_update_skill(
    skill_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    skill = db.query(AdminSkill).filter(AdminSkill.id == skill_id).first()
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")

    body = await request.json()
    body = body if isinstance(body, dict) else {}

    # camelCase 兼容（前端 admin-skill-review.tsx 用的是 camelCase）
    aliases = {
        "prompt_fragment": "promptFragment",
        "tool_overrides": "toolOverrides",
        "resource_files": "resourceFiles",
        "price_credits": "priceCredits",
        "review_comment": "reviewComment",
        "revenue_ratio": "revenueRatio",
    }
    for field in ("name", "description", "category", "tags", "prompt_fragment", "tool_overrides",
                  "resource_files", "price_credits", "palette", "badge", "status", "review_comment",
                  "revenue_ratio"):
        if field in body:
            setattr(skill, field, body[field])
        elif field in aliases and aliases[field] in body:
            setattr(skill, field, body[aliases[field]])

    # 自动推进审核流（在 setattr 之前判断原状态）
    target_status = body.get("status")
    # 直接用 SQLAlchemy 重新读原状态
    original_status = db.query(AdminSkill.status).filter(AdminSkill.id == skill_id).scalar()
    if target_status == "published" and original_status in ("submitted", "reviewing"):
        skill.status = "published"
    elif target_status == "rejected" and original_status in ("submitted", "reviewing"):
        skill.status = "rejected"
    elif target_status == "disabled" and original_status == "published":
        skill.status = "disabled"
    elif target_status is not None:
        skill.status = target_status  # 允许 admin 直接设置任何状态

    # P2: PRD §3.4.4 通知投稿人
    if skill.submitter_id and target_status in ("published", "rejected", "disabled"):
        from app.models.notification import UserNotification
        kind_map = {"published": "skill_approved", "rejected": "skill_rejected", "disabled": "skill_disabled"}
        title_map = {"published": "你的 Skill 已上架", "rejected": "你的 Skill 未通过审核", "disabled": "你的 Skill 已下架"}
        body_text = body.get("review_comment") or skill.review_comment
        if not body_text:
            body_text = {
                "published": "恭喜，你的 Skill 已通过审核并上架。",
                "rejected": "很抱歉，你的 Skill 未通过审核。",
                "disabled": "你的 Skill 已被下架，请查看审核规范。",
            }.get(target_status, "Skill 状态已更新。")
        notif = UserNotification(
            user_id=skill.submitter_id,
            kind=kind_map.get(target_status, "skill_update"),
            title=title_map.get(target_status, "Skill 状态更新"),
            body=body_text,
            meta={"skillId": str(skill_id), "priceCredits": skill.price_credits, "newStatus": target_status},
        )
        db.add(notif)

    audit = AgentAuditLog(
        user_id=current_user.id, event="skill_admin_update", target_id=str(skill_id),
        tool_name="admin_update", status="success",
        meta={"newStatus": body.get("status"), "price": body.get("price_credits")},
    )
    db.add(audit)
    db.commit()
    db.refresh(skill)
    submitter = db.query(User).filter(User.id == skill.submitter_id).first() if skill.submitter_id else None
    return {"ok": True, "item": _skill_out(skill, submitter)}


# P2: 用户通知端点
@router.get("/notifications")
def list_my_notifications(
    only_unread: bool = False,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.models.notification import UserNotification
    q = db.query(UserNotification).filter(UserNotification.user_id == current_user.id)
    if only_unread:
        q = q.filter(UserNotification.is_read == False)
    rows = q.order_by(UserNotification.created_at.desc()).limit(limit).all()
    return {
        "ok": True,
        "items": [
            {
                "id": str(r.id),
                "kind": r.kind,
                "title": r.title,
                "body": r.body,
                "meta": r.meta,
                "isRead": r.is_read,
                "createdAt": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
    }


@router.post("/notifications/{notif_id}/read")
def mark_notification_read(
    notif_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.models.notification import UserNotification
    n = db.query(UserNotification).filter(
        UserNotification.id == notif_id,
        UserNotification.user_id == current_user.id,
    ).first()
    if not n:
        raise HTTPException(status_code=404, detail="Notification not found")
    n.is_read = True
    db.commit()
    return {"ok": True}


@admin_router.delete("/{skill_id}")
def admin_delete_skill(
    skill_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """P2: 删除 Skill（PRD §3.4.5 CRUD 完整）。"""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    skill = db.query(AdminSkill).filter(AdminSkill.id == skill_id).first()
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")
    # 级联删除关联
    db.query(UserSkillBinding).filter(UserSkillBinding.skill_id == skill_id).delete()
    db.query(SkillReview).filter(SkillReview.skill_id == skill_id).delete()
    db.delete(skill)
    db.add(AgentAuditLog(
        user_id=current_user.id, event="skill_admin_delete", target_id=str(skill_id),
        tool_name="admin_delete", status="success",
        meta={"name": skill.name},
    ))
    db.commit()
    return {"ok": True, "deleted": str(skill_id)}


@admin_router.post("/reviews/{review_id}/hide")
def admin_hide_review(
    review_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """P2: 隐藏评论（PRD §3.4.5 评论管理 - 软删除）。"""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    review = db.query(SkillReview).filter(SkillReview.id == review_id).first()
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")
    review.hidden = 1
    db.add(AgentAuditLog(
        user_id=current_user.id, event="skill_review_hide", target_id=str(review_id),
        tool_name="admin_review_hide", status="success",
    ))
    db.commit()
    return {"ok": True}


@admin_router.get("/reviews/all")
def admin_list_reviews(
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """P2: 列出所有评论（含 hidden），方便管理。"""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    rows = db.query(SkillReview).order_by(SkillReview.created_at.desc()).limit(limit).all()
    items = [
        {
            "id": str(r.id),
            "skillId": str(r.skill_id),
            "userId": str(r.user_id),
            "rating": r.rating,
            "comment": r.comment,
            "hidden": r.hidden,
            "createdAt": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]
    return {"ok": True, "items": items}


# ── helpers ─────────────────────────────────────────────────────────

def _skill_out(s: AdminSkill, submitter: Optional[User] = None) -> dict:
    submitter_name = None
    if submitter is not None:
        submitter_name = submitter.nickname or submitter.email
    return {
        "id": str(s.id),
        "name": s.name,
        "description": s.description,
        "category": s.category,
        "tags": s.tags,
        "palette": s.palette,
        "badge": s.badge,
        "priceCredits": s.price_credits,
        "status": s.status,
        "submitterId": str(s.submitter_id) if s.submitter_id else None,
        "submitterName": submitter_name,
        "revenueRatio": s.revenue_ratio,
        "totalRevenue": s.total_revenue,
        "avgRating": s.avg_rating,
        "reviewCount": s.review_count,
        "enabledCount": s.enabled_count,
        "reviewComment": s.review_comment,
        "promptFragment": s.prompt_fragment,
        "createdAt": s.created_at.isoformat() if s.created_at else None,
        "updatedAt": s.updated_at.isoformat() if s.updated_at else None,
    }


# P2: PRD §3.4.6 审核清单自动校验
def _audit_skill_checklist(prompt_fragment: str, tool_overrides: dict) -> list:
    """返回 (passed: bool, reason: str) 列表，供 admin 审核时辅助决策。"""
    issues = []
    if prompt_fragment:
        # 禁止诱导扣费/越权指令的关键词
        suspicious = ["扣除积分", "跳过权限", "disable_safety", "ignore_safety",
                      "ignore_instructions", "admin_override", "扣 100", "清空数据"]
        for kw in suspicious:
            if kw in prompt_fragment.lower() or kw in prompt_fragment:
                issues.append(f"prompt_fragment 含可疑关键词「{kw}」")
    if tool_overrides and isinstance(tool_overrides, dict):
        # tool_overrides 不允许触碰扣费/管理接口
        forbidden_keys = ["deduct_credits", "admin", "ban_user", "system_prompt"]
        for k in forbidden_keys:
            if k in str(tool_overrides).lower():
                issues.append(f"tool_overrides 含禁止键「{k}」")
    return issues
