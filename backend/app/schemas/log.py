from datetime import datetime
from typing import Optional, Dict, Any
from uuid import UUID
from pydantic import BaseModel


class CallLogOut(BaseModel):
    id: UUID
    request_id: str
    user_id: UUID
    variable_name: str
    source_id: Optional[int]
    modal_category: str
    status: str
    status_code: Optional[int]
    latency_ms: float
    error_message: Optional[str]
    cost_credits: int
    request_body: Optional[Dict[str, Any]]
    response_summary: Optional[Dict[str, Any]]
    created_at: datetime

    class Config:
        from_attributes = True
