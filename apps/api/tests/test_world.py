"""The world starter: new-game.mjs --world builds a world around the player (the land kit, mode 'world') that passes
the gate, and a desk game stays as it was."""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

API = Path(__file__).resolve().parents[1]
GATE = API.parent / "gate"
NEW_GAME = API / "skills" / "play" / "learning-game" / "scripts" / "new-game.mjs"
DRY_RUN = API / "skills" / "common" / "dry-run" / "scripts" / "check.mjs"

pytestmark = pytest.mark.skipif(not (GATE / "node_modules" / ".bin" / "tsx").exists(), reason="the gate is not installed")


def _start(tmp_path: Path, *flags: str) -> str:
    out = tmp_path / "module.js"
    subprocess.run(["node", str(NEW_GAME), "low-poly", str(out), *flags], check=True, capture_output=True, text=True)
    return str(out)


def _dry_run(module: str) -> dict:
    env = {**os.environ, "GATE_TSX": str(GATE / "node_modules" / ".bin" / "tsx"), "GATE_ENTRY": str(GATE / "gate.ts")}
    done = subprocess.run(["node", str(DRY_RUN), module], capture_output=True, text=True, env=env, timeout=120)
    return json.loads(done.stdout.strip().splitlines()[0])


def test_the_world_starter_builds_land_and_passes_the_gate(tmp_path: Path) -> None:
    module = _start(tmp_path, "--world")
    code = Path(module).read_text()
    assert "const WORLD = true;" in code and "function worldTerrain" in code and "mode: 'world'" in code
    result = _dry_run(module)
    assert result["ok"], result
    assert result["stats"]["drawCalls"] <= 150
    assert result["stats"]["size"][0] > 5  # the land and mountains around the player, in desk units


def test_a_desk_starter_has_no_world(tmp_path: Path) -> None:
    code = Path(_start(tmp_path)).read_text()
    assert "const WORLD = false;" in code and "function worldTerrain" not in code
