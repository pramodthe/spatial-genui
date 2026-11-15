"""Lesson graph: repair, give up, and resume after the gate crashes."""

from __future__ import annotations

import json

import pytest
from langgraph.checkpoint.memory import MemorySaver

from app.graphs import lesson
from app.graphs.course import _graph as course_graph
from app.graphs.game import _graph as game_graph
from app.graphs.stream import lesson_events
from app.llm import Completion
from app.prompt import EXAMPLE_MODULE


def _completion(text: str) -> Completion:
    return Completion(text=text, finish_reason="stop", prompt_tokens=3, cached_tokens=0, completion_tokens=5, ms=4)


@pytest.fixture
def isolated_graph():
    previous = lesson.get_checkpointer()
    lesson.set_checkpointer(MemorySaver())
    yield
    lesson.set_checkpointer(previous)


def test_course_and_game_graphs_compile() -> None:
    assert course_graph() is not None
    assert game_graph() is not None


@pytest.mark.asyncio
async def test_repair_then_gate(monkeypatch: pytest.MonkeyPatch, isolated_graph: None) -> None:
    calls = {"complete": 0, "gate": 0}

    async def complete(_messages, _target=None):
        calls["complete"] += 1
        if calls["complete"] == 1:
            return _completion("I forgot the block.")
        return _completion("```js\n" + EXAMPLE_MODULE + "\n```")

    async def check(_code, _known=None, *, short=False):
        calls["gate"] += 1
        return {"ok": True, "stats": {"triangles": 10, "rawPanels": 0}, "warnings": []}

    monkeypatch.setattr(lesson.llm, "complete", complete)
    monkeypatch.setattr(lesson.gate, "check_module", check)
    result = await lesson.run_lesson("a lighthouse", use_library=False, log=False, thread_id="repair-1")
    assert result["ok"] is True
    assert result["stats"]["triangles"] == 10
    assert calls["complete"] == 2
    assert calls["gate"] == 1
    assert [attempt["stage"] for attempt in result["attempts"]] == ["no-code", "ok"]


@pytest.mark.asyncio
async def test_give_up_after_three_failures(monkeypatch: pytest.MonkeyPatch, isolated_graph: None) -> None:
    calls = {"complete": 0}

    async def complete(_messages, _target=None):
        calls["complete"] += 1
        return _completion("still no code")

    async def check(_code, _known=None, *, short=False):
        raise AssertionError("the gate should not run when there is no code")

    monkeypatch.setattr(lesson.llm, "complete", complete)
    monkeypatch.setattr(lesson.gate, "check_module", check)
    result = await lesson.run_lesson("a lighthouse", use_library=False, log=False, thread_id="give-up")
    assert result["ok"] is False
    assert calls["complete"] == 3
    assert len(result["attempts"]) == 3
    assert result["error"]


@pytest.mark.asyncio
async def test_resume_retries_the_gate(monkeypatch: pytest.MonkeyPatch, isolated_graph: None) -> None:
    calls = {"complete": 0, "gate": 0}

    async def complete(_messages, _target=None):
        calls["complete"] += 1
        return _completion("```js\n" + EXAMPLE_MODULE + "\n```")

    async def check(_code, _known=None, *, short=False):
        calls["gate"] += 1
        if calls["gate"] == 1:
            raise RuntimeError("gate crashed")
        return {"ok": True, "stats": {"triangles": 10, "rawPanels": 0}, "warnings": []}

    monkeypatch.setattr(lesson.llm, "complete", complete)
    monkeypatch.setattr(lesson.gate, "check_module", check)
    with pytest.raises(RuntimeError, match="gate crashed"):
        await lesson.run_lesson("a lighthouse", use_library=False, log=False, thread_id="resume-1")
    result = await lesson.run_lesson("a lighthouse", use_library=False, log=False, thread_id="resume-1")
    assert result["ok"] is True
    assert calls["complete"] == 1
    assert calls["gate"] == 2


@pytest.mark.asyncio
async def test_stream_chunks_are_v2_dicts(monkeypatch: pytest.MonkeyPatch, isolated_graph: None) -> None:
    async def complete(_messages, _target=None):
        return _completion("```js\n" + EXAMPLE_MODULE + "\n```")

    async def check(_code, _known=None, *, short=False):
        return {"ok": True, "stats": {"triangles": 10, "rawPanels": 0}, "warnings": []}

    monkeypatch.setattr(lesson.llm, "complete", complete)
    monkeypatch.setattr(lesson.gate, "check_module", check)
    chunks = []
    async for line in lesson_events(
        {"request": "a lighthouse", "kind": "lesson", "mode": "classic", "use_library": False, "log": False, "pictures": []},
        {"configurable": {"thread_id": "stream-1"}},
    ):
        chunks.append(json.loads(line))
    assert chunks
    assert all(isinstance(chunk, dict) and chunk.get("type") in {"updates", "custom"} for chunk in chunks)


@pytest.mark.asyncio
async def test_a_retried_lesson_starts_clean(monkeypatch: pytest.MonkeyPatch, isolated_graph: None) -> None:
    """A course lesson written again on its thread must not keep the failed run's error, id or timing."""
    replies = {"ok": False}

    async def complete(_messages, _target=None):
        return _completion("```js\n" + EXAMPLE_MODULE + "\n```" if replies["ok"] else "no code here")

    async def check(_code, _known=None, *, short=False):
        return {"ok": True, "stats": {"triangles": 10, "rawPanels": 0}, "warnings": []}

    monkeypatch.setattr(lesson.llm, "complete", complete)
    monkeypatch.setattr(lesson.gate, "check_module", check)
    failed = await lesson.run_lesson("a lighthouse", use_library=False, log=False, thread_id="course:lesson:0")
    assert failed["ok"] is False and failed["error"]
    replies["ok"] = True
    retried = await lesson.run_lesson("a lighthouse", use_library=False, log=False, thread_id="course:lesson:0")
    assert retried["ok"] is True
    assert "error" not in retried or not retried["error"]
    assert retried["id"] != failed["id"]
    assert [attempt["stage"] for attempt in retried["attempts"]] == ["ok"]
    assert 0 <= retried["totalMs"] < 60_000


@pytest.mark.asyncio
async def test_a_refusal_reaches_the_result(monkeypatch: pytest.MonkeyPatch, isolated_graph: None) -> None:
    """`refused` from the agent writer survives the graph state, so /api/generate can answer 422."""

    async def write_with_agent(state):
        attempt = {"stage": "no-code", "ms": 0, "error": "The model refused: no", "promptTokens": 0, "completionTokens": 0, "finishReason": "stop"}
        return {"attempts": [*state.get("attempts", []), attempt], "code": None, "ok": False, "error": "The model refused: no", "refused": True}

    monkeypatch.setattr(lesson, "write_with_agent", write_with_agent, raising=False)
    import app.agents.coder as coder_module

    monkeypatch.setattr(coder_module, "write_with_agent", write_with_agent)
    result = await lesson.run_lesson("something", use_library=False, log=False, mode="agent", thread_id="refuse-1")
    assert result["ok"] is False
    assert result.get("refused") is True
