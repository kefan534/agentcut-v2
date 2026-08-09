"""Tests for app.services.rate_limiter."""
import time

import pytest

from app.services.rate_limiter import _check_user_rate_in_memory, check_user_rate


def test_in_memory_rate_limit_allows_up_to_limit():
    key = "test:in-memory:1"
    for i in range(20):
        assert _check_user_rate_in_memory(key, limit=20, window_sec=60) is True, f"request {i + 1} should be allowed"
    assert _check_user_rate_in_memory(key, limit=20, window_sec=60) is False


def test_in_memory_window_expires_old_events():
    key = "test:in-memory:2"
    assert _check_user_rate_in_memory(key, limit=1, window_sec=1) is True
    assert _check_user_rate_in_memory(key, limit=1, window_sec=1) is False
    time.sleep(1.1)
    assert _check_user_rate_in_memory(key, limit=1, window_sec=1) is True


def test_in_memory_isolated_buckets():
    assert _check_user_rate_in_memory("a", limit=1, window_sec=60) is True
    assert _check_user_rate_in_memory("b", limit=1, window_sec=60) is True


@pytest.mark.skipif(False, reason="postgres path covered by integration suite")
def test_check_user_rate_postgres_within_limit():
    # Smoke test: check_user_rate delegates to postgres path by default.
    key = f"test:postgres:{time.time()}"
    for i in range(20):
        assert check_user_rate(key, limit=20, window_sec=60) is True, f"request {i + 1} should be allowed"
    assert check_user_rate(key, limit=20, window_sec=60) is False
