"""Deep Agent coder. One Modal sandbox per run, network blocked, host gate still decides."""

from __future__ import annotations

import asyncio
import hashlib
import time
from typing import Any

import modal
from deepagents import create_deep_agent
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

from app.agents.middleware import CostMeterMiddleware
from app.agents.model_maker import model_maker_spec
from app.config import REPO_ROOT
from app.llm import agent_model, gpt_chat
from app.state import CoderState, RunContext
from app.tools.host import asset_job_status, library_lookup, real_size, start_asset_job
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
WALL_S = 8 * 60
RUN_BUDGET_USD = 2.0
APP_NAME = "genui-coder"

_LESSON_SKILLS = ["kit", "panels", "lesson-craft", "dry-run"]
_GAME_SKILLS = ["kit", "panels", "game-loop", "hand-play", "dry-run"]

_HOST_TOOLS = [library_lookup, start_asset_job, asset_job_status, real_size]

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
    delegate = (
        "Do not delegate to model-maker unless the player asked for one realistic scanned object."
        if kind == "game"
        else "Delegate the main realistic 3D model to model-maker with task(), then place what it returns."
    )
    return (
        f"You write one JavaScript module for a mixed-reality {subject} and save it at /work/module.js. "
        "Read your skills before writing. Check with `node /skills/common/dry-run/scripts/check.mjs /work/module.js` "
        "and fix the file until the check prints ok. The sandbox has no network. Never look for API keys. "
        f"{delegate} When the file passes, stop."
    )


def _skills(kind: str) -> list[str]:
    if kind == "game":
        return ["/skills/common/", "/skills/game/"]
    return ["/skills/common/", "/skills/lesson/"]


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
    return f"`{name or 'tool'}` failed ({type(exc).__name__}). Read the error and fix /work/module.js."


def coder_middleware(model: Any) -> list[Any]:
    model_id = getattr(model, "model_name", None) or "gpt-6.1-sol"
    middleware: list[Any] = [
        TodoListMiddleware(),
        ModelCallLimitMiddleware(run_limit=MODEL_CALLS),
        ToolCallLimitMiddleware(run_limit=TOOL_CALLS),
        CostMeterMiddleware(budget_usd=RUN_BUDGET_USD, model_id=model_id),
        ModelRetryMiddleware(max_retries=3),
        ToolErrorMiddleware(_tool_error),
    ]
    base = getattr(model, "openai_api_base", None) or ""
    if "api.meta.ai" in base or str(model_id).startswith("muse"):
        middleware.append(ModelFallbackMiddleware(gpt_chat()))
    return middleware


def _open_sandbox(run_id: str) -> modal.Sandbox:
    app = modal.App.lookup(APP_NAME, create_if_missing=True)
    safe = "".join(ch if ch.isalnum() or ch == "-" else "-" for ch in run_id)[:24] or "run"
    # block_network defaults to False. Pass True: the sandbox must not reach the network.
    return modal.Sandbox.create(
        app=app,
        image=coder_image(),
        name=f"genui-{safe}",
        timeout=WALL_S,
        workdir="/work",
        block_network=True,
    )


def _task_text(state: dict[str, Any]) -> str:
    parts = [str(state.get("request") or "")]
    critique = state.get("critique")
    if critique:
        parts.append(f"A reviewer looked at this lesson on the headset:\n{critique}")
    prior_error = (state.get("attempts") or [{}])[-1].get("error") if state.get("attempts") else None
    if prior_error:
        parts.append(f"The host gate rejected the module:\n{prior_error}\nFix /work/module.js.")
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
    """One sandbox, one agent run. The returned code is still checked by the host gate."""
    run_id = str(state.get("run_id") or "run")
    kind = state.get("kind") or "lesson"
    model = agent_model()
    # The sandbox lives WALL_S from now; the run must finish inside that, file transfers included.
    deadline = time.monotonic() + WALL_S - 20
    sandbox = await asyncio.to_thread(_open_sandbox, run_id)
    backend = ModalSandbox(sandbox=sandbox)
    try:
        existing = _module_to_upload(state)
        if existing is not None:
            await backend.aupload_files([("/work/module.js", existing)])
        coder = create_deep_agent(
            model=model,
            backend=backend,
            skills=_skills(kind),
            subagents=[model_maker_spec()],
            middleware=coder_middleware(model),
            tools=_HOST_TOOLS,
            system_prompt=_prompt(kind),
            context_schema=RunContext,
            state_schema=CoderState,
            checkpointer=_checkpointer,
            name="coder" if kind != "game" else "game-coder",
        )
        config = {
            "configurable": {"thread_id": f"coder-{run_id}"},
            "metadata": {"lc_agent_name": "coder"},
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
        }
        if not continuing:
            payload["pinned_skills"] = pinned
        if values.get("skills_fingerprint") not in (None, stamp):
            payload["skills_metadata"] = None
        context = RunContext(visitor_id="agent", run_id=run_id, kind=kind, budget_usd=RUN_BUDGET_USD)
        _progress("coder")

        # version="v2" is the event iterator (v3 returns a run-stream object, not an async iterator).
        async def _stream() -> None:
            async for event in coder.astream_events(payload, context=context, config=config, version="v2"):
                if event.get("event") == "on_tool_start":
                    _progress(str(event.get("name") or "tool"))

        try:
            await asyncio.wait_for(_stream(), timeout=max(1.0, deadline - time.monotonic()))
        except ModelRefusalError as exc:
            return _failed(state, f"The model refused: {exc}", refused=True)
        except TimeoutError:
            return _failed(state, "The coder ran out of time.")
        tokens = await _tokens_used(coder, config)
        try:
            downloaded = await backend.adownload_files(["/work/module.js"])
        except Exception as exc:
            return _failed(state, f"The coder's sandbox closed before its module was read ({type(exc).__name__}).", tokens=tokens)
        first = downloaded[0] if downloaded else None
        content = getattr(first, "content", None) if first is not None else None
        if not content:
            detail = getattr(first, "error", None) if first is not None else "missing"
            return _failed(state, f"The coder did not leave /work/module.js ({detail}).", tokens=tokens)
        code = content.decode() if isinstance(content, bytes) else str(content)
        attempt = {"stage": "ok", "ms": 0, **tokens, "finishReason": "stop"}
        return {"attempts": [*state.get("attempts", []), attempt], "code": code}
    finally:
        try:
            await asyncio.to_thread(sandbox.terminate)
        except Exception:
            pass


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
