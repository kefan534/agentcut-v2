"""
MiniMax H3 video generation adapter (Gradio API).

The MiniMax H3 open-source deployment on Compshare exposes a Gradio 6.15
Blocks UI at port 7860. This module wraps the Gradio queue/join API as a
synchronous video-generation pipeline suitable for AgentCut's gateway.

Flow:
  1. POST /gradio_api/queue/join → submit job, get event_id
  2. Poll /gradio_api/queue/data?session_hash=... → wait for process_completed
  3. Extract video file path from gallery output
  4. Download video bytes via /gradio_api/file={path}
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from typing import Any, Dict, List, Optional

import httpx

from app.core.config import settings


# Maximum time to wait for video generation (seconds)
H3_GENERATION_TIMEOUT = 600  # 10 minutes
H3_POLL_INTERVAL = 5  # seconds between polls


async def _h3_submit(
    client: httpx.AsyncClient,
    base_url: str,
    data: List[Any],
    fn_index: int = 7,
    trigger_id: int = 67,
) -> Dict[str, Any]:
    """Submit a video generation job via Gradio queue/join."""
    session_hash = uuid.uuid4().hex[:16]
    body = {
        "data": data,
        "event_data": None,
        "fn_index": fn_index,
        "trigger_id": trigger_id,
        "session_hash": session_hash,
    }
    resp = await client.post(
        f"{base_url}/gradio_api/queue/join",
        json=body,
        timeout=30.0,
    )
    resp.raise_for_status()
    result = resp.json()
    result["session_hash"] = session_hash
    return result


async def _h3_poll(
    client: httpx.AsyncClient,
    base_url: str,
    session_hash: str,
    timeout: float = H3_GENERATION_TIMEOUT,
) -> Dict[str, Any]:
    """Poll for generation completion. Returns the process_completed event."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        resp = await client.get(
            f"{base_url}/gradio_api/queue/data",
            params={"session_hash": session_hash},
            timeout=30.0,
        )
        lines = []
        async for line in resp.aiter_lines():
            if line and line.startswith("data:"):
                lines.append(line)

        for line in reversed(lines):
            try:
                event = json.loads(line[5:].strip())
            except json.JSONDecodeError:
                continue
            if event.get("msg") == "process_completed":
                return event
            if event.get("msg") == "process_generating":
                pass  # still running

        await asyncio.sleep(H3_POLL_INTERVAL)

    raise TimeoutError(f"Video generation timed out after {timeout}s")


async def _h3_refresh_gallery(
    client: httpx.AsyncClient,
    base_url: str,
    max_retries: int = 12,
) -> List[Dict[str, Any]]:
    """Trigger the refresh/timer to get updated gallery state.
    Returns gallery items."""
    session_hash = uuid.uuid4().hex[:16]
    for _ in range(max_retries):
        resp = await client.post(
            f"{base_url}/gradio_api/queue/join",
            json={
                "data": [],
                "event_data": None,
                "fn_index": 10,  # refresh button
                "trigger_id": 72,
                "session_hash": session_hash,
            },
            timeout=30.0,
        )
        resp.raise_for_status()

        # Poll for the result
        poll_resp = await client.get(
            f"{base_url}/gradio_api/queue/data",
            params={"session_hash": session_hash},
            timeout=30.0,
        )
        lines = []
        async for line in poll_resp.aiter_lines():
            if line and line.startswith("data:"):
                lines.append(line)

        for line in reversed(lines):
            try:
                event = json.loads(line[5:].strip())
            except json.JSONDecodeError:
                continue
            if event.get("msg") == "process_completed":
                output = event.get("output", {})
                # Component 75 = gallery, output.data[0] = gallery items
                out_data = output.get("data", [])
                if out_data and isinstance(out_data[0], list):
                    return out_data[0]
                return []

        await asyncio.sleep(5)

    return []


async def _h3_download_video(
    client: httpx.AsyncClient,
    base_url: str,
    file_path: str,
) -> bytes:
    """Download a video file via Gradio file proxy."""
    resp = await client.get(
        f"{base_url}/gradio_api/file={file_path}",
        timeout=300.0,
    )
    resp.raise_for_status()
    return resp.content


def _build_h3_data(
    mode: str,
    prompt: str,
    first_frame_url: Optional[str] = None,
    last_frame_url: Optional[str] = None,
    ref_image_urls: Optional[List[str]] = None,
    ref_video_urls: Optional[List[str]] = None,
    ref_audio_urls: Optional[List[str]] = None,
    width: int = 768,
    height: int = 768,
    duration: int = 5,
    steps: int = 20,
    seed: int = -1,
) -> List[Any]:
    """Build the data array for Gradio queue/join call."""
    ref_images = [None] * 9
    if ref_image_urls:
        for i, url in enumerate(ref_image_urls[:9]):
            ref_images[i] = {"path": None, "url": url}

    ref_videos = [None] * 3
    if ref_video_urls:
        for i, url in enumerate(ref_video_urls[:3]):
            ref_videos[i] = {"path": None, "url": url}

    ref_audios = [None] * 3
    if ref_audio_urls:
        for i, url in enumerate(ref_audio_urls[:3]):
            ref_audios[i] = {"path": None, "url": url}

    return [
        mode,                 # 7: generation mode
        prompt,               # 13: prompt
        {"path": None, "url": first_frame_url} if first_frame_url else None,  # 17
        {"path": None, "url": last_frame_url} if last_frame_url else None,    # 18
        "match",              # 44: ref image size
        width,                # 48: width
        height,               # 50: height
        float(duration),      # 54: duration
        steps,                # 55: sampling steps
        seed,                 # 58: seed
        *ref_images,          # 23-33: 9 ref images
        *ref_videos,          # 36-38: 3 ref videos
        *ref_audios,          # 41-43: 3 ref audios
    ]


async def generate_video(
    base_url: str,
    prompt: str,
    mode: str = "文生视频",
    first_frame_url: Optional[str] = None,
    last_frame_url: Optional[str] = None,
    ref_image_urls: Optional[List[str]] = None,
    ref_video_urls: Optional[List[str]] = None,
    ref_audio_urls: Optional[List[str]] = None,
    width: int = 768,
    height: int = 768,
    duration: int = 5,
    steps: int = 20,
    seed: int = -1,
) -> Dict[str, Any]:
    """Generate a video using MiniMax H3. Returns {"video_url": str, "video_bytes": bytes}."""
    data = _build_h3_data(
        mode=mode,
        prompt=prompt,
        first_frame_url=first_frame_url,
        last_frame_url=last_frame_url,
        ref_image_urls=ref_image_urls,
        ref_video_urls=ref_video_urls,
        ref_audio_urls=ref_audio_urls,
        width=width,
        height=height,
        duration=duration,
        steps=steps,
        seed=seed,
    )

    async with httpx.AsyncClient(timeout=httpx.Timeout(600.0, connect=15.0)) as client:
        # 1. Submit job
        result = await _h3_submit(client, base_url, data)
        session_hash = result["session_hash"]

        # 2. Poll for completion
        event = await _h3_poll(client, base_url, session_hash)

        output = event.get("output", {})
        out_data = output.get("data", [])

        # Extract task info from status message
        status_msg = out_data[0] if out_data else ""
        task_id = None
        if "任务 ID:" in str(status_msg):
            task_id = str(status_msg).split("任务 ID: ")[1].split(" ")[0] if "任务 ID: " in str(status_msg) else None

        # 3. Try to get video from gallery via refresh
        await asyncio.sleep(5)  # Brief wait for file to be written
        gallery = await _h3_refresh_gallery(client, base_url)

        video_path = None
        if gallery:
            item = gallery[0]
            if isinstance(item, dict):
                video_path = (
                    item.get("video", {}).get("video", {}).get("path")
                    or item.get("video", {}).get("path")
                    or item.get("path")
                )
            elif isinstance(item, str):
                video_path = item

        if not video_path and task_id:
            # Fallback: try predictable output path
            video_path = f"output/{task_id}.mp4"

        video_bytes = None
        if video_path:
            try:
                video_bytes = await _h3_download_video(client, base_url, video_path)
            except Exception:
                pass

        return {
            "task_id": task_id,
            "status": "succeeded",
            "video_path": video_path,
            "video_bytes": video_bytes,
            "status_msg": status_msg,
        }
