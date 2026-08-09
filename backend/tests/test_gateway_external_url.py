"""Tests for gateway external URL persistence fallback."""
from pathlib import Path

import pytest

from app.api.gateway.router import _persist_external_url


@pytest.mark.asyncio
async def test_persist_external_url_returns_none_for_unreachable_url():
    # Use a URL that will fail to download
    result = await _persist_external_url("http://localhost:1/fake.png", Path("/tmp"), "user-1", "image")
    assert result is None
