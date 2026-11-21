"""Games and course levels built by the pi runner (GAME_MODE=pi), with a stand-in for the runner: no agent, no model,
no emulator."""

from __future__ import annotations

import asyncio
import json
import sqlite3
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core import db, guard
from app.core.clock import now_iso
from app.core.db import save_course, save_game
from app.services import courses, games, pi_build

# What the real runner leaves behind for a game: a production build, a design document, and a results row. With
# --continue it is a follow-up in the game's session: it builds again, and its row's art total includes the build's.
# Like the real one, it cannot run beside another runner (one emulator window); STAND_IN_SLOW keeps it running longer.
STAND_IN = r'''
import json, os, signal, sys, time
from pathlib import Path
args = sys.argv[1:]
game_id, continuing = args[0], "--continue" in args
request = Path(args[args.index("--request-file") + 1]).read_text()
if os.environ.get("STAND_IN_HANG") == "1":  # a runner that hangs and ignores SIGTERM
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    print(f"[{game_id}] 1.0 min, 4 turns, 6 tool calls, $0.010 (0 pictures, 0 models), last tool: bash", flush=True)
    time.sleep(120)
if os.environ.get("STAND_IN_CRASH") == "1":  # the runner throws before it starts: Node prints the error, then its version
    print("file:///runner/run.mjs:69\nthrow new Error(`Port 8091 is taken`);\n^\n\nError: Port 8091 is taken by another process: the trial's runtime cannot start.\n    at run.mjs:69:33\n\nNode.js v22.20.0", flush=True)
    sys.exit(1)
archive = Path(os.environ["PI_XR_ARCHIVE"])
busy = archive / "busy"
try:  # made only if it is not there, in one step: two runners started together cannot both make it
    os.close(os.open(busy, os.O_CREAT | os.O_EXCL | os.O_WRONLY))
except FileExistsError:
    print("Error: another runner is running", flush=True)
    sys.exit(1)
time.sleep(float(os.environ.get("STAND_IN_SLOW") or 0))
if continuing:
    assert os.environ["STAND_IN_FIX"] in request and "screenshot" in request and "playtest_replay" in request, request
else:
    assert request in os.environ["STAND_IN_REQUEST"].split("\n|\n"), request
passed = os.environ.get("STAND_IN_FAIL") != "1"
print(f"[{game_id}] 1.0 min, 4 turns, 6 tool calls, $0.010 (0 pictures, 0 models), last tool: write", flush=True)
print(f"[{game_id}] the agent stopped after 2.0 min (stop); checking the game ...", flush=True)
game = archive / "games" / game_id
(game / "dist" / "assets").mkdir(parents=True, exist_ok=True)
(game / "dist" / "index.html").write_text(f"<html><body>{'fixed' if continuing else 'first'}<script src='./assets/app.js'></script></body></html>")
(game / "dist" / "assets" / "app.js").write_text("console.log('game')")
(game / "canvas" / "documents").mkdir(parents=True, exist_ok=True)
(game / "canvas" / "documents" / "design.md").write_text("# Pump It Up - Design\n\nA bike pump.\n")
row = {"name": game_id, "continued": continuing, "started": f"{time.time():.6f}", "model": os.environ["PI_XR_MODEL"],
       "thinking": os.environ["PI_XR_THINKING"], "usd": 0.15 if continuing else 0.25, "media": {"usd": 0.10},
       "check": {"ok": passed, "failures": [] if passed else ["Replay step 1 (move-1): GameState did not change."]},
       "answer": "The legs made a V,\nso I turned them into an A." if continuing else "Built it."}
with open(archive / "results.jsonl", "a") as rows:
    rows.write(json.dumps(row) + "\n")
busy.unlink()
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
    monkeypatch.setattr(pi_build, "runner_command", lambda game_id, request_file, follow_up=False: [
        sys.executable, str(script), game_id, *(["--continue"] if follow_up else []), "--request-file", str(request_file)])
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
        assert 'id="lab-fix"' in page.text and "Something wrong? Tell Muse" in page.text
        assert "#lab-fix[hidden]{display:none!important}" in page.text  # closed until its button opens it
        assert f'"record": "/api/games/{game["id"]}", "level": null' in page.text  # the box asks about this game
        assert "Next level" not in page.text
        policy = page.headers["content-security-policy"]
        assert f"connect-src testserver/api/play/{game['id']}/ " in policy and "'self'" not in policy.split("frame-ancestors")[0]
        # Of the Lab's API, the page reaches only its own record and fix.
        assert f" testserver/api/games/{game['id']} testserver/api/games/{game['id']}/fix testserver/api/live/game-{game['id']} " in policy
        assert "testserver/api/games/ " not in policy and "testserver/api/ " not in policy
        assert f"worker-src testserver/api/play/{game['id']}/ blob: data:" in policy  # walking and turning in XR
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
    assert {"builder", "url", "fixing", "fixes", "note"} <= columns
    lessons = {row["name"] for row in opened.execute("PRAGMA table_info(lessons)")}
    assert {"builder", "url", "fixing", "fixes", "note"} <= lessons
    assert "builder" in {row["name"] for row in opened.execute("PRAGMA table_info(courses)")}
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


@pytest.mark.asyncio
async def test_a_runner_that_throws_fails_with_its_error_not_nodes_version(pi_mode: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STAND_IN_CRASH", "1")
    game = await _built()
    assert game["status"] == "failed"
    assert "Port 8091 is taken" in game["error"] and "Node.js" not in game["error"]


async def _fixed(game: dict, text: str) -> dict:
    assert games.fix_game(game, text) is True
    assert game["status"] == "writing" and game["fixing"] == text
    assert games._tail is not None
    await games._tail
    fixed = games.get_game(game["id"])
    assert fixed is not None
    return fixed


@pytest.mark.asyncio
async def test_a_fix_continues_the_games_session_and_keeps_its_page(pi_mode: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    game = await _built()
    text = "The stand's legs make a V; they should lean in like an A."
    monkeypatch.setenv("STAND_IN_FIX", text)
    before = guard.spend_today()["usd"]
    fixed = await _fixed(game, text)
    assert fixed["status"] == "ready" and fixed["fixes"] == 1
    assert "fixing" not in fixed and fixed["note"] == "The legs made a V, so I turned them into an A."
    assert fixed["url"] == pi_build.play_url(game["id"])
    assert "fixed" in pi_build.dist_dir(game["id"]).joinpath("index.html").read_text()
    assert not (pi_mode / "games" / game["id"] / "dist-previous").exists()
    assert text in (pi_mode / "requests" / f"{game['id']}-fix-1.txt").read_text()
    # The follow-up's row counts the build's art again; only what the fix spent is recorded.
    assert guard.spend_today()["usd"] == pytest.approx(before + 0.05, abs=0.005)
    games.reset()
    again = games.get_game(game["id"])
    assert again is not None and again["status"] == "ready" and again["fixes"] == 1


def test_a_fix_says_what_muse_is_doing_from_its_last_tool(pi_mode: Path) -> None:
    assert pi_build.doing("playtest_view", {}) == "Looking at the game"
    assert pi_build.doing("mcp__iwsdk_runtime__browser_screenshot", {}) == "Looking at the game"
    assert pi_build.doing("read", {"path": "/tmp/shot.PNG"}) == "Looking at the game"
    assert pi_build.doing("read", {"path": "src/systems/game.ts"}) == "Reading its code"
    assert pi_build.doing("edit", {"path": "src/scene-assets/seesaw.ts"}) == "Changing the game"
    assert pi_build.doing("bash", {"command": "npm run typecheck"}) == "Building it again"
    assert pi_build.doing("bash", {"command": "cd src && grep -n tilt *.ts"}) == "Reading its code"
    assert pi_build.doing("playtest_replay", {}) == "Playing it to check"
    assert pi_build._doing("abcd1247") == ""  # no run yet
    run = pi_mode / "runs" / "abcd1247-2026-11-20T00-00-00"
    run.mkdir(parents=True)
    picture = json.dumps({"type": "tool_execution_end", "result": {"content": [{"type": "image", "data": "x" * 70000}]}})
    (run / "events-0.jsonl").write_text(json.dumps({"type": "tool_execution_start", "toolName": "edit", "args": {}}) + "\n")
    (run / "events-1.jsonl").write_text("\n".join([
        json.dumps({"type": "tool_execution_start", "toolName": "playtest_view", "args": {}}),
        json.dumps({"type": "tool_execution_start", "toolName": "read", "args": {"path": "shot.png"}}),
        picture,
    ]) + "\n")
    assert pi_build._doing("abcd1247") == ""  # the newest stream ends with a picture longer than its tail
    (run / "events-1.jsonl").write_text((run / "events-1.jsonl").read_text() + json.dumps(
        {"type": "tool_execution_start", "toolName": "edit", "args": {"path": "src/a.ts"}}) + "\n")
    assert pi_build._doing("abcd1247") == "Changing the game"


def test_the_answer_shown_to_the_player_is_one_short_line() -> None:
    assert pi_build.answer({}) == ""
    assert pi_build.answer({"answer": "  The plank was short.\n\nI made it longer. "}) == "The plank was short. I made it longer."
    long = "The stand was upside down. " * 30
    shown = pi_build.answer({"answer": long})
    assert len(shown) <= pi_build.ANSWER_MAX and shown.endswith("down.")


@pytest.mark.asyncio
async def test_a_fix_that_fails_leaves_the_game_as_it_was(pi_mode: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    game = await _built()
    first = pi_build.dist_dir(game["id"]).joinpath("index.html").read_text()
    monkeypatch.setenv("STAND_IN_FIX", "make the plank longer")
    monkeypatch.setenv("STAND_IN_FAIL", "1")
    fixed = await _fixed(game, "make the plank longer")
    assert fixed["status"] == "ready"
    assert "did not work" in fixed["note"] and "GameState did not change" in fixed["note"]
    assert pi_build.dist_dir(game["id"]).joinpath("index.html").read_text() == first
    assert not fixed.get("fixes")


@pytest.mark.asyncio
async def test_only_a_ready_pi_game_can_be_fixed(pi_mode: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STAND_IN_FAIL", "1")
    failed = await _built()
    assert games.fix_game(failed, "anything") is False and failed["status"] == "failed"
    usual = {"id": "abcd1244", "request": "pong", "title": "Pong", "status": "ready", "createdAt": now_iso(), "code": "x"}
    assert games.fix_game(usual, "anything") is False


def test_the_fix_route_refuses_what_it_cannot_fix(pi_mode: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    save_game({"id": "abcd1245", "request": "pump", "title": "Pump", "status": "failed", "createdAt": now_iso(), "builder": "pi"})
    db.close_db()
    from app.main import app

    async def _admit(_visitor: str, _text: str) -> None:
        return None

    monkeypatch.setattr(guard, "admit", _admit)
    with TestClient(app) as client:
        assert client.post("/api/games/abcd1245/fix", json={"text": "fix it"}).status_code == 409
        assert client.post("/api/games/abcd1245/fix", json={"text": "  "}).status_code == 400
        assert client.post("/api/games/abcd1245/fix", json={"text": "x" * 501}).status_code == 400
        assert client.post("/api/games/00000000/fix", json={"text": "fix it"}).status_code == 404
        assert client.post("/api/games/not-hex!/fix", json={"text": "fix it"}).status_code == 404


def test_a_fix_cut_off_by_a_restart_gives_back_the_game_as_it_was(pi_mode: Path) -> None:
    save_game({"id": "abcd1246", "request": "pump", "title": "Pump", "status": "writing", "createdAt": now_iso(),
               "builder": "pi", "url": pi_build.play_url("abcd1246"), "fixing": "longer plank"})
    games_dir = pi_mode / "games" / "abcd1246"
    (games_dir / "dist").mkdir(parents=True)
    (games_dir / "dist" / "index.html").write_text("half built")
    (games_dir / "dist-previous").mkdir()
    (games_dir / "dist-previous" / "index.html").write_text("as it was")
    games.load()
    game = games.get_game("abcd1246")
    assert game is not None and game["status"] == "ready" and "restarted" in game["note"]
    assert "fixing" not in game
    assert pi_build.dist_dir("abcd1246").joinpath("index.html").read_text() == "as it was"
    assert games._tail is None


def test_without_the_runner_a_game_page_has_no_fix_box(pi_mode: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GAME_MODE")  # a server that cannot run the fix, such as the deployed one
    game = {"id": "abcd1248", "request": "pump", "title": "Pump", "status": "ready", "createdAt": now_iso(),
            "builder": "pi", "url": pi_build.play_url("abcd1248")}
    save_game(game)
    dist = pi_build.dist_dir(game["id"])
    dist.mkdir(parents=True)
    (dist / "index.html").write_text("<html><body>game</body></html>")
    db.close_db()
    from app.main import app

    with TestClient(app) as client:
        page = client.get(game["url"])
        assert page.status_code == 200 and "Back to the Lab" in page.text
        assert "lab-fix" not in page.text and "Tell Muse" not in page.text
        assert "/api/games/" not in page.headers["content-security-policy"]


def test_a_showcase_page_is_served_with_a_way_back_and_nothing_to_fix(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import dataclasses

    from app.core import config as config_mod

    showcase = tmp_path / "showcase"
    (showcase / "fox-trail" / "assets").mkdir(parents=True)
    (showcase / "fox-trail" / "index.html").write_text("<html><body><script src='./assets/app.js'></script></body></html>")
    (showcase / "fox-trail" / "assets" / "app.js").write_text("console.log('fox')")
    (tmp_path / "secret.txt").write_text("not served")
    monkeypatch.setattr(config_mod, "config", dataclasses.replace(config_mod.config, showcase_dir=showcase))
    db.close_db()
    from app.main import app

    with TestClient(app) as client:
        page = client.get("/api/showcase/fox-trail/")
        assert page.status_code == 200 and "Back to the Lab" in page.text and "lab-fix" not in page.text
        policy = page.headers["content-security-policy"]
        assert "connect-src testserver/api/showcase/fox-trail/ " in policy and "/api/games/" not in policy
        script = client.get("/api/showcase/fox-trail/assets/app.js")
        assert script.status_code == 200 and "javascript" in script.headers["content-type"]
        assert client.get("/api/showcase/fox-trail", follow_redirects=False).headers["location"] == "/api/showcase/fox-trail/"
        assert client.get("/api/showcase/no-such-game/").status_code == 404
        assert client.get("/api/showcase/Fox_Trail/").status_code == 404
        assert client.get("/api/showcase/fox-trail/..%2F..%2Fsecret.txt").status_code in (403, 404)


# ---- course levels ----

LOOK = ("\nDraw it in the Soft clay look, like every level of this course: start with "
        "`node /skills/play/learning-game/scripts/new-game.mjs soft-clay /work/module.js` and draw it with the soft-clay "
        "skill; finish with `node /skills/play/learning-game/scripts/check.mjs /work/module.js`.")


def _course(*lessons: dict, style: str | None = "soft-clay") -> dict:
    """A planned course of two levels (as plan() leaves it), each as given over a pending one."""
    rows = []
    for index in range(2):
        prompt = (f"Pump a tyre, level {index + 1}.\n(This is lesson {index + 1} of 2 in the course \"Pumps\": Push, "
                  f"Pull. Cover only this lesson's idea.)") + (LOOK if style else "")
        rows.append({"title": ["Push", "Pull"][index], "objective": "After this you can pump.", "prompt": prompt,
                     "status": "pending", **(lessons[index] if index < len(lessons) else {})})
    save_course({"id": "c0ffee01", "request": "pumps", "title": "Pumps", "subtitle": "", "status": "building",
                 "createdAt": now_iso(), **({"style": style} if style else {}), "lessons": rows})
    course = courses.get_course("c0ffee01")
    assert course is not None
    return course


async def _level(course: dict, index: int) -> dict:
    courses.queue(course, index, True)
    assert courses._tail is not None
    await courses._tail
    return course["lessons"][index]


def _page(name: str, text: str = "first") -> None:
    dist = pi_build.dist_dir(name)
    (dist / "assets").mkdir(parents=True, exist_ok=True)
    (dist / "index.html").write_text(f"<html><body>{text}<script src='./assets/app.js'></script></body></html>")
    (dist / "assets" / "app.js").write_text("console.log('level')")


def test_a_level_asks_the_runner_for_its_look_in_plain_words(pi_mode: Path) -> None:
    course = _course()
    request = courses.pi_request(course["lessons"][1])
    assert request.startswith("Pump a tyre, level 2.\n(This is lesson 2 of 2 in the course")
    assert request.endswith("Cover only this lesson's idea.)\nDraw it in the Soft clay look, like every level of this course.")
    assert "/skills/" not in request and "module.js" not in request
    assert courses.pi_request({"prompt": "Pump a tyre.\n(This is lesson 1 of 2.)"}) == "Pump a tyre.\n(This is lesson 1 of 2.)"


@pytest.mark.asyncio
async def test_a_course_level_is_built_by_the_runner_as_a_page_of_its_own(pi_mode: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    course = _course()
    monkeypatch.setenv("STAND_IN_REQUEST", courses.pi_request(course["lessons"][0]))
    before = guard.spend_today()["usd"]
    level = await _level(course, 0)
    assert level["builder"] == "pi"
    assert level["status"] == "ready", level.get("error")
    assert level["url"] == "/api/learn/c0ffee01/0/" and "code" not in level
    assert level["title"] == "Push" and level["model"] == "meta/muse-ember-1.0"
    assert pi_build.dist_dir("c0ffee01-0").joinpath("index.html").exists()
    assert guard.spend_today()["usd"] == pytest.approx(before + 0.25, abs=0.01)
    assert course["status"] == "building"  # its second level is still to make
    courses.reset()
    again = courses.get_course("c0ffee01")
    assert again is not None and again["lessons"][0]["url"] == level["url"] and again["lessons"][0]["builder"] == "pi"


@pytest.mark.asyncio
async def test_a_level_that_fails_its_check_fails_with_the_reason(pi_mode: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    course = _course()
    monkeypatch.setenv("STAND_IN_REQUEST", courses.pi_request(course["lessons"][0]))
    monkeypatch.setenv("STAND_IN_FAIL", "1")
    level = await _level(course, 0)
    assert level["status"] == "failed" and "GameState did not change" in level["error"]
    assert "url" not in level


@pytest.mark.asyncio
async def test_a_game_and_a_level_are_built_one_after_the_other(pi_mode: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    course = _course()
    monkeypatch.setenv("STAND_IN_REQUEST", f"teach me how a bike pump works\n|\n{courses.pi_request(course['lessons'][0])}")
    monkeypatch.setenv("STAND_IN_SLOW", "0.5")
    game = games.start_game("teach me how a bike pump works")
    courses.queue(course, 0)
    assert games._tail is not None and courses._tail is not None
    await asyncio.gather(games._tail, courses._tail)
    built = games.get_game(game["id"])
    assert built is not None and built["status"] == "ready", built.get("error")
    assert course["lessons"][0]["status"] == "ready", course["lessons"][0].get("error")


@pytest.mark.asyncio
async def test_without_the_setting_a_level_takes_the_usual_pipeline(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GAME_MODE", raising=False)
    monkeypatch.setenv("DESIGN_MODE", "json")

    async def _usual(_request: str, **_kwargs):
        return {"ok": False, "error": "the usual pipeline ran", "attempts": [], "model": "test"}

    monkeypatch.setattr(courses, "run_lesson", _usual)
    course = _course(style=None)
    level = await _level(course, 0)
    assert "builder" not in level and "the usual pipeline ran" in level["error"]


def test_a_level_page_has_the_way_back_its_fix_box_and_the_next_level_once_ready(pi_mode: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _course({"status": "ready", "builder": "pi", "url": courses.level_url("c0ffee01", 0)})
    _page("c0ffee01-0")
    opened: list[tuple[int, bool]] = []
    monkeypatch.setattr(courses, "queue", lambda _course, index, retry=False: opened.append((index, retry)))
    db.close_db()
    from app.main import app

    with TestClient(app) as client:
        page = client.get("/api/learn/c0ffee01/0/")
        assert page.status_code == 200
        assert "Back to the Lab" in page.text and "./assets/app.js" in page.text and "Next level" not in page.text
        assert 'id="lab-fix"' in page.text and '"record": "/api/courses/c0ffee01", "level": 0' in page.text
        policy = page.headers["content-security-policy"]
        assert "connect-src testserver/api/learn/c0ffee01/0/ " in policy
        assert (" testserver/api/courses/c0ffee01 testserver/api/courses/c0ffee01/lessons/0/fix "
                "testserver/api/live/course-c0ffee01-0 ") in policy
        assert "testserver/api/courses/ " not in policy and "testserver/api/ " not in policy
        assert opened == [(0, True), (1, False)]  # opening its page opens the level: the next one starts
        assert client.get("/api/learn/c0ffee01/0/assets/app.js").status_code == 200
        assert opened == [(0, True), (1, False)]  # its files do not open it again
        assert client.get("/api/learn/c0ffee01/0", follow_redirects=False).headers["location"] == "/api/learn/c0ffee01/0/"
        assert client.get("/api/learn/c0ffee01/1/").status_code == 404  # not made yet
        assert client.get("/api/learn/c0ffee01/7/").status_code == 404
        assert client.get("/api/learn/not-hex!/0/").status_code == 404
        assert client.get("/api/learn/c0ffee01/0/..%2F..%2F..%2Ftemplate%2F.pi-xr-template.json").status_code in (403, 404)
        course = courses.get_course("c0ffee01")
        assert course is not None
        course["lessons"][1].update(status="ready", builder="pi", url=courses.level_url("c0ffee01", 1))
        _page("c0ffee01-1")
        page = client.get("/api/learn/c0ffee01/0/")
        assert 'href="/api/learn/c0ffee01/1/"' in page.text and "Next level" in page.text
        last = client.get("/api/learn/c0ffee01/1/")
        assert last.status_code == 200 and "Next level" not in last.text  # the course's last level


@pytest.mark.asyncio
async def test_a_level_fix_continues_its_own_session(pi_mode: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    course = _course()
    monkeypatch.setenv("STAND_IN_REQUEST", courses.pi_request(course["lessons"][0]))
    level = await _level(course, 0)
    text = "The nut does not crack when the pebble hits it."
    monkeypatch.setenv("STAND_IN_FIX", text)
    assert courses.fix_lesson(course, 0, text) is True
    assert level["status"] == "generating" and level["fixing"] == text
    assert courses._tail is not None
    await courses._tail
    assert level["status"] == "ready" and level["fixes"] == 1 and "fixing" not in level
    assert level["note"] == "The legs made a V, so I turned them into an A."
    assert level["url"] == "/api/learn/c0ffee01/0/"
    assert "fixed" in pi_build.dist_dir("c0ffee01-0").joinpath("index.html").read_text()
    assert text in (pi_mode / "requests" / "c0ffee01-0-fix-1.txt").read_text()


@pytest.mark.asyncio
async def test_a_level_fix_that_fails_leaves_the_level_as_it_was(pi_mode: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    course = _course()
    monkeypatch.setenv("STAND_IN_REQUEST", courses.pi_request(course["lessons"][0]))
    level = await _level(course, 0)
    first = pi_build.dist_dir("c0ffee01-0").joinpath("index.html").read_text()
    monkeypatch.setenv("STAND_IN_FIX", "make the nut softer")
    monkeypatch.setenv("STAND_IN_FAIL", "1")
    assert courses.fix_lesson(course, 0, "make the nut softer") is True
    assert courses._tail is not None
    await courses._tail
    assert level["status"] == "ready" and "did not work" in level["note"] and not level.get("fixes")
    assert pi_build.dist_dir("c0ffee01-0").joinpath("index.html").read_text() == first


def test_only_a_ready_pi_level_can_be_fixed(pi_mode: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    course = _course({"status": "ready", "code": "export default function build() {}"})
    assert courses.fix_lesson(course, 0, "anything") is False  # written by the agent writer
    assert courses.fix_lesson(course, 1, "anything") is False  # not made yet
    assert courses.fix_lesson(course, 5, "anything") is False
    db.close_db()
    from app.main import app

    async def _admit(_visitor: str, _text: str) -> None:
        return None

    monkeypatch.setattr(guard, "admit", _admit)
    with TestClient(app) as client:
        assert client.post("/api/courses/c0ffee01/lessons/1/fix", json={"text": "fix it"}).status_code == 409
        assert client.post("/api/courses/c0ffee01/lessons/1/fix", json={"text": " "}).status_code == 400
        assert client.post("/api/courses/c0ffee01/lessons/1/fix", json={"text": "x" * 501}).status_code == 400
        assert client.post("/api/courses/00000000/lessons/0/fix", json={"text": "fix it"}).status_code == 404
        assert client.post("/api/courses/c0ffee01/lessons/12/fix", json={"text": "fix it"}).status_code == 404


def test_a_level_cut_off_by_a_restart_is_failed_or_given_back_as_it_was(pi_mode: Path) -> None:
    _page("c0ffee01-1", "half built")
    previous = pi_mode / "games" / "c0ffee01-1" / "dist-previous"
    previous.mkdir()
    (previous / "index.html").write_text("as it was")
    course = _course({"status": "generating", "builder": "pi"},  # saved as the server left it, then loaded
                     {"status": "generating", "builder": "pi", "url": courses.level_url("c0ffee01", 1), "fixing": "softer nut"})
    built, fixed = course["lessons"]
    assert built["status"] == "failed" and "restarted" in built["error"]
    assert fixed["status"] == "ready" and "restarted" in fixed["note"] and "fixing" not in fixed
    assert pi_build.dist_dir("c0ffee01-1").joinpath("index.html").read_text() == "as it was"
    assert courses._tail is None and not courses._deferred  # nothing is built again until it is opened
    courses.reset()
    again = courses.get_course("c0ffee01")
    assert again is not None and again["lessons"][0]["status"] == "failed"  # saved as such
