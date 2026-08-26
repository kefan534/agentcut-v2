import uuid
from datetime import datetime

from sqlalchemy import Column, String, DateTime, Integer, Text, Index
from sqlalchemy.dialects.postgresql import UUID

from app.db.session import Base


class QAReview(Base):
    __tablename__ = "qa_review"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    # target_type: asset | storyboard | video | image | project
    target_type = Column(String(32), nullable=False, index=True)
    target_id = Column(String(128), nullable=False)
    score = Column(Integer, nullable=False)  # 1-5
    comment = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_qa_review_user_created", "user_id", "created_at"),
    )
