from typing import List, Optional, Dict, Any
from uuid import UUID
import os
import json
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, case
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.db.session import get_db
from app.core.deps import get_current_user, require_admin
from app.core.config import settings
from app.core.encryption import encrypt_api_key
from app.models.user import User, CreditLedger
from app.models.model import ApiSource, VariableMapping, ModelPlugin
from app.models.log import CallLog
from app.models.agent_audit_log import AgentAuditLog
from app.models.asset import Asset
from app.schemas.user import UserOut
from app.schemas.model import (
    ApiSourceCreate, ApiSourceUpdate, ApiSourceOut,
    VariableMappingCreate, VariableMappingUpdate, VariableMappingOut,
    ModelPluginCreate, ModelPluginUpdate, ModelPluginOut,
)
from app.schemas.log import CallLogOut
from app.services.credit_service import add_credits, deduct_credits
from app.services.plugin_service import execute_plugin
from app.models.agent_config import AgentConfig
from app.services.agent_config_service import get_agent_config, DEFAULT_AGENT_CONFIGS, AGENT_SCOPES

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
    if data.get("balance_remaining") is not None:
        from datetime import datetime
        data["balance_updated_at"] = datetime.utcnow()
    source = ApiSource(**data)
    db.add(source)
    db.commit()
    db.refresh(source)
    _log_admin_action(db, admin, "admin_model_create", str(source.id), meta={"vendor": source.vendor, "model_version": source.model_version})
    db.commit()
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
    if "balance_remaining" in data and data["balance_remaining"] is not None:
        from datetime import datetime
        source.balance_updated_at = datetime.utcnow()

    db.commit()
    db.refresh(source)
    _log_admin_action(db, admin, "admin_model_update", str(source_id), meta={"changed": list(data.keys())})
    db.commit()
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
        vendor = source.vendor
        model_version = source.model_version
        db.delete(source)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="删除失败：该模型仍被数据库其他记录引用")
    _log_admin_action(db, admin, "admin_model_delete", str(source_id), meta={"vendor": vendor, "model_version": model_version})
    db.commit()
    return {"detail": "Source deleted"}


@router.post("/models/{source_id}/test")
async def test_source(source_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    """测试模型源的连通性（GET base_url）。"""
    import httpx
    from app.core.encryption import decrypt_api_key
    source = db.query(ApiSource).filter(ApiSource.id == source_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    url = (source.base_url or "").rstrip("/")
    if not url:
        return {"ok": False, "error": "base_url 为空"}
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.get(url)
        return {"ok": resp.status_code < 500, "status_code": resp.status_code, "detail": "连接成功" if resp.status_code < 500 else resp.text[:200]}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)[:200]}


@router.get("/models/stats")
def model_stats(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    """每个模型源的调用量、成功率、平均耗时统计。"""
    rows = (
        db.query(
            CallLog.source_id,
            func.count(CallLog.id).label("total"),
            func.sum(case((CallLog.status == "success", 1), else_=0)).label("success"),
            func.avg(CallLog.latency_ms).label("avg_latency"),
        )
        .filter(CallLog.source_id.isnot(None))
        .group_by(CallLog.source_id)
        .all()
    )
    stats = {}
    for source_id, total, success, avg_latency in rows:
        stats[source_id] = {
            "total": total,
            "success": int(success or 0),
            "success_rate": round((success or 0) / total * 100, 1) if total else 0,
            "avg_latency_ms": round(avg_latency or 0, 1),
        }
    return {"stats": stats}


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

def _log_admin_action(db: Session, admin: User, event: str, target_id: str, status: str = "success", meta: Optional[dict] = None):
    """记录 admin 敏感操作到审计日志（复用 agent_audit_logs 表）。"""
    db.add(AgentAuditLog(
        user_id=admin.id,
        event=event,
        target_id=target_id,
        status=status,
        meta=meta or {},
    ))


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


@router.get("/users/{user_id}")
def get_user_detail(
    user_id: UUID,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """用户详情：基本信息 + 积分流水 + 最近调用 + 资产。"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    ledger = (
        db.query(CreditLedger).filter(CreditLedger.user_id == user_id)
        .order_by(CreditLedger.created_at.desc()).limit(50).all()
    )
    calls = (
        db.query(CallLog).filter(CallLog.user_id == user_id)
        .order_by(CallLog.created_at.desc()).limit(20).all()
    )
    assets = (
        db.query(Asset).filter(Asset.user_id == user_id)
        .order_by(Asset.created_at.desc()).limit(20).all()
    )

    def _dt(v):
        return v.isoformat() if v else None

    return {
        "user": {
            "id": str(user.id), "email": user.email, "nickname": user.nickname,
            "role": user.role, "level": user.level, "credits": user.credits,
            "status": user.status, "created_at": _dt(user.created_at),
        },
        "ledger": [
            {"id": str(r.id), "delta": r.delta, "balance_after": r.balance_after,
             "reason": r.reason, "created_at": _dt(r.created_at)}
            for r in ledger
        ],
        "recent_calls": [
            {"id": str(r.id), "variable_name": r.variable_name, "modal_category": r.modal_category,
             "status": r.status, "status_code": r.status_code, "latency_ms": r.latency_ms,
             "cost_credits": r.cost_credits, "created_at": _dt(r.created_at)}
            for r in calls
        ],
        "assets": [
            {"id": str(r.id), "name": r.name, "asset_type": r.asset_type,
             "created_at": _dt(r.created_at)}
            for r in assets
        ],
    }


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
    _log_admin_action(db, admin, "admin_recharge", str(user_id), meta={"delta": delta, "reason": reason})
    db.commit()
    return {"user_id": user_id, "new_balance": new_balance}


@router.post("/users/{user_id}/ban")
def ban_user(user_id: UUID, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.status = "banned"
    db.commit()
    _log_admin_action(db, admin, "admin_ban", str(user_id))
    db.commit()
    return {"detail": "User banned"}


@router.post("/users/{user_id}/unban")
def unban_user(user_id: UUID, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.status != "banned":
        raise HTTPException(status_code=400, detail="User is not banned")
    user.status = "active"
    db.commit()
    _log_admin_action(db, admin, "admin_unban", str(user_id))
    db.commit()
    return {"detail": "User unbanned"}


class _UserUpdateBody(BaseModel):
    role: Optional[str] = None
    level: Optional[str] = None
    nickname: Optional[str] = None


@router.put("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: UUID,
    payload: _UserUpdateBody,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """修改用户角色/等级/昵称。"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(user, field, value)
    db.commit()
    db.refresh(user)
    _log_admin_action(db, admin, "admin_user_update", str(user_id), meta={"changed": list(data.keys())})
    db.commit()
    return user


# ---------- Logs ----------

@router.get("/logs")
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
    total = q.count()
    items = q.order_by(CallLog.created_at.desc()).offset(offset).limit(limit).all()
    return {"total": total, "items": items}


# ── P1: ima 知识库配置 ─────────────────────────────────────────

@router.get("/ima/config")
def get_ima_config(admin: User = Depends(require_admin)):
    key = settings.IMA_API_KEY or ""
    return {
        "ok": True,
        "configured": bool(key and settings.IMA_CLIENT_ID),
        "maskedKey": (key[:8] + "***") if key else "",
    }


@router.put("/ima/config")
async def update_ima_config(request: Request, admin: User = Depends(require_admin)):
    body = await request.json()
    if body.get("apiKey"):
        settings.IMA_API_KEY = body["apiKey"]
    if body.get("clientId"):
        settings.IMA_CLIENT_ID = body["clientId"]
    # P1: 持久化到 .env（重启保留）
    try:
        from app.services.env_persister import update_env_value
        if body.get("apiKey") is not None:
            update_env_value("IMA_API_KEY", body.get("apiKey", "") or "")
        if body.get("clientId") is not None:
            update_env_value("IMA_CLIENT_ID", body.get("clientId", "") or "")
    except Exception:
        pass  # 不阻断响应
    return {"ok": True, "configured": bool(settings.IMA_API_KEY)}


# ── Agent 配置（通用 Agent + 短剧工坊智能体）────────────────────

class _AgentConfigBody(BaseModel):
    system_prompt: Optional[str] = None
    model_variable: Optional[str] = None
    enabled_tools: Optional[List[str]] = None
    max_steps: Optional[int] = None
    tool_timeout_sec: Optional[int] = None


@router.get("/agent-config")
def get_agent_configs(admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    """返回所有 scope 的 Agent 配置（含默认值兜底）。"""
    return {
        "ok": True,
        "scopes": {scope: get_agent_config(db, scope) for scope in AGENT_SCOPES},
    }


@router.put("/agent-config/{scope}")
def update_agent_config(
    scope: str,
    payload: _AgentConfigBody,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if scope not in AGENT_SCOPES:
        raise HTTPException(status_code=404, detail=f"未知 scope：{scope}")

    row = db.query(AgentConfig).filter(AgentConfig.scope == scope).first()
    if not row:
        row = AgentConfig(scope=scope)
        db.add(row)

    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(row, field, value)

    db.commit()
    _log_admin_action(db, admin, "admin_agent_config_update", scope, meta={"changed": list(data.keys())})
    db.commit()
    return {"ok": True, "scope": scope, "config": get_agent_config(db, scope)}


# ── Dashboard 数据总览 ─────────────────────────────────────────

@router.get("/dashboard")
def dashboard(admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    from datetime import datetime, timedelta
    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_ago = today_start - timedelta(days=7)

    total_users = db.query(User).count()
    active_users = db.query(User).filter(User.status == "active").count()
    new_today = db.query(User).filter(User.created_at >= today_start).count()

    total_calls = db.query(CallLog).count()
    calls_today = db.query(CallLog).filter(CallLog.created_at >= today_start).count()
    success_calls = db.query(CallLog).filter(CallLog.status == "success").count()

    total_cost = db.query(func.coalesce(func.sum(CallLog.cost_credits), 0)).scalar() or 0
    cost_today = (
        db.query(func.coalesce(func.sum(CallLog.cost_credits), 0))
        .filter(CallLog.created_at >= today_start).scalar() or 0
    )

    by_variable = (
        db.query(CallLog.variable_name, func.count(CallLog.id))
        .group_by(CallLog.variable_name)
        .order_by(func.count(CallLog.id).desc())
        .limit(10).all()
    )

    trend = []
    for i in range(6, -1, -1):
        day = today_start - timedelta(days=i)
        next_day = day + timedelta(days=1)
        cnt = db.query(CallLog).filter(CallLog.created_at >= day, CallLog.created_at < next_day).count()
        trend.append({"date": day.strftime("%m-%d"), "count": cnt})

    return {
        "users": {"total": total_users, "active": active_users, "new_today": new_today},
        "calls": {"total": total_calls, "today": calls_today, "success": success_calls},
        "credits": {"total_cost": total_cost, "cost_today": cost_today},
        "by_variable": [{"variable_name": v, "count": c} for v, c in by_variable],
        "trend": trend,
    }


# P0: model_pricing admin API（独立 router）
from app.api.admin.model_pricing import router as model_pricing_router  # noqa: E402
from app.api.admin.audit_logs import router as audit_logs_router  # noqa: E402
