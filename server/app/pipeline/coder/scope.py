"""What the run in progress shares with the host tools its agents call: its id, its Studio record, its sandbox and
what it has generated so far. Context variables, so a tool a subagent calls sees its own run."""

from __future__ import annotations

from contextvars import ContextVar
from typing import Any

run_id: ContextVar[str | None] = ContextVar("run_id", default=None)
studio: ContextVar[Any] = ContextVar("studio", default=None)
backend: ContextVar[Any] = ContextVar("backend", default=None)
# Generated assets so far, by kind ({"image": 2, ...}); one dict per run, changed in place by the tools.
made: ContextVar[dict[str, int] | None] = ContextVar("made", default=None)
