"""Live preview of a course lesson or a game while it is written.

The writer streams its reply here (llm.complete's on_text). From the text so far this keeps what is safe to show at
once: the named parts and the panel title as they appear. Every couple of seconds it also asks the gate for the
part of the module that can already run (apps/gate/snapshot.ts: cut at the last complete statement, closed,
validated and dry-run like a finished module), so the headset can show the scene building up. Nothing reaches the
headset that has not passed the gate. Kept in memory only: a restart loses the preview, never the lesson.
"""

from __future__ import annotations

import asyncio
import contextlib
import contextvars
import re
import time
from typing import Any, Iterator

from app.core.background import track
from app.pipeline import gate

SNAPSHOT_EVERY_S = 1.5
KEEP = 64
_NAME = re.compile(r"""\.name\s*=\s*(['"`])([^'"`\n]{1,40})\1""")
_TITLE = re.compile(r"""kit\.panel\(\s*ui\s*,\s*\{[\s\S]{0,600}?\btitle:\s*(['"`])([^'"`\n]{2,60})\1""")

_entries: dict[str, "Live"] = {}
_current: contextvars.ContextVar["Live | None"] = contextvars.ContextVar("live", default=None)


class Live:
    def __init__(self, key: str) -> None:
        self.key = key
        self.started = time.time()
        self.stage = "starting"
        self.detail = ""
        self.attempt = 0
        self.text = ""
        self.parts: list[str] = []
        self.title: str | None = None
        self.code: str | None = None
        self.meshes = 0
        self.seq = 0
        self.done = False
        self.ok = False
        # The assets the final gate will allow (pipeline/lesson.py); previews are checked against the same list.
        self.known_assets: list[str] = []
        self._snapping: asyncio.Task[Any] | None = None
        self._snapped_len = 0

    def set_stage(self, stage: str, detail: str = "") -> None:
        self.stage = stage
        self.detail = detail[:160]

    def begin_attempt(self) -> None:
        """A new reply starts (the first, or a repair that writes the module again)."""
        self.attempt += 1
        self.text = ""
        self._snapped_len = 0
        self.set_stage("thinking")

    def on_text(self, text: str) -> None:
        if len(text) < len(self.text):  # the stream started over after a dropped connection
            self._snapped_len = 0
        self.text = text
        self.stage = "writing"
        for match in _NAME.finditer(text):
            name = match.group(2).strip()
            if name and name not in self.parts:
                self.parts.append(name)
        if self.title is None:
            title = _TITLE.search(text)
            if title:
                self.title = title.group(2).strip()
        if self._snapping is None and len(text) - self._snapped_len > 200:
            self._snapping = track(asyncio.get_running_loop().create_task(self._snap()))

    async def _snap(self) -> None:
        try:
            while not self.done and len(self.text) - self._snapped_len > 200:
                text = self.text
                self._snapped_len = len(text)
                began = time.monotonic()
                result = await gate.snapshot(text, self.known_assets)
                # A repair writes the module again from the top: keep showing the fuller scene until it catches up.
                if result.get("ok") and result.get("code") and int(result.get("meshes") or 0) >= self.meshes:
                    self.code = result["code"]
                    self.meshes = int(result.get("meshes") or 0)
                    self.seq += 1
                await asyncio.sleep(max(0.0, SNAPSHOT_EVERY_S - (time.monotonic() - began)))
        finally:
            self._snapping = None

    def finish(self, ok: bool, detail: str = "") -> None:
        self.done = True
        self.ok = ok
        self.set_stage("ready" if ok else "failed", detail)

    def line(self) -> str:
        """One line for a shelf row."""
        seconds = int(time.time() - self.started)
        clock = f"{seconds // 60}:{seconds % 60:02d}"
        if self.stage == "thinking":
            return f"Thinking ({clock})" if self.attempt <= 1 else f"Fixing it, try {self.attempt} ({clock})"
        if self.stage == "writing":
            count = len(self.parts) or self.meshes
            return f"Building: {count} parts so far" if count else f"Writing ({clock})"
        if self.stage == "checking":
            return "Checking it runs"
        return {"starting": "Starting", "designing": "Designing the game"}.get(self.stage, self.stage.capitalize())

    def view(self, after: int = 0) -> dict[str, Any]:
        out: dict[str, Any] = {
            "key": self.key,
            "stage": self.stage,
            "detail": self.detail,
            "line": self.line(),
            "attempt": self.attempt,
            "parts": self.parts,
            "title": self.title,
            "meshes": self.meshes,
            "seq": self.seq,
            "seconds": int(time.time() - self.started),
            "done": self.done,
            "ok": self.ok,
        }
        if self.code and self.seq > after:
            out["code"] = self.code
        return out


@contextlib.contextmanager
def watching(key: str) -> Iterator[Live]:
    """Everything written inside (the lesson graph's nodes) reports to this key's preview."""
    entry = Live(key)
    _entries[key] = entry
    while len(_entries) > KEEP:
        _entries.pop(next(iter(_entries)))
    token = _current.set(entry)
    try:
        yield entry
    finally:
        _current.reset(token)
        if not entry.done:
            entry.finish(False, "stopped")


def current() -> Live | None:
    return _current.get()


def get(key: str) -> Live | None:
    return _entries.get(key)


def lesson_key(course_id: str, index: int) -> str:
    return f"course-{course_id}-{index}"


def game_key(game_id: str) -> str:
    return f"game-{game_id}"
