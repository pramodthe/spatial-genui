"""write -> gate -> repair, then look-and-fix when the headset sends pictures.

Classic mode matches apps/gate/src/agent.ts. `mode="agent"` is the Deep Agent coder.
"""

from __future__ import annotations

import contextvars
import json
import random
import re
import time
from datetime import datetime, timezone
from typing import Any, Literal
from urllib.parse import urlparse

from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph
from typing_extensions import TypedDict

from app import assets, config as config_mod
from app import gate, library, llm, router
from app.agents.coder import write_with_agent
from app.llm import LlmTarget
from app.prompt import GAME_SYSTEM_PROMPT, REVIEW_MESSAGE, SYSTEM_PROMPT, repair_message

HAND_MADE_PANEL = (
    "The module calls ui() with its own markup. Build every panel with kit.panel(ui, { title, items: [...] }) "
    "from the parts listed under \"Panels\" (text, note, stat, status, progress, buttons, choices, segmented, "
    "list, toggle, slider) and change them with panel.set(id, value); do not write markup, CSS or panel.on()."
)
_FENCE = re.compile(r"```(?:js|javascript|ts|typescript)?\s*\n([\s\S]*?)```")
_checkpointer: Any = None
# The active model for this task. Kept off the checkpoint so an API key is not written to disk.
_active_target: contextvars.ContextVar[LlmTarget | None] = contextvars.ContextVar("lesson_target", default=None)


class LessonState(TypedDict, total=False):
    request: str
    kind: str
    mode: str
    previous_code: str | None
    client_error: str | None
    pictures: list[str]
    given_assets: list[str] | None
    on_demand: bool
    use_library: bool
    log: bool
    messages: list[dict[str, Any]]
    attempts: list[dict[str, Any]]
    code: str | None
    ok: bool
    error: str | None
    stats: dict[str, Any] | None
    warnings: list[str] | None
    kept: bool
    critique: str | None
    refused: bool
    route: dict[str, Any] | None
    pending_assets: list[dict[str, str]] | None
    run_id: str
    model: str
    provider: str
    started: float
    total_ms: int
    target: dict[str, Any]


def set_checkpointer(saver: Any) -> None:
    global _checkpointer
    _checkpointer = saver


def get_checkpointer() -> Any:
    return _checkpointer


def extract_code(reply: str) -> str | None:
    fence = _FENCE.search(reply)
    if fence:
        return fence.group(1).strip()
    if re.search(r"export\s+default", reply):
        return reply.strip()
    return None


def _new_id() -> str:
    now = datetime.now(timezone.utc)
    stamp = now.strftime("%Y-%m-%dT%H-%M-%S-") + f"{now.microsecond // 1000:03d}Z"
    suffix = "".join(random.choice("0123456789abcdefghijklmnopqrstuvwxyz") for _ in range(4))
    return f"{stamp}-{suffix}"


def _target_from(state: LessonState) -> LlmTarget:
    active = _active_target.get()
    if active is not None:
        return active
    raw = state.get("target") or {}
    if raw.get("id") and raw["id"] != config_mod.config.model:
        try:
            return llm.load_model(raw["id"])
        except Exception:
            return llm.default_target()
    return llm.default_target()


def _public_target(target: LlmTarget) -> dict[str, Any]:
    return {"id": target.id, "base_url": target.base_url, "model": target.model, "max_tokens_param": target.max_tokens_param}


def _progress(message: str) -> None:
    try:
        get_stream_writer()({"version": "v2", "type": "progress", "message": message})
    except Exception:
        return


def _system(state: LessonState) -> str:
    if state.get("kind") == "game":
        return GAME_SYSTEM_PROMPT
    if state.get("use_library"):
        if state.get("given_assets") is not None:
            ids = state.get("given_assets") or []
        else:
            ids = (state.get("route") or {}).get("assets") or []
        return SYSTEM_PROMPT + library.library_section(ids)
    return SYSTEM_PROMPT


async def _route(state: LessonState) -> dict[str, Any] | None:
    if not state.get("use_library") or state.get("previous_code") or state.get("given_assets") is not None:
        return None
    routed = await router.route_assets(state["request"], _target_from(state), want_objects=bool(state.get("on_demand")))
    if state.get("on_demand") and routed.get("wanted"):
        pending: list[dict[str, str]] = []
        for wanted in routed["wanted"]:
            job = assets.start_asset_job(wanted)
            if job["status"] == "done" and job.get("assetId") and job["assetId"] in library.library_catalog():
                routed["assets"].append(job["assetId"])
            elif job["status"] != "failed":
                pending.append({"jobId": job["id"], "name": job["name"]})
        if pending:
            routed = {**routed, "_pending": pending}
    return routed


def _base(state: LessonState, target: LlmTarget) -> LessonState:
    return {
        "run_id": state.get("run_id") or _new_id(),
        "model": target.id,
        "provider": urlparse(target.base_url).netloc,
        "started": state.get("started") or time.time(),
        "attempts": [],
        "ok": False,
        "target": _public_target(target),
    }


async def prepare(state: LessonState) -> dict[str, Any]:
    target = _target_from(state) if state.get("target") else llm.default_target()
    routed = await _route(state)
    pending = None
    if routed and routed.get("_pending"):
        pending = routed["_pending"]
        routed = {key: value for key, value in routed.items() if key != "_pending"}
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": _system({**state, "route": routed})},
        {"role": "user", "content": state["request"]},
    ]
    if state.get("previous_code") and state.get("client_error"):
        messages.append({"role": "assistant", "content": "```js\n" + state["previous_code"] + "\n```"})
        messages.append({"role": "user", "content": repair_message(f"In the headset runtime: {state['client_error']}")})
    update: dict[str, Any] = {**_base(state, target), "messages": messages, "route": routed}
    if pending:
        update["pending_assets"] = pending
    return update


async def look_and_fix(state: LessonState) -> dict[str, Any]:
    """One revision from headset pictures. The pictures stay on this turn only."""
    target = _target_from(state)
    pictures = state.get("pictures") or []
    content: list[dict[str, Any]] = [{"type": "text", "text": REVIEW_MESSAGE}]
    content.extend({"type": "image_url", "image_url": {"url": url}} for url in pictures)
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": _system(state)},
        {"role": "user", "content": state["request"]},
        {"role": "assistant", "content": "```js\n" + (state.get("previous_code") or "") + "\n```"},
        {"role": "user", "content": content},
    ]
    update: dict[str, Any] = {**_base(state, target), "messages": messages}
    _progress("look and fix")
    if state.get("mode") != "agent":
        return update
    # The reviewer is this node, not a subagent. Pictures stay on this turn.
    reply = await llm.complete(messages, target)
    update["critique"] = reply.text.split("```")[0].strip()[:2000]
    if re.match(r"^\s*LOOKS GOOD\b", reply.text) and state.get("previous_code"):
        update.update(ok=True, kept=True, code=state["previous_code"])
        _progress("looks good")
    return update


async def write(state: LessonState) -> dict[str, Any]:
    if state.get("kept"):
        return {}
    if state.get("mode") == "agent":
        return await write_with_agent(state)
    reply = await llm.complete(state["messages"], _target_from(state))
    attempt: dict[str, Any] = {
        "ms": reply.ms,
        "promptTokens": reply.prompt_tokens,
        "completionTokens": reply.completion_tokens,
        "finishReason": reply.finish_reason,
        "stage": "ok",
    }
    messages = [*state["messages"], {"role": "assistant", "content": reply.text}]
    update: dict[str, Any] = {"messages": messages, "attempts": [*state.get("attempts", []), attempt]}
    first = len(state.get("attempts") or []) == 0
    if first and state.get("pictures") and re.match(r"^\s*LOOKS GOOD\b", reply.text) and state.get("previous_code"):
        update.update(ok=True, kept=True, code=state["previous_code"])
        _progress("looks good")
        return update
    if first and state.get("pictures"):
        update["critique"] = reply.text.split("```")[0].strip()[:2000]
    code = extract_code(reply.text)
    if not code:
        attempt["stage"] = "no-code"
        attempt["error"] = (
            "The reply was cut off before the code block finished. Write a shorter module."
            if reply.finish_reason == "length"
            else "No ```js code block found in the reply."
        )
        update["code"] = None
        return update
    update["code"] = code
    _progress("wrote module")
    return update


def _after_write(state: LessonState) -> Literal["gate", "repair", "done"]:
    if state.get("refused"):
        return "done"
    if state.get("kept") or state.get("ok"):
        return "done"
    if state.get("code"):
        return "gate"
    if len(state.get("attempts") or []) > config_mod.config.max_repairs:
        return "done"
    return "repair"


async def gate_node(state: LessonState) -> dict[str, Any]:
    known = list(library.library_catalog()) if state.get("use_library") else []
    result = await gate.check_module(state.get("code") or "", known)
    attempt = dict(state["attempts"][-1])
    attempts = [*state["attempts"][:-1], attempt]
    if result.get("ok") and (result.get("stats") or {}).get("rawPanels", 0) > 0:
        result = {"ok": False, "stage": "dry-run", "error": HAND_MADE_PANEL}
    if not result.get("ok"):
        attempt["stage"] = result.get("stage") or "dry-run"
        attempt["error"] = result.get("error") or ""
        _progress(f"repair {len(attempts) - 1}" if len(attempts) > 1 else "gate failed")
        return {"attempts": attempts, "ok": False}
    _progress("gate passed")
    return {"attempts": attempts, "ok": True, "stats": result.get("stats"), "warnings": result.get("warnings") or []}


def _after_gate(state: LessonState) -> Literal["repair", "done"]:
    if state.get("ok"):
        return "done"
    if len(state.get("attempts") or []) > config_mod.config.max_repairs:
        return "done"
    return "repair"


async def repair(state: LessonState) -> dict[str, Any]:
    error = (state.get("attempts") or [{}])[-1].get("error") or ""
    messages = [*state["messages"], {"role": "user", "content": repair_message(error)}]
    return {"messages": messages, "ok": False}


async def done(state: LessonState) -> dict[str, Any]:
    # Wall-clock seconds, so a run resumed after a restart still measures from its own start.
    total = round((time.time() - state.get("started", time.time())) * 1000)
    update: dict[str, Any] = {"total_ms": total}
    if not state.get("ok"):
        update["error"] = (state.get("attempts") or [{}])[-1].get("error") or "Generation failed."
    if state.get("log", True):
        await _log({**state, **update})
    return update


def _builder() -> StateGraph:
    graph = StateGraph(LessonState)
    graph.add_node("prepare", prepare)
    graph.add_node("look_and_fix", look_and_fix)
    graph.add_node("write", write)
    graph.add_node("gate", gate_node)
    graph.add_node("repair", repair)
    graph.add_node("done", done)
    # As agent.ts: look-and-fix needs the previous code, and a runtime error from the headset takes priority.
    graph.add_conditional_edges(
        START,
        lambda state: "look_and_fix"
        if state.get("pictures") and state.get("previous_code") and not state.get("client_error")
        else "prepare",
    )
    graph.add_edge("prepare", "write")
    graph.add_edge("look_and_fix", "write")
    graph.add_conditional_edges("write", _after_write)
    graph.add_conditional_edges("gate", _after_gate)
    graph.add_edge("repair", "write")
    graph.add_edge("done", END)
    return graph


def compiled():
    return _builder().compile(checkpointer=_checkpointer)


def result_of(state: LessonState) -> dict[str, Any]:
    """The generate() JSON object, with the same keys the TypeScript server sends."""
    result: dict[str, Any] = {
        "id": state.get("run_id"),
        "ok": bool(state.get("ok")),
        "prompt": state.get("request"),
        "model": state.get("model"),
        "provider": state.get("provider"),
        "format": "code",
        "attempts": state.get("attempts") or [],
        "totalMs": state.get("total_ms") or 0,
    }
    if state.get("code") is not None:
        result["code"] = state["code"]
    if state.get("stats") is not None:
        result["stats"] = state["stats"]
    if state.get("warnings") is not None:
        result["warnings"] = state["warnings"]
    if state.get("error"):
        result["error"] = state["error"]
    if state.get("route") is not None:
        result["route"] = state["route"]
    if state.get("pending_assets"):
        result["pendingAssets"] = state["pending_assets"]
    if state.get("kept"):
        result["kept"] = True
    if state.get("critique"):
        result["critique"] = state["critique"]
    if state.get("refused"):
        result["refused"] = True
    return result


async def _log(state: LessonState) -> None:
    try:
        folder = config_mod.config.runs_dir
        folder.mkdir(parents=True, exist_ok=True)
        run_id = state.get("run_id") or "run"
        path = folder / f"{run_id[:10]}.jsonl"
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(result_of(state), ensure_ascii=False) + "\n")
    except Exception as exc:
        print(f"Could not log the run: {exc}")


async def run_lesson(
    request: str,
    *,
    kind: str = "lesson",
    previous_code: str | None = None,
    client_error: str | None = None,
    pictures: list[str] | None = None,
    assets: list[str] | None = None,
    on_demand: bool = False,
    use_library: bool | None = None,
    log: bool = True,
    mode: str = "classic",
    target: LlmTarget | None = None,
    thread_id: str | None = None,
) -> dict[str, Any]:
    chosen = target or llm.default_target()
    game = kind == "game"
    library_on = (True if use_library is None else use_library) and not game
    state: LessonState = {
        "request": request,
        "kind": "game" if game else "lesson",
        "mode": mode,
        "previous_code": previous_code,
        "client_error": client_error,
        "pictures": pictures or [],
        "given_assets": assets,
        "on_demand": on_demand,
        "use_library": library_on,
        "log": log,
        "target": _public_target(chosen),
        # A new run on a thread that ran before (a course lesson written again) starts clean: the checkpoint
        # merges this input into the old state, so every per-run field is set here, not left from last time.
        "run_id": _new_id(),
        "started": time.time(),
        "messages": [],
        "attempts": [],
        "code": None,
        "ok": False,
        "error": None,
        "stats": None,
        "warnings": None,
        "kept": False,
        "critique": None,
        "refused": False,
        "route": None,
        "pending_assets": None,
        "total_ms": 0,
    }
    graph = compiled()
    config = {"configurable": {"thread_id": thread_id or _new_id()}}
    token = _active_target.set(chosen)
    try:
        if _checkpointer is not None and thread_id:
            snapshot = await graph.aget_state(config)
            if snapshot is not None and getattr(snapshot, "next", None):
                final = await graph.ainvoke(None, config)
                return result_of(final)
        final = await graph.ainvoke(state, config)
        return result_of(final)
    finally:
        _active_target.reset(token)
