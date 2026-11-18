"""The game pipeline with the model calls stubbed: the JSON design stage (DESIGN_MODE=json; where the game plays), and
the design's reference pictures handed to the coder. The design document (the default) is in test_design_doc.py."""

from __future__ import annotations

import asyncio
from typing import Any

from app.pipeline import design, game
from app.services import studio


def test_json_plan_is_one_call_and_picks_where_it_plays(monkeypatch) -> None:
    from app.core import llm

    monkeypatch.setenv("DESIGN_MODE", "json")
    replies = []

    async def fake_complete(messages, target=None, **kw):
        replies.append(messages[0]["content"])
        return llm.Completion(text='{"title": "Canopy Climb", "pitch": "Climb the trees.", "idea": "Levers lift.", "mode": "world", "rules": "Pull the rope."}',
                              finish_reason="stop", prompt_tokens=10, cached_tokens=0, completion_tokens=10, ms=1)

    handed: dict[str, Any] = {}

    async def fake_run_lesson(request, **kwargs) -> dict[str, Any]:
        handed.update(kwargs, request=request)
        return {"ok": True, "code": "// game"}

    monkeypatch.setattr(llm, "complete", fake_complete)
    monkeypatch.setattr(game, "run_lesson", fake_run_lesson)
    monkeypatch.setattr(game, "get_checkpointer", lambda: None)
    result = asyncio.run(game.run_game("a jungle gym in a rainforest", thread_id="t-plan"))
    assert result["ok"] is True and len(replies) == 1
    assert "never use the name" in replies[0] and '"mode": "desk or world"' in replies[0]
    assert "Mode: world" in handed["request"] and "--world" in handed["request"]
    run = studio.read_run(handed["run_id"])
    assert run["request"] == "a jungle gym in a rainforest" and run["events"][0]["what"] == "design (world)"


def test_plan_pictures_are_drawn_for_the_coder(monkeypatch, tmp_path) -> None:
    """PLAN_PICTURES=1: the design step draws the first view and a sheet of the main thing, and the coder's task names
    them as references (in the sandbox's /work/plan), never as pictures for the game."""
    from app.core import llm
    from app.services import media
    from app.pipeline.coder import agent as coder

    monkeypatch.setenv("DESIGN_MODE", "json")
    calls = []

    async def fake_complete(messages, target=None, **kw):
        calls.append(messages[0]["content"])
        text = ('{"title": "Kite Hill", "pitch": "Fly the kite.", "idea": "Wind lifts.", "mode": "world", "rules": "Tilt."}'
                if len(calls) == 1 else
                '{"look": "low-poly", "first_view": "a grassy hill, a kite bar on a post ahead", "hero": "a diamond kite sheet"}')
        return llm.Completion(text=text, finish_reason="stop", prompt_tokens=10, cached_tokens=0, completion_tokens=10, ms=1)

    drawn = []

    async def fake_make_image(prompt, *, run_id=None, size="1024x1024"):
        drawn.append((prompt, size))
        media_id = f"img-{len(drawn):010d}"
        (tmp_path / f"{media_id}.png").write_bytes(b"png")
        return {"id": media_id, "file": f"{media_id}.png"}

    handed: dict[str, Any] = {}

    async def fake_run_lesson(request, **kwargs) -> dict[str, Any]:
        handed.update(kwargs, request=request)
        return {"ok": True, "code": "// game"}

    monkeypatch.setenv("PLAN_PICTURES", "1")
    monkeypatch.setattr(media, "enabled", lambda: True)
    monkeypatch.setattr(media, "make_image", fake_make_image)
    monkeypatch.setattr(media, "file_of", lambda media_id: (tmp_path / f"{media_id}.png", "image/png"))
    monkeypatch.setattr(llm, "complete", fake_complete)
    monkeypatch.setattr(game, "run_lesson", fake_run_lesson)
    monkeypatch.setattr(game, "get_checkpointer", lambda: None)
    asyncio.run(game.run_game("a windy hilltop with kites", thread_id="t-pictures"))
    pictures = handed["plan_pictures"]
    assert [p["name"] for p in pictures] == ["first-view", "hero"] and pictures[0]["look"] == "low-poly"
    assert len(drawn) == 2 and "reference pictures for the builder" in calls[1]
    task = coder._task_text({"request": "kites", "plan_pictures": pictures})
    assert "/work/plan/first-view.png" in task and "/work/plan/hero.png" in task and "low-poly" in task
    assert "Never show these pictures in the game" in task
    assert [path for path, _ in coder._picture_files({"plan_pictures": pictures})] == ["/work/plan/first-view.png", "/work/plan/hero.png"]
    # Each picture is kept in the run's Studio record, and its timeline step shows it.
    run = studio.read_run(handed["run_id"])
    assert {"plan/first-view.png", "plan/hero.png"} <= set(run["files"])
    shown = [e for e in run["events"] if e["what"] == "plan picture"]
    assert [e["file"] for e in shown] == ["plan/first-view.png", "plan/hero.png"] and "low-poly" in shown[0]["detail"]


def test_plan_pictures_are_on_by_default_and_can_be_turned_off(monkeypatch, capsys) -> None:
    from app.services import media

    monkeypatch.setattr(media, "enabled", lambda: True)
    monkeypatch.delenv("PLAN_PICTURES", raising=False)
    assert design.pictures_enabled()
    monkeypatch.setenv("PLAN_PICTURES", "0")
    assert not design.pictures_enabled()
    assert capsys.readouterr().out == ""  # turned off on purpose: nothing to say
    monkeypatch.delenv("PLAN_PICTURES", raising=False)
    monkeypatch.setattr(media, "enabled", lambda: False)
    assert not design.pictures_enabled()
    # On, but no provider: one line says why there are none.
    assert capsys.readouterr().out.strip() == "Plan pictures skipped: MEDIA_BASE_URL or MEDIA_API_KEY is not set."


def test_waiting_card_pictures_never_pile_up() -> None:
    """Review of PR #31: a card picture asked for before its run's final view waits only while that view can still
    come, once per name, and never for more than WAITING_MOST runs."""
    studio.StudioRun("wait-run-1", "a kite", "game", "glm")
    assert studio.keep_picture("game-wait1", "wait-run-1") is False
    assert studio.keep_picture("game-wait1", "wait-run-1") is False  # asked twice, kept once
    assert studio._waiting["wait-run-1"] == ["game-wait1"]
    studio.drop_waiting_pictures("wait-run-1")  # the view ended with no picture
    assert "wait-run-1" not in studio._waiting
    for n in range(studio.WAITING_MOST + 5):
        studio.StudioRun(f"wait-many-{n}", "a kite", "game", "glm")
        studio.keep_picture(f"game-many{n}", f"wait-many-{n}")
    assert len(studio._waiting) == studio.WAITING_MOST and "wait-many-0" not in studio._waiting
    studio._waiting.clear()
