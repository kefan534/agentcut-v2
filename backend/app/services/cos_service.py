"""P1: COS service with private-read access + presigned URL.

PRD §3.1.6: COS 必须私有读，前端通过后端签发的预签名 URL 访问，
避免公开 URL 泄露导致数据出域。
"""
from __future__ import annotations

import os
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from qcloud_cos import CosConfig, CosS3Client

from app.core.config import settings


def _get_client() -> Optional[CosS3Client]:
    if not all([settings.COS_SECRET_ID, settings.COS_SECRET_KEY, settings.COS_BUCKET]):
        return None
    config = CosConfig(
        Region=settings.COS_REGION or "ap-guangzhou",
        SecretId=settings.COS_SECRET_ID,
        SecretKey=settings.COS_SECRET_KEY,
        Scheme="https",
    )
    return CosS3Client(config)


def _make_key(prefix: str, user_id: int | str, ext: str = "") -> str:
    name = os.urandom(8).hex()
    if ext and not ext.startswith("."):
        ext = f".{ext}"
    return f"{prefix}/{user_id}/{name}{ext}"


def upload_file(
    file_path: str | Path,
    prefix: str,
    user_id: int | str,
    content_type: str = "",
    ext: str = "",
) -> str:
    """Upload a local file to COS (private). Returns the storage_key (not public URL)."""
    client = _get_client()
    if not client:
        raise RuntimeError("COS is not configured")

    key = _make_key(prefix, user_id, ext)
    file_path = Path(file_path)

    with open(file_path, "rb") as f:
        client.put_object(
            Bucket=settings.COS_BUCKET,
            Key=key,
            Body=f,
            ContentType=content_type or "application/octet-stream",
        )

    return key


def upload_bytes(
    data: bytes,
    prefix: str,
    user_id: int | str,
    content_type: str = "",
    ext: str = "",
) -> str:
    """Upload bytes to COS (private). Returns the storage_key."""
    client = _get_client()
    if not client:
        raise RuntimeError("COS is not configured")

    key = _make_key(prefix, user_id, ext)
    client.put_object(
        Bucket=settings.COS_BUCKET,
        Key=key,
        Body=data,
        ContentType=content_type or "application/octet-stream",
    )
    return key


def delete_file(key: str) -> None:
    """Delete an object from COS."""
    client = _get_client()
    if client:
        client.delete_object(Bucket=settings.COS_BUCKET, Key=key)


def get_presigned_url(key: str, expires_in: int = 3600) -> str:
    """Generate a presigned GET URL for a private COS object. Default expires in 1 hour."""
    client = _get_client()
    if not client:
        return _public_url(key)  # fallback

    url = client.get_presigned_url(
        Bucket=settings.COS_BUCKET,
        Key=key,
        Method="GET",
        Expired=int(time.time()) + expires_in,
    )
    return url


def get_presigned_put_url(key: str, expires_in: int = 3600, content_type: str = "application/octet-stream") -> str:
    """Generate a presigned PUT URL for direct upload."""
    client = _get_client()
    if not client:
        raise RuntimeError("COS is not configured")

    url = client.get_presigned_url(
        Bucket=settings.COS_BUCKET,
        Key=key,
        Method="PUT",
        Expired=int(time.time()) + expires_in,
        Headers={"Content-Type": content_type},
    )
    return url


def _public_url(key: str) -> str:
    region = settings.COS_REGION or "ap-guangzhou"
    return f"https://{settings.COS_BUCKET}.cos.{region}.myqcloud.com/{key}"


def public_url_for_key(key: str) -> str:
    """Build the public URL for a COS key (only for fallback when COS not configured)."""
    return _public_url(key)


def is_configured() -> bool:
    return bool(settings.COS_SECRET_ID and settings.COS_SECRET_KEY and settings.COS_BUCKET)


def resolve_asset_url(storage_key: str, expires_in: int = 3600) -> str:
    """Resolve a stored asset's storage_key to a presigned URL.

    兼容：
    - COS key（assets/xxx.ext）→ 预签名 URL
    - 已经是 http(s) URL → 直接返回
    - 是本地路径 /api/v1/upload/... → 直接返回（由本地代理服务）
    """
    if not storage_key:
        return ""
    if storage_key.startswith("http://") or storage_key.startswith("https://"):
        return storage_key
    if storage_key.startswith("/api/v1/upload/"):
        return storage_key  # 本地存储，由后端代理
    return get_presigned_url(storage_key, expires_in=expires_in)