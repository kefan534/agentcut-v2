"""P0: model_pricing 管理后台 API（PRD §3.2.3）

GET/PUT /api/v1/admin/model-pricing
"""
from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.deps import require_admin
from app.models.model_pricing import ModelPricing
from app.models.user import User

router = APIRouter(prefix="/admin/model-pricing", tags=["admin-model-pricing"])


@router.get("")
def list_pricing(
    enabled: Optional[bool] = Query(None),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    q = db.query(ModelPricing)
    if enabled is not None:
        q = q.filter(ModelPricing.enabled == enabled)
    rows = q.order_by(ModelPricing.cost_per_turn.asc(), ModelPricing.model_id.asc()).all()
    return {
        "ok": True,
        "items": [
            {
                "id": str(r.id),
                "modelId": r.model_id,
                "name": r.name,
                "enabled": r.enabled,
                "supportsTools": r.supports_tools,
                "costPerTurn": r.cost_per_turn,
                "notes": r.notes,
            }
            for r in rows
        ],
    }


@router.post("")
def create_pricing(
    payload: dict,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    model_id = (payload or {}).get("modelId")
    if not model_id:
        raise HTTPException(status_code=400, detail="modelId required")
    existing = db.query(ModelPricing).filter(ModelPricing.model_id == model_id).first()
    if existing:
        raise HTTPException(status_code=409, detail="Model already exists")
    row = ModelPricing(
        model_id=model_id,
        name=payload.get("name", model_id),
        enabled=payload.get("enabled", True),
        supports_tools=payload.get("supportsTools", False),
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
    if "enabled" in payload: row.enabled = bool(payload["enabled"])
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
    db.delete(row)
    db.commit()
    return {"ok": True}