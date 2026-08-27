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
from app.services.doc_processing_service import parse_asset


ALLOWED_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".gif", ".webp",
    ".mp4", ".mov", ".webm",
    ".mp3", ".wav", ".ogg", ".m4a",
    ".txt", ".json", ".md", ".csv",
    # P0: document formats
    ".pdf", ".docx", ".xlsx", ".xls",
}

ALLOWED_MIME_PREFIXES = ("image/", "video/", "audio/", "text/", "application/json", "application/pdf", "application/vnd.openxmlformats", "application/vnd.ms-excel")

# 文档类扩展名（用于触发解析/OCR）
DOCUMENT_EXTENSIONS = {".pdf", ".docx", ".xlsx", ".xls", ".txt", ".md", ".csv"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}

# 魔数校验（防伪扩展名）
MAGIC_BYTES = {
    ".pdf": b"%PDF",
    ".docx": b"PK\x03\x04",  # zip signature (docx/xlsx are zips)
    ".xlsx": b"PK\x03\x04",
    ".xls": b"\xD0\xCF\x11\xE0",  # OLE signature
    ".png": b"\x89PNG",
    ".jpg": b"\xFF\xD8\xFF",
    ".jpeg": b"\xFF\xD8\xFF",
    ".gif": b"GIF8",
    ".webp": b"RIFF",
    ".mp4": b"\x00\x00\x00",  # partial, check more later
}

MAX_FILE_BYTES = 50 * 1024 * 1024  # 50MB


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


def _validate_magic_bytes(data: bytes, suffix: str) -> bool:
    """校验文件头部魔数（防伪扩展名）。"""
    expected = MAGIC_BYTES.get(suffix)
    if not expected:
        return True  # 没有强校验的格式（mp4/txt/md 等）
    if len(data) < 16:
        return False
    return data[:len(expected)] == expected


def validate_magic_bytes(data: bytes, filename: str) -> tuple[bool, str, str]:
    """公开版本：(通过?, 错误原因?, mime 类型?)"""
    suffix = Path(filename or "bin").suffix.lower()
    if suffix not in MAGIC_BYTES and suffix not in {".txt", ".md", ".csv"}:
        return False, f"不支持的扩展名 {suffix}", ""
    # 推断 mime
    mime = ""
    if suffix in {".png"}: mime = "image/png"
    elif suffix in {".jpg", ".jpeg"}: mime = "image/jpeg"
    elif suffix == ".gif": mime = "image/gif"
    elif suffix == ".webp": mime = "image/webp"
    elif suffix in {".mp4", ".mov"}: mime = "video/mp4"
    elif suffix in {".mp3"}: mime = "audio/mpeg"
    elif suffix == ".wav": mime = "audio/wav"
    elif suffix == ".pdf": mime = "application/pdf"
    elif suffix == ".docx": mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    elif suffix in {".xlsx", ".xls"}: mime = "application/vnd.ms-excel"
    elif suffix in {".txt", ".md", ".csv"}: mime = "text/plain"
    if not _validate_magic_bytes(data, suffix):
        return False, f"魔数校验失败（{suffix} 文件头不匹配）", mime
    return True, "", mime


def sanitize_filename(name: str) -> str:
    """清洗文件名：去除路径分隔符、保留扩展名。"""
    import re
    name = (name or "upload").split("/")[-1].split("\\")[-1]
    name = re.sub(r"[^a-zA-Z0-9_.\-\u4e00-\u9fff]+", "_", name)
    if len(name) > 200:
        base, ext = Path(name).stem, Path(name).suffix
        name = base[:200 - len(ext)] + ext
    return name or "upload"


def detect_asset_type(filename: str) -> str:
    """根据扩展名推断资产类型。"""
    suffix = Path(filename or "bin").suffix.lower()
    if suffix in IMAGE_EXTENSIONS:
        return "image"
    if suffix in {".mp4", ".mov", ".webm"}:
        return "video"
    if suffix in {".mp3", ".wav", ".ogg", ".m4a"}:
        return "audio"
    if suffix in DOCUMENT_EXTENSIONS:
        return "document"
    if suffix in {".txt", ".json", ".md", ".csv"}:
        return "text"
    return "other"


def _file_path_for(storage_key: str) -> Path:
    """Resolve a storage_key to an on-disk path under UPLOAD_DIR.

    Supports both legacy keys (`{user_id}/{filename}`) and prefixed keys
    (`{prefix}/{user_id}/{filename}`, e.g. COS uploads / generated files).
    """
    if "/" not in storage_key:
        raise HTTPException(status_code=400, detail="Invalid storage key")
    filename = storage_key.split("/")[-1]
    safe_filename = Path(filename).name
    if not safe_filename or safe_filename != filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    file_path = Path(settings.UPLOAD_DIR) / storage_key
    file_path = file_path.resolve()
    allowed_root = Path(settings.UPLOAD_DIR).resolve()
    if not str(file_path).startswith(str(allowed_root)):
        raise HTTPException(status_code=400, detail="Invalid path")
    return file_path


def _owner_id_for(storage_key: str) -> str:
    """Return the owning user_id for a storage key.

    Legacy: `{user_id}/{filename}` -> user_id is the first segment.
    Prefixed: `{prefix}/{user_id}/{filename}` -> user_id is the second segment.
    """
    parts = storage_key.split("/")
    if len(parts) == 2:
        return parts[0]
    if len(parts) >= 3:
        return parts[1]
    raise HTTPException(status_code=400, detail="Invalid storage key")


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
                # storage_key 是裸 COS key；url 给完整公网 URL 供上游模型直接拉取
                "url": cos_service.public_url_for_key(cos_url),
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
    owner_id = _owner_id_for(storage_key)
    if str(current_user.id) != owner_id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return file_path


def resolve_upload_url(storage_key: str, current_user: User) -> tuple[str, bool]:
    """Resolve a storage_key to a displayable URL.

    Returns (url_or_path, is_redirect):
    - Local file exists -> returns the local file path (caller returns FileResponse)
    - Local file missing but COS configured -> returns a presigned COS URL (caller returns RedirectResponse)

    This lets the frontend use a single `/api/v1/upload/{storage_key}` URL for
    both legacy local keys and private COS keys.
    """
    file_path = _file_path_for(storage_key)
    owner_id = _owner_id_for(storage_key)
    if str(current_user.id) != owner_id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")

    if file_path.exists() and file_path.is_file():
        return str(file_path), False

    # Fallback: if the file is stored in COS, generate a temporary URL.
    if cos_service.is_configured():
        try:
            presigned = cos_service.get_presigned_url(storage_key, expires_in=3600)
            return presigned, True
        except Exception:
            pass

    raise HTTPException(status_code=404, detail="File not found")
