from datetime import datetime
from typing import List, Optional
from uuid import UUID
from pydantic import BaseModel, Field


class GenerationSessionCreate(BaseModel):
    modal_category: str
    task_type: str = "text"
    prompt: str = Field(..., max_length=20000)
    model: str
    reference_urls: Optional[List[str]] = None


class GenerationSessionUpdate(BaseModel):
    status: str
    reference_urls: Optional[List[str]] = None
    result_urls: Optional[List[str]] = None
    error_message: Optional[str] = None


class GenerationSessionOut(BaseModel):
    id: UUID
    user_id: UUID
    modal_category: str
    task_type: str
    prompt: str
    model: str
    status: str
    reference_urls: List[str]
    result_urls: List[str]
    error_message: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
