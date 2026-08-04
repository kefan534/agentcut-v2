import re
import time
import json
import uuid
import asyncio
import base64
from typing import Dict, Any, Optional, AsyncGenerator, List
from urllib.parse import urlparse
from fastapi import HTTPException
from fastapi.responses import StreamingResponse
import httpx

from sqlalchemy.orm import Session
from app.models.model import ApiSource, VariableMapping
from app.models.user import User
from app.models.log import CallLog
from app.services import cos_service
from app.core.encryption import decrypt_api_key
from app.services.model_service import resolve_source_for_variable


COST_MAP = {
    "text": 1,
    "image": 5,
    "audio": 3,
    "video": 20,
}


_ENDPOINT_PATH_RE = re.compile(r"^[A-Za-z0-9_./-]*$")

# ---------------------------------------------------------------------------
# Flux Art OpenAPI adapter
#
# flux-art.ai uses its own async task protocol (NOT OpenAI-compatible):
#   POST /images/generations   -> {"model", "mode": "generate"|"edit", "prompt",
#                                  "count": 1, "image_urls": [...], "aspect_ratio": "16:9"}
#   POST /videos/generations   -> {"model", "video_mode": "t2v"|"i2v_first"|...,
#                                  "prompt", "image_urls": [...], "duration",
#                                  "resolution", "ratio"|"aspect_ratio"}
#   GET  /tasks/{task_id}      -> {"data": {"status": "queued"|"processing"|"succeeded"|"failed",
#                                           "output": [urls]}}
# Reference images MUST be public HTTPS URLs (data URLs are rejected).
# ---------------------------------------------------------------------------

_FLUXART_HOST_MARKERS = ("open-api.flux-art.ai", "openapi.flux-art", "flux-art.ai/openapi", "fluxart")
_VIDEO_TASK_QUERY_RE = re.compile(r"^/videos/(?!generations$)([^/]+)$")
_IMAGE_ENDPOINT_RE = re.compile(r"images/generations")
_VIDEO_ENDPOINT_RE = re.compile(r"videos/generations")

_VIDEO_MODE_MAP = {
    "text_to_video": "t2v",
    "image_to_video": "i2v_first",
}

# flux-art 只接受标准比例枚举；自定义像素尺寸换算出的比例（如 85:48）会导致 400 invalid_request。
_FLUXART_RATIO_PRESETS = [
    ("1:1", 1.0), ("16:9", 16.0 / 9.0), ("9:16", 9.0 / 16.0),
    ("4:3", 4.0 / 3.0), ("3:4", 3.0 / 4.0), ("3:2", 3.0 / 2.0), ("2:3", 2.0 / 3.0),
    ("21:9", 21.0 / 9.0), ("2:1", 2.0), ("1:2", 0.5), ("7:4", 7.0 / 4.0), ("4:7", 4.0 / 7.0),
]


def _normalize_fluxart_ratio(value: Any) -> Any:
    """Map an arbitrary 'w:h' ratio to the closest flux-art preset; pass through non-ratio values."""
    if not isinstance(value, str):
        return value
    m = re.match(r"^(\d+):(\d+)$", value.strip())
    if not m:
        return value
    w, h = int(m.group(1)), int(m.group(2))
    if w <= 0 or h <= 0:
        return value
    target = w / h
    best, best_diff = None, None
    for label, ratio in _FLUXART_RATIO_PRESETS:
        diff = abs(ratio - target)
        if best_diff is None or diff < best_diff:
            best, best_diff = label, diff
    return best


def _is_fluxart_source(source: ApiSource) -> bool:
    url = (source.base_url or "").lower()
    return any(marker in url for marker in _FLUXART_HOST_MARKERS)


def _is_private_url(url: str) -> bool:
    """True for localhost / private-LAN URLs that an upstream service cannot download."""
    try:
        host = (urlparse(url).hostname or "").lower()
    except Exception:
        return True
    if not host:
        return True
    if host == "localhost" or host == "::1" or host.endswith(".local") or host.endswith(".localhost"):
        return True
    if re.match(r"^(127\.|10\.|192\.168\.)", host) or re.match(r"^172\.(1[6-9]|2\d|3[01])\.", host):
        return True
    return False


async def _fluxart_public_urls(value: Any, user_id: str = "system") -> List[str]:
    """Extract public http(s) URLs. For private/data URLs: download + re-upload to COS."""
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    urls: List[str] = []
    for item in value:
        if not isinstance(item, str):
            continue
        # Already public
        if item.startswith(("http://", "https://")) and not _is_private_url(item):
            urls.append(item)
            continue
        # data URL → decode + upload to COS
        if item.startswith("data:"):
            try:
                header, b64data = item.split(",", 1)
                mime = "image/png"
                if "image/jpeg" in header:
                    mime = "image/jpeg"
                elif "image/webp" in header:
                    mime = "image/webp"
                img_bytes = base64.b64decode(b64data)
                ext = ".png" if "png" in mime else ".jpg" if "jpeg" in mime else ".webp"
                cos_url = cos_service.upload_bytes(img_bytes, "uploads", user_id, mime, ext)
                urls.append(cos_url)
            except Exception:
                continue
            continue
        # Private http URL → download + upload to COS
        if item.startswith(("http://", "https://")) and _is_private_url(item):
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    resp = await client.get(item)
                    resp.raise_for_status()
                    img_bytes = resp.content
                    ct = resp.headers.get("content-type", "image/png")
                    ext_map = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif"}
                    ext = ext_map.get(ct.split(";")[0].strip(), ".png")
                    cos_url = cos_service.upload_bytes(img_bytes, "uploads", user_id, ct, ext)
                    urls.append(cos_url)
            except Exception:
                continue
    return urls


def _size_to_aspect_ratio(size: Any) -> Optional[str]:
    """Convert '1280x720' or '16:9' to '16:9'. Returns None if unusable."""
    if not isinstance(size, str):
        return None
    value = size.strip().lower()
    if not value or value == "auto":
        return None
    if re.match(r"^\d+:\d+$", value):
        return value
    m = re.match(r"^(\d+)[x×](\d+)$", value)
    if m:
        w, h = int(m.group(1)), int(m.group(2))
        if w <= 0 or h <= 0:
            return None
        g = _gcd(w, h)
        return f"{w // g}:{h // g}"
    return None


def _gcd(a: int, b: int) -> int:
    return b if a == 0 else _gcd(b % a, a)


async def _convert_fluxart_request(body: Dict[str, Any], is_video: bool) -> Dict[str, Any]:
    """Convert OpenAI-ish request body into flux-art OpenAPI schema."""
    if not is_video:
        converted: Dict[str, Any] = {
            "model": body.get("model"),
            "mode": "generate",
            "prompt": body.get("prompt"),
            "count": 1,
        }
        refs = body.get("image") or body.get("images")
        if refs:
            urls = await _fluxart_public_urls(refs)
            if urls:
                converted["mode"] = "edit"
                converted["image_urls"] = urls
        ratio = _size_to_aspect_ratio(body.get("size"))
        if ratio:
            converted["aspect_ratio"] = _normalize_fluxart_ratio(ratio)
        # Keep explicit size only for models known to accept `size`; flux-art
        # rejects unknown fields, so we prefer aspect_ratio which is universal.
        return {k: v for k, v in converted.items() if v is not None and v != ""}

    converted = {
        "model": body.get("model"),
        "video_mode": _VIDEO_MODE_MAP.get(body.get("video_mode"), body.get("video_mode") or "t2v"),
        "prompt": body.get("prompt"),
    }
    model_name = str(body.get("model") or "").lower()
    duration = body.get("duration")
    duration_val = None
    if duration is not None and duration != "":
        try:
            duration_val = int(duration)
        except (TypeError, ValueError):
            duration_val = None
    if "grok" in model_name or "kling" in model_name:
        # flux-art 的 Grok/Kling 视频计费以 5 秒为基础档位；固定 5 秒避免非法时长值导致 400
        converted["duration"] = 5
    elif duration_val is not None:
        converted["duration"] = duration_val
    if body.get("resolution"):
        converted["resolution"] = str(body["resolution"])
    refs = body.get("image") or body.get("images")
    if refs:
        urls = await _fluxart_public_urls(refs)
        if urls:
            converted["image_urls"] = urls
    ratio = body.get("ratio") or body.get("aspect_ratio")
    if ratio:
        ratio = _normalize_fluxart_ratio(ratio)
        # flux-art docs: `ratio` for Seedance/HappyHorse, `aspect_ratio` for Grok Video/Kling Video/HappyHorse
        if "grok" in model_name or "kling" in model_name:
            converted["aspect_ratio"] = ratio
        else:
            converted["ratio"] = ratio
    return {k: v for k, v in converted.items() if v is not None and v != ""}


async def _fluxart_post_task(
    source: ApiSource,
    url: str,
    headers: Dict[str, str],
    body: Dict[str, Any],
) -> Dict[str, Any]:
    """POST a task-creation request; return the parsed JSON payload."""
    timeout = httpx.Timeout(source.timeout_ms / 1000.0, connect=10.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        response = await client.post(url, headers=headers, json=body)
        if response.status_code >= 400:
            err_text = response.text[:1000]
            print(f"[flux-art] POST {url} -> {response.status_code}\n  request_body={json.dumps(body, ensure_ascii=False)}\n  response_body={err_text}", flush=True)
            raise RuntimeError(f"{response.status_code} {response.reason_phrase} | body={err_text}")
        print(f"[flux-art] POST {url} -> {response.status_code} body={json.dumps(body, ensure_ascii=False)}", flush=True)
        return response.json()


async def _poll_fluxart_task(
    source: ApiSource,
    headers: Dict[str, str],
    task_id: str,
    timeout_seconds: float = 300.0,
) -> Dict[str, Any]:
    """Poll GET /tasks/{task_id} until terminal state; return the inner data dict."""
    url = _build_upstream_url(source, f"/tasks/{task_id}")
    deadline = time.time() + timeout_seconds
    poll_timeout = httpx.Timeout(30.0, connect=10.0)
    last_error = "任务处理超时"
    while time.time() < deadline:
        async with httpx.AsyncClient(timeout=poll_timeout, follow_redirects=False) as client:
            response = await client.get(url, headers=headers)
            if response.status_code >= 400:
                last_error = f"{response.status_code} {response.reason_phrase} | body={response.text[:300]}"
            else:
                payload = response.json()
                data = payload.get("data") if isinstance(payload, dict) else None
                if isinstance(data, dict):
                    status = data.get("status")
                    if status == "succeeded":
                        return data
                    if status in ("failed", "canceled", "cancelled"):
                        err = data.get("error") or {}
                        if isinstance(err, dict):
                            err = err.get("message") or err
                        raise RuntimeError(f"flux-art 任务失败：{err}")
                    if status in ("queued", "processing", "running", "pending"):
                        last_error = "任务处理超时"
        await asyncio.sleep(4)
    raise RuntimeError(f"flux-art 任务超时（task_id={task_id}）")


async def _call_fluxart(
    source: ApiSource,
    headers: Dict[str, str],
    body: Dict[str, Any],
    endpoint: str,
) -> Any:
    """Route a gateway request to flux-art OpenAPI and adapt the response."""
    endpoint = endpoint or source.endpoint_path or ""

    # Task status query: frontend polls GET /videos/{taskId} -> flux-art GET /tasks/{task_id}
    m = _VIDEO_TASK_QUERY_RE.match(endpoint)
    if m:
        task_id = m.group(1)
        data = await _poll_fluxart_task(source, headers, task_id, timeout_seconds=300.0)
        outputs = data.get("output") or []
        if data.get("status") == "succeeded":
            if outputs:
                return {"id": task_id, "status": "succeeded", "video_url": outputs[0], "result_url": outputs[0], "url": outputs[0]}
            return {"id": task_id, "status": "failed", "error": {"message": "任务成功但没有返回视频地址"}}
        if data.get("status") in ("failed", "canceled", "cancelled"):
            err = data.get("error") or {}
            if isinstance(err, dict):
                err = err.get("message") or err
            return {"id": task_id, "status": "failed", "error": {"message": str(err) or "视频生成失败"}}
        return {"id": task_id, "status": "queued"}

    is_image = bool(_IMAGE_ENDPOINT_RE.search(endpoint))
    is_video = bool(_VIDEO_ENDPOINT_RE.search(endpoint))
    if not (is_image or is_video):
        # Not a generation endpoint: forward as-is.
        url = _build_upstream_url(source, endpoint)
        return await _fluxart_post_task(source, url, headers, body)

    # flux-art only accepts its own model IDs (e.g. "mj_imagine"), while the
    # frontend sends the admin variable_name (e.g. "Midjourney V7 Imagine").
    # The admin stores the real upstream model id in source.model_version.
    upstream_model = (source.model_version or "").strip()
    if upstream_model:
        body = {**body, "model": upstream_model}

    converted = await _convert_fluxart_request(body, is_video)
    url = _build_upstream_url(source, endpoint)

    has_ref_input = bool(body.get("image") or body.get("images"))
    if has_ref_input and not converted.get("image_urls"):
        raise RuntimeError("flux-art 渠道的参考图必须为公网 HTTPS 图片 URL（data URL 不被接受），请使用公网图片外链或资产库中已上传到公网存储的图片")

    payload = await _fluxart_post_task(source, url, headers, converted)
    data = payload.get("data") if isinstance(payload, dict) else None
    task_id = data.get("id") if isinstance(data, dict) else None
    if not task_id:
        raise RuntimeError(f"flux-art 未返回任务 ID：{json.dumps(payload)[:300]}")

    if is_image:
        # Frontend image flow is synchronous: poll here until done.
        result = await _poll_fluxart_task(source, headers, task_id, timeout_seconds=300.0)
        outputs = result.get("output") or []
        if not outputs:
            raise RuntimeError("flux-art 图片任务成功但没有返回图片地址")
        return {"data": [{"url": u} for u in outputs], "task_id": task_id, "status": "succeeded"}

    # Video: return task id; the frontend polls /videos/{taskId} which maps above.
    return {"id": task_id, "status": "queued"}


def _validate_endpoint(endpoint: str):
    """Only allow plain relative API paths; reject scheme, host, query, fragments."""
    if not endpoint:
        return
    if not endpoint.startswith("/"):
        raise HTTPException(status_code=400, detail="Endpoint must be a relative path starting with /")
    if not _ENDPOINT_PATH_RE.match(endpoint):
        raise HTTPException(status_code=400, detail="Endpoint contains invalid characters")
    if "//" in endpoint or ".." in endpoint:
        raise HTTPException(status_code=400, detail="Endpoint contains invalid sequence")


def _build_upstream_url(source: ApiSource, endpoint_override: Optional[str] = None) -> str:
    endpoint = endpoint_override if endpoint_override is not None else source.endpoint_path
    _validate_endpoint(endpoint)
    return source.base_url.rstrip("/") + (endpoint if endpoint.startswith("/") else "/" + endpoint)


def _prepare_headers_and_body(source: ApiSource, request_body: Dict[str, Any], stream: bool = False):
    api_key = decrypt_api_key(source.api_key_encrypted)
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    if source.extra_headers:
        headers.update(source.extra_headers)

    # upstream video API requires Idempotency-Key header
    headers["Idempotency-Key"] = str(uuid.uuid4())

    body = dict(source.extra_body or {})
    body.update(request_body)
    if stream:
        body["stream"] = True
    return headers, body


async def _normalize_reference_urls(body: Dict[str, Any]) -> Dict[str, Any]:
    """For any body field that may carry reference images, replace data URLs /
    private URLs with public COS URLs. Applies to all upstream sources."""
    out = dict(body)
    # Common field names for reference images across different APIs
    image_fields = ("image", "images", "image_urls", "reference_urls",
                    "reference_images", "input_image", "input_images",
                    "input_reference", "input_references")
    for field in image_fields:
        if field not in out:
            continue
        val = out[field]
        if isinstance(val, str):
            urls = await _fluxart_public_urls(val)
            out[field] = urls[0] if urls else val
        elif isinstance(val, list):
            urls = await _fluxart_public_urls(val)
            if urls:
                out[field] = urls
    return out


async def call_upstream(
    source: ApiSource,
    request_body: Dict[str, Any],
    stream: bool = False,
    endpoint_override: Optional[str] = None,
) -> Any:
    url = _build_upstream_url(source, endpoint_override)
    headers, body = _prepare_headers_and_body(source, request_body, stream)

    # Normalize reference image fields for all sources: convert data URLs and
    # private URLs into public COS URLs so upstream APIs (API易, flux-art, etc.)
    # can download them.
    body = await _normalize_reference_urls(body)

    if _is_fluxart_source(source):
        return await _call_fluxart(source, headers, body, endpoint_override or source.endpoint_path or "")

    timeout = httpx.Timeout(source.timeout_ms / 1000.0, connect=10.0)
    last_error = None

    # follow_redirects=False prevents SSRF / credential leakage via 302
    for attempt in range(max(1, source.retry_count + 1)):
        try:
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
                if stream:
                    return {"stream": True, "url": url, "headers": headers, "body": body}
                response = await client.post(url, headers=headers, json=body)
                response.raise_for_status()
                content_type = response.headers.get("content-type", "")
                if "application/json" in content_type:
                    return response.json()
                # Binary responses (audio, video bytes) are returned as bytes.
                return response.content
        except httpx.HTTPStatusError as e:
            # Try to read response body (may be empty / non-JSON)
            try:
                err_body = e.response.text
            except Exception:
                err_body = ""
            enriched = RuntimeError(
                f"{e.response.status_code} {e.response.reason_phrase} | "
                f"body={err_body[:500]}"
            )
            enriched.status_code = e.response.status_code
            enriched.response_body = err_body
            last_error = enriched
            if e.response.status_code < 500:
                break
        except httpx.TimeoutException as e:
            last_error = RuntimeError(f"上游接口响应超时（已等待 {source.timeout_ms / 1000.0:.0f} 秒），请稍后重试或更换模型源")
        except json.JSONDecodeError as e:
            last_error = RuntimeError(f"Upstream returned non-JSON: {e.msg}")
        except Exception as e:
            last_error = RuntimeError(f"{type(e).__name__}: {e}")

    raise last_error or RuntimeError("Upstream call failed")


async def stream_upstream(
    source: ApiSource,
    request_body: Dict[str, Any],
    endpoint_override: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    url = _build_upstream_url(source, endpoint_override)
    headers, body = _prepare_headers_and_body(source, request_body, stream=True)

    timeout = httpx.Timeout(source.timeout_ms / 1000.0, connect=10.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        async with client.stream("POST", url, headers=headers, json=body) as response:
            response.raise_for_status()
            async for chunk in response.aiter_text():
                yield chunk


def log_call(
    db: Session,
    request_id: str,
    user: User,
    variable_name: str,
    source: Optional[ApiSource],
    modal_category: str,
    status: str,
    status_code: Optional[int],
    latency_ms: float,
    error_message: Optional[str],
    cost_credits: int,
    request_body: Dict[str, Any],
    response_summary: Dict[str, Any],
):
    # Sanitize: never store full prompts or sensitive keys
    sanitized_body = {"model": request_body.get("model"), "prompt_len": len(str(request_body.get("prompt", "")))}
    log = CallLog(
        request_id=request_id,
        user_id=user.id,
        variable_name=variable_name,
        source_id=source.id if source else None,
        modal_category=modal_category,
        status=status,
        status_code=status_code,
        latency_ms=latency_ms,
        error_message=error_message,
        cost_credits=cost_credits,
        request_body=sanitized_body,
        response_summary=response_summary,
    )
    db.add(log)
    db.commit()
