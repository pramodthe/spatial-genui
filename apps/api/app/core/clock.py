"""Timestamps in the shape `new Date().toISOString()` produces."""

from __future__ import annotations

import math
from datetime import datetime, timezone
from pathlib import Path


def now_iso() -> str:
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def js_round(value: float) -> int:
    """Math.round: ties go toward +infinity."""
    return int(math.floor(value + 0.5))


def mtime_ms(path: str | object) -> int:
    ns = Path(str(path)).stat().st_mtime_ns
    return (ns + 500_000) // 1_000_000
