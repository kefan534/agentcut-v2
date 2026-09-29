import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple
from jose import JWTError, jwt
import bcrypt
from app.core.config import settings


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))


def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def create_token(subject: str, token_type: str, expires_delta: Optional[timedelta] = None) -> str:
    if token_type == "access":
        default_minutes = settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES
    elif token_type == "refresh":
        default_minutes = settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60
    else:
        raise ValueError("token_type must be access or refresh")

    if expires_delta is None:
        expires_delta = timedelta(minutes=default_minutes)

    expire = datetime.now(timezone.utc) + expires_delta
    to_encode = {
        "sub": str(subject),
        "type": token_type,
        "exp": expire,
        "jti": str(uuid.uuid4()),
    }
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return encoded_jwt


def decode_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        return payload
    except JWTError:
        return None


def create_token_pair(user_id: str) -> Tuple[str, str]:
    access = create_token(user_id, "access")
    refresh = create_token(user_id, "refresh")
    return access, refresh


def revoke_jti(db, jti: str, expires_at: Optional[datetime] = None) -> None:
    """吊销 token（持久化 DB，多 worker / 重启后仍生效）。

    expires_at 未提供时按 refresh 最长有效期兜底，防止黑名单行永不过期。
    顺带清理已过期的黑名单行（opportunistic cleanup）。
    """
    if not jti:
        return
    from app.models.user import RevokedToken
    from sqlalchemy import text as _text

    if expires_at is None:
        expires_at = datetime.now(timezone.utc) + timedelta(
            days=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS
        )
    try:
        db.add(RevokedToken(jti=jti, expires_at=expires_at))
        # 清理已过期条目（token 过期后 JWT 校验自身就会拒绝，黑名单行无用）
        db.execute(_text("DELETE FROM revoked_tokens WHERE expires_at < NOW()"))
        db.commit()
    except Exception:
        db.rollback()


def is_jti_blacklisted(db, jti: str) -> bool:
    if not jti:
        return False
    from app.models.user import RevokedToken

    try:
        return db.query(RevokedToken).filter(RevokedToken.jti == jti).first() is not None
    except Exception:
        # 黑名单查询失败时宁可放行（可用性优先），token 签名/过期校验仍在
        return False
