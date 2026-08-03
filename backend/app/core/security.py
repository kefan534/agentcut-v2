import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple, Set
from jose import JWTError, jwt
import bcrypt
from app.core.config import settings


# In-memory token blacklist (jti). For multi-worker production deployments, replace with Redis.
_TOKEN_BLACKLIST: Set[str] = set()


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


def blacklist_jti(jti: str):
    if jti:
        _TOKEN_BLACKLIST.add(jti)


def is_jti_blacklisted(jti: str) -> bool:
    return jti in _TOKEN_BLACKLIST
