"""The scene plan (agent_skills/play/learning-game/references/scene.md): a game started with one has its things placed
by the solver (gate/src/place.ts), and the check holds the built game to the plan."""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

from app.core.config import SKILLS_DIR
from app.pipeline.coder import agent as coder

API = Path(__file__).resolve().parents[1]
GATE = API.parent / "gate"
SCRIPTS = SKILLS_DIR / "play" / "learning-game" / "scripts"

pytestmark = pytest.mark.skipif(not (GATE / "node_modules" / ".bin" / "tsx").exists(), reason="the gate is not installed")


def _env(**extra: str) -> dict[str, str]:
    return {**os.environ, "GATE_TSX": str(GATE / "node_modules" / ".bin" / "tsx"), "GATE_ENTRY": str(GATE / "gate.ts"), **extra}


def _run(script: str, *args: str, **env: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["node", str(SCRIPTS / script), *args], capture_output=True, text=True, env=_env(**env), timeout=120)


def _places(scene: Path) -> dict:
    line = next(line for line in scene.read_text().splitlines() if line.startswith("const PLACES = "))
    return json.loads(line[len("const PLACES = "):].rstrip(";"))


@pytest.mark.parametrize("flags", [(), ("--world",)], ids=["desk", "world"])
def test_a_game_started_with_a_scene_plan_has_it_placed(tmp_path: Path, flags: tuple[str, ...]) -> None:
    module = tmp_path / "module.js"
    assert _run("new-game.mjs", "low-poly", str(module), *flags, SCENE_PLAN="1").returncode == 0
    places = _places(tmp_path / "parts" / "scene.js")
    assert "hero" in places and "start" in places and ("panel" in places) == (not flags)  # a world's panel is the app's
    # The plan and its places are part of the module, and the module still passes the gate.
    assert "const PLACES = " in module.read_text()
    done = subprocess.run(["node", str(SKILLS_DIR / "common" / "dry-run" / "scripts" / "check.mjs"), str(module)], capture_output=True, text=True, env=_env(PLAY_CHECK="0"), timeout=120)
    assert json.loads(done.stdout.strip().splitlines()[0])["ok"]


def test_no_scene_plan_unless_the_run_asks_for_one(tmp_path: Path) -> None:
    module = tmp_path / "module.js"
    assert _run("new-game.mjs", "low-poly", str(module)).returncode == 0
    assert not (tmp_path / "parts" / "scene.js").exists() and "Scene:" not in _run("check.mjs", str(module), PLAY_CHECK="0").stdout


def test_the_check_holds_the_game_to_its_plan(tmp_path: Path) -> None:
    module = tmp_path / "module.js"
    _run("new-game.mjs", "low-poly", str(module), SCENE_PLAN="1")
    game, scene = tmp_path / "game.js", tmp_path / "parts" / "scene.js"

    def check() -> str:
        return _run("check.mjs", str(module), PLAY_CHECK="0").stdout

    # Nothing stands where the plan says yet.
    assert "Scene: `hero` is in the plan and nowhere in the game" in check()
    # The hero as planned, and Start built far wider than its plan.
    code = game.read_text()
    marker = "  const targets = look.demo(subject);\n"
    assert marker in code
    game.write_text(code.replace(marker, marker + """
  const hero = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.1), new THREE.MeshStandardMaterial());
  subject.add(hero);
  sceneAt(THREE, hero, 'hero', { ground: set.userData.top });
  const wide = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.06), new THREE.MeshStandardMaterial());
  subject.add(wide);
  sceneAt(THREE, wide, 'start', { ground: set.userData.top });
"""))
    out = check()
    assert "`hero`" not in out and "Scene: `start` is built 0.2 x 0.03 x 0.06, bigger than the 0.06 x 0.03 x 0.06" in out
    # Its real size in the plan, not placed again: stale. Placed again: fine.
    scene.write_text(scene.read_text().replace("start: { role: 'button', size: [0.06, 0.03, 0.06] }", "start: { role: 'button', size: [0.2, 0.03, 0.06] }"))
    assert "Scene: SCENE changed since it was placed" in check()
    placed = _run("layout.mjs", str(module))
    assert placed.returncode == 0 and "layout ok" in placed.stdout
    assert "Scene:" not in check()
    # A plan that cannot be placed says why; the game keeps its last places, and the check sends the coder back.
    scene.write_text(scene.read_text().replace("  relations: [\n", "  relations: [\n    ['start', 'near', 'hero', 0.01], ['start', 'far', 'hero'],\n"))
    refused = _run("layout.mjs", str(module))
    assert refused.returncode == 1 and "No place for `start`" in refused.stdout
    assert "Scene: SCENE changed since it was placed" in check()


def test_the_coder_is_told_about_the_scene_plan_only_when_it_is_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CODER_SCENE_PLAN", raising=False)
    assert "scene.js" not in coder._prompt("game")
    monkeypatch.setenv("CODER_SCENE_PLAN", "1")
    assert "/work/parts/scene.js" in coder._prompt("game") and "layout.mjs" in coder._prompt("game")
