from datetime import datetime
from typing import Optional, List, Dict, Any
from uuid import UUID
from pydantic import BaseModel, Field, ConfigDict


class ApiSourceBase(BaseModel):
    modal_category: str = Field(..., pattern="^(text|image|audio|video)$")
    vendor: str = Field(..., min_length=1, max_length=64)
    model_version: str = Field(..., min_length=1, max_length=64)
    source_name: str = Field(..., min_length=1, max_length=64)
    priority: int = 100
    base_url: str
    endpoint_path: str = "/v1/chat/completions"
    api_key_plain: Optional[str] = None  # only used on create/update, never returned
    timeout_ms: int = 30000
    retry_count: int = 2
    is_active: bool = True
    cost_level: str = "medium"
    quality_level: str = "medium"
    allowed_user_levels: List[str] = ["free", "paid", "vip"]
    extra_headers: Optional[Dict[str, Any]] = {}
    extra_body: Optional[Dict[str, Any]] = {}


class ApiSourceCreate(ApiSourceBase):
    pass


class ApiSourceUpdate(BaseModel):
    modal_category: Optional[str] = Field(None, pattern="^(text|image|audio|video)$")
    vendor: Optional[str] = None
    model_version: Optional[str] = None
    source_name: Optional[str] = None
    priority: Optional[int] = None
    base_url: Optional[str] = None
    endpoint_path: Optional[str] = None
    api_key_plain: Optional[str] = None
    timeout_ms: Optional[int] = None
    retry_count: Optional[int] = None
    is_active: Optional[bool] = None
    cost_level: Optional[str] = None
    quality_level: Optional[str] = None
    allowed_user_levels: Optional[List[str]] = None
    extra_headers: Optional[Dict[str, Any]] = None
    extra_body: Optional[Dict[str, Any]] = None


class ApiSourceOut(BaseModel):
    id: int
    modal_category: str
    vendor: str
    model_version: str
    source_name: str
    priority: int
    base_url: str
    endpoint_path: str
    timeout_ms: int
    retry_count: int
    is_active: bool
    cost_level: str
    quality_level: str
    allowed_user_levels: List[str]
    extra_headers: Optional[Dict[str, Any]]
    extra_body: Optional[Dict[str, Any]]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class VariableMappingBase(BaseModel):
    variable_name: str = Field(..., min_length=1, max_length=64)
    modal_category: str = Field(..., pattern="^(text|image|audio|video)$")
    default_source_id: int
    fallback_source_ids: List[int] = []
    condition_rules: Dict[str, Any] = {}
    description: Optional[str] = None


class VariableMappingCreate(VariableMappingBase):
    pass


class VariableMappingUpdate(BaseModel):
    modal_category: Optional[str] = None
    default_source_id: Optional[int] = None
    fallback_source_ids: Optional[List[int]] = None
    condition_rules: Optional[Dict[str, Any]] = None
    description: Optional[str] = None


class VariableMappingOut(VariableMappingBase):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ModelPluginBase(BaseModel):
    name: str
    modal_category: str = Field(..., pattern="^(text|image|audio|video)$")
    api_source_id: Optional[int] = None
    script_content: str
    is_active: bool = True


class ModelPluginCreate(ModelPluginBase):
    pass


class ModelPluginUpdate(BaseModel):
    name: Optional[str] = None
    modal_category: Optional[str] = None
    api_source_id: Optional[int] = None
    script_content: Optional[str] = None
    is_active: Optional[bool] = None


class ModelPluginOut(ModelPluginBase):
    id: UUID
    created_by: Optional[UUID]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class AvailableModelOut(BaseModel):
    variable_name: str
    modal_category: str
    default_source_id: int
    vendor: str
    model_version: str
    source_name: str
    description: Optional[str] = None


def _to_camel(snake: str) -> str:
    parts = snake.split("_")
    return parts[0] + "".join(word.capitalize() for word in parts[1:])


class CatalogModelOut(BaseModel):
    """Palmier-compatible model catalog entry. JSON keys are camelCase."""
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    id: str
    kind: str = Field(..., pattern="^(video|image|audio|upscale)$")
    display_name: str
    provider_name: Optional[str] = None
    description: Optional[str] = None
    allowed_endpoints: List[str] = ["generate"]
    response_shape: str = Field(..., pattern="^(video|images|audio|upscaledImage)$")
    paid_only: bool = False
    credits_cost: int = 1
    variable_name: str
    ui_capabilities: Dict[str, Any] = {}
