"""
Tencent Cloud COS integration for AgentCut.

Upload paths:
  uploads/{user_id}/{uuid}.ext     — user reference images (24h lifecycle)
  generated/{user_id}/{uuid}.ext   — AI generated results
  assets/{user_id}/{uuid}.ext      — user asset library (kept permanently)

All objects are written with public-read ACL so Makers / flux-art / API易
can consume the URLs directly.
"""

from __future__ import annotations

import uuid
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
    name = uuid.uuid4().hex
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
    """Upload a local file to COS. Returns the public URL."""
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
            ACL="public-read",
        )

    return _public_url(key)


def upload_bytes(
    data: bytes,
    prefix: str,
    user_id: int | str,
    content_type: str = "",
    ext: str = "",
) -> str:
    """Upload bytes to COS. Returns the public URL."""
    client = _get_client()
    if not client:
        raise RuntimeError("COS is not configured")

    key = _make_key(prefix, user_id, ext)
    client.put_object(
        Bucket=settings.COS_BUCKET,
        Key=key,
        Body=data,
        ContentType=content_type or "application/octet-stream",
        ACL="public-read",
    )
    return _public_url(key)


def delete_file(key: str) -> None:
    """Delete an object from COS."""
    client = _get_client()
    if client:
        client.delete_object(Bucket=settings.COS_BUCKET, Key=key)


def _public_url(key: str) -> str:
    region = settings.COS_REGION or "ap-guangzhou"
    return f"https://{settings.COS_BUCKET}.cos.{region}.myqcloud.com/{key}"


def public_url_for_key(key: str) -> str:
    """Build the public URL for a COS key."""
    return _public_url(key)


def is_configured() -> bool:
    return bool(settings.COS_SECRET_ID and settings.COS_SECRET_KEY and settings.COS_BUCKET)
