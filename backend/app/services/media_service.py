"""Server-side media processing (ffmpeg) for short-drama video composition (P1).

Implements §6.7 / R6: video composition happens server-side — download source
clips to a temp dir, run ffmpeg concat, upload the result, then clean up.
"""
import asyncio
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import List

import httpx

from app.core.config import settings


async def _download_video(url: str, dest: Path, timeout: int = 600) -> Path:
    """Download a video URL to a local file.

    Supports:
    - http/https (COS presigned / public URLs)
    - ``/api/v1/upload/...`` local upload paths (reads from ``UPLOAD_DIR``)
    """
    if url.startswith("/api/v1/upload/"):
        rel = url[len("/api/v1/upload/"):]
        src = Path(settings.UPLOAD_DIR) / rel
        if src.exists():
            shutil.copyfile(src, dest)
            return dest
        raise FileNotFoundError(f"本地视频文件不存在：{src}")

    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        async with client.stream("GET", url) as resp:
            resp.raise_for_status()
            with open(dest, "wb") as f:
                async for chunk in resp.aiter_bytes():
                    f.write(chunk)
    return dest


def _ffmpeg_concat(input_paths: List[Path], output_path: Path) -> Path:
    """ffmpeg concat demuxer (stream copy, fast). Requires matching codecs."""
    list_file = output_path.parent / "concat_list.txt"
    with open(list_file, "w", encoding="utf-8") as f:
        for p in input_paths:
            f.write(f"file '{p.as_posix()}'\n")

    cmd = [
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", str(list_file), "-c", "copy", str(output_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg 合成失败：{result.stderr[:500]}")
    return output_path


async def compose_videos(video_urls: List[str]) -> bytes:
    """Download clips in order and concat them into one video; return the bytes."""
    if not video_urls:
        raise ValueError("没有可合成的视频片段")
    if len(video_urls) == 1:
        # 单片段无需合成，直接下载返回
        tmpdir = Path(tempfile.mkdtemp(prefix="agentcut_compose_"))
        try:
            dest = tmpdir / "single.mp4"
            await _download_video(video_urls[0], dest)
            return dest.read_bytes()
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)

    tmpdir = Path(tempfile.mkdtemp(prefix="agentcut_compose_"))
    try:
        input_paths = []
        for i, url in enumerate(video_urls):
            dest = tmpdir / f"clip_{i}.mp4"
            await _download_video(url, dest)
            input_paths.append(dest)

        output = tmpdir / "composed.mp4"
        await asyncio.to_thread(_ffmpeg_concat, input_paths, output)
        return output.read_bytes()
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
