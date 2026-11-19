"""Games built by the pi runner (trial/pi-xr): one continuous agent session makes the game as a full IWSDK project,
an independent check plays it with emulated hands, and its production build is served at /api/play/<id>/.

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


def enabled() -> bool:
    return os.environ.get("GAME_MODE") == "pi"


def archive() -> Path:
    raw = os.environ.get("PI_XR_ARCHIVE")
    return Path(raw).expanduser().resolve() if raw else REPO_ROOT / "server" / "data" / "pi"


def dist_dir(game_id: str) -> Path:
    return archive() / "games" / game_id / "dist"


def play_url(game_id: str) -> str:
    return f"/api/play/{game_id}/"


def runner_command(game_id: str, request_file: Path) -> list[str]:
    return ["node", str(RUNNER), game_id, "--request-file", str(request_file), "--down"]


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


async def build(game: dict[str, Any], watcher: Live) -> dict[str, Any]:
    """Build one game with the runner. { ok, url?, title?, error?, model, usd }."""
    if not (archive() / "template" / ".pi-xr-template.json").exists():
        raise RuntimeError(
            "The pi runner has no starter project: run trial/pi-xr/runner/make-template.mjs once, "
            f"with PI_XR_ARCHIVE={archive()}."
        )
    model, effort = pi_model()
    requests = archive() / "requests"
    requests.mkdir(parents=True, exist_ok=True)
    request_file = requests / f"{game['id']}.txt"
    request_file.write_text(game["request"], encoding="utf-8")
    env = {**os.environ, "PI_XR_ARCHIVE": str(archive()), "PI_XR_MODEL": model, "PI_XR_THINKING": effort}
    process = await asyncio.create_subprocess_exec(
        *runner_command(game["id"], request_file), cwd=str(RUNNER.parent.parent), env=env,
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
            elif progress:
                step = _plan_step(game["id"])
                watcher.set_stage(stage_of(step) if step else "building", step or "")
        await process.wait()

    try:
        await asyncio.wait_for(follow(), timeout=HUNG_S)
    finally:
        if process.returncode is None:  # hung, or the server is stopping: the runner and its agent stop too
            await _stop(process)
    row = _result(game["id"])
    usd = float(row["usd"]) if row and row.get("usd") is not None else 0.0
    if row and (row.get("check") or {}).get("ok") and dist_dir(game["id"]).joinpath("index.html").exists():
        return {"ok": True, "url": play_url(game["id"]), "title": _title(game["id"]), "model": model, "usd": usd}
    failures = (row.get("check") or {}).get("failures") if row else None
    error = failures[0] if failures else next((line for line in reversed(tail) if line.strip()), "the runner stopped")
    return {"ok": False, "error": str(error), "model": model, "usd": usd}
