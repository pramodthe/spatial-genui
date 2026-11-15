"""Per-run cost cap. The running total is `cost_usd` on the agent state, not on this instance.
The stop is a jump to the end, the same way the model-call limit stops.
"""

from __future__ import annotations

from typing import Any

from langchain.agents.middleware.types import AgentMiddleware, hook_config
from langchain_core.messages import AIMessage

from app.llm import model_prices

# Unknown models use the same stand-in prices as the daily budget.
_FALLBACK_IN = 3.0
_FALLBACK_OUT = 15.0


def _prices(model_id: str) -> tuple[float, float]:
    entry = model_prices().get(model_id) or {}
    return float(entry.get("priceIn") or _FALLBACK_IN), float(entry.get("priceOut") or _FALLBACK_OUT)


class CostMeterMiddleware(AgentMiddleware):
    """Stops the run once this run's token cost reaches the budget."""

    def __init__(self, budget_usd: float, model_id: str, key: str = "cost_usd") -> None:
        super().__init__()
        self.budget_usd = budget_usd
        self.model_id = model_id
        # The state key holding this agent's running total. A subagent starts from the parent's state values,
        # so it keeps its own key (or it would stop as soon as the parent had spent its budget).
        self.key = key

    @hook_config(can_jump_to=["end"])
    def after_model(self, state: dict[str, Any], runtime: Any) -> dict[str, Any] | None:
        messages = state.get("messages") or []
        if not messages:
            return None
        last = messages[-1]
        usage = getattr(last, "usage_metadata", None) or {}
        price_in, price_out = _prices(self.model_id)
        prompt = int(usage.get("input_tokens") or 0)
        completion = int(usage.get("output_tokens") or 0)
        spent = float(state.get(self.key) or 0) + (prompt * price_in + completion * price_out) / 1e6
        if spent < self.budget_usd:
            return {self.key: spent}
        note = AIMessage(content=f"Stopped: this run reached its ${self.budget_usd:.2f} budget.")
        return {"jump_to": "end", "messages": [note], self.key: spent}
