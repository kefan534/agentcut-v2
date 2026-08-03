from datetime import datetime
from typing import Optional, Dict, Any
from uuid import UUID
from pydantic import BaseModel


class ProjectBase(BaseModel):
    name: str
    description: Optional[str] = None
    thumbnail_url: Optional[str] = None
    canvas_data: Optional[Dict[str, Any]] = {}
    meta: Optional[Dict[str, Any]] = {}


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    thumbnail_url: Optional[str] = None
    canvas_data: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None


class ProjectOut(ProjectBase):
    id: UUID
    user_id: UUID
    is_deleted: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
