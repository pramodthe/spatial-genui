"""The play-through (gate/src/play.ts): the starter game plays through as written, in every look, on the desk and as
a world (a new game starts from one of these, so it starts with a play block that passes), and the host gate sends a
game that cannot be played through back for a repair."""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest
from langgraph.checkpoint.memory import MemorySaver

from app.core.config import SKILLS_DIR
from app.core.llm import Completion
from app.pipeline import lesson

API = Path(__file__).resolve().parents[1]
GATE = API.parent / "gate"
NEW_GAME = SKILLS_DIR / "play" / "learning-game" / "scripts" / "new-game.mjs"
DRY_RUN = SKILLS_DIR / "common" / "dry-run" / "scripts" / "check.mjs"
CHECK = SKILLS_DIR / "play" / "learning-game" / "scripts" / "check.mjs"
LOOKS = ("plain", "voxel", "soft-clay", "low-poly", "ink-toon", "painted", "paper-pop-up", "exploded-view", "circuit-city")

pytestmark = pytest.mark.skipif(not (GATE / "node_modules" / ".bin" / "tsx").exists(), reason="the gate is not installed")


def _env(**extra: str) -> dict[str, str]:
    return {**os.environ, "GATE_TSX": str(GATE / "node_modules" / ".bin" / "tsx"), "GATE_ENTRY": str(GATE / "gate.ts"), **extra}


def _start(tmp_path: Path, look: str, *flags: str) -> Path:
    out = tmp_path / "module.js"
    subprocess.run(["node", str(NEW_GAME), look, str(out), *flags], check=True, capture_output=True, text=True)
    return out


# Every look on the desk; as a world, three of them (a world changes the land and the scale, not the look's pieces).
STARTERS = [(look, ()) for look in LOOKS] + [(look, ("--world",)) for look in ("plain", "low-poly", "exploded-view")]


@pytest.mark.parametrize(("look", "flags"), STARTERS, ids=[f"{look}{'-world' if flags else ''}" for look, flags in STARTERS])
def test_the_starter_plays_through(tmp_path: Path, look: str, flags: tuple[str, ...]) -> None:
    module = _start(tmp_path, look, *flags)
    done = subprocess.run(["node", str(DRY_RUN), str(module)], capture_output=True, text=True, env=_env(), timeout=120)
    result = json.loads(done.stdout.strip().splitlines()[0])
    assert result["ok"], result
    play = result["stats"]["play"]
    assert play["ok"] and not play["findings"], play
    assert play["rounds"]["played"]["stars"] >= 1 and play["rounds"]["again"]["phase"] == "done", play["rounds"]


def test_the_check_reports_a_game_that_cannot_be_played(tmp_path: Path) -> None:
    module = _start(tmp_path, "low-poly")
    game = tmp_path / "game.js"
    code = game.read_text()
    # The first move's gesture now presses nothing the move counts: the move never registers.
    assert "learn: MOVES.map((m) => touchOf(m.target ?? 0))," in code
    game.write_text(code.replace("learn: MOVES.map((m) => touchOf(m.target ?? 0)),", "learn: [{ wait: 0.5 }],"))

    def check(mode: str) -> str:
        return subprocess.run(["node", str(CHECK), str(module)], capture_output=True, text=True, env=_env(PLAY_CHECK=mode), timeout=120).stdout

    assert "NOTE: Play: Move 1 did not register" in check("note")
    assert "FIX: Play: Move 1 did not register" in check("1")
    assert "Play:" not in check("0")


EXAMPLE_GAMES = API.parent / "headset" / "public" / "games"


@pytest.mark.parametrize("name", ["paper-plane", "river-dam", "kite-hill", "desert-canyon"])
def test_the_example_games_play_through(tmp_path: Path, name: str) -> None:
    """The four ready-made games, each with a play block written by hand when the check was calibrated on them: a
    simulated hand plays every one to three stars, again after Try again, and wins nothing without playing."""
    module = tmp_path / "module.js"
    module.write_text(json.loads((EXAMPLE_GAMES / f"{name}.json").read_text())["code"])
    done = subprocess.run(["node", str(DRY_RUN), str(module)], capture_output=True, text=True, env=_env(), timeout=300)
    result = json.loads(done.stdout.strip().splitlines()[0])
    assert result["ok"], result
    play = result["stats"]["play"]
    assert play["ok"] and play["complete"] and not [f for f in play["findings"] if f["level"] == "fix"], play["findings"]
    rounds = play["rounds"]
    assert rounds["played"]["stars"] == 3 and rounds["slow"]["stars"] == 3 and rounds["again"]["stars"] == 3, rounds
    assert rounds["idle"]["phase"] != "done" and rounds["unplayed"]["phase"] != "done", rounds


GAME = "// learning-game look: plain\nexport default function build() {}"
UNPLAYABLE = {"ok": False, "complete": True, "findings": [
    {"level": "fix", "rule": "move", "text": "Move 1 did not register: the game still waits at move 1."},
    {"level": "note", "rule": "frame-rate", "text": "The same play gave 4 at 72 frames a second and 3 at 30."},
]}


def test_what_the_host_gate_counts_as_unplayable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CODER_PLAY_CHECK", raising=False)
    failure = lesson.play_failure(GAME, {"play": UNPLAYABLE})
    assert failure and "Move 1 did not register" in failure and "72 frames" not in failure  # the fixes, not the notes
    assert lesson.play_failure(GAME, {"play": {"ok": True, "complete": True, "findings": UNPLAYABLE["findings"][1:]}}) is None
    # A learning game must say how it is played; a module that is not one (the one-call writer's) need not.
    assert lesson.play_failure(GAME, {"play": None}) == lesson.NO_PLAY_BLOCK
    assert lesson.play_failure("export default function build() {}", {"play": None}) is None
    # Out of computing time is not the game's fault.
    unfinished = {"ok": True, "complete": False, "findings": [{"level": "note", "rule": "time", "text": "ran out of computing time"}]}
    assert lesson.play_failure(GAME, {"play": unfinished}) is None
    monkeypatch.setenv("CODER_PLAY_CHECK", "0")
    assert lesson.play_failure(GAME, {"play": UNPLAYABLE}) is None and lesson.play_failure(GAME, {"play": None}) is None


@pytest.mark.asyncio
async def test_a_game_that_cannot_be_played_is_sent_back(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CODER_PLAY_CHECK", raising=False)
    previous = lesson.get_checkpointer()
    lesson.set_checkpointer(MemorySaver())
    seen: list[str] = []
    gates = {"n": 0}

    async def complete(messages, _target=None):
        seen.append(str(messages[-1]["content"]))
        return Completion(text="```js\n" + GAME + "\n```", finish_reason="stop", prompt_tokens=3, cached_tokens=0, completion_tokens=5, ms=4)

    async def check(_code, _known=None, *, short=False):
        gates["n"] += 1
        play = UNPLAYABLE if gates["n"] == 1 else {"ok": True, "complete": True, "findings": []}
        return {"ok": True, "stats": {"triangles": 10, "rawPanels": 0, "play": play}, "warnings": []}

    monkeypatch.setattr(lesson.llm, "complete", complete)
    monkeypatch.setattr(lesson.gate, "check_module", check)
    try:
        result = await lesson.run_lesson("a seesaw", use_library=False, log=False, thread_id="play-1")
    finally:
        lesson.set_checkpointer(previous)
    assert result["ok"] is True and [attempt["stage"] for attempt in result["attempts"]] == ["play", "ok"]
    assert "Move 1 did not register" in result["attempts"][0]["error"]
    assert "Move 1 did not register" in seen[1]  # the repair is told why
