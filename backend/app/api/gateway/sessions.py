from typing import List
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.session import GenerationSession
from app.schemas.session import GenerationSessionCreate, GenerationSessionUpdate, GenerationSessionOut

router = APIRouter(prefix="/sessions", tags=["generation-sessions"])


@router.get("", response_model=List[GenerationSessionOut])
def list_sessions(
    modal_category: str,
    limit: int = 50,
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sessions = (
        db.query(GenerationSession)
        .filter(
            GenerationSession.user_id == current_user.id,
            GenerationSession.modal_category == modal_category,
        )
        .order_by(GenerationSession.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return sessions


@router.post("", response_model=GenerationSessionOut, status_code=201)
def create_session(
    payload: GenerationSessionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session = GenerationSession(
        user_id=current_user.id,
        modal_category=payload.modal_category,
        task_type=payload.task_type,
        prompt=payload.prompt,
        model=payload.model,
        status="pending",
        reference_urls=payload.reference_urls or [],
        result_urls=[],
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.patch("/{session_id}", response_model=GenerationSessionOut)
def update_session(
    session_id: UUID,
    payload: GenerationSessionUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session = db.query(GenerationSession).filter(
        GenerationSession.id == session_id,
        GenerationSession.user_id == current_user.id,
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    session.status = payload.status
    if payload.reference_urls is not None:
        session.reference_urls = payload.reference_urls
    if payload.result_urls is not None:
        session.result_urls = payload.result_urls
    if payload.error_message is not None:
        session.error_message = payload.error_message
    db.commit()
    db.refresh(session)
    return session


@router.delete("/{session_id}")
def delete_session(
    session_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session = db.query(GenerationSession).filter(
        GenerationSession.id == session_id,
        GenerationSession.user_id == current_user.id,
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    db.delete(session)
    db.commit()
    return {"detail": "Session deleted"}
