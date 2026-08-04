"""
MiniMax H3 video generation adapter (Gradio API 6.15 Blocks).

Flow:
  1. POST /gradio_api/queue/join (fn_index=7) → submit job, get task_id in status
  2. Poll /gradio_api/queue/join (fn_index=12) → check timer/gallery status
  3. Extract video file path from gallery output
  4. Download video via /gradio_api/file={path}
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from typing import Any, Dict, List, Optional

import httpx

H3_GENERATION_TIMEOUT = 600
H3_POLL_INTERVAL = 5


def _build_h3_data(
    mode: str,
    prompt: str,
    first_frame_url: Optional[str] = None,
    last_frame_url: Optional[str] = None,
    ref_image_urls: Optional[List[str]] = None,
    width: int = 768,
    height: int = 768,
    duration: int = 5,
    steps: int = 20,
    seed: int = -1,
) -> List[Any]:
    ref_images = [None] * 9
    if ref_image_urls:
        for i, url in enumerate(ref_image_urls[:9]):
            ref_images[i] = {"path": None, "url": url} if url else None

    return [
        mode,                 # 7
        prompt,               # 13
        {"path": None, "url": first_frame_url} if first_frame_url else None,  # 17
        {"path": None, "url": last_frame_url} if last_frame_url else None,    # 18
        "match",              # 44
        width,                # 48
        height,               # 50
        float(duration),      # 54
        steps,                # 55
        seed,                 # 58
        *ref_images,          # 23-33: 9 ref images
        None, None, None,     # 36-38: ref videos
        None, None, None,     # 41-43: ref audios
    ]


async def _h3_call(
    client: httpx.AsyncClient,
    base_url: str,
    data: List[Any],
    fn_index: int,
    trigger_id: int,
) -> Dict[str, Any]:
    session_hash = uuid.uuid4().hex[:16]
    body = {
        "data": data,
        "event_data": None,
        "fn_index": fn_index,
        "trigger_id": trigger_id,
        "session_hash": session_hash,
    }
    resp = await client.post(f"{base_url}/gradio_api/queue/join", json=body, timeout=30.0)
    resp.raise_for_status()
    result = resp.json()

    # Read SSE stream for the full response
    await asyncio.sleep(1.0)
    sse_resp = await client.get(
        f"{base_url}/gradio_api/queue/data",
        params={"session_hash": session_hash},
        timeout=15.0,
    )
    lines = []
    async for line in sse_resp.aiter_lines():
        if line and line.startswith("data:"):
            lines.append(line)

    for line in reversed(lines):
        try:
            event = json.loads(line[5:].strip())
        except json.JSONDecodeError:
            continue
        if event.get("msg") == "process_completed":
            return event

    return {"output": {}}


async def _h3_extract_result(
    client: httpx.AsyncClient,
    base_url: str,
    event: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    """Extract video from gallery output. Returns {"path": str} or None."""
    output = event.get("output", {})
    out_data = output.get("data", [])

    # Check gallery (component 75 = index 0 in data)
    gallery = out_data[0] if out_data and isinstance(out_data[0], list) else []

    if gallery:
        for item in gallery:
            if isinstance(item, dict):
                v = item.get("video", {})
                if v.get("path"):
                    return {"path": v["path"]}
                # Also check for direct file data
                for key in ("video", "file"):
                    if key in v:
                        inner = v[key]
                        if isinstance(inner, dict) and inner.get("path"):
                            return {"path": inner["path"]}
                        elif isinstance(inner, str):
                            return {"path": inner}
    return None


async def generate_video(
    base_url: str,
    prompt: str,
    mode: str = "文生视频",
    first_frame_url: Optional[str] = None,
    last_frame_url: Optional[str] = None,
    ref_image_urls: Optional[List[str]] = None,
    width: int = 768,
    height: int = 768,
    duration: int = 5,
    steps: int = 20,
    seed: int = -1,
) -> Dict[str, Any]:
    data = _build_h3_data(
        mode=mode, prompt=prompt,
        first_frame_url=first_frame_url, last_frame_url=last_frame_url,
        ref_image_urls=ref_image_urls,
        width=width, height=height, duration=duration, steps=steps, seed=seed,
    )

    async with httpx.AsyncClient(timeout=httpx.Timeout(H3_GENERATION_TIMEOUT + 60, connect=15.0)) as client:
        # 1. Submit generation job
        submit_event = await _h3_call(client, base_url, data, fn_index=7, trigger_id=67)
        status_msg = str(submit_event.get("output", {}).get("data", [""])[0])
        task_id = status_msg.split("任务 ID: ")[1].split(" ")[0] if "任务 ID: " in status_msg else None

        # 2. Poll timer/gallery for the actual video output
        deadline = time.monotonic() + H3_GENERATION_TIMEOUT
        while time.monotonic() < deadline:
            await asyncio.sleep(H3_POLL_INTERVAL)

            poll_event = await _h3_call(client, base_url, [], fn_index=12, trigger_id=77)
            result = await _h3_extract_result(client, base_url, poll_event)

            if result and result.get("path"):
                # 3. Download video
                file_path = result["path"]
                try:
                    dl_resp = await client.get(
                        f"{base_url}/gradio_api/file={file_path}",
                        timeout=180.0,
                    )
                    dl_resp.raise_for_status()
                    return {
                        "task_id": task_id,
                        "status": "succeeded",
                        "video_bytes": dl_resp.content,
                        "video_path": file_path,
                    }
                except Exception as e:
                    return {
                        "task_id": task_id,
                        "status": "failed",
                        "error": f"Download failed: {e}",
                        "video_path": file_path,
                    }

            # Check status text for completion/failure
            out_data = poll_event.get("output", {}).get("data", [])
            status_line = ""
            for d in out_data[1:]:
                if isinstance(d, str):
                    status_line += d

            if "失败" in status_line:
                return {
                    "task_id": task_id,
                    "status": "failed",
                    "error": status_line[:500],
                }

        raise TimeoutError(f"Video generation timed out after {H3_GENERATION_TIMEOUT}s")
