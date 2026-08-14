"""P0: Agent 内置模型管理后台 API（PRD §3.2.3 / §3.2.4）

仅支持 EdgeOne Makers 提供的固定内置模型列表，每次只能启用一个。
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.deps import require_admin
from app.models.model_pricing import ModelPricing
from app.models.user import User

router = APIRouter(prefix="/admin/model-pricing", tags=["admin-model-pricing"])


# EdgeOne Makers 提供的内置模型（PRD 要求必须携带 @makers/ 前缀）
MAKERS_BUILTIN_MODELS: List[str] = [
    "@makers/hy3",
    "@makers/hy3-preview",
    "@makers/deepseek-v4-pro",
    "@makers/deepseek-v4-flash",
    "@makers/minimax-m3",
    "@makers/minimax-m2.7",
    "@makers/kimi-k2.6",
]


def _ensure_builtin_rows(db: Session) -> None:
    """Ensure all 7 Makers builtin models exist in DB (idempotent seed)."""
    existing_ids = {r.model_id for r in db.query(ModelPricing.model_id).all()}
    for model_id in MAKERS_BUILTIN_MODELS:
        if model_id not in existing_ids:
            db.add(ModelPricing(
                model_id=model_id,
                name=model_id,
                enabled=False,
                supports_tools=True,
                cost_per_turn=1,
                notes="EdgeOne Makers 内置模型",
            ))
    db.commit()


@router.get("")
def list_pricing(
    enabled: Optional[bool] = Query(None),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Return all Makers builtin models with their enabled state."""
    _ensure_builtin_rows(db)
    q = db.query(ModelPricing)
    if enabled is not None:
        q = q.filter(ModelPricing.enabled == enabled)
    rows = q.order_by(ModelPricing.model_id.asc()).all()
    items = [
        {
            "id": str(r.id),
            "modelId": r.model_id,
            "name": r.name,
            "enabled": r.enabled,
            "supportsTools": r.supports_tools,
            "costPerTurn": r.cost_per_turn,
            "notes": r.notes,
            "builtin": r.model_id in MAKERS_BUILTIN_MODELS,
        }
        for r in rows
    ]
    # Ensure all 7 builtin models appear even if DB had non-builtin rows
    seen = {i["modelId"] for i in items}
    for model_id in MAKERS_BUILTIN_MODELS:
        if model_id not in seen:
            items.append({
                "id": None,
                "modelId": model_id,
                "name": model_id,
                "enabled": False,
                "supportsTools": True,
                "costPerTurn": 1,
                "notes": "EdgeOne Makers 内置模型",
                "builtin": True,
            })
    items.sort(key=lambda x: MAKERS_BUILTIN_MODELS.index(x["modelId"]) if x["modelId"] in MAKERS_BUILTIN_MODELS else 999)
    return {"ok": True, "items": items, "builtinModels": MAKERS_BUILTIN_MODELS}


@router.post("/select-builtin")
def select_builtin_model(
    payload: dict,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Select exactly one Makers builtin model as the active Agent model."""
    model_id = (payload or {}).get("modelId")
    if not model_id:
        raise HTTPException(status_code=400, detail="modelId required")
    if model_id not in MAKERS_BUILTIN_MODELS:
        raise HTTPException(status_code=400, detail=f"{model_id} 不是允许的内置模型")
    if not model_id.startswith("@makers/"):
        raise HTTPException(status_code=400, detail="内置模型 ID 必须以 @makers/ 开头")

    _ensure_builtin_rows(db)

    # Disable all models, then enable the selected one
    db.query(ModelPricing).update({ModelPricing.enabled: False}, synchronize_session=False)

    row = db.query(ModelPricing).filter(ModelPricing.model_id == model_id).first()
    if not row:
        row = ModelPricing(
            model_id=model_id,
            name=model_id,
            enabled=True,
            supports_tools=True,
            cost_per_turn=1,
            notes="EdgeOne Makers 内置模型",
        )
        db.add(row)
    else:
        row.enabled = True
    db.commit()
    db.refresh(row)
    return {
        "ok": True,
        "selected": {
            "id": str(row.id),
            "modelId": row.model_id,
            "enabled": row.enabled,
            "supportsTools": row.supports_tools,
            "costPerTurn": row.cost_per_turn,
        },
    }


@router.get("/selected")
def get_selected_builtin(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Return the currently selected builtin model."""
    _ensure_builtin_rows(db)
    row = db.query(ModelPricing).filter(ModelPricing.enabled == True).first()
    if not row:
        return {"ok": True, "selected": None}
    return {
        "ok": True,
        "selected": {
            "id": str(row.id),
            "modelId": row.model_id,
            "enabled": row.enabled,
            "supportsTools": row.supports_tools,
            "costPerTurn": row.cost_per_turn,
        },
    }


# Legacy CRUD kept for compatibility, but constrained to builtin list where applicable.

@router.post("")
def create_pricing(
    payload: dict,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    model_id = (payload or {}).get("modelId")
    if not model_id:
        raise HTTPException(status_code=400, detail="modelId required")
    if model_id not in MAKERS_BUILTIN_MODELS:
        raise HTTPException(status_code=400, detail="只允许添加 Makers 内置模型")
    existing = db.query(ModelPricing).filter(ModelPricing.model_id == model_id).first()
    if existing:
        raise HTTPException(status_code=409, detail="Model already exists")
    row = ModelPricing(
        model_id=model_id,
        name=payload.get("name", model_id),
        enabled=bool(payload.get("enabled", True)),
        supports_tools=payload.get("supportsTools", True),
        cost_per_turn=int(payload.get("costPerTurn", 1)),
        notes=payload.get("notes"),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"ok": True, "item": {"id": str(row.id), "modelId": row.model_id, "enabled": row.enabled, "supportsTools": row.supports_tools, "costPerTurn": row.cost_per_turn}}


@router.put("/{model_id}")
def update_pricing(
    model_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    row = db.query(ModelPricing).filter(ModelPricing.model_id == model_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Model not found")
    if "name" in payload: row.name = payload["name"]
    if "enabled" in payload:
        # Enforce single-selection: enabling one disables all others
        new_enabled = bool(payload["enabled"])
        if new_enabled:
            db.query(ModelPricing).update({ModelPricing.enabled: False}, synchronize_session=False)
        row.enabled = new_enabled
    if "supportsTools" in payload: row.supports_tools = bool(payload["supportsTools"])
    if "costPerTurn" in payload: row.cost_per_turn = int(payload["costPerTurn"])
    if "notes" in payload: row.notes = payload["notes"]
    db.commit()
    db.refresh(row)
    return {"ok": True, "item": {
        "id": str(row.id), "modelId": row.model_id, "enabled": row.enabled,
        "supportsTools": row.supports_tools, "costPerTurn": row.cost_per_turn
    }}


@router.delete("/{model_id}")
def delete_pricing(
    model_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    row = db.query(ModelPricing).filter(ModelPricing.model_id == model_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Model not found")
    if model_id in MAKERS_BUILTIN_MODELS:
        raise HTTPException(status_code=400, detail="内置模型不允许删除")
    db.delete(row)
    db.commit()
    return {"ok": True}
