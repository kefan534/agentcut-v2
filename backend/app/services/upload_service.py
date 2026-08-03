import uuid
import os
from pathlib import Path
from fastapi import HTTPException, UploadFile, Request
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.user import User


ALLOWED_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".gif", ".webp",
    ".mp4", ".mov", ".webm",
    ".mp3", ".wav", ".ogg", ".m4a",
    ".txt", ".json", ".md", ".csv",
}

ALLOWED_MIME_PREFIXES = ("image/", "video/", "audio/", "text/", "application/json")


def _ensure_upload_dir():
    Path(settings.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)


def _user_subdir(user_id) -> Path:
    path = Path(settings.UPLOAD_DIR) / str(user_id)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _validate_file_type(filename: str | None, content_type: str | None):
    suffix = Path(filename or "bin").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail=f"File extension '{suffix}' is not allowed")
    if content_type and not content_type.startswith(ALLOWED_MIME_PREFIXES):
        raise HTTPException(status_code=415, detail=f"Content-Type '{content_type}' is not allowed")


def _file_path_for(storage_key: str) -> Path:
    parts = storage_key.split("/", 1)
    if len(parts) != 2:
        raise HTTPException(status_code=400, detail="Invalid storage key")
    user_id, filename = parts
    safe_filename = Path(filename).name
    if not safe_filename or safe_filename != filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    file_path = Path(settings.UPLOAD_DIR) / str(user_id) / safe_filename
    file_path = file_path.resolve()
    allowed_root = Path(settings.UPLOAD_DIR).resolve()
    if not str(file_path).startswith(str(allowed_root)):
        raise HTTPException(status_code=400, detail="Invalid path")
    return file_path


async def save_upload_file(
    request: Request,
    file: UploadFile,
    current_user: User,
) -> dict:
    """Save an uploaded file and return a storage key / URL.

    This is shared by /api/v1/upload and /api/v1/gateway/upload.
    """
    _ensure_upload_dir()

    max_upload_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    content_length = request.headers.get("content-length")
    if content_length:
        if int(content_length) > max_upload_bytes:
            raise HTTPException(status_code=413, detail="File too large")

    _validate_file_type(file.filename, file.content_type)

    ext = Path(file.filename or "bin").suffix
    safe_name = f"{uuid.uuid4().hex}{ext}"
    user_dir = _user_subdir(current_user.id)
    dest = user_dir / safe_name

    try:
        with open(dest, "wb") as buffer:
            copied = 0
            while True:
                chunk = file.file.read(64 * 1024)
                if not chunk:
                    break
                copied += len(chunk)
                if copied > max_upload_bytes:
                    raise HTTPException(status_code=413, detail="File too large")
                buffer.write(chunk)
    except HTTPException:
        try:
            os.unlink(dest)
        except OSError:
            pass
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")
    finally:
        file.file.close()

    storage_key = f"{current_user.id}/{safe_name}"
    return {
        "storage_key": storage_key,
        "filename": file.filename,
        "content_type": file.content_type,
        "url": f"/api/v1/upload/{storage_key}",
    }


def get_upload_file_path(storage_key: str, current_user: User) -> Path:
    file_path = _file_path_for(storage_key)
    owner_id = storage_key.split("/", 1)[0]
    if str(current_user.id) != owner_id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return file_path
