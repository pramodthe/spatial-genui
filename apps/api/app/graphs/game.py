"""Design a game, then hand the brief to the lesson writer. The design stays in the checkpoint."""

from __future__ import annotations

import json
import os
from typing import Any

from langgraph.graph import END, START, StateGraph
from typing_extensions import TypedDict

from app import llm
from app.a2ui.catalog import extract_json
from app.graphs.lesson import get_checkpointer, run_lesson
from app.guard import record_spend

DESIGN_PROMPT = """You design one mixed-reality learning game that is played on a desk with the player's hands, before any code is written. Every game here teaches one real idea by playing it: find the idea under the request (a sailing game: how wind pushes a sail; a racing game: speed, grip and turning) and make the rules depend on it, so playing well means understanding it. Players are from about 9 years old to adults.

Reply with only this JSON:
{"title": "2 to 4 words", "idea": "the one idea, as a sentence a player could repeat", "rules": "how a turn works", "controls": "what each hand does", "learn": "the moves the player learns first, each with why it matters", "scoring": "how points are earned, and why that depends on the idea", "win": "how the game is won", "lose": "how it ends (never before Start)", "difficulty": "what gets harder"}"""


class GameState(TypedDict, total=False):
    request: str
    design: dict[str, Any] | None
    brief: str
    result: dict[str, Any]


def _brief(request: str, design: dict[str, Any] | None) -> str:
    if not design:
        return request
    return f"{request}\n\nDesign (follow this; do not change the rules):\n{json.dumps(design, ensure_ascii=False)}"


async def design(state: GameState) -> dict[str, Any]:
    request = state["request"]
    try:
        target = llm.default_target()
        reply = await llm.complete(
            [{"role": "system", "content": DESIGN_PROMPT}, {"role": "user", "content": request}],
            target,
        )
        await record_spend([{"model": target.id, "promptTokens": reply.prompt_tokens, "completionTokens": reply.completion_tokens}])
        parsed = extract_json(reply.text)
    except Exception:
        parsed = None
    if isinstance(parsed, dict) and isinstance(parsed.get("rules"), str) and parsed["rules"].strip():
        kept = {key: parsed[key] for key in ("title", "idea", "rules", "controls", "learn", "scoring", "win", "lose", "difficulty") if key in parsed}
        return {"design": kept, "brief": _brief(request, kept)}
    return {"design": None, "brief": request}


async def write(state: GameState) -> dict[str, Any]:
    # A learning game needs the skills only the agent writer has; GAME_MODE=classic keeps the one-call writer.
    mode = "classic" if os.environ.get("GAME_MODE") == "classic" else "agent"
    result = await run_lesson(state.get("brief") or state["request"], kind="game", mode=mode, thread_id=None)
    return {"result": result}


def _graph():
    graph = StateGraph(GameState)
    graph.add_node("design", design)
    graph.add_node("write", write)
    graph.add_edge(START, "design")
    graph.add_edge("design", "write")
    graph.add_edge("write", END)
    return graph.compile(checkpointer=get_checkpointer())


async def run_game(request: str, *, thread_id: str) -> dict[str, Any]:
    graph = _graph()
    config = {"configurable": {"thread_id": thread_id}}
    if get_checkpointer() is not None:
        snapshot = await graph.aget_state(config)
        if snapshot is not None and getattr(snapshot, "next", None):
            final = await graph.ainvoke(None, config)
            return final.get("result") or {"ok": False, "error": "The game could not be written.", "attempts": [], "model": ""}
    final = await graph.ainvoke({"request": request}, config)
    return final.get("result") or {"ok": False, "error": "The game could not be written.", "attempts": [], "model": ""}
