from datetime import datetime
from typing import Optional, Dict, Any
from uuid import UUID
from pydantic import BaseModel


class AssetBase(BaseModel):
    asset_type: str
    name: str
    mime_type: Optional[str] = None
    size_bytes: Optional[int] = None
    width: Optional[int] = None
    height: Optional[int] = None
    duration_seconds: Optional[float] = None
    prompt: Optional[str] = None
    meta: Optional[Dict[str, Any]] = {}
    project_id: Optional[UUID] = None


class AssetCreate(AssetBase):
    storage_key: str


class AssetUpdate(BaseModel):
    name: Optional[str] = None
    prompt: Optional[str] = None
    meta: Optional[Dict[str, Any]] = None
    project_id: Optional[UUID] = None


class AssetOut(AssetBase):
    id: UUID
    user_id: UUID
    storage_key: str
    url: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
