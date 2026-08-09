from pathlib import Path

from fastapi import APIRouter, Depends, File, Request, UploadFile
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.services.upload_service import save_upload_file, resolve_upload_url

router = APIRouter(prefix="/upload", tags=["upload"])


@router.post("")
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    return await save_upload_file(request, file, current_user)


@router.get("/{storage_key:path}")
async def get_file(storage_key: str, current_user: User = Depends(get_current_user)):
    target, is_redirect = resolve_upload_url(storage_key, current_user)
    if is_redirect:
        return RedirectResponse(url=target)

    file_path = target
    # Images: preview inline; everything else: force download
    ext = Path(file_path).suffix.lower()
    inline_types = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
    disposition = "inline" if ext in inline_types else "attachment"

    return FileResponse(
        file_path,
        filename=Path(file_path).name,
        content_disposition_type=disposition,
    )
