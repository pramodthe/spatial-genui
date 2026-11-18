"""The coder's grading loop: one rubric per request, a switch to turn it off, and tools that read the sandbox."""

import asyncio
from types import SimpleNamespace

import pytest

from app.pipeline import grader


def test_rubric_names_the_request_and_the_loop() -> None:
    text = grader.rubric_for("Make a bat game with sound:\n  hunt moths by their echoes.")
    assert "Make a bat game with sound: hunt moths by their echoes." in text
    assert "game ok" in text and "Try again" in text and "before Start" in text
    assert len(text.splitlines()) == 9


def test_rubric_can_be_turned_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CODER_RUBRIC", raising=False)
    assert grader.enabled()
    monkeypatch.setenv("CODER_RUBRIC", "0")
    assert not grader.enabled()


def test_grader_tools_run_in_the_sandbox() -> None:
    commands: list[str] = []

    class Backend:
        async def aexecute(self, command: str, timeout: int | None = None) -> SimpleNamespace:
            commands.append(command)
            return SimpleNamespace(output="game ok")

    playtest, check, read, pictures = grader.grader_tools(Backend(), "game")
    assert asyncio.run(check.ainvoke({})) == "game ok"
    asyncio.run(read.ainvoke({"offset": 300}))
    asyncio.run(playtest.ainvoke({}))
    assert commands[0] == grader.CHECK
    assert "sed -n '301,600p'" in commands[1] and "export default function" in commands[1] and "/work/game.js" in commands[1]
    assert commands[2] == grader.PLAYTEST + " --game"
    # No pictures drawn for this game: the grader is told so instead of seeing an error.
    assert "No plan pictures" in str(asyncio.run(pictures.ainvoke({})))


def test_tool_images_move_to_a_user_message() -> None:
    from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

    from app.pipeline.coder.middleware import move_tool_images

    image = {"type": "image", "base64": "xx", "mime_type": "image/png"}
    messages = [
        HumanMessage("go"),
        AIMessage(content="", tool_calls=[{"id": "a", "name": "read_file", "args": {}}, {"id": "b", "name": "ls", "args": {}}]),
        ToolMessage(tool_call_id="a", name="read_file", content=[{"type": "text", "text": "view-1.png"}, image]),
        ToolMessage(tool_call_id="b", name="ls", content="a b"),
    ]
    moved = move_tool_images(messages)
    assert [type(m).__name__ for m in moved] == ["HumanMessage", "AIMessage", "ToolMessage", "ToolMessage", "HumanMessage"]
    assert image not in moved[2].content and image in moved[4].content
    assert move_tool_images(messages[:2]) == messages[:2]


def test_budget_stop_answers_pending_tool_calls() -> None:
    from langchain_core.messages import AIMessage, ToolMessage

    from app.pipeline.coder.middleware import CostMeterMiddleware

    meter = CostMeterMiddleware(budget_usd=0.0001, model_id="gpt-6.1-sol")
    asked = AIMessage(content="", tool_calls=[{"id": "t1", "name": "execute", "args": {}}], usage_metadata={"input_tokens": 1000, "output_tokens": 10, "total_tokens": 1010})
    update = meter.after_model({"messages": [asked]}, None)
    assert update["jump_to"] == "end"
    answered = [m for m in update["messages"] if isinstance(m, ToolMessage)]
    assert [m.tool_call_id for m in answered] == ["t1"] and "budget" in update["messages"][-1].content


def test_grading_is_skipped_once_the_budget_is_spent() -> None:
    from types import SimpleNamespace

    from app.pipeline.coder.middleware import CostMeterMiddleware  # noqa: F401  (the coder's key is cost_usd)

    middleware = grader.rubric_middleware(SimpleNamespace(model_name="gpt-6.1-sol"), SimpleNamespace(), budget_usd=3.0)
    assert middleware.after_agent({"cost_usd": 3.2, "rubric": "- x", "messages": []}, None) is None


def test_studio_reads_survive_a_half_written_file_and_refuse_dot_ids() -> None:
    from app.services.studio import StudioRun, read_run, run_dir

    run = StudioRun("studio-torn-run", "a kite", "game", "m")
    run.event("director", "plan", "wrote the plan")
    (run.dir / "events.json").write_text('[{"t": 0, "who": "dir')  # another process caught mid-write
    assert read_run("studio-torn-run")["events"] == []
    run.event("grader", "verdict", "pass")
    assert [e["what"] for e in read_run("studio-torn-run")["events"]] == ["plan", "verdict"]
    assert not list(run.dir.glob(".*.part"))  # written whole, by rename
    assert run_dir("..") is None and run_dir(".") is None and run_dir("ok-run.1") is not None


def test_studio_keeps_a_runs_record_across_a_repair() -> None:
    from app.services.studio import StudioRun, read_run

    first = StudioRun("studio-test-run", "a kite", "game", "m")
    first.event("director", "plan", "wrote the design doc")
    first.save("plan.md", b"# Kite")
    first.finish("failed", error="gate")
    again = StudioRun("studio-test-run", "a kite", "game", "m")
    again.finish("ready", code="// module")
    run = read_run("studio-test-run")
    assert [e["what"] for e in run["events"]] == ["plan", "repair"]
    assert run["status"] == "ready" and "module.js" in run["files"] and run["texts"]["plan.md"] == "# Kite"
    assert StudioRun("../escape/1", "x", "game", "m").dir.parent == first.dir.parent


def test_studio_keeps_each_attempts_module_and_serves_the_latest() -> None:
    from app.services.studio import StudioRun

    first = StudioRun("studio-attempts-run", "blocks", "game", "m")
    first.save("module.js", b"// first build")
    assert first.saved("module.js") == b"// first build"
    first.finish("failed", error="gate")
    again = StudioRun("studio-attempts-run", "blocks", "game", "m")
    assert again.saved("module.js") is None  # the repair starts its own copy
    assert (again.dir / "files" / "module-attempt-1.js").read_bytes() == b"// first build"
