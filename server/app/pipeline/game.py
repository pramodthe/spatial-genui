"""A game: design (design.py: the design document, design.md; DESIGN_MODE=json for the earlier JSON design), then
write (lesson.py: the coder agent, the gate, repairs). Each stage stays in the checkpoint, and the whole run is one
Studio record (services/studio.py)."""

from __future__ import annotations

import json
import os
from typing import Any

from langgraph.graph import END, START, StateGraph
from typing_extensions import TypedDict

from app.core.llm import default_target
from app.pipeline import design
from app.pipeline.lesson import _new_id, get_checkpointer, run_lesson
from app.services.studio import StudioRun


class GameState(TypedDict, total=False):
    request: str
    run_id: str
    brief: str
    # The design: a design document ({design_md, mode, look, title, pitch, scene, problems}) or, with
    # DESIGN_MODE=json, the JSON design (DESIGN_KEYS).
    design: dict[str, Any] | None
    # PLAN_PICTURES: the plan's reference pictures for the coder ([{name, file, prompt, id}]) and the look they use.
    plan_pictures: list[dict[str, Any]] | None
    result: dict[str, Any]


def _writer() -> str:
    # A learning game needs the skills only the agent writer has; GAME_MODE=classic keeps the one-call writer.
    return "classic" if os.environ.get("GAME_MODE") == "classic" else "agent"


async def plan(state: GameState) -> dict[str, Any]:
    """Stage 1 (design.py), kept in the Studio record: the design document, where the game plays, and its reference
    pictures. When the document cannot be written (the call fails), the earlier JSON design stands in."""
    request = state["request"]
    doc = await design.design_doc(request) if design.design_mode() == "doc" else None
    kept = doc or await design.design(request)
    run_id = state.get("run_id") or _new_id()
    studio = _studio({**state, "run_id": run_id})
    if studio is not None and doc:
        studio.save("design.md", doc["design_md"].encode())
        left = f" Still missing after a second try: {' '.join(doc['problems'])}" if doc["problems"] else ""
        studio.event("designer", f"design ({doc['mode']})", f"{doc['title']}: {doc['pitch']}{left}", file="design.md")
    elif studio is not None and kept:
        studio.save("design.json", json.dumps(kept, ensure_ascii=False, indent=1).encode())
        studio.event("designer", f"design ({kept['mode']})", f"{kept.get('title', '')}: {kept.get('pitch', '')}", file="design.json")
    pictures = await design.plan_pictures(request, kept, run_id, studio) if kept and design.pictures_enabled() else None
    brief = design.doc_brief(request, doc, inline=_writer() == "classic") if doc else design.brief(request, kept)
    return {"design": kept, "brief": brief, "run_id": run_id, "plan_pictures": pictures}


def _studio(state: GameState) -> StudioRun | None:
    try:
        return StudioRun(state["run_id"], state["request"], "game", default_target().model, status="designing")
    except Exception:
        return None  # the Studio is a record; planning never fails for it


async def write(state: GameState) -> dict[str, Any]:
    mode = _writer()
    request = state.get("brief") or state["request"]
    # A design document goes into the coder's sandbox as /work/design.md; the one-call writer has it in its request.
    designed = state.get("design") if (state.get("design") or {}).get("design_md") else None
    result = await run_lesson(request, kind="game", mode=mode, thread_id=None, run_id=state.get("run_id"),
                              plan_pictures=state.get("plan_pictures"), design=designed)
    return {"result": result}


def _graph():
    graph = StateGraph(GameState)
    graph.add_node("plan", plan)
    graph.add_node("write", write)
    graph.add_edge(START, "plan")
    graph.add_edge("plan", "write")
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

