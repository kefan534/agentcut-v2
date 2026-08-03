"""
Agent proxy for EdgeOne Makers.

The frontend Agent panel originally talked to a local Codex canvas-agent
(http://127.0.0.1:17371). This router exposes the same wire protocol so the
panel needs minimal changes, while forwarding the actual brain to an EdgeOne
Makers-hosted AgentCut agent.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any, Dict, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User

router = APIRouter(prefix="/agent", tags=["agent"])

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

AGENT_TOOL_SECRET = (settings.AGENT_TOOL_SECRET or "").strip()
EDGEONE_MAKERS_AGENT_URL = (settings.EDGEONE_MAKERS_AGENT_URL or "").rstrip("/")
EDGEONE_MAKERS_API_KEY = (settings.EDGEONE_MAKERS_API_KEY or "").strip()

# -----------------------------------------------------------------------------
# In-memory per-user event bus and tool result rendezvous
# -----------------------------------------------------------------------------

# user_id -> {client_id: asyncio.Queue}
_user_queues: Dict[str, Dict[str, asyncio.Queue]] = {}
# user_id -> active client_id
_active_clients: Dict[str, str] = {}
# user_id -> latest canvas snapshot
_canvas_states: Dict[str, Dict[str, Any]] = {}
# request_id -> asyncio.Future waiting for frontend tool result
_pending_tools: Dict[str, asyncio.Future] = {}


class _ToolBridgePayload(BaseModel):
    request_id: str
    tool: str
    input: Dict[str, Any] = Field(default_factory=dict)
    user_id: Optional[str] = None
    conversation_id: Optional[str] = None
    client_id: Optional[str] = None
    thread_id: Optional[str] = None


class _CanvasResultPayload(BaseModel):
    requestId: str
    result: Optional[Any] = None
    error: Optional[str] = None


class _TurnPayload(BaseModel):
    prompt: str
    messageText: Optional[str] = None
    messageId: Optional[str] = None
    clientId: Optional[str] = None
    threadId: Optional[str] = None
    attachments: list = Field(default_factory=list)


def _get_user_queues(user_id: str) -> Dict[str, asyncio.Queue]:
    return _user_queues.setdefault(user_id, {})


def _enqueue(user_id: str, event_name: str, payload: Dict[str, Any]) -> None:
    queues = _get_user_queues(user_id)
    if not queues:
        return
    frame = f"event: {event_name}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
    for queue in list(queues.values()):
        try:
            queue.put_nowait(frame)
        except asyncio.QueueFull:
            pass


def _build_conversation_id(user_id: str, thread_id: Optional[str]) -> str:
    return f"user-{user_id}:thread-{thread_id or uuid.uuid4()}"


# -----------------------------------------------------------------------------
# SSE endpoint — same shape as the local canvas-agent /events
# -----------------------------------------------------------------------------

@router.get("/events")
async def agent_events(
    request: Request,
    client_id: str = Query(..., alias="clientId"),
    current_user: User = Depends(get_current_user),
):
    user_id = str(current_user.id)
    queues = _get_user_queues(user_id)
    queue: asyncio.Queue = asyncio.Queue(maxsize=256)
    queues[client_id] = queue
    _active_clients[user_id] = client_id

    async def stream():
        try:
            hello = {
                "ok": True,
                "clientId": client_id,
                "codex": {"busy": False, "threadId": "", "turnId": ""},
            }
            yield f"event: hello\ndata: {json.dumps(hello, ensure_ascii=False)}\n\n"
            while True:
                try:
                    frame = await asyncio.wait_for(queue.get(), timeout=60.0)
                except asyncio.TimeoutError:
                    yield f"event: ping\ndata: {json.dumps({'time': int(asyncio.get_event_loop().time() * 1000)}, ensure_ascii=False)}\n\n"
                    continue
                if frame is None:
                    break
                yield frame
        finally:
            queues.pop(client_id, None)
            if _active_clients.get(user_id) == client_id:
                _active_clients.pop(user_id, None)

    return StreamingResponse(stream(), media_type="text/event-stream")


# -----------------------------------------------------------------------------
# Turn — forward user message to Makers, return immediately, stream via SSE
# -----------------------------------------------------------------------------

@router.post("/turn")
async def agent_turn(
    payload: _TurnPayload,
    current_user: User = Depends(get_current_user),
):
    if not EDGEONE_MAKERS_AGENT_URL:
        raise HTTPException(status_code=503, detail="EdgeOne Makers agent URL is not configured")

    user_id = str(current_user.id)
    thread_id = payload.threadId or str(uuid.uuid4())
    conversation_id = _build_conversation_id(user_id, thread_id)

    makers_body = {
        "prompt": payload.prompt,
        "messageText": payload.messageText,
        "messageId": payload.messageId,
        "client_id": payload.clientId,
        "thread_id": thread_id,
        "user_id": user_id,
        "attachments": payload.attachments,
    }

    # Start the Makers stream in the background; events are pushed to the
    # user's SSE queues as they arrive.
    asyncio.create_task(_stream_from_makers(user_id, conversation_id, makers_body))

    return {
        "ok": True,
        "threadId": conversation_id,
        "conversationId": conversation_id,
    }


async def _stream_from_makers(user_id: str, conversation_id: str, body: Dict[str, Any]) -> None:
    """Read the Makers SSE stream and forward events to the frontend."""
    headers: Dict[str, str] = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "Makers-Conversation-Id": conversation_id,
    }
    if EDGEONE_MAKERS_API_KEY:
        headers["Authorization"] = f"Bearer {EDGEONE_MAKERS_API_KEY}"

    url = f"{EDGEONE_MAKERS_AGENT_URL}"
    stream_id = f"{conversation_id}:msg"

    _enqueue(user_id, "codex_state", {"busy": True, "threadId": conversation_id, "turnId": ""})

    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            async with client.stream("POST", url, json=body, headers=headers) as response:
                response.raise_for_status()
                buffer = ""
                async for chunk in response.aiter_text():
                    buffer += chunk
                    while "\n\n" in buffer:
                        frame, buffer = buffer.split("\n\n", 1)
                        await _handle_makers_frame(user_id, conversation_id, stream_id, frame)
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text or str(exc)
        _enqueue(user_id, "agent_error", {"message": f"Makers HTTP error: {detail}"})
    except Exception as exc:
        _enqueue(user_id, "agent_error", {"message": f"Makers stream error: {exc}"})
    finally:
        _enqueue(user_id, "codex_state", {"busy": False, "threadId": conversation_id, "turnId": ""})


async def _handle_makers_frame(user_id: str, conversation_id: str, stream_id: str, frame: str) -> None:
    lines = frame.strip().split("\n")
    event = ""
    data_lines: list[str] = []
    for line in lines:
        if line.startswith("event: "):
            event = line[7:].strip()
        elif line.startswith("data: "):
            data_lines.append(line[6:])
    if not event or not data_lines:
        return
    try:
        data = json.loads("\n".join(data_lines))
    except json.JSONDecodeError:
        return

    if event == "text_delta":
        delta = data.get("delta", "")
        _enqueue(user_id, "agent_event", {
            "agent": "agentcut",
            "type": "item.updated",
            "thread_id": conversation_id,
            "item": {"id": stream_id, "type": "agent_message", "text": delta},
        })
    elif event == "tool_called":
        _enqueue(user_id, "agent_event", {
            "agent": "agentcut",
            "type": "item.started",
            "thread_id": conversation_id,
            "item": {"type": "mcp_tool_call", "tool": data.get("tool")},
        })
    elif event == "tool_output":
        _enqueue(user_id, "agent_event", {
            "agent": "agentcut",
            "type": "item.completed",
            "thread_id": conversation_id,
            "item": {"type": "mcp_tool_call", "tool": data.get("tool"), "result": data.get("output")},
        })
    elif event == "error":
        _enqueue(user_id, "agent_error", {
            "thread_id": conversation_id,
            "message": data.get("message", "Agent error"),
            "detail": data.get("detail"),
        })
    elif event == "done":
        _enqueue(user_id, "agent_event", {
            "agent": "agentcut",
            "type": "turn.completed",
            "thread_id": conversation_id,
        })


# -----------------------------------------------------------------------------
# Tool bridge — called by the Makers agent to execute a browser-side tool
# -----------------------------------------------------------------------------

@router.post("/tool-bridge")
async def agent_tool_bridge(
    request: Request,
    payload: _ToolBridgePayload,
):
    secret = AGENT_TOOL_SECRET
    if secret:
        provided = request.headers.get("X-Agent-Tool-Secret", "")
        if provided != secret:
            raise HTTPException(status_code=401, detail="Invalid tool secret")

    user_id = payload.user_id
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id is required")

    request_id = payload.request_id
    client_id = payload.client_id or _active_clients.get(user_id)
    tool_payload = {
        "requestId": request_id,
        "name": payload.tool,
        "input": payload.input,
    }

    _enqueue(user_id, "tool_call", tool_payload)

    future: asyncio.Future = asyncio.get_event_loop().create_future()
    _pending_tools[request_id] = future

    try:
        result = await asyncio.wait_for(future, timeout=60.0)
        return {"ok": True, "result": result}
    except asyncio.TimeoutError:
        return {"ok": False, "error": "前端工具执行超时"}
    finally:
        _pending_tools.pop(request_id, None)


# -----------------------------------------------------------------------------
# Canvas tool result — frontend posts the outcome of a tool_call
# -----------------------------------------------------------------------------

@router.post("/canvas/result")
async def agent_canvas_result(
    payload: _CanvasResultPayload,
    current_user: User = Depends(get_current_user),
):
    future = _pending_tools.get(payload.requestId)
    if not future or future.done():
        return {"ok": False, "error": "Request already resolved or unknown"}
    if payload.error:
        future.set_exception(RuntimeError(payload.error))
    else:
        future.set_result(payload.result)
    return {"ok": True}


@router.post("/tool-result")
async def agent_tool_result(
    payload: _CanvasResultPayload,
    current_user: User = Depends(get_current_user),
):
    """Alias for /canvas/result."""
    return await agent_canvas_result(payload, current_user)


# -----------------------------------------------------------------------------
# Canvas state / activate — keep the local-agent protocol alive
# -----------------------------------------------------------------------------

@router.post("/canvas/state")
async def agent_canvas_state(
    request: Request,
    current_user: User = Depends(get_current_user),
    client_id: str = Query(..., alias="clientId"),
):
    body = await request.json()
    user_id = str(current_user.id)
    _canvas_states[user_id] = dict(body) if isinstance(body, dict) else {}
    return {"ok": True}


@router.post("/canvas/activate")
async def agent_canvas_activate(
    current_user: User = Depends(get_current_user),
    client_id: str = Query(..., alias="clientId"),
):
    user_id = str(current_user.id)
    _active_clients[user_id] = client_id
    return {"ok": True}


# -----------------------------------------------------------------------------
# Interrupt — ask Makers to stop the current turn
# -----------------------------------------------------------------------------

@router.post("/interrupt")
async def agent_interrupt(
    request: Request,
    current_user: User = Depends(get_current_user),
):
    if not EDGEONE_MAKERS_AGENT_URL:
        raise HTTPException(status_code=503, detail="EdgeOne Makers agent URL is not configured")
    body = await request.json()
    conversation_id = body.get("threadId") if isinstance(body, dict) else None

    stop_url = f"{EDGEONE_MAKERS_AGENT_URL}/stop"
    headers: Dict[str, str] = {"Content-Type": "application/json"}
    if EDGEONE_MAKERS_API_KEY:
        headers["Authorization"] = f"Bearer {EDGEONE_MAKERS_API_KEY}"
    if conversation_id:
        headers["Makers-Conversation-Id"] = conversation_id

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(stop_url, headers=headers, json={})
            resp.raise_for_status()
            return {"ok": True, "detail": resp.json()}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to interrupt Makers run: {exc}")


# -----------------------------------------------------------------------------
# Threads/history placeholders (Makers manages memory; we keep the protocol)
# -----------------------------------------------------------------------------

@router.get("/codex/threads")
async def agent_threads(current_user: User = Depends(get_current_user)):
    return {"ok": True, "workspace": {"workspacePath": ""}, "data": []}


@router.post("/codex/threads/new")
async def agent_new_thread(current_user: User = Depends(get_current_user)):
    thread_id = str(uuid.uuid4())
    return {
        "ok": True,
        "workspace": {"workspacePath": ""},
        "thread": {"id": thread_id, "preview": "", "cwd": ""},
        "messages": [],
    }


@router.get("/codex/threads/{thread_id}")
async def agent_read_thread(thread_id: str, current_user: User = Depends(get_current_user)):
    return {
        "ok": True,
        "workspace": {"workspacePath": ""},
        "thread": {"id": thread_id, "preview": "", "cwd": ""},
        "messages": [],
    }


@router.post("/codex/threads/{thread_id}/resume")
async def agent_resume_thread(thread_id: str, current_user: User = Depends(get_current_user)):
    return {
        "ok": True,
        "workspace": {"workspacePath": ""},
        "thread": {"id": thread_id, "preview": "", "cwd": ""},
        "messages": [],
    }


@router.post("/codex/threads/{thread_id}/delete")
async def agent_delete_thread(thread_id: str, current_user: User = Depends(get_current_user)):
    return {"ok": True}
