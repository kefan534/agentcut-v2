"""Process-local agent loop (P0.5) — replaces the EdgeOne Makers proxy.

Runs a tool-calling loop in-process against the AgentCut model gateway
(``call_upstream``) instead of delegating to an external Makers-hosted agent.

Design notes:
- No heavyweight framework (LangChain/LangGraph) and no ``openai`` SDK — we
  reuse the existing ``call_upstream`` gateway (OpenAI-compatible proxy) and
  hand-roll the loop, exactly matching the Toonflow / Vercel AI SDK pattern.
- Text is streamed to the frontend via the existing SSE ``agent_event``
  ``item.updated`` protocol; each loop iteration emits an incremental delta.
- Tool execution happens in-process for backend tools; browser-side tools
  (file picker etc.) are out of scope for this first cut.
"""
import json
from typing import Any, Callable, Dict, List, Optional
from uuid import UUID

from app.db.session import get_db
from app.models.user import User
from app.models.model import VariableMapping
from app.services.model_service import resolve_source_for_variable, first_active_source_by_category
from app.services.gateway_service import call_upstream

MAX_TOOL_STEPS = 16


def _resolve_text_source(db, user):
    """Resolve the text model source.

    Prefers an explicit TEXT_MODEL mapping (architecture convention); falls
    back to any text-category mapping, then the first active text source.
    """
    source = resolve_source_for_variable(db, "TEXT_MODEL", user)
    if source:
        return source
    mappings = db.query(VariableMapping).filter(VariableMapping.modal_category == "text").all()
    for m in mappings:
        source = resolve_source_for_variable(db, m.variable_name, user)
        if source:
            return source
    return first_active_source_by_category(db, "text", user)


# ---------------------------------------------------------------------------
# Built-in tool schemas (OpenAI function-calling format)
# ---------------------------------------------------------------------------

BUILTIN_TOOLS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "get_user_credits",
            "description": "查询当前用户的积分余额。",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "asset_list",
            "description": "列出当前用户的素材资产（图片/视频/音频/文本）。",
            "parameters": {
                "type": "object",
                "properties": {
                    "keyword": {"type": "string", "description": "按名称模糊搜索（可选）"},
                    "limit": {"type": "integer", "description": "返回数量，默认 20，最大 100"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "asset_get_text",
            "description": "读取指定素材的已解析文本内容（OCR/解析后的文本）。",
            "parameters": {
                "type": "object",
                "properties": {
                    "assetIds": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "素材 ID 列表",
                    },
                },
                "required": ["assetIds"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ima_search",
            "description": "在 ima 知识库中检索相关内容。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "检索关键词"},
                    "topK": {"type": "integer", "description": "返回条数，默认 5"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "skill_list",
            "description": "列出当前用户已启用的 Skill。",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
]


def _execute_tool(user_id: str, name: str, args: Dict[str, Any]) -> Dict[str, Any]:
    """Execute a built-in backend tool in-process. Returns a JSON-serializable dict."""
    uid = UUID(user_id)

    if name == "get_user_credits":
        db = next(get_db())
        try:
            from app.services.credit_service import get_user_credits
            return {"balance": get_user_credits(db, uid)}
        finally:
            db.close()

    if name == "asset_list":
        db = next(get_db())
        try:
            from app.models.asset import Asset
            keyword = (args or {}).get("keyword", "") or ""
            try:
                limit = min(int((args or {}).get("limit", 20)), 100)
            except (ValueError, TypeError):
                limit = 20
            q = db.query(Asset).filter(Asset.user_id == uid)
            if keyword:
                q = q.filter(Asset.name.ilike(f"%{keyword}%"))
            rows = q.order_by(Asset.created_at.desc()).limit(limit).all()
            return {
                "items": [
                    {"id": str(r.id), "name": r.name, "asset_type": r.asset_type} for r in rows
                ],
                "count": len(rows),
            }
        finally:
            db.close()

    if name == "asset_get_text":
        db = next(get_db())
        try:
            from app.models.asset import Asset
            asset_ids = (args or {}).get("assetIds", []) or []
            if isinstance(asset_ids, str):
                asset_ids = [asset_ids]
            results = []
            for aid in asset_ids:
                asset = db.query(Asset).filter(Asset.id == aid, Asset.user_id == uid).first()
                if not asset:
                    results.append({"id": str(aid), "text": None, "error": "not found or not owned"})
                elif asset.text_status != "ready" or not asset.text:
                    results.append({"id": str(aid), "text": None, "error": f"text not ready ({asset.text_status})"})
                else:
                    results.append({"id": str(aid), "text": asset.text[:30000]})
            return {"texts": results}
        finally:
            db.close()

    if name == "ima_search":
        from app.services import ima_openapi
        from app.models.agent_audit_log import AgentAuditLog
        from app.services.rate_limiter import check_user_rate
        query = (args or {}).get("query", "") or ""
        try:
            top_k = int((args or {}).get("topK", 5))
        except (ValueError, TypeError):
            top_k = 5
        if not query:
            return {"ok": False, "error": "query is required"}
        if len(query) > 4000:
            query = query[:4000]
        if not check_user_rate(f"ima_search:{user_id}", limit=20, window_sec=3600):
            return {"ok": False, "error": "会话检索次数已达上限（20次/小时）"}
        result = ima_openapi.search(query, top_k, user_id)
        db_audit = next(get_db())
        try:
            db_audit.add(AgentAuditLog(
                user_id=uid, event="ima_search", target_id="",
                tool_name="ima_search", status="success" if result.get("ok") else "failed",
                meta={"query": query[:200], "topK": top_k, "resultCount": len(result.get("results", []))},
            ))
            db_audit.commit()
        finally:
            db_audit.close()
        return result

    if name == "skill_list":
        db = next(get_db())
        try:
            from app.models.skill import AdminSkill, UserSkillBinding
            bindings = db.query(UserSkillBinding).filter(UserSkillBinding.user_id == uid).all()
            skills = []
            for b in bindings:
                s = db.query(AdminSkill).filter(AdminSkill.id == b.skill_id).first()
                if s and s.status == "published":
                    skills.append({"id": str(s.id), "name": s.name, "description": s.description})
            return {"skills": skills}
        finally:
            db.close()

    return {"error": f"unknown tool: {name}"}


def build_skill_tools(user_id: str) -> List[Dict[str, Any]]:
    """Dynamically register enabled skills' ``tool_overrides`` as callable tools.

    ``tool_overrides`` has no enforced schema yet; we accept a conservative
    shape: a list of ``{name, description, parameters}`` (OpenAI function spec)
    or a dict mapping name -> ``{description, parameters}``. Anything else is
    ignored (the skill still applies via prompt_fragment injection).
    """
    db = next(get_db())
    try:
        from app.models.skill import AdminSkill, UserSkillBinding
        bindings = db.query(UserSkillBinding).filter(UserSkillBinding.user_id == UUID(user_id)).all()
        tools: List[Dict[str, Any]] = []
        builtin_names = {t["function"]["name"] for t in BUILTIN_TOOLS}
        for b in bindings:
            s = db.query(AdminSkill).filter(AdminSkill.id == b.skill_id).first()
            if not s or s.status != "published" or not s.tool_overrides:
                continue
            overrides = s.tool_overrides
            entries: List[Dict[str, Any]] = []
            if isinstance(overrides, list):
                entries = [e for e in overrides if isinstance(e, dict)]
            elif isinstance(overrides, dict):
                # Accept {"name": ..., "description": ..., "parameters": ...}
                if "name" in overrides:
                    entries = [overrides]
                else:
                    entries = [
                        {"name": k, "description": v.get("description", ""), "parameters": v.get("parameters", {"type": "object", "properties": {}})}
                        for k, v in overrides.items() if isinstance(v, dict)
                    ]
            for e in entries:
                name = (e.get("name") or "").strip()
                if not name or name in builtin_names:
                    continue
                tools.append({
                    "type": "function",
                    "function": {
                        "name": name,
                        "description": e.get("description") or "",
                        "parameters": e.get("parameters") or {"type": "object", "properties": {}},
                    },
                })
        return tools
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Agent loop
# ---------------------------------------------------------------------------

async def run_local_agent(
    user_id: str,
    thread_id: str,
    messages: List[Dict[str, Any]],
    tools: List[Dict[str, Any]],
    emit: Callable[[str, Dict[str, Any]], None],
    stream_id: str,
    execute_fn: Optional[Callable[[str, str, Dict[str, Any]], Dict[str, Any]]] = None,
) -> str:
    """Run the tool-calling loop against the gateway. Returns the final text.

    ``execute_fn`` overrides the built-in backend tool executor (used by the
    short-drama script agent to run domain tools bound to a project).
    """
    executor = execute_fn or _execute_tool
    db = next(get_db())
    try:
        user = db.query(User).filter(User.id == UUID(user_id)).first()
        source = _resolve_text_source(db, user)
    finally:
        db.close()

    if not source:
        emit("agent_error", {"message": "未配置文本模型（TEXT_MODEL），请在管理后台设置模型路由", "threadId": thread_id})
        return ""

    model = (source.extra_body or {}).get("model") or source.model_version

    emit("codex_state", {"busy": True, "threadId": thread_id, "turnId": ""})
    assistant_text = ""

    try:
        for _step in range(MAX_TOOL_STEPS):
            body: Dict[str, Any] = {"model": model, "messages": messages}
            if tools:
                body["tools"] = tools

            resp = await call_upstream(source, body, user_id=user_id)

            # Tolerate both dict and raw bytes/str (some adapters differ).
            if not isinstance(resp, dict):
                raise RuntimeError(f"Unexpected upstream response type: {type(resp).__name__}")

            choices = resp.get("choices") or []
            if not choices:
                raise RuntimeError("Upstream returned no choices")

            message = choices[0].get("message") or {}
            content = message.get("content") or ""
            tool_calls = message.get("tool_calls") or []

            # Stream incremental text (reasoning/thinking is intentionally not
            # surfaced to the frontend in this first cut).
            if content:
                assistant_text += content
                emit("agent_event", {
                    "agent": "agentcut",
                    "type": "item.updated",
                    "threadId": thread_id,
                    "item": {"id": stream_id, "type": "agent_message", "text": assistant_text},
                })

            # No tool calls -> turn finished.
            if not tool_calls:
                break

            # Append the assistant message (with tool_calls) then execute tools.
            messages.append({"role": "assistant", "content": content or None, "tool_calls": tool_calls})
            for tc in tool_calls:
                fn = tc.get("function") or {}
                tool_name = fn.get("name", "")
                try:
                    tool_args = json.loads(fn.get("arguments") or "{}")
                except json.JSONDecodeError:
                    tool_args = {}
                emit("agent_event", {
                    "agent": "agentcut",
                    "type": "item.started",
                    "threadId": thread_id,
                    "item": {"type": "mcp_tool_call", "tool": tool_name},
                })
                result = executor(user_id, tool_name, tool_args)
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.get("id") or f"call_{_step}",
                    "content": json.dumps(result, ensure_ascii=False),
                })
                emit("agent_event", {
                    "agent": "agentcut",
                    "type": "item.completed",
                    "threadId": thread_id,
                    "item": {"type": "mcp_tool_call", "tool": tool_name, "result": result},
                })

        # Turn completed.
        emit("agent_event", {
            "agent": "agentcut",
            "type": "turn.completed",
            "threadId": thread_id,
        })
        return assistant_text

    except Exception as exc:
        emit("agent_error", {"message": f"Agent error: {exc}", "threadId": thread_id})
        return assistant_text
    finally:
        emit("codex_state", {"busy": False, "threadId": thread_id, "turnId": ""})
