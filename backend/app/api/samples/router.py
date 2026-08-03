from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.deps import get_current_user
from app.models.user import User

router = APIRouter(prefix="/samples", tags=["samples"])


@router.get("")
def list_samples(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return sample projects available to the user.

    In the local fork samples are not implemented yet; returns an empty list.
    """
    return []


@router.get("/resolve")
def resolve_sample(
    slug: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Resolve a sample project by slug."""
    raise HTTPException(status_code=404, detail="Sample not found")
