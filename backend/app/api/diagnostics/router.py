import time
from collections import defaultdict, deque
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.model import ApiSource
from app.models.user import User
from app.services.url_safety import is_private_url

router = APIRouter(prefix="/diagnostics", tags=["diagnostics"])

# 简单内存限流：每用户每窗口最多 RATE_LIMIT 次诊断，防滥用（SSRF 已另做防护，此为纵深防御）。
_RATE_LIMIT = 10
_RATE_WINDOW_SECONDS = 60
_recent_calls: dict[str, deque] = defaultdict(deque)


def _check_rate(user_id: str) -> None:
    now = time.time()
    q = _recent_calls[user_id]
    while q and q[0] < now - _RATE_WINDOW_SECONDS:
        q.popleft()
    # R2-#10: 顺带清理空 deque，防止长期运行下每用户条目只增不减（慢内存泄漏）
    if not q:
        _recent_calls.pop(user_id, None)
    else:
        if len(q) >= _RATE_LIMIT:
            raise HTTPException(status_code=429, detail="诊断请求过于频繁，请稍后再试")
        q.append(now)
        return
    _recent_calls.setdefault(user_id, deque()).append(now)



class DiagnosticResult(BaseModel):
    name: str
    url: str
    ok: bool
    status_code: Optional[int] = None
    latency_ms: Optional[int] = None
    error: Optional[str] = None


class NetworkDiagnosticResponse(BaseModel):
    results: List[DiagnosticResult]


async def _probe(name: str, url: str) -> DiagnosticResult:
    """对单个 URL 做连通性探测，记录状态与耗时，绝不回显任何密钥/令牌。

    SSRF 防护：拒绝内网/回环/链路本地（含云元数据 169.254.169.254）地址；
    不跟随重定向（避免经 302 跳转到内网）；启用 TLS 校验。
    """
    if not isinstance(url, str) or not url.lower().startswith(("http://", "https://")):
        return DiagnosticResult(name=name, url=url, ok=False, error="非 HTTP(S) 地址，已跳过")

    if is_private_url(url):
        return DiagnosticResult(name=name, url=url, ok=False, error="内网/私网地址，禁止探测")

    try:
        async with httpx.AsyncClient(timeout=5.0, follow_redirects=False) as client:
            # 仅做探测，不发送/接收任何业务负载，避免泄露信息
            response = await client.head(url)
            latency_ms = int(response.elapsed.total_seconds() * 1000)
            return DiagnosticResult(
                name=name,
                url=url,
                ok=(response.status_code < 500),
                status_code=response.status_code,
                latency_ms=latency_ms,
            )
    except httpx.TimeoutException:
        return DiagnosticResult(name=name, url=url, ok=False, error="连接超时（>5s）")
    except httpx.SSLError as exc:
        return DiagnosticResult(name=name, url=url, ok=False, error=f"SSL 错误: {type(exc).__name__}")
    except httpx.HTTPError as exc:
        return DiagnosticResult(name=name, url=url, ok=False, error=f"HTTP 错误: {type(exc).__name__}")
    except Exception as exc:  # noqa: BLE001 - 任何异常都归为探测失败
        return DiagnosticResult(name=name, url=url, ok=False, error=f"异常: {type(exc).__name__}")


@router.post("/network", response_model=NetworkDiagnosticResponse)
async def diagnose_network(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NetworkDiagnosticResponse:
    """对一组 URL 做连通性探测（按顺序合并、去重）。

    目标来源：
      1) settings.EDGEONE_MAKERS_AGENT_URL（若存在且非空）
      2) 数据库 api_sources 表中所有 distinct 的非空 base_url
    """
    targets: List[tuple[str, str]] = []
    seen: set[str] = set()

    _check_rate(str(current_user.id))

    def _add(name: str, url: str) -> None:
        if not url:
            return
        url = url.strip()
        if not url or url in seen:
            return
        seen.add(url)
        targets.append((name, url))

    # a) EdgeOne Makers Agent
    if getattr(settings, "EDGEONE_MAKERS_AGENT_URL", None):
        _add("EdgeOne Makers Agent", settings.EDGEONE_MAKERS_AGENT_URL)

    # b) 数据库 api_sources 表（Model）中的 distinct 非空 base_url
    rows = (
        db.query(ApiSource.base_url, ApiSource.vendor, ApiSource.model_version)
        .filter(ApiSource.base_url.isnot(None), ApiSource.base_url != "")
        .all()
    )
    for base_url, vendor, model_version in rows:
        name = f"{vendor or 'model'} / {model_version or ''}".strip(" /")
        _add(name, base_url)

    results = await _probe_all(targets)
    return NetworkDiagnosticResponse(results=results)


async def _probe_all(targets: List[tuple[str, str]]) -> List[DiagnosticResult]:
    import asyncio

    # 限制并发，避免目标过多时打爆上游/本机文件描述符
    sem = asyncio.Semaphore(10)

    async def run(item: tuple[str, str]) -> DiagnosticResult:
        async with sem:
            return await _probe(item[0], item[1])

    return list(await asyncio.gather(*(run(t) for t in targets)))
