"""P1: 腾讯 ima 知识库 OpenAPI 搜索服务。

真实端点（来自 ima-skills-1.1.9.zip 中的 ima_api.cjs + SKILL.md）：
- base: https://ima.qq.com
- path: openapi/wiki/v1/search_knowledge_base （跨知识库搜索）
- headers: ima-openapi-clientid / ima-openapi-apikey / ima-openapi-ctx
- body: {"query": "...", "cursor": "", "limit": 20}

PRD v1.5 §3.3：管理员预配置共享知识库，普通用户透明使用。
"""
import httpx
from typing import Any, Dict

from app.core.config import settings

IMA_BASE_URL = "https://ima.qq.com"


def search(query: str, top_k: int = 5, user_id: str = "") -> Dict[str, Any]:
    """检索 ima 平台共享知识库。

    使用 search_knowledge_base 跨知识库检索，无需预先绑定具体 kb_id。
    """
    api_key = settings.IMA_API_KEY or ""
    client_id = settings.IMA_CLIENT_ID or ""
    if not api_key or not client_id:
        return {"ok": False, "error": "IMA credentials not configured"}

    top_k = min(max(1, top_k), 20)
    headers = {
        "Content-Type": "application/json",
        "ima-openapi-clientid": client_id,
        "ima-openapi-apikey": api_key,
        "ima-openapi-ctx": "skill_version=1.1.9",
    }
    body = {"query": query, "cursor": "", "limit": top_k}
    url = f"{IMA_BASE_URL}/openapi/wiki/v1/search_knowledge_base"

    try:
        with httpx.Client(timeout=15.0, follow_redirects=False) as client:
            resp = client.post(url, headers=headers, json=body)
            if resp.status_code >= 400:
                return {"ok": False, "error": f"ima HTTP {resp.status_code}: {resp.text[:200]}"}
            data = resp.json()

        # 响应结构（基于 ima_api.cjs + SKILL.md）：
        # {"code": 0, "msg": "...", "data": {"knowledge_base_list": [...], "next_cursor": "..."}}
        # 或者 search_knowledge 返回 {"data": {"knowledge_list": [...]}}
        if data.get("code") not in (0, None):
            return {"ok": False, "error": f"ima API code={data.get('code')} msg={data.get('msg')}"}

        payload = data.get("data") or {}
        # 兼容两种搜索端点的返回字段
        items = payload.get("knowledge_base_list") or payload.get("knowledge_list") or payload.get("list") or []
        results = []
        for item in items:
            results.append({
                "title": item.get("name") or item.get("title") or "",
                "content": item.get("summary") or item.get("content") or item.get("description") or item.get("snippet") or "",
                "source": item.get("knowledge_base_id") or item.get("id") or item.get("url") or "",
                "score": item.get("score") or item.get("relevance") or 0,
            })

        return {"ok": True, "results": results[:top_k], "query": query, "next_cursor": payload.get("next_cursor", "")}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"ima API error: {exc}"}
