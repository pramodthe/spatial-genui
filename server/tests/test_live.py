"""Live preview: a lesson written under live.watching streams its parts and gate-checked scenes."""

from __future__ import annotations

import asyncio

import httpx
import pytest
from langgraph.checkpoint.memory import MemorySaver

from app.core import llm
from app.core.llm import Completion, LlmTarget
from app.pipeline import lesson
from app.pipeline.prompts import EXAMPLE_MODULE
from app.services import live


@pytest.fixture
def isolated_graph():
    previous = lesson.get_checkpointer()
    lesson.set_checkpointer(MemorySaver())
    yield
    lesson.set_checkpointer(previous)


@pytest.mark.asyncio
async def test_a_watched_lesson_streams_parts_and_scenes(monkeypatch: pytest.MonkeyPatch, isolated_graph: None) -> None:
    reply = "```js\n" + EXAMPLE_MODULE + "\n```"
    snapshots: list[str] = []

    async def complete(_messages, _target=None, *, on_text=None):
        assert on_text is not None
        for end in range(400, len(reply), 400):
            on_text(reply[:end])
            await asyncio.sleep(0.01)
        on_text(reply)
        return Completion(text=reply, finish_reason="stop", prompt_tokens=3, cached_tokens=0, completion_tokens=5, ms=4)

    async def snapshot(text, _known=None):
        snapshots.append(text)
        return {"ok": True, "code": "export default function build() {}", "meshes": len(snapshots)}

    async def check(_code, _known=None, *, short=False):
        return {"ok": True, "stats": {"rawPanels": 0}, "warnings": []}

    monkeypatch.setattr(lesson.llm, "complete", complete)
    monkeypatch.setattr(lesson.gate, "check_module", check)
    monkeypatch.setattr(live.gate, "snapshot", snapshot)
    monkeypatch.setattr(live, "SNAPSHOT_EVERY_S", 0)
    with live.watching("course-abc-0") as watcher:
        result = await lesson.run_lesson("a lighthouse", use_library=False, log=False, thread_id="live-1")
    assert result["ok"] is True
    view = live.get("course-abc-0").view()
    assert view["done"] and view["ok"] and view["stage"] == "ready"
    assert "Lighthouse" in view["parts"]
    assert view["seq"] >= 1 and view["code"]
    assert live.get("course-abc-0").view(after=view["seq"]).get("code") is None
    assert watcher.attempt == 1


@pytest.mark.asyncio
async def test_an_unwatched_lesson_is_not_streamed(monkeypatch: pytest.MonkeyPatch, isolated_graph: None) -> None:
    async def complete(_messages, _target=None, **kwargs):
        assert "on_text" not in kwargs
        return Completion(text="```js\n" + EXAMPLE_MODULE + "\n```", finish_reason="stop", prompt_tokens=1, cached_tokens=0, completion_tokens=1, ms=1)

    async def check(_code, _known=None, *, short=False):
        return {"ok": True, "stats": {"rawPanels": 0}, "warnings": []}

    monkeypatch.setattr(lesson.llm, "complete", complete)
    monkeypatch.setattr(lesson.gate, "check_module", check)
    result = await lesson.run_lesson("a lighthouse", use_library=False, log=False, thread_id="live-2")
    assert result["ok"] is True


@pytest.mark.asyncio
async def test_a_streamed_completion_matches_a_plain_one(monkeypatch: pytest.MonkeyPatch) -> None:
    chunks = [
        'data: {"choices":[{"delta":{"content":"```js\\nexport","role":"assistant"},"index":0}]}',
        'data: {"choices":[{"delta":{"content":" default 1\\n```"},"index":0}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"stop","index":0}],"usage":{"prompt_tokens":7,"completion_tokens":9,"prompt_tokens_details":{"cached_tokens":2}}}',
        "data: [DONE]",
    ]
    sent: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        import json
        sent.append(json.loads(request.content))
        return httpx.Response(200, text="\n\n".join(chunks) + "\n\n", headers={"content-type": "text/event-stream"})

    real_client = httpx.AsyncClient
    monkeypatch.setattr(llm.httpx, "AsyncClient", lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))
    seen: list[str] = []
    target = LlmTarget(id="m", base_url="https://api.openai.com/v1/", api_key="k", model="m")
    done = await llm.complete([{"role": "user", "content": "hi"}], target, on_text=seen.append)
    assert done.text == "```js\nexport default 1\n```"
    assert (done.finish_reason, done.prompt_tokens, done.completion_tokens, done.cached_tokens) == ("stop", 7, 9, 2)
    assert seen == ["```js\nexport", "```js\nexport default 1\n```"]
    assert sent[0]["stream"] is True and sent[0]["stream_options"] == {"include_usage": True}


def test_a_card_being_made_only_steps_forward() -> None:
    with live.watching("game-steps") as watcher:
        assert watcher.shelf()["step"] == 0
        watcher.set_stage("designing")
        watcher.set_stage("building")
        watcher.set_stage("testing")
        watcher.set_stage("building")  # the coder goes back to building after trying its game
        shelf = watcher.shelf()
        assert shelf["stage"] == "building" and shelf["step"] == 2
        assert shelf["line"].startswith("Building") and shelf["seconds"] >= 0 and shelf["key"] == "game-steps"
        watcher.set_stage("grading")
        assert watcher.shelf()["step"] == 3


def test_the_coders_tools_move_the_card() -> None:
    from app.pipeline.coder import agent

    with live.watching("game-follow") as watcher:
        watcher.set_stage("designing")
        agent._follow({"event": "on_tool_start", "name": "write_file", "data": {"input": {"file_path": "/work/game.js"}}})
        assert (watcher.stage, watcher.step) == ("building", 1)
        agent._follow({"event": "on_tool_start", "name": "execute", "data": {"input": {"command": "node /skills/play/learning-game/scripts/check.mjs"}}})
        assert (watcher.stage, watcher.step) == ("testing", 2)
        agent._follow({"event": "on_tool_start", "name": "execute", "data": {"input": {"command": "ls /work"}}})
        assert watcher.stage == "testing"
