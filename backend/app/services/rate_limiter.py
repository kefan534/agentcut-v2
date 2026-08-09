"""持久化速率限制器（PRD FR-1.7：上传 20 次/分钟，ima_search 20 次/小时）。

优先使用 PostgreSQL 表 `rate_limit_buckets` 记录每个窗口内的请求事件，
进程重启后计数不丢失；若数据库不可用则降级为进程内 deque。
"""
from collections import deque
from threading import Lock
from time import time
from datetime import datetime, timezone

from app.db.session import SessionLocal
from sqlalchemy import text

_buckets: dict = {}
_lock = Lock()


def _check_user_rate_in_memory(key: str, limit: int, window_sec: int) -> bool:
    now = time()
    with _lock:
        bucket = _buckets.setdefault(key, deque())
        while bucket and bucket[0] < now - window_sec:
            bucket.popleft()
        if len(bucket) >= limit:
            return False
        bucket.append(now)
        return True


def _check_user_rate_postgres(key: str, limit: int, window_sec: int) -> bool:
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        window_start = now.replace(microsecond=0)  # 精度到秒即可

        # 1) 清理过期事件
        db.execute(
            text(
                "DELETE FROM rate_limit_buckets "
                "WHERE bucket_key = :key AND event_at < :window_start"
            ),
            {"key": key, "window_start": window_start},
        )

        # 2) 查询当前窗口事件数
        count = db.execute(
            text(
                "SELECT COUNT(*) FROM rate_limit_buckets WHERE bucket_key = :key"
            ),
            {"key": key},
        ).scalar()

        if count is not None and count >= limit:
            db.rollback()
            return False

        # 3) 插入本次事件
        db.execute(
            text(
                "INSERT INTO rate_limit_buckets (bucket_key, event_at) VALUES (:key, :event_at)"
            ),
            {"key": key, "event_at": now},
        )
        db.commit()
        return True
    except Exception:
        db.rollback()
        return _check_user_rate_in_memory(key, limit, window_sec)
    finally:
        db.close()


def check_user_rate(key: str, limit: int, window_sec: int) -> bool:
    """Return True if within limit, False if exceeded."""
    return _check_user_rate_postgres(key, limit, window_sec)
