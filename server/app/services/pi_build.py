"""Games and course levels built by the pi runner (trial/pi-xr): one continuous agent session makes the game as a full
IWSDK project, an independent check plays it with emulated hands, and its production build is served as a page of its
own (a game at /api/play/<id>/, a level at /api/learn/<course>/<index>/). One is built at a time.

Chosen with GAME_MODE=pi. The game's model and reasoning level are the app's own (LLM_MODEL, LLM_REASONING_EFFORT);
the runner keeps its own limits in minutes and dollars. It works on this machine only: it needs its starter project
(trial/pi-xr/runner/make-template.mjs) and port 8091 for the emulator window. Games, run logs and the starter live
under PI_XR_ARCHIVE (server/data/pi by default), never in git.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import re
import shutil
import signal
from pathlib import Path
from typing import Any

from app.core import config as config_mod
from app.core.config import REPO_ROOT, is_meta
from app.core.llm import load_model
from app.services.live import Live

RUNNER = REPO_ROOT / "trial" / "pi-xr" / "runner" / "run.mjs"
# The runner stops itself well before this (its own minutes and dollars); this only ends a process that hangs.
HUNG_S = 3 * 3600
STOP_WAIT_S = 15.0  # how long a stopped runner gets to end its agent and write its results, before SIGKILL
_PROGRESS = re.compile(r"\] ([\d.]+) min, (\d+) turns, (\d+) tool calls, \$([\d.]+)")
_HEADING = re.compile(r"^#\s+(.+?)(?:\s+[-—–]\s+Design)?\s*$", re.MULTILINE)
_PLAIN = re.compile(r"^[\x20-\x7e]{2,40}$")
_ERROR = re.compile(r"\b(?:\w*Error|error):")
# A fix continues the game's own session (the runner's --continue), as a player's message would. The agent cannot see
# what the player saw, so it looks at the game first; its last message is shown to the player as it is.
FIX_PROMPT = (
    "A player tried this game on the headset and says:\n\n{text}\n\n"
    "You cannot see what they saw, so look before you change anything: run playtest_view, then take a screenshot "
    "from where the player stands and read it. Find what they mean in the picture and in the code. Fix that, and keep "
    "everything that already works. Take the same screenshot again to see that it is fixed, then run playtest_replay."
    "\n\nYour last message is shown to the player as it is: one or two short sentences in plain words, with no code, "
    "file names or numbers, saying what was wrong and what you changed. If you could not find what they mean, change "
    "nothing and say what you looked at."
)
ANSWER_MAX = 400  # characters of the agent's last message shown to the player
DOING_EVERY_S = 3.0  # how often a fix's live line is brought up to date with what the agent is doing
_LOOK = re.compile(r"\s*(cd [^&]+&&\s*)?(ls|cat|grep|rg|find|sed|head|tail)\b")
_one: asyncio.Lock | None = None


def reset() -> None:
    global _one
    _one = None


def _one_at_a_time() -> asyncio.Lock:
    """Games and course levels are queued apart, but this machine has one emulator window (port 8091) for a runner."""
    global _one
    if _one is None:
        _one = asyncio.Lock()
    return _one


def enabled() -> bool:
    return os.environ.get("GAME_MODE") == "pi"


def archive() -> Path:
    raw = os.environ.get("PI_XR_ARCHIVE")
    return Path(raw).expanduser().resolve() if raw else REPO_ROOT / "server" / "data" / "pi"


def dist_dir(game_id: str) -> Path:
    return archive() / "games" / game_id / "dist"


def play_url(game_id: str) -> str:
    return f"/api/play/{game_id}/"


def answer(row: dict[str, Any]) -> str:
    """What the agent said last, on one line and short enough to show: after a fix, what it tells the player."""
    said = " ".join(str(row.get("answer") or "").split())
    if len(said) <= ANSWER_MAX:
        return said
    cut = said[:ANSWER_MAX]
    end = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    return cut[: end + 1] if end > 0 else cut.rstrip() + "..."


def runner_command(game_id: str, request_file: Path, follow_up: bool = False) -> list[str]:
    return ["node", str(RUNNER), game_id, *(["--continue"] if follow_up else []), "--request-file", str(request_file), "--down"]


def _previous_dir(game_id: str) -> Path:
    return archive() / "games" / game_id / "dist-previous"


def keep_build(game_id: str) -> None:
    """A copy of the game's current build, so a fix that fails leaves it as it was."""
    previous = _previous_dir(game_id)
    shutil.rmtree(previous, ignore_errors=True)
    if dist_dir(game_id).is_dir():
        shutil.copytree(dist_dir(game_id), previous)


def restore_build(game_id: str) -> bool:
    """Put the kept build back; False when there is none."""
    previous = _previous_dir(game_id)
    if not previous.joinpath("index.html").exists():
        return False
    shutil.rmtree(dist_dir(game_id), ignore_errors=True)
    previous.rename(dist_dir(game_id))
    return True


def pi_model() -> tuple[str, str]:
    """pi's name for the app's model, and its reasoning level."""
    config = config_mod.config
    if not is_meta(config.base_url):
        raise RuntimeError("GAME_MODE=pi builds with Meta's Muse only: LLM_BASE_URL must be Meta's Model API.")
    model, effort = config.model, os.environ.get("LLM_REASONING_EFFORT")
    with contextlib.suppress(Exception):  # an id that is not in models.json is the model's own name
        entry = load_model(config.model)
        model = entry.model
        effort = (entry.extra_body or {}).get("reasoning_effort") or effort
    return f"meta/{model}", str(effort or "max")


def stage_of(step: str) -> str:
    """The live stage for the runner's current plan step."""
    text = step.lower()
    if any(word in text for word in ("test", "replay", "verify", "playtest")):
        return "testing"
    if any(word in text for word in ("design", "canvas", "requirement", "inspect", "explore")):
        return "designing"
    return "building"


def _plan_step(game_id: str) -> str | None:
    runs = sorted((archive() / "runs").glob(f"{game_id}-2*"))
    if not runs:
        return None
    try:
        plan = json.loads((runs[-1] / "plan.json").read_text(encoding="utf-8")).get("plan") or []
    except (OSError, ValueError):
        return None
    return next((str(item.get("step")) for item in plan if item.get("status") == "in_progress"), None)


def doing(tool: str, args: dict[str, Any]) -> str:
    """What the agent is doing, in words a player understands, from the tool it started."""
    name = tool.rsplit("__", 1)[-1]  # an IWSDK runtime tool is named mcp__iwsdk_runtime__<name>
    command = str(args.get("command") or "")
    if name in ("playtest_view", "browser_screenshot", "scene_screenshot") or (
        name == "read" and re.search(r"\.(png|jpe?g)$", str(args.get("path") or ""), re.IGNORECASE)
    ):
        return "Looking at the game"
    if name in ("playtest_replay", "playtest_record", "xr_run_sequence"):
        return "Playing it to check"
    if name in ("edit", "write"):
        return "Changing the game"
    if name == "bash" and re.search(r"typecheck|tsc|run build", command):
        return "Building it again"
    if name in ("read", "grep", "find", "ls") or (name == "bash" and _LOOK.match(command)):
        return "Reading its code"
    return "Working on it"


def _doing(game_id: str) -> str:
    """What the agent of the game's latest run is doing now: the last tool it started, from the end of its newest
    event stream (a line too long to fit, such as a picture, is skipped)."""
    runs = sorted((archive() / "runs").glob(f"{game_id}-2*"))
    streams = sorted(runs[-1].glob("events-*.jsonl"), key=lambda p: int(p.stem.split("-")[1])) if runs else []
    if not streams:
        return ""
    try:
        with streams[-1].open("rb") as stream:
            stream.seek(max(0, stream.seek(0, os.SEEK_END) - 65536))
            lines = stream.read().decode("utf-8", "replace").splitlines()
    except OSError:
        return ""
    for line in reversed(lines):
        if '"tool_execution_start"' in line:
            with contextlib.suppress(ValueError):
                record = json.loads(line)
                return doing(str(record.get("toolName") or ""), record.get("args") or {})
    return ""


def _result(game_id: str) -> dict[str, Any] | None:
    """The runner's results row for this game (results.jsonl in the archive), or None."""
    rows = archive() / "results.jsonl"
    if not rows.exists():
        return None
    found = None
    for line in rows.read_text(encoding="utf-8").splitlines():
        with contextlib.suppress(ValueError):
            row = json.loads(line)
            if row.get("name") == game_id:
                found = row
    return found


def _title(game_id: str) -> str | None:
    """The game's name, from the first heading of its design document on the canvas."""
    design = archive() / "games" / game_id / "canvas" / "documents" / "design.md"
    with contextlib.suppress(OSError):
        match = _HEADING.search(design.read_text(encoding="utf-8"))
        if match and _PLAIN.fullmatch(match.group(1).strip()):
            return match.group(1).strip()
    return None


async def _stop(process: asyncio.subprocess.Process) -> None:
    """End the runner and everything it started, and wait for it: its results are final before they are read, and
    nothing it started goes on spending."""
    for sig, wait_s in ((signal.SIGTERM, STOP_WAIT_S), (signal.SIGKILL, None)):
        with contextlib.suppress(ProcessLookupError):
            os.killpg(process.pid, sig)
        with contextlib.suppress(asyncio.TimeoutError):
            await asyncio.wait_for(process.wait(), timeout=wait_s)
            return


async def build(game: dict[str, Any], watcher: Live, follow_up: str | None = None) -> dict[str, Any]:
    """Build one game (or course level: its `id` is the runner's name for it) with the runner, or with `follow_up` fix a
    built one in its own session, after any build already running. A fix that does not pass the check leaves the
    build as it was. { ok, url?, title?, answer?, error?, model, usd }; `url` is a game's page."""
    async with _one_at_a_time():
        return await _build(game, watcher, follow_up)


async def _build(game: dict[str, Any], watcher: Live, follow_up: str | None) -> dict[str, Any]:
    if not (archive() / "template" / ".pi-xr-template.json").exists():
        raise RuntimeError(
            "The pi runner has no starter project: run trial/pi-xr/runner/make-template.mjs once, "
            f"with PI_XR_ARCHIVE={archive()}."
        )
    model, effort = pi_model()
    requests = archive() / "requests"
    requests.mkdir(parents=True, exist_ok=True)
    fixing = follow_up is not None
    if fixing:
        request_file = requests / f"{game['id']}-fix-{int(game.get('fixes') or 0) + 1}.txt"
        request_file.write_text(FIX_PROMPT.format(text=follow_up), encoding="utf-8")
        before = _result(game["id"])
        keep_build(game["id"])
    else:
        request_file = requests / f"{game['id']}.txt"
        request_file.write_text(game["request"], encoding="utf-8")
        before = None
    env = {**os.environ, "PI_XR_ARCHIVE": str(archive()), "PI_XR_MODEL": model, "PI_XR_THINKING": effort}
    process = await asyncio.create_subprocess_exec(
        *runner_command(game["id"], request_file, follow_up=fixing), cwd=str(RUNNER.parent.parent), env=env,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT, start_new_session=True,
    )
    tail: list[str] = []

    async def follow() -> None:
        assert process.stdout is not None
        async for raw in process.stdout:
            line = raw.decode("utf-8", "replace").rstrip()
            tail[:] = [*tail[-19:], line]
            progress = _PROGRESS.search(line)
            if "checking the game" in line:
                watcher.set_stage("checking")
            elif progress and not fixing:
                step = _plan_step(game["id"])
                watcher.set_stage(stage_of(step) if step else "building", step or "")
        await process.wait()

    async def tell() -> None:
        """While fixing, the live line says what the agent is doing now, for the box on the game's page."""
        while True:
            await asyncio.sleep(DOING_EVERY_S)
            now = _doing(game["id"])
            if now and watcher.stage == "fixing":
                watcher.set_stage("fixing", now)

    teller = asyncio.create_task(tell()) if fixing else None
    try:
        await asyncio.wait_for(follow(), timeout=HUNG_S)
    finally:
        if teller is not None:
            teller.cancel()
        if process.returncode is None:  # hung, or the server is stopping: the runner and its agent stop too
            await _stop(process)
    row = _result(game["id"])
    if row is not None and before is not None and row.get("started") == before.get("started"):
        row = None  # the fix wrote no results of its own
    usd = float(row["usd"]) if row and row.get("usd") is not None else 0.0
    if row is not None and before is not None:
        # A follow-up's media ledger carries the build's art too: count only what this fix made.
        usd = max(0.0, usd - float((before.get("media") or {}).get("usd") or 0.0))
    if row and (row.get("check") or {}).get("ok") and dist_dir(game["id"]).joinpath("index.html").exists():
        shutil.rmtree(_previous_dir(game["id"]), ignore_errors=True)
        return {"ok": True, "url": play_url(game["id"]), "title": _title(game["id"]), "model": model, "usd": usd,
                "answer": answer(row)}
    if fixing:
        restore_build(game["id"])
    failures = (row.get("check") or {}).get("failures") if row else None
    said = [line for line in reversed(tail) if line.strip()]
    # A runner that stopped with an exception ends its output with Node's version: name the error line instead.
    error = failures[0] if failures else next((line for line in said if _ERROR.search(line)), said[0] if said else "the runner stopped")
    return {"ok": False, "error": str(error), "model": model, "usd": usd}
