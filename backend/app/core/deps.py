from typing import Optional
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from uuid import UUID

from app.db.session import get_db
from app.core.security import decode_token, is_jti_blacklisted
from app.models.user import User

security = HTTPBearer(auto_error=False)


def _extract_token(request: Request, credentials: Optional[HTTPAuthorizationCredentials]) -> Optional[str]:
    # 1. Authorization header
    if credentials and credentials.scheme.lower() == "bearer":
        return credentials.credentials
    # 2. Cookie fallback (httpOnly access_token)
    token = request.cookies.get("access_token")
    if token:
        return token
    return None


def _validate_access_payload(db: Session, payload: Optional[dict]) -> bool:
    """校验 access token payload：类型正确 + jti 未被吊销。"""
    if not payload or payload.get("type") != "access":
        return False
    if is_jti_blacklisted(db, payload.get("jti")):
        return False
    return True


def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    token = _extract_token(request, credentials)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    payload = decode_token(token)
    if not _validate_access_payload(db, payload):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    try:
        UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user = db.query(User).filter(User.id == user_id, User.status == "active").first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or banned")

    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin required")
    return current_user


def get_current_user_optional(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db),
) -> Optional[User]:
    """Same as get_current_user but returns None instead of 401."""
    token = _extract_token(request, credentials)
    if not token:
        return None
    try:
        payload = decode_token(token)
    except Exception:
        return None
    if not _validate_access_payload(db, payload):
        return None
    user_id = payload.get("sub")
    if not user_id:
        return None
    try:
        UUID(user_id)
    except ValueError:
        return None
    return db.query(User).filter(User.id == user_id, User.status == "active").first()
