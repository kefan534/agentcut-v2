import uuid
from datetime import datetime
from uuid import UUID
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.qa import QAReview  # noqa: F401  (register table for create_all)

# 允许的评分目标类型
VALID_TARGET_TYPES = {"asset", "storyboard", "video", "image", "project"}


class QAReviewCreate(BaseModel):
    target_type: str = Field(..., max_length=32)
    target_id: str = Field(..., max_length=128)
    score: int
    comment: Optional[str] = Field(None, max_length=2000)


class QAReviewOut(BaseModel):
    id: UUID
    user_id: UUID
    target_type: str
    target_id: str
    score: int
    comment: Optional[str]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class QAStatsItem(BaseModel):
    target_type: str
    avg_score: float
    count: int


router = APIRouter(prefix="/qa", tags=["qa"])


@router.post("", response_model=QAReviewOut)
def create_qa_review(
    payload: QAReviewCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """提交一条 QA 评分记录（评分 1-5）。"""
    if not (1 <= payload.score <= 5):
        raise HTTPException(status_code=400, detail="score 必须在 1-5 之间")
    if payload.target_type not in VALID_TARGET_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"target_type 必须是 {sorted(VALID_TARGET_TYPES)} 之一",
        )

    review = QAReview(
        id=uuid.uuid4(),
        user_id=current_user.id,
        target_type=payload.target_type,
        target_id=payload.target_id,
        score=payload.score,
        comment=payload.comment,
    )
    db.add(review)
    db.commit()
    db.refresh(review)
    return QAReviewOut.model_validate(review)


@router.get("", response_model=List[QAReviewOut])
def list_qa_reviews(
    target_type: Optional[str] = Query(None, description="按目标类型过滤"),
    target_id: Optional[str] = Query(None, description="按目标ID过滤"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """列出当前用户的评分记录，按创建时间倒序。"""
    q = db.query(QAReview).filter(QAReview.user_id == current_user.id)
    if target_type:
        q = q.filter(QAReview.target_type == target_type)
    if target_id:
        q = q.filter(QAReview.target_id == target_id)
    reviews = q.order_by(QAReview.created_at.desc()).limit(limit).offset(offset).all()
    return [QAReviewOut.model_validate(r) for r in reviews]


@router.get("/stats", response_model=List[QAStatsItem])
def qa_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """按 target_type 聚合平均分与条数。"""
    rows = (
        db.query(
            QAReview.target_type,
            func.avg(QAReview.score).label("avg_score"),
            func.count(QAReview.id).label("count"),
        )
        .filter(QAReview.user_id == current_user.id)
        .group_by(QAReview.target_type)
        .all()
    )
    return [
        QAStatsItem(
            target_type=r.target_type,
            avg_score=round(float(r.avg_score), 2),
            count=r.count,
        )
        for r in rows
    ]
