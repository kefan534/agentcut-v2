from uuid import UUID
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.config import settings
from app.core.deps import get_current_user
from app.models.user import User
from app.models.asset import Asset
from app.schemas.asset import AssetCreate, AssetUpdate, AssetOut

router = APIRouter(prefix="/assets", tags=["assets"])


def _append_url(asset: Asset) -> AssetOut:
    data = AssetOut.model_validate(asset)
    data.url = f"/api/v1/upload/{asset.storage_key}"
    return data


@router.get("", response_model=List[AssetOut])
def list_assets(
    asset_type: Optional[str] = Query(None),
    project_id: Optional[UUID] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Asset).filter(Asset.user_id == current_user.id)
    if asset_type:
        q = q.filter(Asset.asset_type == asset_type)
    if project_id:
        q = q.filter(Asset.project_id == project_id)
    assets = q.order_by(Asset.created_at.desc()).all()
    return [_append_url(a) for a in assets]


@router.post("", response_model=AssetOut)
def create_asset(payload: AssetCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    asset = Asset(
        user_id=current_user.id,
        asset_type=payload.asset_type,
        name=payload.name,
        storage_key=payload.storage_key,
        mime_type=payload.mime_type,
        size_bytes=payload.size_bytes,
        width=payload.width,
        height=payload.height,
        duration_seconds=payload.duration_seconds,
        prompt=payload.prompt,
        meta=payload.meta or {},
        project_id=payload.project_id,
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return _append_url(asset)


@router.get("/{asset_id}", response_model=AssetOut)
def get_asset(asset_id: UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.user_id == current_user.id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return _append_url(asset)


@router.put("/{asset_id}", response_model=AssetOut)
def update_asset(
    asset_id: UUID,
    payload: AssetUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.user_id == current_user.id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(asset, field, value)

    db.commit()
    db.refresh(asset)
    return _append_url(asset)


@router.delete("/{asset_id}")
def delete_asset(asset_id: UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.user_id == current_user.id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    db.delete(asset)
    db.commit()
    return {"detail": "Asset deleted"}
