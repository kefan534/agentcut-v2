from typing import List, Optional, Dict, Any
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.db.session import get_db
from app.core.deps import get_current_user, require_admin
from app.core.encryption import encrypt_api_key
from app.models.user import User
from app.models.model import ApiSource, VariableMapping, ModelPlugin
from app.models.log import CallLog
from app.schemas.user import UserOut
from app.schemas.model import (
    ApiSourceCreate, ApiSourceUpdate, ApiSourceOut,
    VariableMappingCreate, VariableMappingUpdate, VariableMappingOut,
    ModelPluginCreate, ModelPluginUpdate, ModelPluginOut,
)
from app.schemas.log import CallLogOut
from app.services.credit_service import add_credits, deduct_credits
from app.services.plugin_service import execute_plugin

router = APIRouter(prefix="/admin", tags=["admin"])


# ---------- API Sources (4-level models) ----------

@router.get("/models", response_model=List[ApiSourceOut])
def list_sources(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    return db.query(ApiSource).order_by(ApiSource.modal_category, ApiSource.priority).all()


@router.post("/models", response_model=ApiSourceOut)
def create_source(payload: ApiSourceCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    data = payload.model_dump()
    api_key = data.pop("api_key_plain")
    if not api_key:
        raise HTTPException(status_code=400, detail="api_key_plain is required")
    data["api_key_encrypted"] = encrypt_api_key(api_key)
    source = ApiSource(**data)
    db.add(source)
    db.commit()
    db.refresh(source)
    return source


@router.put("/models/{source_id}", response_model=ApiSourceOut)
def update_source(
    source_id: int,
    payload: ApiSourceUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    source = db.query(ApiSource).filter(ApiSource.id == source_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")

    data = payload.model_dump(exclude_unset=True)
    if "api_key_plain" in data and data["api_key_plain"]:
        source.api_key_encrypted = encrypt_api_key(data.pop("api_key_plain"))
    elif "api_key_plain" in data:
        data.pop("api_key_plain")

    for k, v in data.items():
        setattr(source, k, v)

    db.commit()
    db.refresh(source)
    return source


@router.delete("/models/{source_id}")
def delete_source(source_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    source = db.query(ApiSource).filter(ApiSource.id == source_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")

    # Check if any variable mapping still references this source.
    used_by_vars = (
        db.query(VariableMapping.variable_name)
        .filter(
            (VariableMapping.default_source_id == source_id)
            | VariableMapping.fallback_source_ids.any(source_id)
        )
        .all()
    )
    used_by_plugins = (
        db.query(ModelPlugin.name)
        .filter(ModelPlugin.api_source_id == source_id, ModelPlugin.is_active == True)
        .all()
    )
    if used_by_vars or used_by_plugins:
        var_names = [v[0] for v in used_by_vars]
        plugin_names = [p[0] for p in used_by_plugins]
        details = []
        if var_names:
            details.append(f"变量映射: {', '.join(var_names)}")
        if plugin_names:
            details.append(f"插件: {', '.join(plugin_names)}")
        raise HTTPException(
            status_code=409,
            detail=f"无法删除，仍被以下项引用：{'；'.join(details)}。请先调整或删除这些引用后再重试。",
        )

    try:
        db.delete(source)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="删除失败：该模型仍被数据库其他记录引用")
    return {"detail": "Source deleted"}


# ---------- Variable Mappings ----------

@router.get("/variables", response_model=List[VariableMappingOut])
def list_variables(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    return db.query(VariableMapping).all()


@router.post("/variables", response_model=VariableMappingOut)
def create_variable(payload: VariableMappingCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    mapping = VariableMapping(**payload.model_dump())
    db.add(mapping)
    db.commit()
    db.refresh(mapping)
    return mapping


@router.put("/variables/{mapping_id}", response_model=VariableMappingOut)
def update_variable(
    mapping_id: int,
    payload: VariableMappingUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    mapping = db.query(VariableMapping).filter(VariableMapping.id == mapping_id).first()
    if not mapping:
        raise HTTPException(status_code=404, detail="Variable mapping not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(mapping, k, v)
    db.commit()
    db.refresh(mapping)
    return mapping


@router.delete("/variables/{mapping_id}")
def delete_variable(mapping_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    mapping = db.query(VariableMapping).filter(VariableMapping.id == mapping_id).first()
    if not mapping:
        raise HTTPException(status_code=404, detail="Variable mapping not found")
    db.delete(mapping)
    db.commit()
    return {"detail": "Variable mapping deleted"}


# ---------- Model Plugins ----------

@router.get("/plugins", response_model=List[ModelPluginOut])
def list_plugins(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    return db.query(ModelPlugin).all()


@router.post("/plugins", response_model=ModelPluginOut)
def create_plugin(payload: ModelPluginCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    plugin = ModelPlugin(**payload.model_dump(), created_by=admin.id)
    db.add(plugin)
    db.commit()
    db.refresh(plugin)
    return plugin


@router.put("/plugins/{plugin_id}", response_model=ModelPluginOut)
def update_plugin(
    plugin_id: UUID,
    payload: ModelPluginUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    plugin = db.query(ModelPlugin).filter(ModelPlugin.id == plugin_id).first()
    if not plugin:
        raise HTTPException(status_code=404, detail="Plugin not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(plugin, k, v)
    db.commit()
    db.refresh(plugin)
    return plugin


@router.delete("/plugins/{plugin_id}")
def delete_plugin(plugin_id: UUID, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    plugin = db.query(ModelPlugin).filter(ModelPlugin.id == plugin_id).first()
    if not plugin:
        raise HTTPException(status_code=404, detail="Plugin not found")
    db.delete(plugin)
    db.commit()
    return {"detail": "Plugin deleted"}


@router.post("/plugins/{plugin_id}/execute")
async def execute_plugin_endpoint(
    plugin_id: UUID,
    inputs: Dict[str, Any],
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    plugin = db.query(ModelPlugin).filter(ModelPlugin.id == plugin_id, ModelPlugin.is_active == True).first()
    if not plugin:
        raise HTTPException(status_code=404, detail="Plugin not found")

    # Deduct small plugin execution cost from admin tester
    try:
        deduct_credits(db=db, user_id=admin.id, amount=1, reason="plugin_execution", reference_id=str(plugin_id))
    except ValueError:
        raise HTTPException(status_code=402, detail="Insufficient credits")

    try:
        result = await execute_plugin(plugin.script_content, inputs)
        return {"result": result}
    except HTTPException:
        raise
    except Exception as e:
        add_credits(db=db, user_id=admin.id, delta=1, reason="plugin_refund", reference_id=str(plugin_id))
        raise HTTPException(status_code=500, detail=f"Plugin execution failed: {e}")


# ---------- Users ----------

@router.get("/users", response_model=List[UserOut])
def list_users(
    q: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    query = db.query(User)
    if q:
        query = query.filter(User.email.ilike(f"%{q}%"))
    return query.order_by(User.created_at.desc()).all()


@router.post("/users/{user_id}/credits")
def add_user_credits(
    user_id: UUID,
    delta: int,
    reason: str = "admin_recharge",
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if delta <= 0:
        raise HTTPException(status_code=400, detail="delta must be positive")
    new_balance = add_credits(db=db, user_id=user.id, delta=delta, reason=reason)
    return {"user_id": user_id, "new_balance": new_balance}


@router.post("/users/{user_id}/ban")
def ban_user(user_id: UUID, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.status = "banned"
    db.commit()
    return {"detail": "User banned"}


# ---------- Logs ----------

@router.get("/logs", response_model=List[CallLogOut])
def list_logs(
    user_id: Optional[UUID] = Query(None),
    variable_name: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    q = db.query(CallLog)
    if user_id:
        q = q.filter(CallLog.user_id == user_id)
    if variable_name:
        q = q.filter(CallLog.variable_name == variable_name)
    if status:
        q = q.filter(CallLog.status == status)
    return q.order_by(CallLog.created_at.desc()).offset(offset).limit(limit).all()
