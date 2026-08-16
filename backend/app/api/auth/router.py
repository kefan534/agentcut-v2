import time
from fastapi import APIRouter, Depends, HTTPException, Response, Request, status
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.config import settings
from app.core.security import get_password_hash, verify_password, create_token_pair, create_token, blacklist_jti, is_jti_blacklisted
from app.core.deps import get_current_user
from app.services.credit_service import add_credits
from app.models.user import User
from app.schemas.user import UserRegister, UserLogin, UserOut, TokenPair, UserUpdate, ChangePasswordIn


# Simple in-memory login rate limiter: max 5 failures per (ip+email) per 10 min.
# Replace with Redis for multi-worker production.
_LOGIN_FAILURES: dict[str, list[float]] = {}
_MAX_LOGIN_FAILURES = 5
_LOGIN_WINDOW_SECONDS = 600


def _record_login_failure(key: str):
    now = time.time()
    window = _LOGIN_FAILURES.setdefault(key, [])
    window.append(now)


def _is_rate_limited(key: str) -> bool:
    now = time.time()
    window = _LOGIN_FAILURES.get(key, [])
    window = [t for t in window if now - t < _LOGIN_WINDOW_SECONDS]
    _LOGIN_FAILURES[key] = window
    return len(window) >= _MAX_LOGIN_FAILURES

router = APIRouter(prefix="/auth", tags=["auth"])
security = HTTPBearer(auto_error=False)


def _validate_password_strength(password: str) -> None:
    """Weak-password guard: min length enforced by schema; require letters + digits."""
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="密码至少 8 位")
    if password.isdigit() or password.isalpha():
        raise HTTPException(status_code=400, detail="密码需同时包含字母和数字")


ACCESS_COOKIE_KEY = "access_token"
REFRESH_COOKIE_KEY = "refresh_token"


def _set_auth_cookies(response: Response, access_token: str, refresh_token: str):
    response.set_cookie(
        key=ACCESS_COOKIE_KEY,
        value=access_token,
        httponly=True,
        secure=settings.SECURE_COOKIE,
        samesite="lax",
        max_age=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )
    response.set_cookie(
        key=REFRESH_COOKIE_KEY,
        value=refresh_token,
        httponly=True,
        secure=settings.SECURE_COOKIE,
        samesite="lax",
        max_age=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
    )


@router.post("/register", response_model=UserOut)
def register(payload: UserRegister, response: Response, db: Session = Depends(get_db)):
    _validate_password_strength(payload.password)
    existing = db.query(User).filter(User.email == payload.email).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    user = User(
        email=payload.email,
        hashed_password=get_password_hash(payload.password),
        nickname=payload.nickname,
        credits=0,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    add_credits(
        db=db,
        user_id=user.id,
        delta=settings.DEFAULT_SIGNUP_CREDITS,
        reason="signup",
        reference_id=str(user.id),
    )

    access_token, refresh_token = create_token_pair(str(user.id))
    _set_auth_cookies(response, access_token, refresh_token)
    return user


@router.post("/login", response_model=TokenPair)
def login(request: Request, payload: UserLogin, response: Response, db: Session = Depends(get_db)):
    client_ip = request.client.host if request.client else "unknown"
    rate_key = f"{client_ip}:{payload.email}"
    if _is_rate_limited(rate_key):
        raise HTTPException(status_code=429, detail="Too many login attempts. Please try again later.")

    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        _record_login_failure(rate_key)
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user.status != "active":
        raise HTTPException(status_code=403, detail="Account is banned")

    # Clear failure window on success
    _LOGIN_FAILURES.pop(rate_key, None)

    access_token, refresh_token = create_token_pair(str(user.id))
    _set_auth_cookies(response, access_token, refresh_token)
    return {"access_token": access_token, "refresh_token": refresh_token, "token_type": "bearer"}


@router.post("/refresh", response_model=TokenPair)
def refresh(request: Request, response: Response, db: Session = Depends(get_db)):
    refresh_token = request.cookies.get(REFRESH_COOKIE_KEY)
    if not refresh_token:
        raise HTTPException(status_code=401, detail="No refresh token")

    from app.core.security import decode_token
    payload = decode_token(refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    jti = payload.get("jti")
    if not jti or is_jti_blacklisted(jti):
        raise HTTPException(status_code=401, detail="Refresh token revoked")

    user_id = payload.get("sub")
    user = db.query(User).filter(User.id == user_id, User.status == "active").first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found or banned")

    access_token, new_refresh = create_token_pair(user.id)
    _set_auth_cookies(response, access_token, new_refresh)
    return {"access_token": access_token, "refresh_token": new_refresh, "token_type": "bearer"}


@router.post("/logout")
def logout(request: Request, response: Response):
    from app.core.security import decode_token
    for cookie_key in (ACCESS_COOKIE_KEY, REFRESH_COOKIE_KEY):
        token = request.cookies.get(cookie_key)
        if token:
            payload = decode_token(token)
            if payload:
                blacklist_jti(payload.get("jti"))
    response.delete_cookie(ACCESS_COOKIE_KEY)
    response.delete_cookie(REFRESH_COOKIE_KEY)
    return {"detail": "Logged out"}


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user


@router.put("/me", response_model=UserOut)
def update_me(payload: UserUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if payload.nickname is not None:
        current_user.nickname = payload.nickname
    if payload.avatar_url is not None:
        current_user.avatar_url = payload.avatar_url
    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/change-password")
def change_password(
    payload: ChangePasswordIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """修改当前用户密码（需校验旧密码）。"""
    if not verify_password(payload.old_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="旧密码错误")
    if payload.old_password == payload.new_password:
        raise HTTPException(status_code=400, detail="新密码不能与旧密码相同")
    _validate_password_strength(payload.new_password)

    current_user.hashed_password = get_password_hash(payload.new_password)
    db.commit()
    return {"detail": "密码已修改，请重新登录"}
