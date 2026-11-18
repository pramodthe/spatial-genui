"""Phase 3 coder: one sandbox per run, pin skills once, upload a module on a later run."""

from __future__ import annotations

import asyncio
import time
from types import SimpleNamespace

import pytest
from deepagents.profiles.harness.harness_profiles import _harness_profile_for_model
from langchain.agents.middleware import ModelCallLimitMiddleware, ModelFallbackMiddleware, ToolCallLimitMiddleware
from langchain_openai import ChatOpenAI
from langchain.agents.middleware.model_refusal import ModelRefusalError
from langchain_core.messages import AIMessage
from langgraph.checkpoint.memory import MemorySaver

from app.core import background
from app.core.llm import Completion
from app.pipeline import lesson
from app.pipeline.coder import agent as coder, model_maker
from app.pipeline.coder.middleware import CostMeterMiddleware
from app.services import studio as studio_records
from app.pipeline.prompts import EXAMPLE_MODULE
from sandbox.image import GATE_ENTRY, GATE_ROOT, SKILLS_ROOT, WORK_ROOT, image_layout
from app.core.config import SKILLS_DIR


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
        self.commands: list[str] = []

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

    async def aexecute(self, command: str) -> object:
        self.commands.append(command)
        return None


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
    assert seen["payload"]["pinned_skills"] == ["kit", "panels", "learning-game", "dry-run"]
    assert seen["skills"] == ["/skills/common/", "/skills/play/", "/skills/looks/", "/skills/game/", "/skills/lesson/"]
    assert seen["thread"] == "coder-run/1"
    assert "/work/module.js" not in backend.files or backend.files["/work/module.js"] == b"export default function build(){}"
    # The final view closes the sandbox once its picture is taken, after the result.
    await asyncio.gather(*list(background._tasks))
    assert backend.sandbox.terminated is True
    assert any(isinstance(item, ModelCallLimitMiddleware) for item in seen["middleware"])
    assert any(isinstance(item, ToolCallLimitMiddleware) for item in seen["middleware"])


@pytest.mark.asyncio
async def test_the_module_comes_back_before_the_final_view_with_its_cost(monkeypatch: pytest.MonkeyPatch) -> None:
    """The final view (a play-test of up to four minutes) is taken after the module is downloaded and never delays the
    result; the sandbox closes when its picture is taken. The attempt carries what its cost meters counted."""
    order: list[str] = []
    release = asyncio.Event()
    box: dict[str, object] = {}

    class SlowPlaytest(_Backend):
        async def aexecute(self, command: str, timeout: int | None = None) -> object:
            self.commands.append(command)
            if "playtest.mjs" in command:
                order.append("final view")
                await release.wait()
                return SimpleNamespace(output='{"screenshot": "/work/playtest/view-1.png"}')
            return SimpleNamespace(output="")

        async def adownload_files(self, paths: list[str]) -> list[_File]:
            order.extend(f"download {path}" for path in paths)
            return self.download_files(paths)

    class Agent:
        async def astream_events(self, payload, *, context, config, version):
            files = box["backend"].files
            files["/work/module.js"] = b"export default function build(){}"
            files["/work/playtest/view-1.png"] = b"png"
            # One model call through the coder's cost meter: 100k in (95k of them cached), 1k out.
            usage = {"input_tokens": 100_000, "output_tokens": 1_000, "total_tokens": 101_000, "input_token_details": {"cache_read": 95_000}}
            CostMeterMiddleware(budget_usd=3.0, model_id="gpt-6.1-sol").after_model({"messages": [AIMessage(content="", usage_metadata=usage)]}, None)
            yield {"event": "on_tool_start", "name": "write_file"}

    def factory(**kwargs):
        box["backend"] = kwargs["backend"]
        return Agent()

    _install(monkeypatch, factory)
    monkeypatch.setattr(coder, "ModalSandbox", SlowPlaytest)
    coder.set_checkpointer(None)
    result = await asyncio.wait_for(coder.write_with_agent({"run_id": "final-view-1", "kind": "game", "request": "a kite"}), 10)
    backend = box["backend"]
    assert result["code"] == "export default function build(){}"
    assert result["attempts"][-1]["costUsd"] == pytest.approx(0.0295)
    # A card picture asked for now, before the view exists, is kept when it lands.
    assert studio_records.keep_picture("game-final1", "final-view-1") is False
    await asyncio.sleep(0.05)
    assert "final view" in order and order.index("download /work/module.js") < order.index("final view")
    assert backend.sandbox.terminated is False  # still taking its picture
    release.set()
    await asyncio.gather(*list(background._tasks))
    assert backend.sandbox.terminated is True
    run = studio_records.read_run("final-view-1")
    assert "final-view.png" in run["files"] and any(e["what"] == "final view" and e.get("file") == "final-view.png" for e in run["events"])
    assert studio_records.picture("game-final1") is not None


@pytest.mark.asyncio
async def test_a_repair_closes_the_last_attempts_final_view_before_its_sandbox_opens(monkeypatch: pytest.MonkeyPatch) -> None:
    """A repair's sandbox takes the run's sandbox name, which the last attempt's sandbox holds while it takes its
    final view (Nov 18: AlreadyExistsError on a repair). That view is of a rejected module: it is closed first."""
    order: list[str] = []
    sandboxes: list[_Sandbox] = []

    class NeverDone(_Backend):
        async def aexecute(self, command: str, timeout: int | None = None) -> object:
            self.commands.append(command)
            if "playtest.mjs" in command:
                await asyncio.Event().wait()  # a final view that would take minutes
            return SimpleNamespace(output="")

    class Agent:
        def __init__(self, backend: _Backend) -> None:
            self.backend = backend

        async def astream_events(self, payload, *, context, config, version):
            self.backend.files["/work/module.js"] = b"export default function build(){}"
            yield {"event": "on_tool_start", "name": "write_file"}

    class Tracked(_Sandbox):
        def terminate(self) -> None:
            order.append(f"close {sandboxes.index(self) + 1}")
            super().terminate()

    def open_sandbox(run_id: str, **_options) -> Tracked:
        sandboxes.append(Tracked())
        order.append(f"open {len(sandboxes)}")
        return sandboxes[-1]

    _install(monkeypatch, lambda **kwargs: Agent(kwargs["backend"]))
    monkeypatch.setattr(coder, "ModalSandbox", NeverDone)
    monkeypatch.setattr(coder, "_open_sandbox", open_sandbox)
    coder.set_checkpointer(None)
    first = await coder.write_with_agent({"run_id": "repair-view", "kind": "game", "request": "a kite"})
    await asyncio.sleep(0.05)
    assert first["code"] and order == ["open 1"]  # its final view still holds sandbox 1
    await coder.write_with_agent({"run_id": "repair-view", "kind": "game", "request": "a kite",
                                  "attempts": first["attempts"], "code": first["code"]})
    assert order[:3] == ["open 1", "close 1", "open 2"]
    await asyncio.sleep(0.05)  # the second final view starts (in the app the gate check runs first)
    for task in list(background._tasks):
        task.cancel()
    await asyncio.gather(*list(background._tasks), return_exceptions=True)
    assert sandboxes[1].terminated is True


@pytest.mark.asyncio
async def test_a_repair_waits_for_a_close_that_a_cancel_cut_off(monkeypatch: pytest.MonkeyPatch) -> None:
    """Review of PR #31: a cancel that lands while the last attempt's sandbox is closing must not let the repair open
    a sandbox of the same name before the close has ended."""
    order: list[str] = []
    sandboxes: list[_Sandbox] = []

    class SlowClose(_Sandbox):
        def terminate(self) -> None:
            number = sandboxes.index(self) + 1
            order.append(f"closing {number}")
            time.sleep(0.3)  # Modal's terminate is a blocking call, run in a thread
            order.append(f"closed {number}")
            super().terminate()

    class QuickView(_Backend):
        async def aexecute(self, command: str, timeout: int | None = None) -> object:
            self.commands.append(command)
            return SimpleNamespace(output="")  # no picture: the view ends at once and the close begins

    class Agent:
        def __init__(self, backend: _Backend) -> None:
            self.backend = backend

        async def astream_events(self, payload, *, context, config, version):
            self.backend.files["/work/module.js"] = b"export default function build(){}"
            yield {"event": "on_tool_start", "name": "write_file"}

    def open_sandbox(run_id: str, **_options) -> SlowClose:
        sandboxes.append(SlowClose())
        order.append(f"open {len(sandboxes)}")
        return sandboxes[-1]

    _install(monkeypatch, lambda **kwargs: Agent(kwargs["backend"]))
    monkeypatch.setattr(coder, "ModalSandbox", QuickView)
    monkeypatch.setattr(coder, "_open_sandbox", open_sandbox)
    coder.set_checkpointer(None)
    first = await coder.write_with_agent({"run_id": "repair-race", "kind": "game", "request": "a kite"})
    await asyncio.sleep(0.05)
    assert order == ["open 1", "closing 1"]  # the close is under way when the repair comes
    await coder.write_with_agent({"run_id": "repair-race", "kind": "game", "request": "a kite",
                                  "attempts": first["attempts"], "code": first["code"]})
    assert order.index("closed 1") < order.index("open 2")
    await asyncio.gather(*list(background._tasks), return_exceptions=True)
    assert all(sandbox.terminated for sandbox in sandboxes)


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
    # A repair has its own budget: the first attempt's spend on the thread would stop it after one reply.
    assert seen["payload"]["cost_usd"] == 0.0
    # The saved module goes back to kits.js and game.js for the repair, and is built again before it is read.
    assert any("build-module.mjs --split /work/module.js" in c for c in seen["backend"].commands)
    assert seen["backend"].commands[-1].endswith("build-module.mjs /work/module.js")
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
    # The sandbox outlives the agent's deadline, so a tool still running at the deadline cannot take the module with it.
    assert kwargs["timeout"] == coder.WALL_S + coder.SANDBOX_GRACE_S
    assert kwargs["name"] == "genui-run-1"
    assert captured["app"] == (coder.APP_NAME, True)


def test_the_prompt_points_at_the_motion_kit_unless_switched_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CODER_MOTION", raising=False)
    assert "/skills/game/motion" in coder._prompt("game") and "/skills/game/motion" in coder._prompt("lesson")
    monkeypatch.setenv("CODER_MOTION", "0")
    assert "/skills/game/motion" not in coder._prompt("game")


def test_image_puts_the_gate_and_skills_at_absolute_paths() -> None:
    destinations = [dest for _source, dest in image_layout()]
    assert GATE_ROOT in destinations
    assert SKILLS_ROOT in destinations
    assert WORK_ROOT == "/work"
    assert all("/opt/repo/" not in dest for dest in destinations)
    script = SKILLS_DIR / "common" / "dry-run" / "scripts" / "check.mjs"
    assert f"'{GATE_ENTRY}'" in script.read_text(encoding="utf-8")
    for skill in SKILLS_DIR.rglob("SKILL.md"):
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
