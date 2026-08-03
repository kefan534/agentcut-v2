"""
AgentCut Agent handler — EdgeOne Makers
=======================================

Route mapping: agents/agentcut/index.py → POST /agentcut
Stop route:    agents/agentcut/stop.py  → POST /agentcut/stop

This is the "Agent brain" for AgentCut v2. It runs on EdgeOne Makers and
replaces the local Codex canvas-agent. The actual website/canvas state lives
in the user's browser, so all canvas/site tools are executed as remote tools:

1. User sends a message from the Agent panel.
2. AgentCut backend forwards it to this handler with a Makers-Conversation-Id.
3. The handler streams token/tool events back to the backend.
4. When the model wants to call a canvas/site tool, the tool function calls
   the backend bridge endpoint and waits for the browser to execute it.

Environment variables expected in Makers project settings:
    AI_GATEWAY_API_KEY      Makers Models API key
    AI_GATEWAY_BASE_URL     https://ai-gateway.edgeone.link/v1
    AI_GATEWAY_MODEL        e.g. @makers/deepseek-v4-flash
    AGENT_BACKEND_URL       Public URL of the AgentCut backend
    AGENT_TOOL_SECRET       Shared secret for backend bridge calls
"""

from __future__ import annotations

import asyncio
import contextvars
import json
import os
import uuid
from typing import Any, AsyncGenerator, Dict, List, Optional

import httpx
from dotenv import load_dotenv
from openai import AsyncOpenAI
from openai.types.responses import ResponseTextDeltaEvent
from agents import Agent, OpenAIChatCompletionsModel, Runner, function_tool

load_dotenv()

AGENT_NAME = "AgentCut"
AGENT_PROMPT = (
    "你正在帮助用户操作 AgentCut 网站。"
    "切换网站页面用 site_navigate，可跳 / (首页)、/canvas (我的画布)、/canvas/:id (指定画布)、/image、/video、/prompts、/assets、/config。"
    "需要改动画布时优先读取当前画布（canvas_get_state），再根据任务使用 canvas_create_text_node、canvas_generate_text、canvas_generate_image、"
    "canvas_generate_video、canvas_generate_audio、canvas_create_generation_flow、canvas_create_config_node、canvas_run_generation、"
    "canvas_update_node、canvas_connect_nodes 等通用工具；复杂批量改动再用 canvas_apply_ops，删除连线可用 delete_connections。"
    "本轮若有用户上传的图片附件，会同时给出 attachmentId；用户要求把附件放入画布或作为生成参考图时，必须先用 canvas_create_attachment_nodes "
    "创建真实图片节点，再把返回的节点 ID 传给 canvas_create_generation_flow.referenceNodeIds，不要创建空图片占位节点。"
    "若当前不在画布页，画布工具会报错，需先用 site_navigate 打开画布。"
    "想了解或打开用户已有画布，用 canvas_list_projects 获取画布清单和 id，再用 site_navigate 跳 /canvas/:id 打开。"
    "生图工作台可用 workbench_image_get_config 看可选项、workbench_image_generate 填提示词并生成；"
    "视频创作台对应 workbench_video_get_config 与 workbench_video_generate；用 prompts_search 分页搜索提示词库；"
    "用 assets_list 查看「我的素材」、assets_add 新增文本或图片素材。"
    "需要生成内容时直接调用对应生成工具，不要绑定特定业务场景。不要模拟鼠标点击，不要要求用户手动复制 JSON。"
)

LLM_CLIENT = AsyncOpenAI(
    api_key=os.getenv("AI_GATEWAY_API_KEY", ""),
    base_url=os.getenv("AI_GATEWAY_BASE_URL", "https://ai-gateway.edgeone.link/v1"),
)
LLM_MODEL = OpenAIChatCompletionsModel(
    model=os.getenv("AI_GATEWAY_MODEL", "@makers/deepseek-v4-flash"),
    openai_client=LLM_CLIENT,
)

# Per-request context shared with tool functions.
_RequestCtx = contextvars.ContextVar("agentcut_request_ctx", default=None)


def _ctx() -> Dict[str, Any]:
    ctx = _RequestCtx.get()
    if ctx is None:
        raise RuntimeError("Tool called outside of an AgentCut request context")
    return ctx


def _backend_url() -> str:
    return os.getenv("AGENT_BACKEND_URL", "http://127.0.0.1:8081").rstrip("/")


def _tool_secret() -> str:
    return os.getenv("AGENT_TOOL_SECRET", "")


def _sse_event(event: str, data: Dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def _bridge_tool(name: str, tool_input: Any) -> str:
    """Forward a tool call to the AgentCut backend and wait for the browser result."""
    ctx = _ctx()
    request_id = str(uuid.uuid4())
    payload = {
        "request_id": request_id,
        "tool": name,
        "input": tool_input,
        "user_id": ctx.get("user_id"),
        "conversation_id": ctx.get("conversation_id"),
        "client_id": ctx.get("client_id"),
        "thread_id": ctx.get("thread_id"),
    }
    headers: Dict[str, str] = {"Content-Type": "application/json"}
    secret = _tool_secret()
    if secret:
        headers["X-Agent-Tool-Secret"] = secret

    backend = _backend_url()
    url = f"{backend}/api/v1/agent/tool-bridge"

    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
    except httpx.TimeoutException:
        return json.dumps({"ok": False, "error": "工具执行超时，用户页面没有响应"}, ensure_ascii=False)
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text or str(exc)
        return json.dumps({"ok": False, "error": f"后端桥接错误: {detail}"}, ensure_ascii=False)
    except Exception as exc:
        return json.dumps({"ok": False, "error": f"工具桥接异常: {exc}"}, ensure_ascii=False)

    if data.get("error"):
        return json.dumps({"ok": False, "error": data["error"]}, ensure_ascii=False)
    return json.dumps({"ok": True, "result": data.get("result")}, ensure_ascii=False)


# -----------------------------------------------------------------------------
# Tool definitions (mirror the canvas-agent tool schema)
# -----------------------------------------------------------------------------

@function_tool
def site_navigate(path: str) -> str:
    """Jump to a page on the AgentCut website."""
    return asyncio.run(_bridge_tool("site_navigate", {"path": path}))


@function_tool
def canvas_list_projects(keyword: str = "", page: int = 1, page_size: int = 20) -> str:
    """List user's canvas projects."""
    return asyncio.run(_bridge_tool("canvas_list_projects", {"keyword": keyword, "page": page, "pageSize": page_size}))


@function_tool
def canvas_get_state() -> str:
    """Read the current canvas snapshot (nodes, connections, viewport, selection)."""
    return asyncio.run(_bridge_tool("canvas_get_state", {}))


@function_tool
def canvas_get_selection() -> str:
    """Read the currently selected nodes on the canvas."""
    return asyncio.run(_bridge_tool("canvas_get_selection", {}))


@function_tool
def canvas_export_snapshot() -> str:
    """Export a compact snapshot of the canvas for reasoning."""
    return asyncio.run(_bridge_tool("canvas_export_snapshot", {}))


@function_tool
def canvas_apply_ops(ops: List[Dict[str, Any]]) -> str:
    """Apply a batch of canvas operations (add_node, update_node, delete_node, connect_nodes, etc.)."""
    return asyncio.run(_bridge_tool("canvas_apply_ops", {"ops": ops}))


@function_tool
def canvas_create_node(
    node_type: str,
    title: str = "",
    x: float = 0,
    y: float = 0,
    width: float = 0,
    height: float = 0,
    metadata: Optional[Dict[str, Any]] = None,
) -> str:
    """Create a single node on the canvas."""
    return asyncio.run(_bridge_tool("canvas_create_node", {
        "nodeType": node_type, "title": title, "x": x, "y": y,
        "width": width, "height": height, "metadata": metadata or {},
    }))


@function_tool
def canvas_create_attachment_nodes(attachment_ids: List[str], x: float = 0, y: float = 0, gap: float = 40, direction: str = "row") -> str:
    """Turn uploaded image attachments into real image nodes on the canvas."""
    return asyncio.run(_bridge_tool("canvas_create_attachment_nodes", {
        "attachmentIds": attachment_ids, "x": x, "y": y, "gap": gap, "direction": direction,
    }))


@function_tool
def canvas_create_text_node(text: str = "", title: str = "", x: float = 0, y: float = 0, width: float = 0, height: float = 0) -> str:
    """Create a text node on the canvas."""
    return asyncio.run(_bridge_tool("canvas_create_text_node", {
        "text": text, "title": title, "x": x, "y": y, "width": width, "height": height,
    }))


@function_tool
def canvas_create_text_nodes(items: List[Dict[str, Any]], x: float = 0, y: float = 0, gap: float = 40, direction: str = "row") -> str:
    """Create multiple text nodes on the canvas."""
    return asyncio.run(_bridge_tool("canvas_create_text_nodes", {
        "items": items, "x": x, "y": y, "gap": gap, "direction": direction,
    }))


@function_tool
def canvas_create_config_node(
    prompt: str = "",
    mode: str = "image",
    title: str = "",
    x: float = 0,
    y: float = 0,
    width: float = 0,
    height: float = 0,
    auto_run: bool = False,
    **kwargs: Any,
) -> str:
    """Create a generation config node on the canvas."""
    payload = {
        "prompt": prompt, "mode": mode, "title": title, "x": x, "y": y,
        "width": width, "height": height, "autoRun": auto_run,
    }
    payload.update(kwargs)
    return asyncio.run(_bridge_tool("canvas_create_config_node", payload))


@function_tool
def canvas_create_image_prompt_flow(prompt: str, title: str = "", x: float = 0, y: float = 0, auto_run: bool = False, **kwargs: Any) -> str:
    """Create a text prompt node + image generation config node, wired together."""
    payload = {"prompt": prompt, "title": title, "x": x, "y": y, "autoRun": auto_run}
    payload.update(kwargs)
    return asyncio.run(_bridge_tool("canvas_create_image_prompt_flow", payload))


@function_tool
def canvas_create_generation_flow(
    prompt: str,
    mode: str = "image",
    title: str = "",
    x: float = 0,
    y: float = 0,
    reference_node_ids: Optional[List[str]] = None,
    auto_run: bool = False,
    **kwargs: Any,
) -> str:
    """Create a generic generation flow (prompt node + config node + optional reference nodes)."""
    payload = {
        "prompt": prompt, "mode": mode, "title": title, "x": x, "y": y,
        "referenceNodeIds": reference_node_ids or [], "autoRun": auto_run,
    }
    payload.update(kwargs)
    return asyncio.run(_bridge_tool("canvas_create_generation_flow", payload))


@function_tool
def canvas_generate_text(prompt: str, title: str = "", x: float = 0, y: float = 0, **kwargs: Any) -> str:
    """Create a text generation flow and run it immediately."""
    payload = {"prompt": prompt, "title": title, "x": x, "y": y, "autoRun": True}
    payload.update(kwargs)
    return asyncio.run(_bridge_tool("canvas_generate_text", payload))


@function_tool
def canvas_generate_image(prompt: str, title: str = "", x: float = 0, y: float = 0, **kwargs: Any) -> str:
    """Create an image generation flow and run it immediately."""
    payload = {"prompt": prompt, "title": title, "x": x, "y": y, "autoRun": True}
    payload.update(kwargs)
    return asyncio.run(_bridge_tool("canvas_generate_image", payload))


@function_tool
def canvas_generate_video(prompt: str, title: str = "", x: float = 0, y: float = 0, **kwargs: Any) -> str:
    """Create a video generation flow and run it immediately."""
    payload = {"prompt": prompt, "title": title, "x": x, "y": y, "autoRun": True}
    payload.update(kwargs)
    return asyncio.run(_bridge_tool("canvas_generate_video", payload))


@function_tool
def canvas_generate_audio(prompt: str, title: str = "", x: float = 0, y: float = 0, **kwargs: Any) -> str:
    """Create an audio generation flow and run it immediately."""
    payload = {"prompt": prompt, "title": title, "x": x, "y": y, "autoRun": True}
    payload.update(kwargs)
    return asyncio.run(_bridge_tool("canvas_generate_audio", payload))


@function_tool
def canvas_update_node(id: str, patch: Optional[Dict[str, Any]] = None, metadata: Optional[Dict[str, Any]] = None) -> str:
    """Update a canvas node."""
    return asyncio.run(_bridge_tool("canvas_update_node", {"id": id, "patch": patch or {}, "metadata": metadata or {}}))


@function_tool
def canvas_update_node_text(id: str, text: str, title: str = "") -> str:
    """Update a text node's content and optional title."""
    return asyncio.run(_bridge_tool("canvas_update_node_text", {"id": id, "text": text, "title": title}))


@function_tool
def canvas_move_nodes(items: List[Dict[str, Any]]) -> str:
    """Move one or more canvas nodes."""
    return asyncio.run(_bridge_tool("canvas_move_nodes", {"items": items}))


@function_tool
def canvas_resize_node(id: str, width: float, height: float, free_resize: bool = False) -> str:
    """Resize a canvas node."""
    return asyncio.run(_bridge_tool("canvas_resize_node", {"id": id, "width": width, "height": height, "freeResize": free_resize}))


@function_tool
def canvas_delete_nodes(ids: List[str]) -> str:
    """Delete canvas nodes."""
    return asyncio.run(_bridge_tool("canvas_delete_nodes", {"ids": ids}))


@function_tool
def canvas_connect_nodes(connections: List[Dict[str, str]]) -> str:
    """Connect nodes on the canvas."""
    return asyncio.run(_bridge_tool("canvas_connect_nodes", {"connections": connections}))


@function_tool
def canvas_select_nodes(ids: List[str]) -> str:
    """Set the current selection on the canvas."""
    return asyncio.run(_bridge_tool("canvas_select_nodes", {"ids": ids}))


@function_tool
def canvas_set_viewport(viewport: Dict[str, float]) -> str:
    """Adjust the canvas viewport."""
    return asyncio.run(_bridge_tool("canvas_set_viewport", {"viewport": viewport}))


@function_tool
def canvas_run_generation(node_id: str, mode: str = "image", prompt: str = "") -> str:
    """Trigger generation on a config node."""
    return asyncio.run(_bridge_tool("canvas_run_generation", {"nodeId": node_id, "mode": mode, "prompt": prompt}))


@function_tool
def generation_get_status(scope: str = "all", task_id: str = "", node_ids: Optional[List[str]] = None, limit: int = 20) -> str:
    """Query generation task status."""
    return asyncio.run(_bridge_tool("generation_get_status", {
        "scope": scope, "taskId": task_id, "nodeIds": node_ids or [], "limit": limit,
    }))


@function_tool
def workbench_image_get_config() -> str:
    """Read the image generation workbench configuration and available options."""
    return asyncio.run(_bridge_tool("workbench_image_get_config", {}))


@function_tool
def workbench_image_generate(
    prompt: str,
    model: str = "",
    quality: str = "",
    size: str = "",
    count: int = 1,
    run: bool = True,
) -> str:
    """Generate images on the image workbench."""
    return asyncio.run(_bridge_tool("workbench_image_generate", {
        "prompt": prompt, "model": model, "quality": quality, "size": size, "count": count, "run": run,
    }))


@function_tool
def workbench_video_get_config() -> str:
    """Read the video generation workbench configuration and available options."""
    return asyncio.run(_bridge_tool("workbench_video_get_config", {}))


@function_tool
def workbench_video_generate(
    prompt: str,
    model: str = "",
    size: str = "",
    seconds: str = "",
    resolution: str = "",
    generate_audio: bool = False,
    watermark: bool = False,
    run: bool = True,
) -> str:
    """Generate videos on the video workbench."""
    return asyncio.run(_bridge_tool("workbench_video_generate", {
        "prompt": prompt, "model": model, "size": size, "seconds": seconds,
        "resolution": resolution, "generateAudio": generate_audio, "watermark": watermark, "run": run,
    }))


@function_tool
def prompts_search(keyword: str = "", category: str = "", tags: Optional[List[str]] = None, page: int = 1, page_size: int = 20) -> str:
    """Search the prompt library."""
    return asyncio.run(_bridge_tool("prompts_search", {
        "keyword": keyword, "category": category, "tags": tags or [], "page": page, "pageSize": page_size,
    }))


@function_tool
def assets_list(kind: str = "all", keyword: str = "", page: int = 1, page_size: int = 20) -> str:
    """List user's assets."""
    return asyncio.run(_bridge_tool("assets_list", {
        "kind": kind, "keyword": keyword, "page": page, "pageSize": page_size,
    }))


@function_tool
def assets_add(kind: str, title: str, content: str = "", image_url: str = "", tags: Optional[List[str]] = None, source: str = "", note: str = "") -> str:
    """Add a text or image asset to the user's library."""
    return asyncio.run(_bridge_tool("assets_add", {
        "kind": kind, "title": title, "content": content, "imageUrl": image_url,
        "tags": tags or [], "source": source, "note": note,
    }))


TOOLS = [
    site_navigate,
    canvas_list_projects,
    canvas_get_state,
    canvas_get_selection,
    canvas_export_snapshot,
    canvas_apply_ops,
    canvas_create_node,
    canvas_create_attachment_nodes,
    canvas_create_text_node,
    canvas_create_text_nodes,
    canvas_create_config_node,
    canvas_create_image_prompt_flow,
    canvas_create_generation_flow,
    canvas_generate_text,
    canvas_generate_image,
    canvas_generate_video,
    canvas_generate_audio,
    canvas_update_node,
    canvas_update_node_text,
    canvas_move_nodes,
    canvas_resize_node,
    canvas_delete_nodes,
    canvas_connect_nodes,
    canvas_select_nodes,
    canvas_set_viewport,
    canvas_run_generation,
    generation_get_status,
    workbench_image_get_config,
    workbench_image_generate,
    workbench_video_get_config,
    workbench_video_generate,
    prompts_search,
    assets_list,
    assets_add,
]


# -----------------------------------------------------------------------------
# Event stream
# -----------------------------------------------------------------------------

async def _event_stream(
    message: str,
    session=None,
    cancel_signal: asyncio.Event | None = None,
) -> AsyncGenerator[str, None]:
    agent = Agent(
        name=AGENT_NAME,
        instructions=AGENT_PROMPT,
        tools=TOOLS,
        model=LLM_MODEL,
    )
    result = Runner.run_streamed(agent, input=message, session=session)

    async for event in result.stream_events():
        if cancel_signal and cancel_signal.is_set():
            break

        if event.type == "raw_response_event" and isinstance(event.data, ResponseTextDeltaEvent):
            yield _sse_event("text_delta", {"delta": event.data.delta})
        elif event.type == "run_item_stream_event" and event.name == "tool_called":
            tool_name = getattr(event.item, "name", None) or getattr(getattr(event.item, "raw_item", None), "name", None)
            if tool_name:
                yield _sse_event("tool_called", {"tool": tool_name})
        elif event.type == "run_item_stream_event" and event.name == "tool_output":
            tool_name = getattr(event.item, "name", None) or getattr(getattr(event.item, "raw_item", None), "name", None)
            output = getattr(event.item, "output", None)
            yield _sse_event("tool_output", {"tool": tool_name, "output": output})


# -----------------------------------------------------------------------------
# Handler
# -----------------------------------------------------------------------------

async def handler(context: Any) -> AsyncGenerator[str, None]:
    """EdgeOne Makers entry point for POST /agentcut."""
    request = context.request
    body = request.body or {}
    prompt = body.get("prompt") if isinstance(body, dict) else None
    if not prompt:
        yield _sse_event("error", {"message": "'prompt' is required"})
        yield _sse_event("done", {})
        return

    user_id = str(body.get("user_id") or body.get("userId") or "").strip() or None
    client_id = str(body.get("client_id") or body.get("clientId") or "").strip() or None
    thread_id = str(body.get("thread_id") or body.get("threadId") or "").strip() or None

    cid = context.conversation_id
    token = _RequestCtx.set({
        "user_id": user_id,
        "conversation_id": cid,
        "client_id": client_id,
        "thread_id": thread_id,
    })

    # Index the conversation by user on the first turn so /conversations can list it.
    if user_id and cid:
        try:
            existing = await context.store.get_messages(conversation_id=cid, limit=1)
            already_indexed = bool(existing)
        except Exception:
            already_indexed = False
        if not already_indexed:
            try:
                await context.store.append_message(
                    conversation_id=cid,
                    role="user",
                    content=prompt,
                    user_id=user_id,
                )
            except Exception:
                pass

    session = context.store.openai_session(cid) if cid else None
    cancel_signal = request.signal
    stopped = False

    try:
        async for frame in _event_stream(prompt, session, cancel_signal):
            if cancel_signal and cancel_signal.is_set():
                stopped = True
                break
            yield frame
    except asyncio.CancelledError:
        stopped = True
    except Exception as exc:
        detail: Any = str(exc)
        status: Any = None
        response = getattr(exc, "response", None)
        if response is not None:
            status = getattr(response, "status_code", None)
            try:
                body_text = response.text if hasattr(response, "text") else None
                if callable(body_text):
                    body_text = body_text()
                if body_text:
                    try:
                        detail = json.loads(body_text)
                    except Exception:
                        detail = body_text
            except Exception:
                pass
        yield _sse_event("error", {
            "message": str(exc),
            "errorType": type(exc).__name__,
            "status": status,
            "detail": detail,
        })
    finally:
        _RequestCtx.reset(token)
        yield _sse_event("done", {"stopped": stopped})
