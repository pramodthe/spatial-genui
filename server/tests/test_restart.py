"""What a server restart does to courses and games that were being written."""

from __future__ import annotations

import pytest

from app.core.clock import now_iso
from app.core.db import save_course, save_game
from app.services import courses, games


@pytest.mark.asyncio
async def test_planning_course_fails_on_restart() -> None:
    save_course({
        "id": "abcd1234",
        "request": "the heart",
        "title": "The heart",
        "subtitle": "Planning the course...",
        "status": "planning",
        "createdAt": now_iso(),
        "lessons": [],
    })
    courses.load()
    course = courses.get_course("abcd1234")
    assert course is not None
    assert course["status"] == "failed"
    assert course["error"] == "The server restarted while planning."


@pytest.mark.asyncio
async def test_generating_lesson_is_requeued(monkeypatch: pytest.MonkeyPatch) -> None:
    save_course({
        "id": "abcd1235",
        "request": "gears",
        "title": "Gears",
        "subtitle": "",
        "status": "building",
        "createdAt": now_iso(),
        "lessons": [{
            "title": "Teeth",
            "objective": "",
            "prompt": "Show two gears.",
            "status": "generating",
        }],
    })

    async def _stopped(*_args, **_kwargs):
        return {"ok": False, "error": "stopped in the test", "attempts": [], "model": "test", "code": None}

    monkeypatch.setattr(courses, "run_lesson", _stopped)
    courses.load()
    assert courses._tail is not None
    await courses._tail
    lesson = courses.get_course("abcd1235")["lessons"][0]
    assert lesson["status"] == "failed"
    assert "stopped in the test" in lesson["error"]


@pytest.mark.asyncio
async def test_writing_game_is_requeued(monkeypatch: pytest.MonkeyPatch) -> None:
    save_game({
        "id": "abcd1236",
        "request": "pong",
        "title": "Pong",
        "status": "writing",
        "createdAt": now_iso(),
    })

    async def _stopped(_request: str, *, thread_id: str):
        assert thread_id == "abcd1236"
        return {"ok": False, "error": "stopped in the test", "attempts": [], "model": "test"}

    monkeypatch.setattr(games, "run_game", _stopped)
    games.load()
    assert games._tail is not None
    await games._tail
    game = games.get_game("abcd1236")
    assert game is not None
    assert game["status"] == "failed"
    assert "stopped in the test" in game["error"]
