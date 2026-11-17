"""Design a game, then hand the brief to the writer. Each stage stays in the checkpoint.

One call designs it (plan): the rules, the one idea it teaches, and where it plays (on the desk or as a world around
the player). The whole run is one Studio record (app/studio.py). The plan is also drawn as two reference pictures for
the coder (not for the game): the first view and a sheet of the main thing (PLAN_PICTURES=0 turns them off).
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any

from langgraph.graph import END, START, StateGraph
from typing_extensions import TypedDict

from app import llm, media
from app.a2ui.catalog import extract_json
from app.graphs.lesson import _new_id, get_checkpointer, run_lesson
from app.guard import record_spend
from app.llm import default_target
from app.studio import StudioRun

DESIGN_PROMPT = """You design one mixed-reality learning game that is played with the player's hands, before any code is written. Every game here teaches one real idea by playing it: find the idea under the request (a sailing game: how wind pushes a sail; a racing game: speed, grip and turning) and make the rules depend on it, so playing well means understanding it. Players are from about 9 years old to adults.

Keep it simple enough to understand in five seconds without reading: the whole game in one sentence of about 15 words; ONE main action with one hand (cut, throw, fold, pour, push, stack, steer), the other hand free; at most two controls; no modes, bonus allowances or combos. Use a familiar real action, and when the idea is invisible (sound, heat, a force), make it something you can see too. Depth comes from harder versions of the same action, not from more rules.

Make it original: never use the name, characters or look of an existing game, film or brand, even when the request names one; a request that names a game gets an original game of that kind, with its own name.

Choose where it plays. "desk": a toy-sized game on the player's real desk, in mixed reality; the default, and right for most ideas you learn by hand. "world": a place the player stands in and walks around (a riverbank, a campsite, a race track, the inside of a cell); choose it when the request asks for a place, a ride, being inside something, or something too big for a desk.

Reply with only this JSON:
{"title": "2 to 4 words, original", "pitch": "the whole game in one sentence of about 15 words", "idea": "the one idea, as a sentence a player could repeat", "mode": "desk or world", "rules": "how a turn works", "controls": "what each hand does", "learn": "the moves the player learns first, each with why it matters", "scoring": "how points are earned, and why that depends on the idea", "win": "how the game is won", "lose": "how it ends (never before Start)", "difficulty": "what gets harder"}"""

DESIGN_KEYS = ("title", "pitch", "idea", "mode", "rules", "controls", "learn", "scoring", "win", "lose", "difficulty")

LOOKS = ("voxel", "soft-clay", "low-poly", "ink-toon", "painted", "paper-pop-up", "exploded-view", "circuit-city", "plain")

PICTURES_PROMPT = """You draw the plan of a mixed-reality learning game before it is built: two reference pictures for the builder, who models the game in simple 3D from them and compares what it built with them. They are never shown in the game.

From the request and the design, reply with only this JSON:
{"look": "one of: voxel, soft-clay, low-poly, ink-toon, painted, paper-pop-up, exploded-view, circuit-city, plain (the one the request names, else the one that fits)", "first_view": "a picture prompt", "hero": "a picture prompt"}

first_view: what the player sees the moment the game opens. For a desk game: the game standing on a real wooden desk in a bright room, seen from a seated player's eyes about half a metre away, the whole game in view. For a world: seen from a standing player's eyes where they start, the first thing to do one to two metres ahead at waist height and only hand-sized (small in the picture, below eye level), the place spreading out beyond it, open sky. Show only the game's own things at their real sizes, the thing to touch first clear but not filling the view, as a 3D render in the look. No text, no labels, no menus, no people, no hands.
hero: a reference sheet of the main thing the player handles or watches: front view, side view and top view side by side, the same size, on a plain white background, as a simple 3D model built from basic shapes in the look, in its colours. No text, no labels, no shadows.
Each prompt at most 80 words, naming the look's style (for example "chunky voxel cubes", "smooth soft clay", "flat-shaded low-poly facets", "ink outlines with flat toon colours")."""

PICTURE_SIZES = {"first-view": "1280x720", "hero": "1280x720"}


class GameState(TypedDict, total=False):
    request: str
    run_id: str
    brief: str
    design: dict[str, Any] | None
    # PLAN_PICTURES: the plan's reference pictures for the coder ([{name, file, prompt, id}]) and the look they use.
    plan_pictures: list[dict[str, Any]] | None
    result: dict[str, Any]


def _brief(request: str, design: dict[str, Any] | None) -> str:
    if not design:
        return request
    brief = f"{request}\n\nDesign (follow this; do not change the rules):\n{json.dumps(design, ensure_ascii=False)}"
    if design.get("mode") == "world":
        brief += ("\n\nMode: world. This game is a place the player stands in and walks around: start the module with "
                  "new-game.mjs <look> /work/module.js --world and read the learning-game skill's references/world.md.")
    return brief


async def plan(state: GameState) -> dict[str, Any]:
    """The default design: one call, as on Nov 16 (side by side, the best games), plus where it plays."""
    request = state["request"]
    try:
        target = llm.default_target()
        reply = await llm.complete([{"role": "system", "content": DESIGN_PROMPT}, {"role": "user", "content": request}], target)
        await record_spend([{"model": target.id, "promptTokens": reply.prompt_tokens, "completionTokens": reply.completion_tokens}])
        parsed = extract_json(reply.text)
    except Exception:
        parsed = None
    if isinstance(parsed, dict) and isinstance(parsed.get("rules"), str) and parsed["rules"].strip():
        kept = {key: parsed[key] for key in DESIGN_KEYS if key in parsed}
        if kept.get("mode") not in ("desk", "world"):
            kept["mode"] = "desk"
    else:
        kept = None
    run_id = state.get("run_id") or _new_id()
    studio = _studio({**state, "run_id": run_id})
    if studio is not None and kept:
        studio.save("design.json", json.dumps(kept, ensure_ascii=False, indent=1).encode())
        studio.event("designer", f"design ({kept['mode']})", f"{kept.get('title', '')}: {kept.get('pitch', '')}", file="design.json")
    pictures = await plan_pictures(request, kept, run_id, studio) if kept and pictures_enabled() else None
    return {"design": kept, "brief": _brief(request, kept), "run_id": run_id, "plan_pictures": pictures}


def pictures_enabled() -> bool:
    """The plan's reference pictures (needs the media provider). Side by side (Nov 17, four games) the games built
    from them followed their plan and came out cleaner in three; PLAN_PICTURES=0 turns them off."""
    return os.environ.get("PLAN_PICTURES", "1") != "0" and media.enabled()


async def plan_pictures(request: str, design: dict[str, Any], run_id: str, studio: StudioRun | None) -> list[dict[str, Any]] | None:
    """Two reference pictures of the design for the coder: what the player sees first, and the main thing from the
    front, side and top. One small call writes the prompts (and picks the look), then both are drawn at once."""
    try:
        target = llm.default_target()
        reply = await llm.complete([
            {"role": "system", "content": PICTURES_PROMPT},
            {"role": "user", "content": f"Request: {request}\n\nDesign: {json.dumps(design, ensure_ascii=False)}"},
        ], target)
        await record_spend([{"model": target.id, "promptTokens": reply.prompt_tokens, "completionTokens": reply.completion_tokens}])
        asked = extract_json(reply.text)
    except Exception:
        return None
    if not isinstance(asked, dict):
        return None
    look = asked.get("look") if asked.get("look") in LOOKS else "plain"
    prompts = {name: str(asked.get(key) or "").strip() for name, key in (("first-view", "first_view"), ("hero", "hero"))}

    async def draw(name: str, prompt: str) -> dict[str, Any] | None:
        if not prompt:
            return None
        try:
            record = await media.make_image(prompt, run_id=run_id, size=PICTURE_SIZES[name])
        except Exception:
            try:
                record = await media.make_image(prompt, run_id=run_id)
            except Exception:
                return None
        return {"name": name, "id": record["id"], "file": record["file"], "prompt": prompt, "look": look}

    drawn = [p for p in await asyncio.gather(*(draw(n, t) for n, t in prompts.items())) if p]
    if studio is not None and drawn:
        studio.event("designer", "plan pictures", f"{look}: " + ", ".join(p["name"] for p in drawn))
    return drawn or None


def _studio(state: GameState) -> StudioRun | None:
    try:
        return StudioRun(state["run_id"], state["request"], "game", default_target().model, status="designing")
    except Exception:
        return None  # the Studio is a record; planning never fails for it


async def write(state: GameState) -> dict[str, Any]:
    # A learning game needs the skills only the agent writer has; GAME_MODE=classic keeps the one-call writer.
    mode = "classic" if os.environ.get("GAME_MODE") == "classic" else "agent"
    request = state.get("brief") or state["request"]
    result = await run_lesson(request, kind="game", mode=mode, thread_id=None, run_id=state.get("run_id"),
                              plan_pictures=state.get("plan_pictures"))
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

