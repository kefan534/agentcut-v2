import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Integer, Text, Index
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from app.db.session import Base


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(Text, nullable=False)
    nickname = Column(String(64), nullable=True)
    avatar_url = Column(Text, nullable=True)
    role = Column(String(16), nullable=False, default="user")  # user, admin
    level = Column(String(16), nullable=False, default="free")  # free, paid, vip
    credits = Column(Integer, nullable=False, default=0)
    # 冻结积分：异步任务进行中被保留（reserve）的积分，成功后结算为已消费、失败后释放回可用。
    frozen_balance = Column(Integer, nullable=False, default=0)
    status = Column(String(16), nullable=False, default="active")  # active, banned
    # P0: 用户级 Agent 模型选择持久化
    agent_model = Column(String(128), nullable=True)  # 用户选择的 Agent 模型 id
    agent_model_updated_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class CreditLedger(Base):
    __tablename__ = "credit_ledger"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    delta = Column(Integer, nullable=False)  # positive or negative
    balance_after = Column(Integer, nullable=False)
    reason = Column(String(64), nullable=False)  # signup, daily_check_in, recharge, generation, refund
    reference_id = Column(String(128), nullable=True)
    metadata_json = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_credit_ledger_user_created", "user_id", "created_at"),
    )
