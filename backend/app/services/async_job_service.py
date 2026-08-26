import uuid
import time
import asyncio
from typing import Dict, Any, Optional
from datetime import datetime

from app.db.session import SessionLocal
from app.models.user import User
from app.models.model import ApiSource
from app.services.model_service import resolve_source_for_variable
from app.services.gateway_service import call_upstream
from app.services.credit_service import freeze_credits, settle_frozen_credits, release_frozen_credits


# In-memory job store. For production, replace with Redis / Celery / RQ.
_jobs: Dict[str, Dict[str, Any]] = {}

# 任务中心列表最多返回条数（防内存态字典随并发增长而无限拉取）。
_LIST_LIMIT = 200
# 超过该数量后，淘汰最旧的「已结束」任务，防止进程长期运行内存泄漏。
_MAX_JOBS = 5000
# 任务保留时长（秒）：超过后从内存中清理。
_JOB_TTL_SECONDS = 7 * 24 * 3600


def _now_ms() -> int:
    return int(time.time() * 1000)


def _prune_jobs() -> None:
    """按 TTL 与总量上限清理内存任务，避免长期运行内存无限增长。"""
    now = _now_ms()
    ttl_cutoff = now - _JOB_TTL_SECONDS * 1000
    for job_id in list(_jobs.keys()):
        job = _jobs[job_id]
        # R2-#8: 运行中/排队中的任务永不清理（清理会造成状态端点 404 + 冻结积分成孤儿）
        if job.get("status") in ("queued", "running"):
            continue
        if job.get("created_at", 0) < ttl_cutoff:
            del _jobs[job_id]

    # 若仍超量，按创建时间从旧到新淘汰「已结束」任务
    if len(_jobs) > _MAX_JOBS:
        finished = [
            (jid, j.get("created_at", 0))
            for jid, j in _jobs.items()
            if j.get("status") in ("succeeded", "failed")
        ]
        finished.sort(key=lambda x: x[1])
        overflow = len(_jobs) - _MAX_JOBS
        for jid, _ in finished[:overflow]:
            _jobs.pop(jid, None)


def create_job(
    variable_name: str,
    request_body: Dict[str, Any],
    user_id: str,
    kind: str = "generation",
) -> str:
    job_id = str(uuid.uuid4())
    _prune_jobs()
    _jobs[job_id] = {
        "id": job_id,
        "variable_name": variable_name,
        "user_id": user_id,
        "request_body": request_body,
        "kind": kind,  # generation | transcription（重试分发依据，R3-1）
        "status": "queued",
        "result_urls": None,
        "error_message": None,
        "cost_credits": 0,
        "created_at": _now_ms(),
        "completed_at": None,
    }
    return job_id


def list_jobs_for_user(user_id: str) -> list[Dict[str, Any]]:
    """Return a user's jobs, newest first (capped to _LIST_LIMIT)."""
    user_jobs = [j for j in _jobs.values() if str(j.get("user_id")) == str(user_id)]
    user_jobs.sort(key=lambda j: j.get("created_at", 0), reverse=True)
    return user_jobs[:_LIST_LIMIT]


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
        # R2-#1: 统一计费口径 —— 与同步路径/报价共用 compute_cost（定价规则优先，COST_MAP 兜底）
        from app.services.gateway_service import compute_cost
        cost = compute_cost(db, variable_name, request_body, modal_category)
        job["cost_credits"] = cost

        # 冻结积分（可用→冻结），任务进入 running；失败释放、成功结算。
        try:
            freeze_credits(db=db, user_id=user.id, amount=cost, reference_id=job_id)
        except ValueError:
            job["status"] = "failed"
            job["error_message"] = "Insufficient credits"
            job["completed_at"] = _now_ms()
            return

        job["status"] = "running"

        try:
            result = await call_upstream(source, request_body, user_id=str(user.id))
        except Exception as e:
            # 上游失败：释放冻结积分回可用余额
            try:
                release_frozen_credits(db=db, user_id=user.id, amount=cost, reference_id=job_id)
            except ValueError:
                pass
            job["status"] = "failed"
            job["error_message"] = str(e)[:500]
            job["completed_at"] = _now_ms()
            return

        # 上游成功：结算冻结积分为已消费
        try:
            settle_frozen_credits(db=db, user_id=user.id, amount=cost, reference_id=job_id)
        except ValueError:
            try:
                release_frozen_credits(db=db, user_id=user.id, amount=cost, reference_id=job_id)
            except ValueError:
                pass
            job["status"] = "failed"
            job["error_message"] = "Credit settlement failed"
            job["completed_at"] = _now_ms()
            return

        job["status"] = "succeeded"
        job["result_urls"] = _extract_result_urls(result)
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
