"""Per-run cost cap. The running total is `cost_usd` on the agent state, not on this instance.
The stop is a jump to the end, the same way the model-call limit stops.
"""

from __future__ import annotations

import time
from typing import Any

from langchain.agents.middleware.types import AgentMiddleware, hook_config
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from app.llm import model_prices

# Unknown models use the same stand-in prices as the daily budget.
_FALLBACK_IN = 3.0
_FALLBACK_OUT = 15.0


def _prices(model_id: str) -> tuple[float, float, float]:
    """Input, cached input and output price per million tokens. Without a cached price, cached input pays full price."""
    entry = model_prices().get(model_id) or {}
    price_in = float(entry.get("priceIn") or _FALLBACK_IN)
    return price_in, float(entry.get("priceCached") or price_in), float(entry.get("priceOut") or _FALLBACK_OUT)


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
        price_in, price_cached, price_out = _prices(self.model_id)
        prompt = int(usage.get("input_tokens") or 0)
        # An agent re-sends its whole history every call, so most of its input is a cache read (95% on Sol's runs).
        cached = min(prompt, int((usage.get("input_token_details") or {}).get("cache_read") or 0))
        completion = int(usage.get("output_tokens") or 0)
        cost = (prompt - cached) * price_in + cached * price_cached + completion * price_out
        spent = float(state.get(self.key) or 0) + cost / 1e6
        if spent < self.budget_usd:
            return {self.key: spent}
        # Tool calls the model just asked for will not run: answer each, or the history is invalid (a tool call
        # without its result) and any later model call fails with a 400 (seen when the grading loop resumed it).
        unanswered = [
            ToolMessage(content="Not run: this run reached its budget.", tool_call_id=call["id"], name=call["name"], status="error")
            for call in (getattr(last, "tool_calls", None) or [])
        ]
        note = AIMessage(content=f"Stopped: this run reached its ${self.budget_usd:.2f} budget.")
        return {"jump_to": "end", "messages": [*unanswered, note], self.key: spent}


_IMAGE_BLOCKS = ("image", "image_url")


def _image_blocks(message: Any) -> list[dict[str, Any]]:
    content = getattr(message, "content", None)
    if not isinstance(content, list):
        return []
    return [block for block in content if isinstance(block, dict) and block.get("type") in _IMAGE_BLOCKS]


def move_tool_images(messages: list[Any]) -> list[Any]:
    """Tool results keep their text; their images move into a user message right after that batch of results.

    On Chat Completions an image inside a tool result reached the model as noise (it described a play-test
    screenshot as "multicolored static"); in a user message it saw the game. Deep Agents does the same for video.
    """
    out: list[Any] = []
    pending: list[tuple[str, list[dict[str, Any]]]] = []

    def flush() -> None:
        if not pending:
            return
        blocks: list[dict[str, Any]] = []
        for name, images in pending:
            blocks.append({"type": "text", "text": f"The image{'s' if len(images) > 1 else ''} from {name}:"})
            blocks.extend(images)
        out.append(HumanMessage(content=blocks))
        pending.clear()

    for message in messages:
        if isinstance(message, ToolMessage):
            images = _image_blocks(message)
            if images:
                text = [block for block in message.content if block not in images]
                note = {"type": "text", "text": "The image is attached in the next message."}
                out.append(message.model_copy(update={"content": [*text, note]}))
                pending.append((message.name or "the tool", images))
                continue
            out.append(message)
            continue
        flush()
        out.append(message)
    flush()
    return out


class ToolImagesAsUserMessage(AgentMiddleware):
    """Shows the model the images tools return (play-test screenshots, read_file of a picture) in a user message."""

    def wrap_model_call(self, request: Any, handler: Any) -> Any:
        moved = move_tool_images(list(request.messages))
        return handler(request.override(messages=moved)) if len(moved) != len(request.messages) else handler(request)

    async def awrap_model_call(self, request: Any, handler: Any) -> Any:
        moved = move_tool_images(list(request.messages))
        return await handler(request.override(messages=moved)) if len(moved) != len(request.messages) else await handler(request)


class TimeLeftMiddleware(AgentMiddleware):
    """Tells the agent how much of its wall clock is left once most of it is gone, so it stops building in time for
    the check, the play-test and the grader. The note is added to the request only; nothing is kept in the state."""

    def __init__(self, deadline: float, wall_s: float) -> None:
        self.deadline = deadline
        self.wall_s = wall_s

    def note(self) -> HumanMessage | None:
        left = self.deadline - time.monotonic()
        if left > self.wall_s * 0.4:
            return None
        minutes = max(1, round(left / 60))
        if left < self.wall_s * 0.15:
            text = (f"About {minutes} minute{'s' if minutes != 1 else ''} left. Finish now: the module as it is now is what "
                    "gets judged, so make sure the check prints game ok.")
        else:
            text = (f"About {minutes} minutes are left for this game, play-test and grading included. Stop adding features: "
                    "make sure the check prints game ok, have it play-tested, fix only what would stop a first-time "
                    "player, then finish.")
        return HumanMessage(content=f"[time] {text}")

    def wrap_model_call(self, request: Any, handler: Any) -> Any:
        note = self.note()
        return handler(request.override(messages=[*request.messages, note])) if note else handler(request)

    async def awrap_model_call(self, request: Any, handler: Any) -> Any:
        note = self.note()
        return await handler(request.override(messages=[*request.messages, note])) if note else await handler(request)
