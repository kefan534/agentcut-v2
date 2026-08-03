"""
Stop route for the AgentCut agent.

EdgeOne Makers convention: agents/agentcut/stop.py → POST /agentcut/stop
When this endpoint is called, Makers sets the `signal` event on the
matching /agentcut request context, causing the stream to break.
"""

from typing import Any


async def handler(context: Any) -> dict:
    return {"ok": True, "message": "Stop signal sent"}
