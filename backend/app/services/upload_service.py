import uuid
import os
import tempfile
from pathlib import Path
from fastapi import HTTPException, UploadFile, Request
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.user import User
from app.services import cos_service


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
    """Save an uploaded file. Uses COS when configured, falls back to local disk."""
    _ensure_upload_dir()

    max_upload_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    content_length = request.headers.get("content-length")
    if content_length:
        if int(content_length) > max_upload_bytes:
            raise HTTPException(status_code=413, detail="File too large")

    _validate_file_type(file.filename, file.content_type)

    ext = Path(file.filename or "bin").suffix
    safe_name = f"{uuid.uuid4().hex}{ext}"

    # Read file into memory (or use temp file for large files)
    chunks: list[bytes] = []
    total = 0
    try:
        while True:
            chunk = await file.read(64 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > max_upload_bytes:
                raise HTTPException(status_code=413, detail="File too large")
            chunks.append(chunk)
    finally:
        file.file.close()

    data = b"".join(chunks)

    if cos_service.is_configured():
        # Upload to COS with public-read ACL
        try:
            cos_url = cos_service.upload_bytes(
                data=data,
                prefix="uploads",
                user_id=current_user.id,
                content_type=file.content_type or "application/octet-stream",
                ext=ext,
            )
            return {
                "storage_key": cos_url,
                "filename": file.filename,
                "content_type": file.content_type,
                "url": cos_url,
                "storage": "cos",
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"COS upload failed: {e}")
    else:
        # Fallback to local disk
        user_dir = _user_subdir(current_user.id)
        dest = user_dir / safe_name
        try:
            dest.write_bytes(data)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Upload failed: {e}")
        storage_key = f"{current_user.id}/{safe_name}"
        return {
            "storage_key": storage_key,
            "filename": file.filename,
            "content_type": file.content_type,
            "url": f"/api/v1/upload/{storage_key}",
            "storage": "local",
        }


def get_upload_file_path(storage_key: str, current_user: User) -> Path:
    file_path = _file_path_for(storage_key)
    owner_id = storage_key.split("/", 1)[0]
    if str(current_user.id) != owner_id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return file_path
