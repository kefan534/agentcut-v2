"""
ComfyUI adapter for AgentCut gateway.

ComfyUI REST API:
  POST /prompt          → submit workflow JSON, returns prompt_id
  GET  /history/{id}    → get result (images/videos)
  GET  /view?filename=  → download output file

Workflow templates: stored in extra_body as key-value pairs where
the value is a standard ComfyUI API format workflow JSON.

Key convention: prompt text is injected as node "6" (CLIPTextEncode).
Reference images go to node "10" (LoadImage or similar).
"""

from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any, Dict, List, Optional

import httpx


async def comfyui_submit(
    client: httpx.AsyncClient,
    base_url: str,
    workflow: Dict[str, Any],
) -> str:
    """Submit a workflow, return prompt_id."""
    url = f"{base_url}/prompt"
    resp = await client.post(url, json={"prompt": workflow}, timeout=30.0)
    data = resp.json()
    if "prompt_id" not in data:
        error_msg = data.get("error", {}).get("message", str(data))
        raise RuntimeError(f"ComfyUI submission failed: {error_msg}")
    return data["prompt_id"]


async def comfyui_poll(
    client: httpx.AsyncClient,
    base_url: str,
    prompt_id: str,
    timeout: float = 600.0,
    poll_interval: float = 3.0,
) -> Dict[str, Any]:
    """Poll until prompt completes. Returns history entry."""
    import time
    deadline = time.monotonic() + timeout

    while time.monotonic() < deadline:
        resp = await client.get(f"{base_url}/history/{prompt_id}", timeout=15.0)
        history = resp.json()

        if prompt_id not in history:
            await asyncio.sleep(poll_interval)
            continue

        entry = history[prompt_id]
        status = entry.get("status", {})
        if status.get("completed", False):
            return entry
        if status.get("status_str") == "error":
            raise RuntimeError(f"ComfyUI generation failed: {entry}")

        await asyncio.sleep(poll_interval)

    raise TimeoutError(f"ComfyUI generation timed out after {timeout}s")


def comfyui_extract_outputs(history_entry: Dict[str, Any]) -> List[Dict[str, str]]:
    """Extract output file info from history entry.
    Returns list of {"filename": str, "subfolder": str, "type": str}.
    """
    outputs = history_entry.get("outputs", {})
    files = []
    for node_id, node_outputs in outputs.items():
        for item in node_outputs.get("images", []):
            files.append({
                "filename": item["filename"],
                "subfolder": item.get("subfolder", ""),
                "type": item.get("type", "output"),
                "node_id": node_id,
            })
        for item in node_outputs.get("gifs", []):
            files.append({
                "filename": item["filename"],
                "subfolder": item.get("subfolder", ""),
                "type": item.get("type", "output"),
                "node_id": node_id,
            })
    return files


async def comfyui_download(
    client: httpx.AsyncClient,
    base_url: str,
    filename: str,
    subfolder: str = "",
    output_type: str = "output",
) -> bytes:
    """Download an output file."""
    params = {"filename": filename, "type": output_type}
    if subfolder:
        params["subfolder"] = subfolder
    resp = await client.get(f"{base_url}/view", params=params, timeout=300.0)
    resp.raise_for_status()
    return resp.content


async def comfyui_upload_image(
    client: httpx.AsyncClient,
    base_url: str,
    image_url: str,
) -> Optional[str]:
    """Download image from URL and upload to ComfyUI's input directory.
    Returns the filename to use in LoadImage, or None on failure."""
    try:
        # 1. Download image
        resp = await client.get(image_url, timeout=60.0)
        resp.raise_for_status()
        img_bytes = resp.content

        # Determine filename from URL
        fname = image_url.split("/")[-1].split("?")[0] or f"ref_{uuid.uuid4().hex[:8]}.png"
        if "." not in fname:
            fname += ".png"

        # 2. Upload to ComfyUI
        files = {"image": (fname, img_bytes, "application/octet-stream")}
        up_resp = await client.post(f"{base_url}/upload/image", files=files, timeout=60.0)
        up_resp.raise_for_status()
        return up_resp.json()["name"]
    except Exception as e:
        print(f"comfyui_upload_image error for {image_url}: {e}")
        return None


async def comfyui_generate(
    base_url: str,
    workflow: Dict[str, Any],
    inject_prompt: str = "",
    inject_positive_node: str = "6",
    inject_negative_node: str = "7",
    inject_seed_node: Optional[str] = None,
    inject_image_node: Optional[str] = None,
    inject_image_url: Optional[str] = None,
    timeout: float = 600.0,
) -> Dict[str, Any]:
    """Run a ComfyUI workflow with optional prompt/image injection.

    Args:
        base_url: ComfyUI server URL
        workflow: The workflow JSON (ComfyUI API format)
        inject_prompt: Text prompt to inject into text encode node
        inject_positive_node: Node ID for positive prompt (default "6")
        inject_negative_node: Node ID for negative prompt (default "7")
        inject_seed_node: Node ID to randomize seed (KSampler node)
        inject_image_node: Node ID for LoadImage (reference/input image)
        inject_image_url: URL of image to load as reference

    Returns:
        {
            "outputs": [{"filename": ..., "url": ...}],
            "files": [bytes, ...]  # raw file bytes
        }
    """
    # Clone workflow to avoid mutating template
    wf = json.loads(json.dumps(workflow))

    # Inject prompt text
    if inject_prompt and inject_positive_node in wf:
        node = wf[inject_positive_node]
        inputs = node.get("inputs", {})
        # Handle both CLIPTextEncode (inputs.text) and PrimitiveStringMultiline (inputs.value)
        if "text" in inputs:
            node["inputs"]["text"] = inject_prompt
        elif "value" in inputs:
            node["inputs"]["value"] = inject_prompt
    if inject_prompt and inject_negative_node in wf:
        # Keep negative prompt minimal unless explicitly set
        pass

    # Randomize seed
    import random
    if inject_seed_node and inject_seed_node in wf:
        if "seed" in wf[inject_seed_node]["inputs"]:
            wf[inject_seed_node]["inputs"]["seed"] = random.randint(0, 2**32 - 1)

    # Inject reference image URL
    if inject_image_url and inject_image_node and inject_image_node in wf:
        wf[inject_image_node]["inputs"]["image"] = inject_image_url

    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout + 60, connect=15.0)) as client:
        # Submit workflow
        prompt_id = await comfyui_submit(client, base_url, wf)

        # Poll for completion
        history = await comfyui_poll(client, base_url, prompt_id, timeout=timeout)

        # Extract outputs
        output_files = comfyui_extract_outputs(history)

        # Download all output files
        results = []
        raw_files = []
        for f in output_files:
            file_bytes = await comfyui_download(
                client, base_url, f["filename"], f["subfolder"], f["type"]
            )
            url = f"{base_url}/view?filename={f['filename']}&subfolder={f['subfolder']}&type={f['type']}"
            results.append({"filename": f["filename"], "url": url})
            raw_files.append(file_bytes)

        return {
            "prompt_id": prompt_id,
            "outputs": results,
            "files": raw_files,
        }


# Pre-built workflow templates for common tasks
# These are minimal workflows that the user can customize in ComfyUI

TEXT_TO_IMAGE_WORKFLOW = {
    "3": {
        "class_type": "KSampler",
        "inputs": {
            "seed": 0,
            "steps": 20,
            "cfg": 7.0,
            "sampler_name": "euler",
            "scheduler": "normal",
            "denoise": 1.0,
            "model": ["4", 0],
            "positive": ["6", 0],
            "negative": ["7", 0],
            "latent_image": ["5", 0],
        },
    },
    "4": {
        "class_type": "CheckpointLoaderSimple",
        "inputs": {"ckpt_name": "sd_xl_base_1.0.safetensors"},
    },
    "5": {
        "class_type": "EmptyLatentImage",
        "inputs": {"width": 1024, "height": 1024, "batch_size": 1},
    },
    "6": {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": "a beautiful landscape", "clip": ["4", 1]},
    },
    "7": {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": "ugly, blurry, low quality", "clip": ["4", 1]},
    },
    "8": {
        "class_type": "VAEDecode",
        "inputs": {"samples": ["3", 0], "vae": ["4", 2]},
    },
    "9": {
        "class_type": "SaveImage",
        "inputs": {"filename_prefix": "AgentCut", "images": ["8", 0]},
    },
}
