"""Deep Agent coder. One Modal sandbox per run, network blocked, host gate still decides."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import time
from typing import Any

import modal
from deepagents import create_deep_agent
from deepagents.backends.protocol import FileDownloadResponse
from deepagents.profiles import GeneralPurposeSubagentProfile, HarnessProfile, register_harness_profile
from langchain.agents.middleware import (
    ModelCallLimitMiddleware,
    ModelFallbackMiddleware,
    ModelRetryMiddleware,
    TodoListMiddleware,
    ToolCallLimitMiddleware,
    ToolErrorMiddleware,
)
from langchain.agents.middleware.model_refusal import ModelRefusalError
from langchain_modal import ModalSandbox
from langgraph.config import get_stream_writer

from app import media
from app.agents import rubric, scope
from app.studio import StudioRun
from app.agents.middleware import CostMeterMiddleware, TimeLeftMiddleware, ToolImagesAsUserMessage
from app.agents.model_maker import model_maker_spec
from app.config import REPO_ROOT
from app.llm import agent_model, gpt_chat
from app.state import CoderState, RunContext
from app.tools.host import library_lookup, real_size
from app.tools.media import SOUND_TOOLS
from sandbox.image import coder_image

# Provider key "openai" matches ChatOpenAI (Muse and gpt). This build has no OpenAI prompt suffix
# on that key, so disabling the general-purpose subagent does not add one.
OPENAI_PROFILE = HarnessProfile(
    general_purpose_subagent=GeneralPurposeSubagentProfile(enabled=False),
    excluded_tools=frozenset({"delete"}),
)
register_harness_profile("openai", OPENAI_PROFILE)

MODEL_CALLS = 40
TOOL_CALLS = 80
# A lesson in a look (its skill: new-lesson, build, check) takes 5-8 minutes on gpt-6.1-sol; 8 minutes ran out.
WALL_S = int(os.environ.get("AGENT_WALL_S") or 15 * 60)
SANDBOX_GRACE_S = 180
# Out of time, how long the cancelled agent gets to stop before its module is read.
STOP_WAIT_S = 5
# A play-test (screenshots, hand runs) and a grading round cost more than writing alone; two runs stopped at $2.
# Per attempt. Priced without a cached rate, $3 is about 30 model calls, and the grading round is skipped once it is
# spent (Nov 17: every side-by-side run ended at it); CODER_BUDGET_USD sets it.
RUN_BUDGET_USD = float(os.environ.get("CODER_BUDGET_USD") or 3.0)
APP_NAME = "genui-coder"
# Builds /work/module.js from /work/kits.js and /work/game.js (the learning-game skill), or splits it back with --split.
BUILD_MODULE = "/skills/play/learning-game/scripts/build-module.mjs"
PLAYTEST = "/skills/play/playtest/scripts/playtest.mjs"

# Every lesson and game is a learning game (skills/play/learning-game), so both start with that skill in context.
_LESSON_SKILLS = ["kit", "panels", "learning-game", "dry-run"]
_GAME_SKILLS = ["kit", "panels", "learning-game", "hand-play", "dry-run"]

_HOST_TOOLS = [library_lookup, real_size]

# The lesson graph and the coder share the durable saver. Set from app startup.
_checkpointer: Any = None


def set_checkpointer(saver: Any) -> None:
    global _checkpointer
    _checkpointer = saver


def _progress(message: str) -> None:
    # Duplicated from the lesson graph so this module does not import it (that import is a cycle).
    try:
        get_stream_writer()({"version": "v2", "type": "progress", "message": message})
    except Exception:
        return


def _prompt(kind: str) -> str:
    subject = "game" if kind == "game" else "lesson"
    # No generated pictures in the game: the app opens it with its name as a text title card.
    art = (
        " make_sound only the sounds the sound library lacks; a calm music loop with make_music is optional."
        if media.enabled() else ""
    )
    # Side by side (Nov 17) games written as entities, components and systems were as good and a little faster, and
    # their code says what the game is. CODER_ECS=0 keeps the plain form.
    ecs = (
        " Organise the game as entities, components and systems with the ecs skill (/skills/common/ecs): every game "
        "thing an entity made with game.spawn, its data in components, every behaviour one system, the round an entity "
        "too. The ECS kit (playWorld) is already in the module."
        if os.environ.get("CODER_ECS", "1") != "0" else ""
    )
    return (
        f"You write a mixed-reality {subject} in JavaScript. Everything this app makes is a learning game: follow the "
        "learning-game skill. Start it with `node /skills/play/learning-game/scripts/new-game.mjs <look> /work/module.js` "
        "(the look the request names, else the one that fits the subject, else plain): it writes /work/game.js, the "
        "game's own code and the only file you edit, and /work/kits.js, the kits it uses, all in scope (do not read or "
        "edit kits.js; the APIs are in the skills); the check and the play-test build /work/module.js from the two. "
        "Draw it with that look's skill. Check it with "
        "`node /skills/play/learning-game/scripts/check.mjs /work/module.js` and fix game.js until it prints game ok, "
        "then play-test it (the playtest skill: look at it in the headset app, try its main action) and fix what you "
        "see. The sandbox has no network. Never look for API keys. Only for a realistic model of one real object in "
        "the plain look, delegate it to model-maker with task() and place what it returns. When the file passes and "
        "a first-time player would know what to do, stop."
        " The subject's own sounds come from the sound library first (/skills/common/sound/references/library.md: "
        "ready clips and ambience loops by id, as { clip: id } in SOUNDS)."
        + art
        + ecs
    )


def _skills(kind: str) -> list[str]:
    # /skills/play/: the learning-game skill, which every module starts from. /skills/looks/: one skill per look
    # (soft-clay, voxel, ...); looks/shared holds their common code and has no SKILL.md. /skills/game/: hands that
    # steer, game loops and tabletop physics, which learning games of every kind use.
    if kind == "game":
        return ["/skills/common/", "/skills/play/", "/skills/looks/", "/skills/game/"]
    return ["/skills/common/", "/skills/play/", "/skills/looks/", "/skills/game/", "/skills/lesson/"]


def skills_fingerprint() -> str:
    """Hash of the baked skills. A change means a continuing thread must reload them."""
    root = REPO_ROOT / "apps" / "api" / "skills"
    digest = hashlib.sha256()
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        digest.update(path.relative_to(root).as_posix().encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
    return digest.hexdigest()


def _tool_error(exc: Exception, request: Any) -> str:
    """Hand the agent a short tool failure it can repair. The raw exception stays off the message."""
    tool_call = getattr(request, "tool_call", None)
    name = tool_call.get("name") if isinstance(tool_call, dict) else None
    return f"`{name or 'tool'}` failed ({type(exc).__name__}). Read the error and fix /work/game.js."


def coder_middleware(model: Any) -> list[Any]:
    model_id = getattr(model, "model_name", None) or "gpt-6.1-sol"
    middleware: list[Any] = [
        TodoListMiddleware(),
        ModelCallLimitMiddleware(run_limit=MODEL_CALLS),
        ToolCallLimitMiddleware(run_limit=TOOL_CALLS),
        CostMeterMiddleware(budget_usd=RUN_BUDGET_USD, model_id=model_id),
        ModelRetryMiddleware(max_retries=3),
        ToolErrorMiddleware(_tool_error),
        # Play-test screenshots read with read_file reach the model as pictures, not as noise.
        ToolImagesAsUserMessage(),
    ]
    base = getattr(model, "openai_api_base", None) or ""
    if "api.meta.ai" in base or str(model_id).startswith("muse"):
        middleware.append(ModelFallbackMiddleware(gpt_chat()))
    return middleware


def _open_sandbox(run_id: str) -> modal.Sandbox:
    app = modal.App.lookup(APP_NAME, create_if_missing=True)
    # The whole id: two runs started in the same millisecond differ only in its last letters.
    safe = "".join(ch if ch.isalnum() or ch == "-" else "-" for ch in run_id)[:48] or "run"
    # block_network defaults to False. Pass True: the sandbox must not reach the network.
    return modal.Sandbox.create(
        app=app,
        image=coder_image(),
        name=f"genui-{safe}",
        # Longer than the agent's own deadline: a tool still running when time is up must not take the module with it.
        timeout=WALL_S + SANDBOX_GRACE_S,
        workdir="/work",
        block_network=True,
        # The game check's layout rules (gate layout.ts); CODER_LAYOUT_CHECK=0 runs without them, for side-by-sides.
        env={"LAYOUT_CHECK": os.environ.get("CODER_LAYOUT_CHECK", "1")},
    )


async def _final_view(backend: Any, studio: StudioRun, kind: str) -> None:
    """The finished game as a player first sees it (a fresh play-test, after the title card), kept in the Studio
    record as final-view.png: the run's picture of what was built, beside the plan's pictures."""
    try:
        run = await backend.aexecute(f"node {PLAYTEST} /work/module.js{' --game' if kind == 'game' else ''}", timeout=240)
        text = getattr(run, "output", "") or ""
        path = json.loads(text[text.index("{"):]).get("screenshot")
        if path:
            found = await backend.adownload_files([path])
            data = getattr(found[0], "content", None) if found else None
            if data:
                studio.save("final-view.png", data)
                studio.event("play-test", "final view", "the game as it opens", file="final-view.png")
    except Exception:
        return  # a record only: the game is judged by the gate, not by this picture


def _picture_paths(state: dict[str, Any]) -> dict[str, str]:
    """Where the plan's reference pictures go in the sandbox, by name (only those whose file exists)."""
    paths = {}
    for picture in state.get("plan_pictures") or []:
        found = media.file_of(str(picture.get("id") or ""))
        if found:
            paths[str(picture["name"])] = f"/work/plan/{picture['name']}{found[0].suffix}"
    return paths


def _picture_files(state: dict[str, Any]) -> list[tuple[str, bytes]]:
    files = []
    for picture in state.get("plan_pictures") or []:
        found = media.file_of(str(picture.get("id") or ""))
        if found:
            files.append((f"/work/plan/{picture['name']}{found[0].suffix}", found[0].read_bytes()))
    return files


def _task_text(state: dict[str, Any]) -> str:
    parts = [str(state.get("request") or "")]
    pictures = _picture_paths(state)
    if pictures:
        look = (state.get("plan_pictures") or [{}])[0].get("look") or "plain"
        named = {"first-view": "what the player should see the moment the game opens",
                 "hero": "the main thing from the front, side and top"}
        listing = "; ".join(f"{path} ({named.get(name, name)})" for name, path in pictures.items())
        parts.append(
            f"The plan is drawn in two reference pictures, for you and not for the game: {listing}. Look at each "
            f"(read_file) before you build, and use the {look} look they are drawn in. Lay the scene out as the first "
            "view shows it, and build the main thing from the look's builders to match the sheet's shapes, parts and "
            "colours. After the play-test, put your screenshot beside the first view and fix what is missing or "
            "different. Never show these pictures in the game."
        )
    critique = state.get("critique")
    if critique:
        parts.append(f"A reviewer looked at this lesson on the headset:\n{critique}")
    prior_error = (state.get("attempts") or [{}])[-1].get("error") if state.get("attempts") else None
    if prior_error:
        parts.append(f"The host gate rejected the module:\n{prior_error}\nFix /work/game.js.")
    return "\n\n".join(part for part in parts if part)


def _module_to_upload(state: dict[str, Any]) -> bytes | None:
    """A later run (repair or look-and-fix) starts from the module the host already has."""
    later = bool(state.get("attempts")) or bool(state.get("pictures")) or bool(state.get("critique"))
    if not later:
        return None
    code = state.get("code") or state.get("previous_code")
    if not code:
        return None
    return str(code).encode()


async def write_with_agent(state: dict[str, Any]) -> dict[str, Any]:
    """One sandbox, one agent run, recorded in the Studio. The returned code is still checked by the host gate."""
    run_id = str(state.get("run_id") or "run")
    try:
        studio: StudioRun | None = StudioRun(run_id, str(state.get("request") or ""), str(state.get("kind") or "lesson"), str(getattr(agent_model(), "model_name", "") or ""))
    except Exception:
        studio = None  # the Studio is a record; a run never fails for it
    # The host tools (media) and the grader's callback find the run through its scope.
    tokens = [scope.run_id.set(run_id), scope.studio.set(studio), scope.made.set({})]
    try:
        result = await _write_with_agent(state, studio)
    except Exception as exc:
        if studio is not None:
            studio.finish("failed", error=f"{type(exc).__name__}: {str(exc)[:300]}")  # not left "writing" for ever
        raise
    finally:
        for var, token in zip((scope.run_id, scope.studio, scope.made), tokens):
            var.reset(token)
    if studio is not None:
        attempt = (result.get("attempts") or [{}])[-1]
        studio.finish("ready" if result.get("code") else "failed", code=result.get("code"), error=result.get("error"), rubric=attempt.get("rubric"))
    return result


async def _write_with_agent(state: dict[str, Any], studio: StudioRun | None) -> dict[str, Any]:
    run_id = str(state.get("run_id") or "run")
    kind = state.get("kind") or "lesson"
    model = agent_model()
    # The sandbox lives WALL_S from now; the run must finish inside that, file transfers included.
    deadline = time.monotonic() + WALL_S - 20
    sandbox = await asyncio.to_thread(_open_sandbox, run_id)
    backend = ModalSandbox(sandbox=sandbox)
    backend_token = scope.backend.set(backend)
    syncing = asyncio.get_running_loop().create_task(studio.sync_loop(backend)) if studio is not None else None
    try:
        existing = _module_to_upload(state)
        if existing is not None:
            await backend.aupload_files([("/work/module.js", existing)])
            # A module built from kits.js and game.js goes back to the two, so the repair edits game.js again.
            await backend.aexecute(f"node {BUILD_MODULE} --split /work/module.js")
        pictures = _picture_files(state)
        if pictures:
            await backend.aexecute("mkdir -p /work/plan")
            await backend.aupload_files(pictures)
        coder = create_deep_agent(
            model=model,
            backend=backend,
            skills=_skills(kind),
            subagents=[model_maker_spec()],
            # The grading loop sits after the coder's own middleware: it runs when the coder would finish.
            middleware=[*coder_middleware(model), TimeLeftMiddleware(deadline, WALL_S), *([rubric.rubric_middleware(agent_model(), backend, kind, _on_evaluation, budget_usd=RUN_BUDGET_USD)] if rubric.enabled() else [])],
            tools=[*_HOST_TOOLS, *(SOUND_TOOLS if media.enabled() else [])],
            system_prompt=_prompt(kind),
            context_schema=RunContext,
            state_schema=CoderState,
            checkpointer=_checkpointer,
            name="coder" if kind != "game" else "game-coder",
        )
        config = {
            "configurable": {"thread_id": f"coder-{run_id}"},
            "metadata": {"lc_agent_name": "coder"},
            # LangGraph's default of 25 steps ends a run (and the model-maker subagent, which inherits this) before a
            # module exists. Each model call is several steps (middleware hooks are nodes), so the step limit sits well
            # above the call and tool limits, which are the real bounds.
            "recursion_limit": 10 * (MODEL_CALLS + TOOL_CALLS) + 100,
        }
        snapshot = None
        if _checkpointer is not None:
            try:
                snapshot = await coder.aget_state(config)
            except Exception:
                snapshot = None
        values = getattr(snapshot, "values", None) or {}
        stamp = skills_fingerprint()
        pinned = _LESSON_SKILLS if kind != "game" else _GAME_SKILLS
        continuing = bool(state.get("attempts")) or bool(values.get("messages"))
        payload: dict[str, Any] = {
            "messages": [{"role": "user", "content": _task_text(state)}],
            "skills_fingerprint": stamp,
            # Each attempt has its own budget: a repair continues the thread, and with the first attempt's spend still
            # on it the cost meter stopped it after one reply (Nov 17: a game left as the starter, both repairs empty).
            "cost_usd": 0.0,
        }
        if not continuing:
            payload["pinned_skills"] = pinned
        if rubric.enabled():
            payload["rubric"] = rubric.rubric_for(str(state.get("request") or ""))
        if values.get("skills_fingerprint") not in (None, stamp):
            payload["skills_metadata"] = None
        context = RunContext(visitor_id="agent", run_id=run_id, kind=kind, budget_usd=RUN_BUDGET_USD)
        _progress("coder")

        # version="v2" is the event iterator (v3 returns a run-stream object, not an async iterator).
        async def _stream() -> None:
            async for event in coder.astream_events(payload, context=context, config=config, version="v2"):
                if event.get("event") == "on_tool_start":
                    _progress(str(event.get("name") or "tool"))
                if studio is not None:
                    _record(studio, event)

        # Out of time: cancel the agent and keep what was written. The gate judges it (an unfinished starter fails
        # there), and a repair starts from it instead of from nothing. The cancel gets a few seconds to land, so the
        # module is read from a sandbox the agent no longer edits and nothing reaches the Studio after its finish; a
        # tool running in a thread cannot be cancelled, so it is not waited for beyond that (wait_for would).
        streaming = asyncio.ensure_future(_stream())
        finished, _ = await asyncio.wait({streaming}, timeout=max(1.0, deadline - time.monotonic()))
        timed_out = not finished
        if timed_out:
            streaming.cancel()
            await asyncio.wait({streaming}, timeout=STOP_WAIT_S)
            if streaming.done() and not streaming.cancelled() and isinstance(streaming.exception(), ModelRefusalError):
                return _failed(state, f"The model refused: {streaming.exception()}", refused=True)
        else:
            try:
                streaming.result()
            except ModelRefusalError as exc:
                return _failed(state, f"The model refused: {exc}", refused=True)
        tokens = await _tokens_used(coder, config)
        try:
            # The latest game.js, built into module.js (a coder that stopped after editing game.js left it stale).
            await backend.aexecute(f"node {BUILD_MODULE} /work/module.js")
            if studio is not None:
                await _final_view(backend, studio, kind)
            downloaded = await backend.adownload_files(["/work/module.js"])
        except Exception as exc:
            kept = studio.saved("module.js") if studio is not None else None
            if not kept:
                return _failed(state, f"The coder's sandbox closed before its module was read ({type(exc).__name__}).", tokens=tokens)
            downloaded = [FileDownloadResponse(path="/work/module.js", content=kept, error=None)]  # the Studio's copy, seconds old
        first = downloaded[0] if downloaded else None
        content = getattr(first, "content", None) if first is not None else None
        if not content:
            detail = getattr(first, "error", None) if first is not None else "missing"
            if timed_out:
                return _failed(state, "The coder ran out of time.", tokens=tokens)
            return _failed(state, f"The coder did not leave /work/module.js ({detail}).", tokens=tokens)
        code = content.decode() if isinstance(content, bytes) else str(content)
        attempt = {"stage": "ok", "ms": 0, **tokens, "finishReason": "length" if timed_out else "stop", **await _rubric_outcome(coder, config)}
        return {"attempts": [*state.get("attempts", []), attempt], "code": code}
    finally:
        if syncing is not None:
            syncing.cancel()
            await studio.sync(backend)  # the last plan, parts and screenshots before the sandbox goes
        scope.backend.reset(backend_token)
        try:
            await asyncio.to_thread(sandbox.terminate)
        except Exception:
            pass


def _record(studio: StudioRun, event: dict[str, Any]) -> None:
    """The Studio's timeline: hand-offs and reports, commands, files written."""
    kind = event.get("event")
    name = str(event.get("name") or "")
    # The main agent runs under the name "coder"; the Studio's timeline calls it the director.
    who = str((event.get("metadata") or {}).get("lc_agent_name") or "director").replace("coder", "director")
    data = event.get("data") or {}
    args = data.get("input") if isinstance(data.get("input"), dict) else {}
    if kind == "on_tool_start" and name == "task":
        studio.event("director", "hand-off", str(args.get("description") or "")[:600], to=str(args.get("subagent_type") or ""))
    elif kind == "on_tool_end" and name == "task":
        output = data.get("output")
        # A subagent returns a Command whose last message is its reply.
        messages = (getattr(output, "update", None) or {}).get("messages") if hasattr(output, "update") else None
        text = getattr(messages[-1], "content", messages[-1]) if messages else getattr(output, "content", output)
        studio.event(str((args or {}).get("subagent_type") or "specialist"), "report", str(text)[:1500])
    elif kind == "on_tool_start" and name == "execute":
        command = str(args.get("command") or "")
        if any(k in command for k in ("check.mjs", "playtest.mjs", "assemble.mjs", "new-game.mjs", "iwsdk xr")):
            studio.event(who, "run", command[:300])
    elif kind == "on_tool_start" and name in ("write_file", "edit_file"):
        studio.event(who, "edit" if name == "edit_file" else "write", str(args.get("file_path") or ""))


def _on_evaluation(evaluation: dict[str, Any]) -> None:
    studio = scope.studio.get()
    if studio is not None:
        studio.event("grader", str(evaluation.get("result") or ""), str(evaluation.get("explanation") or "")[:800],
                     criteria=[{"name": c.get("name"), "passed": bool(c.get("passed")), "gap": c.get("gap")} for c in evaluation.get("criteria") or []])
    failed = [c.get("name") for c in evaluation.get("criteria") or [] if not c.get("passed")]
    _progress(f"rubric {evaluation.get('iteration', 0) + 1}: {evaluation.get('result')}" + (f" ({len(failed)} to fix)" if failed else ""))


async def _rubric_outcome(coder: Any, config: dict[str, Any]) -> dict[str, Any]:
    """How the grading loop ended (satisfied, max_iterations_reached, ...) and how many grader passes it took."""
    if not rubric.enabled():
        return {}
    try:
        values = getattr(await coder.aget_state(config), "values", None) or {}
    except Exception:
        return {}
    return {"rubric": {"status": values.get("_rubric_status"), "iterations": values.get("_rubric_iterations", 0)}}


async def _tokens_used(coder: Any, config: dict[str, Any]) -> dict[str, int]:
    """The run's tokens from its messages' usage, so the daily budget counts agent runs like one-call writes."""
    prompt = completion = 0
    try:
        snapshot = await coder.aget_state(config)
        for message in (getattr(snapshot, "values", None) or {}).get("messages") or []:
            usage = getattr(message, "usage_metadata", None) or {}
            prompt += int(usage.get("input_tokens") or 0)
            completion += int(usage.get("output_tokens") or 0)
    except Exception:
        pass
    return {"promptTokens": prompt, "completionTokens": completion}


def _failed(state: dict[str, Any], error: str, *, refused: bool = False, tokens: dict[str, int] | None = None) -> dict[str, Any]:
    used = tokens or {"promptTokens": 0, "completionTokens": 0}
    attempt = {"stage": "no-code", "ms": 0, "error": error, **used, "finishReason": "stop"}
    update: dict[str, Any] = {"attempts": [*state.get("attempts", []), attempt], "code": None, "ok": False, "error": error}
    if refused:
        update["refused"] = True
    return update
