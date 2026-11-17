"""The Studio: what the design step, the coder and the grader made while they wrote a game, kept after the sandbox closes.

One folder per run under data/studio/<run_id>: meta.json (the request, kind, model, status), events.json (who did
what, in order: the design, the coder's plan, its hand-offs and their reports, play-tests, the grader's verdicts) and
files/ (plan.md, the parts, every play-test screenshot, the final module). While the run goes, a sync task copies
the sandbox's /work files every few seconds, so the Studio page (/studio/<run_id>) fills in live.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import time
from pathlib import Path
from typing import Any

from app import media
from app.config import REPO_ROOT

STUDIO_ROOT = Path(os.environ.get("STUDIO_DIR") or REPO_ROOT / "data" / "studio")
# A folder name: letters, digits, dot, dash and underscore, never starting with a dot (no "." or "..").
RUN_ID = re.compile(r"^[A-Za-z0-9_-][A-Za-z0-9._-]{0,79}$")
SYNC_EVERY_S = 6
# What the Studio copies from the sandbox: the plan, the game's parts and the module as it is (the play-test pictures
# are listed and copied as they appear). The module is kept even when the run fails, to see how far it got.
SANDBOX_FILES = ("/work/plan.md", "/work/parts/identity.js", "/work/parts/sounds.js", "/work/module.js")


def run_dir(run_id: str) -> Path | None:
    return STUDIO_ROOT / run_id if RUN_ID.match(run_id) else None


def _write_json(path: Path, data: Any) -> None:
    """Whole or not at all: another process (the API, a benchmark) may read the file while a run writes it."""
    part = path.with_name(f".{path.name}.{os.getpid()}.part")
    part.write_text(json.dumps(data, indent=1))
    os.replace(part, path)


def _read_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


class StudioRun:
    def __init__(self, run_id: str, request: str, kind: str, model: str, *, status: str = "writing") -> None:
        # A folder name: anything but letters, digits, dot, dash and underscore becomes a dash (no paths from an id).
        run_id = re.sub(r"[^A-Za-z0-9._-]", "-", run_id)[:80].strip(".") or "run"
        self.run_id = run_id
        self.dir = STUDIO_ROOT / run_id
        (self.dir / "files").mkdir(parents=True, exist_ok=True)
        # Later stages of the same run (the design step, then the coder, then a repair) carry on its record: its
        # start, its timeline and the player's own words as the request.
        previous = _read_json(self.dir / "meta.json", {})
        self.started = float(previous.get("started") or time.time())
        self.meta = {"runId": run_id, "request": previous.get("request") or request, "kind": kind, "model": model, "status": status, "started": self.started}
        self.events: list[dict[str, Any]] = _read_json(self.dir / "events.json", [])
        if previous.get("status") in ("ready", "failed"):
            # Keep the last attempt's module: this attempt's sync would overwrite it with its own start.
            module = self.dir / "files" / "module.js"
            if module.exists():
                module.rename(self.dir / "files" / f"module-attempt-{sum(1 for e in self.events if e['what'] == 'repair') + 1}.js")
            self.event("director", "repair", "writing the game again from the gate's error")
        self._sizes: dict[str, int] = {}
        self._write_meta()

    def _write_meta(self) -> None:
        _write_json(self.dir / "meta.json", self.meta)

    def event(self, who: str, what: str, detail: str = "", **extra: Any) -> None:
        self.events.append({"t": round(time.time() - self.started, 1), "who": who, "what": what, "detail": detail[:1500], **extra})
        _write_json(self.dir / "events.json", self.events)

    def save(self, name: str, data: bytes) -> bool:
        """Keep a file the run made; True when it is new or changed."""
        path = self.dir / "files" / name
        if self._sizes.get(name) == len(data) and path.exists() and path.read_bytes() == data:
            return False
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        self._sizes[name] = len(data)
        return True

    def saved(self, name: str) -> bytes | None:
        """A file the sync copied from the sandbox, if there is one."""
        path = self.dir / "files" / name
        return path.read_bytes() if path.is_file() else None

    def finish(self, status: str, code: str | None = None, error: str | None = None, **extra: Any) -> None:
        if code:
            self.save("module.js", code.encode())
        self.meta.update(status=status, seconds=round(time.time() - self.started, 1), error=error, **extra)
        self._write_meta()

    async def sync(self, backend: Any) -> None:
        """Copy the plan, the parts and new play-test screenshots from the sandbox."""
        try:
            listing = await backend.aexecute("ls /work/playtest 2>/dev/null", timeout=20)
            shots = sorted((f"/work/playtest/{n}" for n in (listing.output or "").split() if re.match(r"^view-\d+\.png$", n)), key=lambda p: int(re.findall(r"\d+", p)[-1]))
            new = [p for p in shots if not (self.dir / "files" / "playtest" / Path(p).name).exists()]
            got = await backend.adownload_files([*SANDBOX_FILES, *new])
            for item in got:
                content = getattr(item, "content", None)
                path = getattr(item, "path", "")
                if not content or not path:
                    continue
                name = path.removeprefix("/work/")
                if self.save(name, content) and name.startswith("playtest/"):
                    self.event("play-test", "screenshot", name, file=name)
                elif name == "plan.md" and not any(e["what"] == "plan" for e in self.events):
                    self.event("director", "plan", "wrote the design doc", file=name)
        except Exception:
            return  # the sandbox may be busy or closing; the next sync tries again

    async def sync_loop(self, backend: Any) -> None:
        while True:
            await asyncio.sleep(SYNC_EVERY_S)
            await self.sync(backend)


def list_runs(limit: int = 40) -> list[dict[str, Any]]:
    if not STUDIO_ROOT.exists():
        return []
    runs = []
    for path in STUDIO_ROOT.glob("*/meta.json"):
        meta = _read_json(path, None)
        if isinstance(meta, dict):
            runs.append(meta)
    return sorted(runs, key=lambda r: r.get("started", 0), reverse=True)[:limit]


def read_run(run_id: str) -> dict[str, Any] | None:
    folder = run_dir(run_id)
    meta = _read_json(folder / "meta.json", None) if folder is not None else None
    if not isinstance(meta, dict):
        return None
    events = _read_json(folder / "events.json", [])
    files = sorted(str(p.relative_to(folder / "files")) for p in (folder / "files").rglob("*") if p.is_file())
    texts = {}
    for name in ("plan.md", "parts/identity.js", "parts/sounds.js"):
        path = folder / "files" / name
        if path.exists():
            texts[name] = path.read_text(errors="replace")[:20000]
    return {**meta, "events": events, "files": files, "texts": texts,
            "media": media.library(run_id=run_id),
            "identity": _identity(texts.get("parts/identity.js", "")), "sounds": _sounds(texts.get("parts/sounds.js", ""))}


_STRING = r"""(['"`])((?:(?!\1).){0,200})\1"""


def _identity(code: str) -> dict[str, Any]:
    """The identity part's name, words and colours, read without running it (the agent wrote it)."""
    out: dict[str, Any] = {}
    for key in ("title", "eyebrow", "pitch"):
        m = re.search(rf"\b{key}\s*:\s*{_STRING}", code)
        if m:
            out[key] = m.group(2)
    for group in ("skin", "resultSign"):
        m = re.search(rf"\b{group}\s*:\s*\{{([^}}]*)\}}", code)
        if m:
            out[group] = dict(re.findall(r"(\w+)\s*:\s*['\"](#[0-9a-fA-F]{6})['\"]", m.group(1)))
    return out


def _sounds(code: str) -> list[dict[str, str]]:
    """The sound part's events and what each plays, as text."""
    body = code[code.find("{") + 1: code.rfind("}")] if "{" in code else ""
    return [{"event": e, "plays": v.strip().rstrip(",")[:120]} for e, v in re.findall(r"^\s*(\w+)\s*:\s*(.+?)\s*,?\s*(?://.*)?$", body, re.M)]
