# Based on Toonflow by HBAI-Ltd, licensed under Apache-2.0 + Supplemental License.
"""Short-drama script agent (P3) — screenwriter role tools + executor.

Reuses the P0.5 process-local loop (``run_local_agent``) with a screenwriter
system prompt and short-drama domain tools that read/write ``drama_novel`` and
``drama_script``. Mirrors Toonflow's ``scriptAgent`` (read novel chapters,
read script, produce skeleton/strategy/script).
"""
import asyncio
import json
from typing import Any, Callable, Dict, List, Tuple
from uuid import UUID

from app.db.session import get_db
from app.models.drama import DramaNovel, DramaScript, DramaStoryboard

DRAMA_SCRIPT_AGENT_SYSTEM_PROMPT = (
    "你是一名专业的短剧编剧（剧本智能体），帮助用户把小说改编成短剧剧本。\n"
    "你可以读取项目内的小说章节原文、已有剧本，并把生成的剧本保存到项目中。\n"
    "工作方式：先读取小说章节理解剧情，再构思故事骨架与改编策略，最后写出分场剧本（含场景、角色、对白、镜头说明）。\n"
    "剧本格式建议：用【场景】标注场景，用「角色名」标注对白，必要时附镜头说明。\n"
    "回答使用中文，专业、简洁。"
)


def make_script_agent(project_id: str) -> Tuple[str, List[Dict[str, Any]], Callable[[str, str, Dict[str, Any]], Dict[str, Any]]]:
    """Build the screenwriter system prompt, tools and a project-bound executor.

    ``project_id`` is captured in the executor closure (never exposed to the
    LLM as a tool parameter), so all reads/writes are scoped to one project.
    """
    # 读短剧编剧 Agent 配置（system_prompt 可后台配置，默认值兜底）
    from app.services.agent_config_service import get_agent_config
    db_cfg = next(get_db())
    try:
        cfg = get_agent_config(db_cfg, "script_agent")
    finally:
        db_cfg.close()

    tools: List[Dict[str, Any]] = [
        {
            "type": "function",
            "function": {
                "name": "list_novels",
                "description": "列出项目内的小说章节（编号、标题、事件抽取状态）。",
                "parameters": {"type": "object", "properties": {}, "required": []},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_novel_text",
                "description": "读取指定章节的小说原文正文。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "chapter_index": {"type": "integer", "description": "章节编号（从 0 开始）"},
                    },
                    "required": ["chapter_index"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "list_scripts",
                "description": "列出项目内的剧本。",
                "parameters": {"type": "object", "properties": {}, "required": []},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_script_content",
                "description": "读取指定剧本的完整内容。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "script_id": {"type": "string", "description": "剧本 ID"},
                    },
                    "required": ["script_id"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "save_script",
                "description": "新建一个剧本并保存到项目（返回剧本 ID）。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string", "description": "剧本名称"},
                        "content": {"type": "string", "description": "剧本内容"},
                    },
                    "required": ["name", "content"],
                },
            },
        },
    ]

    def execute(user_id: str, name: str, args: Dict[str, Any]) -> Dict[str, Any]:
        uid = UUID(user_id)
        pid = UUID(project_id)

        if name == "list_novels":
            db = next(get_db())
            try:
                rows = (
                    db.query(DramaNovel)
                    .filter(
                        DramaNovel.user_id == uid,
                        DramaNovel.project_id == pid,
                        DramaNovel.is_deleted == "N",
                    )
                    .order_by(DramaNovel.chapter_index.asc())
                    .all()
                )
                return {
                    "chapters": [
                        {"chapter_index": r.chapter_index, "chapter": r.chapter, "event_state": r.event_state}
                        for r in rows
                    ],
                    "count": len(rows),
                }
            finally:
                db.close()

        if name == "get_novel_text":
            chapter_index = int((args or {}).get("chapter_index", 0))
            db = next(get_db())
            try:
                row = (
                    db.query(DramaNovel)
                    .filter(
                        DramaNovel.user_id == uid,
                        DramaNovel.project_id == pid,
                        DramaNovel.chapter_index == chapter_index,
                        DramaNovel.is_deleted == "N",
                    )
                    .first()
                )
                if not row:
                    return {"error": f"未找到第 {chapter_index} 章"}
                return {"chapter_index": chapter_index, "chapter": row.chapter, "text": row.chapter_data or ""}
            finally:
                db.close()

        if name == "list_scripts":
            db = next(get_db())
            try:
                rows = (
                    db.query(DramaScript)
                    .filter(
                        DramaScript.user_id == uid,
                        DramaScript.project_id == pid,
                        DramaScript.is_deleted == "N",
                    )
                    .order_by(DramaScript.updated_at.desc())
                    .all()
                )
                return {
                    "scripts": [{"id": str(r.id), "name": r.name} for r in rows],
                    "count": len(rows),
                }
            finally:
                db.close()

        if name == "get_script_content":
            script_id = (args or {}).get("script_id", "")
            db = next(get_db())
            try:
                row = db.query(DramaScript).filter(
                    DramaScript.id == script_id,
                    DramaScript.user_id == uid,
                    DramaScript.is_deleted == "N",
                ).first()
                if not row:
                    return {"error": "剧本不存在"}
                return {"id": str(row.id), "name": row.name, "content": row.content or ""}
            finally:
                db.close()

        if name == "save_script":
            sname = (args or {}).get("name", "未命名剧本")
            content = (args or {}).get("content", "")
            db = next(get_db())
            try:
                script = DramaScript(
                    user_id=uid,
                    project_id=pid,
                    name=sname,
                    content=content,
                    extract_state=0,
                )
                db.add(script)
                db.commit()
                db.refresh(script)
                return {"id": str(script.id), "name": script.name}
            finally:
                db.close()

        return {"error": f"unknown tool: {name}"}

    return cfg["system_prompt"], tools, execute


# ---------------------------------------------------------------------------
# Novel event extraction (P4)
# ---------------------------------------------------------------------------

EVENT_EXTRACTION_PROMPT = (
    "你是一名小说剧情分析助手。请阅读给定的小说章节，提取其中的关键剧情事件。\n"
    "要求：\n"
    "1. 按发生顺序，用简洁的中文概括每个事件（一句话，含时间/地点/人物/发生了什么）。\n"
    "2. 每个事件单独一行，以「- 」开头。\n"
    "3. 只概括剧情事实，不添加评论或演绎。\n"
    "4. 若章节无明显剧情，输出「本章无关键事件」。"
)


async def extract_novel_events(
    user_id: str,
    project_id: str,
    novel_ids: List[str],
) -> Dict[str, Any]:
    """异步抽取小说章节的事件摘要，写回 ``drama_novel.event`` + ``event_state``.

    Runs each chapter through the text model (via the gateway), then persists
    the summary. Returns a summary dict.
    """
    from app.models.user import User
    from app.services.agent_loop import _resolve_text_source
    from app.services.gateway_service import call_upstream

    uid = UUID(user_id)
    pid = UUID(project_id)

    db = next(get_db())
    try:
        user = db.query(User).filter(User.id == uid).first()
        source = _resolve_text_source(db, user)
    finally:
        db.close()

    if not source:
        return {"ok": False, "error": "未配置文本模型（TEXT_MODEL）"}

    model = (source.extra_body or {}).get("model") or source.model_version

    db = next(get_db())
    try:
        q = db.query(DramaNovel).filter(
            DramaNovel.user_id == uid,
            DramaNovel.project_id == pid,
            DramaNovel.is_deleted == "N",
        )
        if novel_ids:
            q = q.filter(DramaNovel.id.in_(novel_ids))
        novels = q.order_by(DramaNovel.chapter_index.asc()).all()
    finally:
        db.close()

    if not novels:
        return {"ok": False, "error": "没有可抽取的章节"}

    # 标记为处理中（event_state=0 表示未抽取/处理中）
    db = next(get_db())
    try:
        for n in novels:
            n.event_state = 0
            n.event = None
            n.error_reason = None
        db.commit()
    finally:
        db.close()

    # §2.4: 并发抽取（Toonflow concurrentCount=5），信号量限流。
    semaphore = asyncio.Semaphore(5)

    async def _process_one(novel: DramaNovel) -> str:
        async with semaphore:
            try:
                body = {
                    "model": model,
                    "messages": [
                        {"role": "system", "content": EVENT_EXTRACTION_PROMPT},
                        {"role": "user", "content": f"章节标题：{novel.chapter or ''}\n章节内容：\n{novel.chapter_data or ''}"},
                    ],
                }
                resp = await call_upstream(source, body, user_id=user_id)
                text = ""
                if isinstance(resp, dict):
                    choices = resp.get("choices") or []
                    if choices:
                        text = (choices[0].get("message") or {}).get("content") or ""

                db = next(get_db())
                try:
                    row = db.query(DramaNovel).filter(DramaNovel.id == novel.id).first()
                    if row:
                        row.event = text
                        row.event_state = 1 if text else -1
                        row.error_reason = None if text else "模型返回为空"
                        db.commit()
                finally:
                    db.close()
                return "done"
            except Exception as exc:  # noqa: BLE001
                db = next(get_db())
                try:
                    row = db.query(DramaNovel).filter(DramaNovel.id == novel.id).first()
                    if row:
                        row.event_state = -1
                        row.error_reason = str(exc)[:500]
                        db.commit()
                finally:
                    db.close()
                return "failed"

    results = await asyncio.gather(*[_process_one(n) for n in novels])
    done = results.count("done")
    failed = results.count("failed")

    return {"ok": True, "total": len(novels), "done": done, "failed": failed}


# ---------------------------------------------------------------------------
# Storyboard auto-split from script (P6)
# ---------------------------------------------------------------------------

STORYBOARD_GENERATION_PROMPT = (
    "你是一名专业的短剧分镜师。请把下面这段剧本拆解成分镜序列（shot list）。\n"
    "每个分镜是一个连续镜头，要求：\n"
    "1. prompt：该镜头的画面描述（人物、场景、动作、构图、光线），用于生成分镜图。\n"
    "2. video_desc：该镜头的运镜描述（如「固定镜头」「缓慢推近」「跟随人物」）。\n"
    "3. duration：该镜头时长（秒，3 到 8 秒）。\n\n"
    "只输出 JSON 数组，格式：\n"
    '[{"index": 0, "prompt": "...", "video_desc": "...", "duration": 5}, ...]\n\n'
    "不要输出任何 JSON 以外的文字。"
)


def _extract_json_array(text: str) -> list:
    """Extract the first JSON array from model output (tolerates markdown fences)."""
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else t
        if t.endswith("```"):
            t = t.rsplit("```", 1)[0]
        t = t.strip()
    start = t.find("[")
    end = t.rfind("]")
    if start == -1 or end == -1 or end <= start:
        return []
    try:
        arr = json.loads(t[start : end + 1])
        return arr if isinstance(arr, list) else []
    except json.JSONDecodeError:
        return []


async def generate_storyboards_from_script(
    user_id: str,
    project_id: str,
    script_id: str,
) -> Dict[str, Any]:
    """用文本模型把剧本拆成分镜序列，批量写入 drama_storyboard。"""
    from app.models.user import User
    from app.services.agent_loop import _resolve_text_source
    from app.services.gateway_service import call_upstream

    uid = UUID(user_id)
    pid = UUID(project_id)

    db = next(get_db())
    try:
        script = db.query(DramaScript).filter(
            DramaScript.id == script_id,
            DramaScript.user_id == uid,
            DramaScript.project_id == pid,
            DramaScript.is_deleted == "N",
        ).first()
        user = db.query(User).filter(User.id == uid).first()
        source = _resolve_text_source(db, user)
    finally:
        db.close()

    if not script:
        return {"ok": False, "error": "剧本不存在"}
    if not source:
        return {"ok": False, "error": "未配置文本模型（TEXT_MODEL）"}
    if not (script.content or "").strip():
        return {"ok": False, "error": "剧本内容为空"}

    model = (source.extra_body or {}).get("model") or source.model_version
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": STORYBOARD_GENERATION_PROMPT},
            {"role": "user", "content": script.content[:12000]},
        ],
    }
    resp = await call_upstream(source, body, user_id=user_id)
    text = ""
    if isinstance(resp, dict):
        choices = resp.get("choices") or []
        if choices:
            text = (choices[0].get("message") or {}).get("content") or ""

    shots = _extract_json_array(text)
    if not shots:
        return {"ok": False, "error": "模型未返回有效的分镜 JSON", "raw": text[:300]}

    db = next(get_db())
    try:
        created = 0
        for i, shot in enumerate(shots):
            if not isinstance(shot, dict):
                continue
            index = int(shot.get("index", i))
            duration = int(shot.get("duration", 5) or 5)
            duration = max(1, min(60, duration))
            sb = DramaStoryboard(
                user_id=uid,
                project_id=pid,
                script_id=UUID(script_id),
                index=index,
                prompt=shot.get("prompt") or "",
                video_desc=shot.get("video_desc") or "",
                duration=duration,
            )
            db.add(sb)
            created += 1
        db.commit()
        return {"ok": True, "count": created}
    finally:
        db.close()


