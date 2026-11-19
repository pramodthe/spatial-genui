"""Games built by the pi runner (GAME_MODE=pi), with a stand-in for the runner: no agent, no model, no emulator."""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core import db, guard
from app.core.clock import now_iso
from app.core.db import save_game
from app.services import games, pi_build

# What the real runner leaves behind for a game: a production build, a design document, and a results row.
STAND_IN = r'''
import json, os, signal, sys, time
from pathlib import Path
game_id = sys.argv[1]
if os.environ.get("STAND_IN_HANG") == "1":  # a runner that hangs and ignores SIGTERM
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    print(f"[{game_id}] 1.0 min, 4 turns, 6 tool calls, $0.010 (0 pictures, 0 models), last tool: bash", flush=True)
    time.sleep(120)
archive = Path(os.environ["PI_XR_ARCHIVE"])
assert Path(sys.argv[3]).read_text() == os.environ["STAND_IN_REQUEST"]
passed = os.environ.get("STAND_IN_FAIL") != "1"
print(f"[{game_id}] 1.0 min, 4 turns, 6 tool calls, $0.010 (0 pictures, 0 models), last tool: write", flush=True)
print(f"[{game_id}] the agent stopped after 2.0 min (stop); checking the game ...", flush=True)
game = archive / "games" / game_id
(game / "dist" / "assets").mkdir(parents=True)
(game / "dist" / "index.html").write_text("<html><body><script src='./assets/app.js'></script></body></html>")
(game / "dist" / "assets" / "app.js").write_text("console.log('game')")
(game / "canvas" / "documents").mkdir(parents=True)
(game / "canvas" / "documents" / "design.md").write_text("# Pump It Up - Design\n\nA bike pump.\n")
row = {"name": game_id, "model": os.environ["PI_XR_MODEL"], "thinking": os.environ["PI_XR_THINKING"], "usd": 0.25,
       "check": {"ok": passed, "failures": [] if passed else ["Replay step 1 (move-1): GameState did not change."]}}
with open(archive / "results.jsonl", "a") as rows:
    rows.write(json.dumps(row) + "\n")
sys.exit(0 if passed else 1)
'''


@pytest.fixture
def pi_mode(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    archive = tmp_path / "pi"
    (archive / "template").mkdir(parents=True)
    (archive / "template" / ".pi-xr-template.json").write_text("{}")
    script = tmp_path / "stand_in.py"
    script.write_text(STAND_IN)
    monkeypatch.setenv("GAME_MODE", "pi")
    monkeypatch.setenv("PI_XR_ARCHIVE", str(archive))
    monkeypatch.setenv("STAND_IN_REQUEST", "teach me how a bike pump works")
    monkeypatch.setattr(pi_build, "runner_command", lambda game_id, request_file: [sys.executable, str(script), game_id, "--request-file", str(request_file)])
    return archive


async def _built(request: str = "teach me how a bike pump works") -> dict:
    game = games.start_game(request)
    assert games._tail is not None
    await games._tail
    built = games.get_game(game["id"])
    assert built is not None
    return built


@pytest.mark.asyncio
async def test_a_passing_build_is_ready_with_its_page(pi_mode: Path) -> None:
    before = guard.spend_today()["usd"]
    game = await _built()
    assert game["builder"] == "pi"
    assert game["status"] == "ready", game.get("error")
    assert game["url"] == f"/api/play/{game['id']}/"
    assert game["title"] == "Pump It Up"
    assert game["model"] == "meta/muse-ember-1.0"
    assert "code" not in game
    assert guard.spend_today()["usd"] == pytest.approx(before + 0.25, abs=0.01)
    # It is kept: a fresh load from the database has the builder and the page.
    games.reset()
    again = games.get_game(game["id"])
    assert again is not None and again["url"] == game["url"] and again["builder"] == "pi"


@pytest.mark.asyncio
async def test_a_failing_check_fails_the_game_with_its_reason(pi_mode: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STAND_IN_FAIL", "1")
    game = await _built()
    assert game["status"] == "failed"
    assert "GameState did not change" in game["error"]
    assert "url" not in game


@pytest.mark.asyncio
async def test_without_a_starter_project_the_game_fails_and_says_how_to_make_one(pi_mode: Path) -> None:
    (pi_mode / "template" / ".pi-xr-template.json").unlink()
    game = await _built()
    assert game["status"] == "failed"
    assert "make-template.mjs" in game["error"]


@pytest.mark.asyncio
async def test_a_failed_pi_game_is_not_built_again_by_reading_it(pi_mode: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STAND_IN_FAIL", "1")
    game = await _built()
    assert games.retry_game(game) is False
    assert game["status"] == "failed"


def test_a_pi_game_cut_off_by_a_restart_stays_failed(pi_mode: Path) -> None:
    save_game({"id": "abcd1240", "request": "pump", "title": "Pump", "status": "writing", "createdAt": now_iso(), "builder": "pi"})
    games.load()
    game = games.get_game("abcd1240")
    assert game is not None and game["status"] == "failed" and "restarted" in game["error"]
    assert games._tail is None


@pytest.mark.asyncio
async def test_without_the_setting_a_game_takes_the_usual_pipeline(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GAME_MODE", raising=False)

    async def _usual(_request: str, *, thread_id: str):
        return {"ok": False, "error": "the usual pipeline ran", "attempts": [], "model": "test"}

    monkeypatch.setattr(games, "run_game", _usual)
    game = await _built("pong")
    assert "builder" not in game
    assert "the usual pipeline ran" in game["error"]


def test_the_game_page_is_served_with_a_way_back(pi_mode: Path) -> None:
    game = {"id": "abcd1243", "request": "pump", "title": "Pump", "status": "ready", "createdAt": now_iso(),
            "builder": "pi", "url": pi_build.play_url("abcd1243")}
    save_game(game)
    dist = pi_build.dist_dir(game["id"])
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html><body><script src='./assets/app.js'></script></body></html>")
    (dist / "assets" / "app.js").write_text("console.log('game')")
    db.close_db()  # the app opens its own connection, in the client's thread
    from app.main import app

    with TestClient(app) as client:
        page = client.get(game["url"])
        assert page.status_code == 200
        assert "Back to the Lab" in page.text and "./assets/app.js" in page.text
        policy = page.headers["content-security-policy"]
        assert f"connect-src testserver/api/play/{game['id']}/ " in policy and "'self'" not in policy.split("frame-ancestors")[0]
        script = client.get(f"{game['url']}assets/app.js")
        assert script.status_code == 200 and "javascript" in script.headers["content-type"]
        assert client.get(f"/api/play/{game['id']}", follow_redirects=False).headers["location"] == game["url"]
        assert client.get(f"{game['url']}assets/missing.js").status_code == 404
        assert client.get(f"{game['url']}..%2F..%2Ftemplate%2F.pi-xr-template.json").status_code in (403, 404)
        assert client.get("/api/play/00000000/").status_code == 404


def test_a_database_from_before_gets_the_new_columns(tmp_path: Path) -> None:
    old = tmp_path / "old.db"
    conn = sqlite3.connect(old)
    conn.execute("""CREATE TABLE games (id TEXT PRIMARY KEY, request TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL,
                    error TEXT, code TEXT, model TEXT, seconds INTEGER, created_at TEXT NOT NULL)""")
    conn.execute("INSERT INTO games VALUES ('abcd1241', 'pong', 'Pong', 'ready', NULL, 'code', 'm', 3, '2026-11-01')")
    conn.commit()
    conn.close()
    opened = db._connect(old)
    columns = {row["name"] for row in opened.execute("PRAGMA table_info(games)")}
    assert {"builder", "url"} <= columns
    assert opened.execute("SELECT code FROM games WHERE id = 'abcd1241'").fetchone()["code"] == "code"
    opened.close()


def test_the_runner_gets_the_apps_model_and_reasoning_level(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_REASONING_EFFORT", "high")
    assert pi_build.pi_model() == ("meta/muse-ember-1.0", "high")
    assert pi_build.stage_of("Test with hands, replay interactions") == "testing"
    assert pi_build.stage_of("Write canvas design doc as requirements checklist") == "designing"
    assert pi_build.stage_of("Implement painting studio core") == "building"
    assert json.loads(json.dumps(pi_build.play_url("abcd1242"))) == "/api/play/abcd1242/"


@pytest.mark.asyncio
async def test_a_hung_runner_that_ignores_sigterm_is_killed_and_the_game_fails(pi_mode: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STAND_IN_HANG", "1")
    monkeypatch.setattr(pi_build, "HUNG_S", 1.5)
    monkeypatch.setattr(pi_build, "STOP_WAIT_S", 0.5)
    game = await _built()
    assert game["status"] == "failed"
    assert game["seconds"] < 30
