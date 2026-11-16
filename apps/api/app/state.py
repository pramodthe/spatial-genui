"""Run context and coder state. The context reaches subagents; the state stays on the graph."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, NotRequired

from deepagents.graph import DeepAgentState


@dataclass
class RunContext:
    visitor_id: str
    run_id: str
    kind: str
    budget_usd: float


class CoderState(DeepAgentState):
    """DeepAgentState plus the run's attempts, gate stats, cost and skill stamp."""

    attempts: NotRequired[list[dict[str, Any]]]
    stats: NotRequired[dict[str, Any]]
    cost_usd: NotRequired[float]
    model_maker_cost_usd: NotRequired[float]
    skills_fingerprint: NotRequired[str]
