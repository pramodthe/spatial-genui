"""Phase 3 coder: one sandbox per run, pin skills once, upload a module on a later run."""

from __future__ import annotations

from pathlib import Path

import pytest
from deepagents.profiles.harness.harness_profiles import _harness_profile_for_model
from langchain.agents.middleware import ModelCallLimitMiddleware, ModelFallbackMiddleware, ToolCallLimitMiddleware
from langchain_openai import ChatOpenAI
from langchain.agents.middleware.model_refusal import ModelRefusalError
from langgraph.checkpoint.memory import MemorySaver

from app.agents import coder, model_maker
from app.graphs import lesson
from app.llm import Completion
from app.prompt import EXAMPLE_MODULE
from sandbox.image import GATE_ENTRY, GATE_ROOT, SKILLS_ROOT, WORK_ROOT, image_layout


class _Model:
    def __init__(self, name: str, base: str) -> None:
        self.model_name = name
        self.openai_api_base = base


def _completion(text: str) -> Completion:
    return Completion(text=text, finish_reason="stop", prompt_tokens=3, cached_tokens=0, completion_tokens=5, ms=4)


class _File:
    def __init__(self, path: str, content: bytes | None) -> None:
        self.path = path
        self.content = content
        self.error = None if content else "file_not_found"


class _Backend:
    def __init__(self, *, sandbox: object) -> None:
        self.sandbox = sandbox
        self.files: dict[str, bytes] = {}

    def upload_files(self, files: list[tuple[str, bytes]]) -> list[object]:
        self.files.update(dict(files))
        return []

    def download_files(self, paths: list[str]) -> list[_File]:
        return [_File(path, self.files.get(path)) for path in paths]

    # The coder uses the async forms (Modal's sync RPCs would block the event loop).
    async def aupload_files(self, files: list[tuple[str, bytes]]) -> list[object]:
        return self.upload_files(files)

    async def adownload_files(self, paths: list[str]) -> list[_File]:
        return self.download_files(paths)


class _Sandbox:
    def __init__(self) -> None:
        self.terminated = False

    def terminate(self) -> None:
        self.terminated = True


def _install(monkeypatch: pytest.MonkeyPatch, agent_factory):
    monkeypatch.setattr(coder, "agent_model", lambda: _Model("gpt-6.1-sol", "https://api.openai.com/v1"))
    monkeypatch.setattr(model_maker, "agent_model", lambda: _Model("gpt-6.1-sol", "https://api.openai.com/v1"))
    monkeypatch.setattr(coder, "_open_sandbox", lambda _run_id: _Sandbox())
    monkeypatch.setattr(coder, "ModalSandbox", _Backend)
    monkeypatch.setattr(coder, "create_deep_agent", agent_factory)


@pytest.mark.asyncio
async def test_first_run_pins_skills_and_returns_the_module(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, object] = {}

    class Agent:
        async def astream_events(self, payload, *, context, config, version):
            seen["payload"] = payload
            seen["version"] = version
            seen["thread"] = config["configurable"]["thread_id"]
            backend_box["backend"].files["/work/module.js"] = b"export default function build(){}"
            yield {"event": "on_tool_start", "name": "write_file"}

    backend_box: dict[str, _Backend] = {}

    def factory(**kwargs):
        backend_box["backend"] = kwargs["backend"]
        seen["skills"] = kwargs["skills"]
        seen["checkpointer"] = kwargs["checkpointer"]
        seen["middleware"] = kwargs["middleware"]
        return Agent()

    _install(monkeypatch, factory)
    coder.set_checkpointer(None)
    result = await coder.write_with_agent({"run_id": "run/1", "kind": "lesson", "request": "a heart"})
    backend = backend_box["backend"]
    assert result["code"] == "export default function build(){}"
    # v2 is the async event iterator; v3 returns a run-stream object that `async for` cannot iterate.
    assert seen["version"] == "v2"
    assert seen["payload"]["pinned_skills"] == ["kit", "panels", "lesson-craft", "dry-run"]
    assert seen["skills"] == ["/skills/common/", "/skills/lesson/"]
    assert seen["thread"] == "coder-run/1"
    assert "/work/module.js" not in backend.files or backend.files["/work/module.js"] == b"export default function build(){}"
    assert backend.sandbox.terminated is True
    assert any(isinstance(item, ModelCallLimitMiddleware) for item in seen["middleware"])
    assert any(isinstance(item, ToolCallLimitMiddleware) for item in seen["middleware"])


@pytest.mark.asyncio
async def test_repair_uploads_the_module_and_does_not_repin(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, object] = {}

    class Agent:
        async def aget_state(self, _config):
            return type("Snap", (), {"values": {"skills_fingerprint": "old", "messages": [{"role": "user"}]}})()

        async def astream_events(self, payload, *, context, config, version):
            seen["payload"] = payload
            yield {"event": "on_chain_end"}

    def factory(**kwargs):
        seen["backend"] = kwargs["backend"]
        return Agent()

    _install(monkeypatch, factory)
    monkeypatch.setattr(coder, "skills_fingerprint", lambda: "new")
    coder.set_checkpointer(MemorySaver())
    code = "export default function build(root){}"
    result = await coder.write_with_agent({
        "run_id": "again",
        "kind": "game",
        "request": "table tennis",
        "attempts": [{"error": "no score"}],
        "code": code,
    })
    assert seen["backend"].files["/work/module.js"] == code.encode()
    assert "pinned_skills" not in seen["payload"]
    assert seen["payload"]["skills_metadata"] is None
    assert "host gate rejected" in seen["payload"]["messages"][0]["content"]
    assert result["code"] == code
    coder.set_checkpointer(None)


@pytest.mark.asyncio
async def test_refusal_and_missing_file(monkeypatch: pytest.MonkeyPatch) -> None:
    class Refuse:
        async def astream_events(self, payload, *, context, config, version):
            raise ModelRefusalError("no")
            yield {}

    def factory(**_kwargs):
        return Refuse()

    _install(monkeypatch, factory)
    refused = await coder.write_with_agent({"run_id": "r", "request": "a bomb"})
    assert refused["refused"] is True
    assert refused["ok"] is False

    class Empty:
        async def astream_events(self, payload, *, context, config, version):
            yield {"event": "on_chain_end"}

    monkeypatch.setattr(coder, "create_deep_agent", lambda **_kwargs: Empty())
    missing = await coder.write_with_agent({"run_id": "r2", "request": "a chair"})
    assert missing["ok"] is False
    assert "module.js" in missing["error"]


def test_sandbox_create_blocks_the_network(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    class App:
        @staticmethod
        def lookup(name, create_if_missing=False):
            captured["app"] = (name, create_if_missing)
            return "app"

    class Sandbox:
        @staticmethod
        def create(**kwargs):
            captured["kwargs"] = kwargs
            return "box"

    monkeypatch.setattr(coder.modal, "App", App)
    monkeypatch.setattr(coder.modal, "Sandbox", Sandbox)
    monkeypatch.setattr(coder, "coder_image", lambda: "image")
    assert coder._open_sandbox("run/1") == "box"
    kwargs = captured["kwargs"]
    assert kwargs["block_network"] is True
    assert kwargs["image"] == "image"
    assert kwargs["workdir"] == "/work"
    assert kwargs["timeout"] == coder.WALL_S
    assert kwargs["name"] == "genui-run-1"
    assert captured["app"] == (coder.APP_NAME, True)


def test_image_puts_the_gate_and_skills_at_absolute_paths() -> None:
    destinations = [dest for _source, dest in image_layout()]
    assert GATE_ROOT in destinations
    assert SKILLS_ROOT in destinations
    assert WORK_ROOT == "/work"
    assert all("/opt/repo/" not in dest for dest in destinations)
    script = Path(__file__).resolve().parents[1] / "skills" / "common" / "dry-run" / "scripts" / "check.mjs"
    assert f"'{GATE_ENTRY}'" in script.read_text(encoding="utf-8")
    for skill in (Path(__file__).resolve().parents[1] / "skills").rglob("SKILL.md"):
        for line in skill.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if stripped.startswith("node "):
                assert stripped.startswith("node /"), skill


def test_profile_disables_the_general_subagent_and_delete() -> None:
    assert coder.OPENAI_PROFILE.general_purpose_subagent.enabled is False
    assert "delete" in coder.OPENAI_PROFILE.excluded_tools
    assert not coder.OPENAI_PROFILE.system_prompt_suffix
    model = ChatOpenAI(model="gpt-6.1-sol", api_key="missing")
    profile = _harness_profile_for_model(model, None)
    assert profile.general_purpose_subagent.enabled is False
    assert not profile.system_prompt_suffix


def test_muse_falls_back_to_gpt() -> None:
    middleware = coder.coder_middleware(_Model("muse-spark", "https://api.meta.ai/v1"))
    assert any(isinstance(item, ModelFallbackMiddleware) for item in middleware)


def test_model_maker_is_isolated() -> None:
    spec = model_maker.model_maker_spec()
    assert spec["mode"] == "isolated"
    assert spec["skills"] == ["/skills/common/", "/skills/model/"]
    assert spec["system_prompt"]
    names = [getattr(tool, "name", "") for tool in spec["tools"]]
    assert "library_lookup" in names
    assert "start_asset_job" not in names


@pytest.fixture
def isolated_graph():
    previous = lesson.get_checkpointer()
    lesson.set_checkpointer(MemorySaver())
    yield
    lesson.set_checkpointer(previous)


@pytest.mark.asyncio
async def test_agent_mode_checks_the_module_on_the_host(monkeypatch: pytest.MonkeyPatch, isolated_graph: None) -> None:
    async def fake(state):
        assert state["request"] == "a heart"
        return {"attempts": [{"stage": "ok", "ms": 1, "promptTokens": 1, "completionTokens": 1, "finishReason": "stop"}], "code": EXAMPLE_MODULE}

    async def check(_code, _known=None, *, short=False):
        return {"ok": True, "stats": {"triangles": 12, "rawPanels": 0}, "warnings": []}

    monkeypatch.setattr(lesson, "write_with_agent", fake)
    monkeypatch.setattr(lesson.gate, "check_module", check)
    result = await lesson.run_lesson("a heart", use_library=False, log=False, mode="agent", thread_id="agent-1")
    assert result["ok"] is True
    assert result["stats"]["triangles"] == 12


@pytest.mark.asyncio
async def test_agent_look_and_fix_reviews_then_rewrites(monkeypatch: pytest.MonkeyPatch, isolated_graph: None) -> None:
    seen: dict[str, object] = {}

    async def complete(messages, _target=None):
        seen["pictures"] = messages[-1]["content"]
        return _completion("The valve is floating.")

    async def fake(state):
        seen["critique"] = state.get("critique")
        seen["previous"] = state.get("previous_code")
        return {"attempts": [{"stage": "ok", "ms": 1, "promptTokens": 1, "completionTokens": 1, "finishReason": "stop"}], "code": EXAMPLE_MODULE}

    async def check(_code, _known=None, *, short=False):
        return {"ok": True, "stats": {"triangles": 4, "rawPanels": 0}, "warnings": []}

    monkeypatch.setattr(lesson.llm, "complete", complete)
    monkeypatch.setattr(lesson, "write_with_agent", fake)
    monkeypatch.setattr(lesson.gate, "check_module", check)
    result = await lesson.run_lesson(
        "a heart",
        previous_code="export default function build(root){}",
        pictures=["data:image/jpeg;base64,aaaa"],
        use_library=False,
        log=False,
        mode="agent",
        thread_id="agent-fix",
    )
    assert result["ok"] is True
    assert "valve" in seen["critique"]
    assert seen["previous"] == "export default function build(root){}"
    assert seen["pictures"][1]["type"] == "image_url"


@pytest.mark.asyncio
async def test_agent_keeps_a_lesson_the_reviewer_accepts(monkeypatch: pytest.MonkeyPatch, isolated_graph: None) -> None:
    async def complete(_messages, _target=None):
        return _completion("LOOKS GOOD")

    async def fake(_state):
        raise AssertionError("an accepted lesson is not written again")

    monkeypatch.setattr(lesson.llm, "complete", complete)
    monkeypatch.setattr(lesson, "write_with_agent", fake)
    result = await lesson.run_lesson(
        "a heart",
        previous_code=EXAMPLE_MODULE,
        pictures=["data:image/jpeg;base64,aaaa"],
        use_library=False,
        log=False,
        mode="agent",
        thread_id="agent-keep",
    )
    assert result["ok"] is True
    assert result["code"] == EXAMPLE_MODULE
