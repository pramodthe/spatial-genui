"""The game graph, with the model calls stubbed: the one-call design step (and where the game plays), and the plan's
reference pictures handed to the coder."""

from __future__ import annotations

import asyncio
from typing import Any

from app import studio
from app.graphs import game


def test_default_plan_is_one_call_and_picks_where_it_plays(monkeypatch) -> None:
    from app import llm

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
    from app import llm, media
    from app.agents import coder

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


def test_plan_pictures_are_on_by_default_and_can_be_turned_off(monkeypatch) -> None:
    from app import media

    monkeypatch.setattr(media, "enabled", lambda: True)
    monkeypatch.delenv("PLAN_PICTURES", raising=False)
    assert game.pictures_enabled()
    monkeypatch.setenv("PLAN_PICTURES", "0")
    assert not game.pictures_enabled()
    monkeypatch.delenv("PLAN_PICTURES", raising=False)
    monkeypatch.setattr(media, "enabled", lambda: False)
    assert not game.pictures_enabled()
