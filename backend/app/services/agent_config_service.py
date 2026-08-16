"""Agent configuration service.

Per-scope tunables for the in-process agents (global chat agent + short-drama
script agent). Reads from ``agent_config`` with hard-coded defaults as fallback
so agents keep working with an empty table.
"""
from typing import Any, Dict

from sqlalchemy.orm import Session

from app.models.agent_config import AgentConfig

# 默认配置（未配置时兜底，与历史硬编码值保持一致）
DEFAULT_AGENT_CONFIGS: Dict[str, Dict[str, Any]] = {
    "global": {
        "system_prompt": (
            "你是 AgentCut 的智能助手，帮助用户完成 AI 创作（生图、生视频、剪辑、短剧）等任务。\n"
            "你可以调用工具查询用户积分、检索素材、搜索知识库、查看已启用技能。\n"
            "回答使用中文，简洁准确；不确定时如实说明。"
        ),
        "model_variable": None,   # None = 走默认文本模型解析（_resolve_text_source）
        "enabled_tools": None,    # None = 全部内置工具
        "max_steps": 16,
        "tool_timeout_sec": 30,
    },
    "script_agent": {
        "system_prompt": (
            "你是一名专业的短剧编剧（剧本智能体），帮助用户把小说改编成短剧剧本。\n"
            "你可以读取项目内的小说章节原文、已有剧本，并把生成的剧本保存到项目中。\n"
            "工作方式：先读取小说章节理解剧情，再构思故事骨架与改编策略，最后写出分场剧本（含场景、角色、对白、镜头说明）。\n"
            "剧本格式建议：用【场景】标注场景，用「角色名」标注对白，必要时附镜头说明。\n"
            "回答使用中文，专业、简洁。"
        ),
        "model_variable": None,
        "enabled_tools": None,
        "max_steps": 16,
        "tool_timeout_sec": 30,
    },
}

AGENT_SCOPES = list(DEFAULT_AGENT_CONFIGS.keys())


def get_agent_config(db: Session, scope: str) -> Dict[str, Any]:
    """Return the effective config for ``scope``, overlaying DB values on defaults."""
    defaults = DEFAULT_AGENT_CONFIGS.get(scope) or {}
    result = dict(defaults)
    row = db.query(AgentConfig).filter(AgentConfig.scope == scope).first()
    if row:
        for field in ("system_prompt", "model_variable", "enabled_tools", "max_steps", "tool_timeout_sec"):
            val = getattr(row, field)
            if val is not None:
                result[field] = val
    return result
