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
# Dollars this attempt has spent on model calls, from every cost meter (the coder, its grader and the model-maker),
# cached input at its cached price: {"usd": 0.42}, one dict per attempt, changed in place by the meters. The daily
# budget is charged from it (guard.record_spend).
spent: ContextVar[dict[str, float] | None] = ContextVar("spent", default=None)
