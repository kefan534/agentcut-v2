import uuid
import time
import json
import base64
import asyncio
import logging
from pathlib import Path
from typing import Any, Dict, Optional, List
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Request, File, UploadFile
from fastapi.responses import StreamingResponse, JSONResponse, FileResponse, Response
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from app.db.session import get_db
from app.core.deps import get_current_user, get_current_user_optional
from app.models.user import User
from app.models.model import ApiSource
from app.services.model_service import resolve_source_for_variable, list_available_models, build_catalog, first_active_source_by_category
from app.services.gateway_service import call_upstream, stream_upstream, log_call, COST_MAP, _is_private_url, _is_backend_upload_url
from app.services.credit_service import deduct_credits
from app.services.async_job_service import create_job, get_job, submit_and_run
from app.services.upload_service import save_upload_file, get_upload_file_path
from app.schemas.model import AvailableModelOut, CatalogModelOut
from app.schemas.log import CallLogOut
from app.models.log import CallLog
from app.api.gateway import sessions as sessions_router

router = APIRouter(prefix="/gateway", tags=["gateway"])
router.include_router(sessions_router.router)


def _get_request_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    return forwarded.split(",")[0].strip() if forwarded else request.client.host if request.client else ""


# ---------------------------------------------------------------------------
# Model catalog / listing
# ---------------------------------------------------------------------------

@router.get("/models", response_model=list[AvailableModelOut])
def get_models(
    current_user: Optional[User] = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    return list_available_models(db, current_user)


@router.get("/models/catalog", response_model=list[CatalogModelOut])
def get_model_catalog(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Palmier-compatible model catalog."""
    return build_catalog(db, current_user)


@router.get("/logs", response_model=list[CallLogOut])
def get_generation_logs(
    modal_category: str,
    limit: int = 50,
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the current user's generation history for a given modal category."""
    query = db.query(CallLog).filter(
        CallLog.user_id == current_user.id,
        CallLog.modal_category == modal_category,
    ).order_by(CallLog.created_at.desc())
    return query.offset(offset).limit(limit).all()


# ---------------------------------------------------------------------------
# Media upload (replaces Convex staging upload)
# ---------------------------------------------------------------------------

@router.post("/upload")
async def gateway_upload(
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """Upload a media file and receive a storageId usable by transcription/generation."""
    result = await save_upload_file(request, file, current_user)
    return {
        "storageId": result["storage_key"],
        "filename": result["filename"],
        "content_type": result["content_type"],
        "url": result["url"],
    }


# ---------------------------------------------------------------------------
# Transcription jobs (replaces Convex transcriptions:*)
# ---------------------------------------------------------------------------

class TranscriptionSubmit(BaseModel):
    storageId: str
    durationSeconds: float = 0
    language: Optional[str] = None
    projectId: Optional[str] = None


@router.post("/transcription/submit")
async def transcription_submit(
    payload: TranscriptionSubmit,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Submit an async transcription job. Returns a jobId to poll."""
    # Validate the uploaded file exists and belongs to the caller.
    try:
        file_path = get_upload_file_path(payload.storageId, current_user)
    except HTTPException:
        raise HTTPException(status_code=404, detail="Storage file not found")

    request_body = {
        "storageId": payload.storageId,
        "durationSeconds": payload.durationSeconds,
        "language": payload.language,
        "projectId": payload.projectId,
        "file_path": str(file_path),
        "content_type": None,
    }

    job_id = create_job("TRANSCRIPTION", request_body, str(current_user.id))
    asyncio.create_task(_run_transcription_job(job_id, request_body, str(current_user.id)))

    job = get_job(job_id)
    return {
        "jobId": job_id,
        "status": job["status"],
        "createdAt": job["created_at"],
    }


@router.get("/transcription/{job_id}/status")
def transcription_status(
    job_id: str,
    current_user: User = Depends(get_current_user),
):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if str(job.get("user_id")) != str(current_user.id):
        raise HTTPException(status_code=403, detail="Not your job")

    return {
        "jobId": job["id"],
        "status": job["status"],
        "errorMessage": job.get("error_message"),
        "createdAt": job.get("created_at"),
        "completedAt": job.get("completed_at"),
    }


@router.get("/transcription/{job_id}/result")
async def transcription_result(
    job_id: str,
    current_user: User = Depends(get_current_user),
):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if str(job.get("user_id")) != str(current_user.id):
        raise HTTPException(status_code=403, detail="Not your job")
    if job.get("status") != "succeeded":
        raise HTTPException(status_code=400, detail="Transcription not ready")

    result_path = _transcription_result_path(job_id)
    if not result_path.exists():
        raise HTTPException(status_code=404, detail="Transcription result not found")

    return FileResponse(result_path, media_type="application/json")


def _transcription_result_path(job_id: str):
    from pathlib import Path
    from app.core.config import settings
    path = Path(settings.UPLOAD_DIR) / "transcriptions"
    path.mkdir(parents=True, exist_ok=True)
    return path / f"{job_id}.json"


async def _run_transcription_job(job_id: str, request_body: Dict[str, Any], user_id: str):
    """Background worker for transcription. Falls back to a local mock if no upstream is configured."""
    from app.db.session import SessionLocal
    from uuid import UUID

    job = get_job(job_id)
    if job is None:
        return

    db = SessionLocal()
    try:
        try:
            uid = UUID(user_id)
        except ValueError:
            job["status"] = "failed"
            job["error_message"] = "Invalid user id"
            job["completed_at"] = _now_ms()
            return

        user = db.query(User).filter(User.id == uid, User.status == "active").first()
        if not user:
            job["status"] = "failed"
            job["error_message"] = "User not found or banned"
            job["completed_at"] = _now_ms()
            return

        source = resolve_source_for_variable(db, "TRANSCRIPTION", user)
        cost = COST_MAP.get("audio", 3)

        try:
            deduct_credits(
                db=db,
                user_id=user.id,
                amount=cost,
                reason="transcription",
                reference_id=job_id,
            )
        except ValueError:
            job["status"] = "failed"
            job["error_message"] = "Insufficient credits"
            job["completed_at"] = _now_ms()
            return

        job["status"] = "running"
        job["cost_credits"] = cost

        try:
            if source:
                # Forward to an upstream transcription service if configured.
                payload = {
                    "storageId": request_body["storageId"],
                    "durationSeconds": request_body["durationSeconds"],
                    "language": request_body.get("language"),
                    "projectId": request_body.get("projectId"),
                }
                result = await call_upstream(source, payload, user_id=user_id)
            else:
                # Local mock: produce a placeholder transcript so the Palmier UI works.
                duration = request_body.get("durationSeconds") or 0
                placeholder_text = "（本地转写占位）未配置上游转写服务。请在 infinite-canvas-backend 后台添加 TRANSCRIPTION 变量对应的 API source。"
                segment = {
                    "start": 0.0,
                    "end": max(duration, 1.0),
                    "text": placeholder_text,
                    "speaker": None,
                }
                result = {
                    "text": placeholder_text,
                    "language": request_body.get("language") or "auto",
                    "words": [],
                    "segments": [segment],
                }

            result_path = _transcription_result_path(job_id)
            with open(result_path, "w", encoding="utf-8") as f:
                json.dump(result, f, ensure_ascii=False)

            job["status"] = "succeeded"
            job["result_urls"] = [f"/api/v1/gateway/transcription/{job_id}/result"]
            job["completed_at"] = _now_ms()
        except Exception as e:
            from app.services.credit_service import add_credits
            add_credits(
                db=db,
                user_id=user.id,
                delta=cost,
                reason="refund",
                reference_id=job_id,
            )
            job["status"] = "failed"
            job["error_message"] = str(e)[:500]
            job["completed_at"] = _now_ms()
    finally:
        db.close()


def _now_ms() -> int:
    return int(time.time() * 1000)


# ---------------------------------------------------------------------------
# Agent chat streaming (replaces Convex v1/agent/stream)
# ---------------------------------------------------------------------------

@router.post("/agent/stream")
async def agent_stream(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Stream agent responses. Accepts an Anthropic-style request body.

    Looks for a variable named TEXT_MODEL; if absent, uses the first active text source.
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    source = resolve_source_for_variable(db, "TEXT_MODEL", current_user)
    if not source:
        source = first_active_source_by_category(db, "text", current_user)
    if not source:
        raise HTTPException(status_code=404, detail="No active text model configured")

    cost = COST_MAP.get(source.modal_category, 1)
    try:
        deduct_credits(
            db=db,
            user_id=current_user.id,
            amount=cost,
            reason="agent",
            reference_id=str(uuid.uuid4()),
        )
    except ValueError:
        raise HTTPException(status_code=402, detail="Insufficient credits")

    request_id = str(uuid.uuid4())
    start = time.time()

    async def event_stream():
        try:
            async for chunk in stream_upstream(source, body):
                yield chunk

            latency = (time.time() - start) * 1000
            log_call(
                db=db,
                request_id=request_id,
                user=current_user,
                variable_name="TEXT_MODEL",
                source=source,
                modal_category=source.modal_category,
                status="success",
                status_code=200,
                latency_ms=latency,
                error_message=None,
                cost_credits=cost,
                request_body=body,
                response_summary={"stream": True},
            )
        except Exception as e:
            latency = (time.time() - start) * 1000
            log_call(
                db=db,
                request_id=request_id,
                user=current_user,
                variable_name="TEXT_MODEL",
                source=source,
                modal_category=source.modal_category,
                status="failed",
                status_code=None,
                latency_ms=latency,
                error_message=str(e)[:500],
                cost_credits=0,
                request_body=body,
                response_summary={},
            )
            # Yield a final SSE-style error so the client can surface it.
            yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ---------------------------------------------------------------------------
# Generic gateway generation (sync / async / proxy)
# ---------------------------------------------------------------------------

async def _save_generated_media(
    result: Any,
    current_user: User,
    modal_category: str,
) -> List[str]:
    """Persist generated media (image base64 or external URL) to COS.
    Returns public COS URLs that can be displayed by the frontend."""
    from app.core.config import settings
    from app.services import cos_service
    urls: List[str] = []
    if not isinstance(result, dict):
        return urls

    data_arr = result.get("data")
    items = data_arr if isinstance(data_arr, list) else [result]

    cos_ready = cos_service.is_configured()
    user_dir = Path(settings.UPLOAD_DIR) / str(current_user.id)
    if not cos_ready:
        user_dir.mkdir(parents=True, exist_ok=True)

    for item in items:
        if not isinstance(item, dict):
            continue
        b64 = item.get("b64_json") or item.get("b64")
        if b64:
            try:
                raw = base64.b64decode(b64)
            except Exception:
                continue
            mime = item.get("mime_type") or item.get("mimeType") or ""
            ext = ".png"
            content_type = "image/png"
            if "jpeg" in mime or "jpg" in mime:
                ext = ".jpg"; content_type = "image/jpeg"
            elif "webp" in mime:
                ext = ".webp"; content_type = "image/webp"
            elif "gif" in mime:
                ext = ".gif"; content_type = "image/gif"
            elif "mp4" in mime:
                ext = ".mp4"; content_type = "video/mp4"
            # 上传 COS（优先），否则写本地
            if cos_ready:
                try:
                    cos_url = cos_service.upload_bytes(
                        raw, prefix="generated", user_id=current_user.id,
                        content_type=content_type, ext=ext.lstrip("."),
                    )
                    urls.append(cos_url)
                    continue
                except Exception:
                    pass  # fallback to local
            fname = f"{uuid.uuid4().hex}{ext}"
            fpath = user_dir / fname
            fpath.write_bytes(raw)
            urls.append(f"/api/v1/upload/{current_user.id}/{fname}")
            continue
        # External URL: download → upload to COS
        ext_url = item.get("url") or item.get("video_url") or item.get("audio_url")
        if isinstance(ext_url, str) and ext_url:
            saved_url = await _persist_external_url(ext_url, user_dir, current_user.id, modal_category)
            if saved_url:
                urls.append(saved_url)
            else:
                logger.warning("External URL persistence failed and was skipped to avoid returning a potentially expired URL: %s", ext_url)
    return urls


async def _persist_external_url(url: str, user_dir: Path, user_id: int | str, modal_category: str) -> Optional[str]:
    """Download an external media URL and upload to COS (or save locally as fallback)."""
    import httpx
    from app.services import cos_service

    # SSRF guard: refuse private / loopback / metadata URLs before fetching.
    if _is_private_url(url):
        logger.warning("Blocked fetch of private URL (SSRF guard): %s", url)
        return None

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=15.0), follow_redirects=True) as client:
            response = await client.get(url)
            if response.status_code >= 400:
                return None
            content_type = response.headers.get("content-type", "").lower()
            ext = ".bin"
            if "mp4" in content_type:
                ext = ".mp4"
            elif "webm" in content_type:
                ext = ".webm"
            elif "png" in content_type:
                ext = ".png"
            elif "jpeg" in content_type or "jpg" in content_type:
                ext = ".jpg"
            elif "webp" in content_type:
                ext = ".webp"
            elif "gif" in content_type:
                ext = ".gif"
            elif modal_category == "video":
                ext = ".mp4"
            elif modal_category == "audio":
                ext = ".mp3"
            elif modal_category == "image":
                ext = ".png"
            fname = f"{uuid.uuid4().hex}{ext}"
            # 优先上传 COS
            if cos_service.is_configured():
                try:
                    cos_url = cos_service.upload_bytes(
                        response.content, prefix="generated", user_id=user_id,
                        content_type=content_type or "application/octet-stream", ext=ext.lstrip("."),
                    )
                    return cos_url
                except Exception:
                    pass  # fallback to local
            fpath = user_dir / fname
            fpath.write_bytes(response.content)
            return f"/api/v1/upload/{user_id}/{fname}"
    except Exception:
        return None


async def _save_binary_response(
    content: bytes,
    current_user: User,
    content_type: str,
) -> str:
    """Save a binary upstream response (e.g. video bytes) to disk and return its URL."""
    from app.core.config import settings
    ext = ".bin"
    ct = (content_type or "").lower()
    if "mp4" in ct:
        ext = ".mp4"
    elif "webm" in ct:
        ext = ".webm"
    elif "png" in ct:
        ext = ".png"
    elif "jpeg" in ct or "jpg" in ct:
        ext = ".jpg"
    elif "webp" in ct:
        ext = ".webp"
    # 优先上传 COS
    from app.services import cos_service
    if cos_service.is_configured():
        try:
            return cos_service.upload_bytes(
                content, prefix="generated", user_id=current_user.id,
                content_type=ct or "application/octet-stream", ext=ext.lstrip("."),
            )
        except Exception:
            pass
    user_dir = Path(settings.UPLOAD_DIR) / str(current_user.id)
    user_dir.mkdir(parents=True, exist_ok=True)
    fname = f"{uuid.uuid4().hex}{ext}"
    fpath = user_dir / fname
    fpath.write_bytes(content)
    return f"/api/v1/upload/{current_user.id}/{fname}"


async def _run_gateway(
    variable_name: str,
    body: Dict[str, Any],
    current_user: User,
    db: Session,
    endpoint_override: Optional[str] = None,
    raw_stream: bool = False,
    raw_response: bool = False,
):
    source = resolve_source_for_variable(db, variable_name, current_user)
    if not source:
        raise HTTPException(status_code=404, detail=f"No active model for variable {variable_name}")

    modal_category = source.modal_category
    cost = COST_MAP.get(modal_category, 1)

    try:
        deduct_credits(
            db=db,
            user_id=current_user.id,
            amount=cost,
            reason="generation",
            reference_id=str(uuid.uuid4()),
        )
    except ValueError:
        raise HTTPException(status_code=402, detail="Insufficient credits")

    request_id = str(uuid.uuid4())
    start = time.time()

    try:
        stream = body.pop("stream", False) if endpoint_override is None else False
        if raw_stream:
            stream = True

        if stream and modal_category == "text":
            async def event_stream():
                async for chunk in stream_upstream(source, body, endpoint_override=endpoint_override):
                    yield chunk

            log_call(
                db=db,
                request_id=request_id,
                user=current_user,
                variable_name=variable_name,
                source=source,
                modal_category=modal_category,
                status="pending",
                status_code=None,
                latency_ms=0,
                error_message=None,
                cost_credits=cost,
                request_body=body,
                response_summary={"stream": True},
            )
            return StreamingResponse(event_stream(), media_type="text/event-stream")

        result = await call_upstream(source, body, endpoint_override=endpoint_override, user_id=str(current_user.id))
        latency = (time.time() - start) * 1000

        # Persist generated media so it survives page reloads.
        if isinstance(result, bytes):
            content_type = "application/octet-stream"
            saved_url = await _save_binary_response(result, current_user, content_type)
            generated_files = [saved_url]
        else:
            generated_files = await _save_generated_media(result, current_user, modal_category)

        log_call(
            db=db,
            request_id=request_id,
            user=current_user,
            variable_name=variable_name,
            source=source,
            modal_category=modal_category,
            status="success",
            status_code=200,
            latency_ms=latency,
            error_message=None,
            cost_credits=cost,
            request_body=body,
            response_summary={"upstream_status": "ok", "generated_files": generated_files},
        )

        # Proxy mode returns the raw upstream response so the web UI parsers work.
        if isinstance(result, bytes):
            return Response(
                content=result,
                media_type="application/octet-stream",
                headers={"X-Generated-Files": json.dumps(generated_files)},
            )
        if raw_response:
            return JSONResponse(content={
                **result,
                "generated_files": generated_files,
            })
        return JSONResponse(content={
            "request_id": request_id,
            "variable_name": variable_name,
            "source": {
                "vendor": source.vendor,
                "model_version": source.model_version,
                "source_name": source.source_name,
            },
            "data": result,
            "generated_files": generated_files,
        })

    except Exception as e:
        latency = (time.time() - start) * 1000
        from app.services.credit_service import add_credits
        add_credits(
            db=db,
            user_id=current_user.id,
            delta=cost,
            reason="refund",
            reference_id=request_id,
        )
        log_call(
            db=db,
            request_id=request_id,
            user=current_user,
            variable_name=variable_name,
            source=source,
            modal_category=modal_category,
            status="failed",
            status_code=None,
            latency_ms=latency,
            error_message=str(e)[:500],
            cost_credits=0,
            request_body=body,
            response_summary={},
        )
        raise HTTPException(status_code=502, detail=f"Upstream error: {e}")


class ProxyPayload(BaseModel):
    endpoint: str
    body: Dict[str, Any]
    stream: bool = False


@router.post("/{variable_name}/proxy")
async def gateway_proxy(
    variable_name: str,
    payload: ProxyPayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return await _run_gateway(
        variable_name,
        payload.body,
        current_user,
        db,
        endpoint_override=payload.endpoint,
        raw_stream=payload.stream,
        raw_response=True,
    )


class SubmitJobResponse(BaseModel):
    job_id: str
    status: str
    created_at: int


@router.post("/{variable_name}/submit", response_model=SubmitJobResponse)
async def gateway_submit(
    variable_name: str,
    body: Dict[str, Any],
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Submit an async generation job. Returns immediately; poll /status/{job_id}."""
    source = resolve_source_for_variable(db, variable_name, current_user)
    if not source:
        raise HTTPException(status_code=404, detail=f"No active model for variable {variable_name}")

    job_id = create_job(variable_name, body, str(current_user.id))
    # Fire-and-forget background task
    asyncio.create_task(submit_and_run(job_id, variable_name, body, str(current_user.id)))

    job = get_job(job_id)
    return SubmitJobResponse(
        job_id=job_id,
        status=job["status"],
        created_at=job["created_at"],
    )


@router.get("/{variable_name}/status/{job_id}")
def gateway_status(
    variable_name: str,
    job_id: str,
    current_user: User = Depends(get_current_user),
):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if str(job.get("user_id")) != str(current_user.id):
        raise HTTPException(status_code=403, detail="Not your job")
    return {
        "job_id": job["id"],
        "variable_name": job["variable_name"],
        "status": job["status"],
        "result_urls": job.get("result_urls"),
        "error_message": job.get("error_message"),
        "cost_credits": job.get("cost_credits"),
        "created_at": job.get("created_at"),
        "completed_at": job.get("completed_at"),
    }


# Generic sync generation endpoint. Must be registered AFTER the specific
# /{variable_name}/... sub-routes so that /proxy, /submit and /status are
# not shadowed by this path parameter.
@router.post("/{variable_name}")
async def gateway_generate(
    variable_name: str,
    body: Dict[str, Any],
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return await _run_gateway(variable_name, body, current_user, db)
