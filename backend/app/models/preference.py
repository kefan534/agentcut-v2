import uuid
from datetime import datetime

from sqlalchemy import Column, String, DateTime, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID

from app.db.session import Base


class UserPreference(Base):
    """Per-user key/value preferences (e.g. budget_cap).

    Stored as text so a single table can hold heterogeneous settings. Each
    (user_id, key) pair is unique; values are cast on read/write by callers.
    """

    __tablename__ = "user_preference"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    key = Column(String(128), nullable=False)
    value = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("user_id", "key", name="uq_user_preference_user_key"),
    )
