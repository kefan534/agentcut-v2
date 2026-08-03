import base64
import hashlib
from cryptography.fernet import Fernet
from app.core.config import settings


def _derive_key(password: str) -> bytes:
    """Derive a 32-byte Fernet key from an arbitrary password using PBKDF2."""
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), b"infinite-canvas-salt", 100000, dklen=32)
    return base64.urlsafe_b64encode(digest)


def _get_fernet() -> Fernet:
    key = _derive_key(settings.KEY_ENCRYPTION_KEY)
    return Fernet(key)


def encrypt_api_key(plain_key: str) -> str:
    return _get_fernet().encrypt(plain_key.encode("utf-8")).decode("utf-8")


def decrypt_api_key(encrypted_key: str) -> str:
    return _get_fernet().decrypt(encrypted_key.encode("utf-8")).decode("utf-8")
