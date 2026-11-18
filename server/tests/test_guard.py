"""Rate limit and the refusal shape."""

from __future__ import annotations

import pytest

from app.core import guard
from app.core.config import config


@pytest.mark.asyncio
async def test_rate_limit_after_the_window_fills() -> None:
    limit = config.rate_limit_per_10_min
    for _ in range(limit):
        assert await guard.admit("visitor-a", "how a lever works") is None
    refusal = await guard.admit("visitor-a", "how a lever works")
    assert refusal is not None
    assert refusal["status"] == 429
    assert refusal["reason"] == "rate"
    assert "min" in refusal["error"]
