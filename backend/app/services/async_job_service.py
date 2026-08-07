import uuid
import time
import asyncio
from typing import Dict, Any, Optional
from datetime import datetime

from app.db.session import SessionLocal
from app.models.user import User
from app.models.model import ApiSource
from app.services.model_service import resolve_source_for_variable
from app.services.gateway_service import call_upstream, COST_MAP
from app.services.credit_service import deduct_credits, add_credits


# In-memory job store. For production, replace with Redis / Celery / RQ.
_jobs: Dict[str, Dict[str, Any]] = {}


def _now_ms() -> int:
    return int(time.time() * 1000)


def create_job(
    variable_name: str,
    request_body: Dict[str, Any],
    user_id: str,
) -> str:
    job_id = str(uuid.uuid4())
    _jobs[job_id] = {
        "id": job_id,
        "variable_name": variable_name,
        "user_id": user_id,
        "status": "queued",
        "result_urls": None,
        "error_message": None,
        "cost_credits": 0,
        "created_at": _now_ms(),
        "completed_at": None,
    }
    return job_id


def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    return _jobs.get(job_id)


async def submit_and_run(
    job_id: str,
    variable_name: str,
    request_body: Dict[str, Any],
    user_id: str,
) -> None:
    """Background task: deduct credits, call upstream, update job."""
    job = _jobs.get(job_id)
    if job is None:
        return

    db = SessionLocal()
    try:
        from uuid import UUID
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

        source = resolve_source_for_variable(db, variable_name, user)
        if not source:
            job["status"] = "failed"
            job["error_message"] = f"No active model for variable {variable_name}"
            job["completed_at"] = _now_ms()
            return

        modal_category = source.modal_category
        cost = COST_MAP.get(modal_category, 1)
        job["cost_credits"] = cost

        try:
            deduct_credits(
                db=db,
                user_id=user.id,
                amount=cost,
                reason="generation",
                reference_id=job_id,
            )
        except ValueError:
            job["status"] = "failed"
            job["error_message"] = "Insufficient credits"
            job["completed_at"] = _now_ms()
            return

        job["status"] = "running"

        try:
            result = await call_upstream(source, request_body, user_id=str(user.id))
            job["status"] = "succeeded"
            job["result_urls"] = _extract_result_urls(result)
            job["completed_at"] = _now_ms()
        except Exception as e:
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


def _extract_result_urls(result: Any) -> Optional[list[str]]:
    """Best-effort extraction of result URLs from common upstream shapes."""
    if not isinstance(result, dict):
        return None

    # OpenAI DALL-E / Images
    if "data" in result and isinstance(result["data"], list):
        urls = []
        for item in result["data"]:
            if isinstance(item, dict):
                if "url" in item:
                    urls.append(item["url"])
                elif "b64_json" in item:
                    urls.append(f"data:image/png;base64,{item['b64_json']}")
        return urls if urls else None

    # Generic url / urls fields
    for key in ("url", "audio_url", "video_url", "output_url"):
        if key in result and isinstance(result[key], str):
            return [result[key]]

    if "urls" in result and isinstance(result["urls"], list):
        return [u for u in result["urls"] if isinstance(u, str)]

    return None
