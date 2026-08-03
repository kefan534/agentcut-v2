from datetime import datetime
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, EmailStr, Field


class UserBase(BaseModel):
    email: EmailStr = Field(..., max_length=255)
    nickname: Optional[str] = Field(None, max_length=64)
    avatar_url: Optional[str] = Field(None, max_length=1024)


class UserRegister(UserBase):
    password: str = Field(..., min_length=6, max_length=128)


class UserLogin(BaseModel):
    email: EmailStr = Field(..., max_length=255)
    password: str = Field(..., max_length=128)


class UserUpdate(BaseModel):
    nickname: Optional[str] = Field(None, max_length=64)
    avatar_url: Optional[str] = Field(None, max_length=1024)


class UserOut(BaseModel):
    id: UUID
    email: EmailStr
    nickname: Optional[str]
    avatar_url: Optional[str]
    role: str
    level: str
    credits: int
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class CreditLedgerOut(BaseModel):
    id: UUID
    delta: int
    balance_after: int
    reason: str
    reference_id: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True
