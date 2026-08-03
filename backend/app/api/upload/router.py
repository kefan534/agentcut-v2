from fastapi import APIRouter, Depends, File, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.services.upload_service import save_upload_file, get_upload_file_path

router = APIRouter(prefix="/upload", tags=["upload"])


@router.post("")
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    return await save_upload_file(request, file, current_user)


@router.get("/{user_id}/{filename}")
async def get_file(user_id: str, filename: str, current_user: User = Depends(get_current_user)):
    storage_key = f"{user_id}/{filename}"
    file_path = get_upload_file_path(storage_key, current_user)

    # Images: preview inline; everything else: force download
    ext = file_path.suffix.lower()
    inline_types = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
    disposition = "inline" if ext in inline_types else "attachment"

    return FileResponse(
        file_path,
        filename=file_path.name,
        content_disposition_type=disposition,
    )
