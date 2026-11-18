"""The designer writes design.md (design.py design_doc), with the model calls stubbed: the 12 sections and the scene
plan are checked, what is missing is asked for once, and every way a game is made goes through it (Your games, course
levels, /api/generate); the coder builds from it and the grader checks against it. DESIGN_MODE=json keeps the old
JSON design."""

from __future__ import annotations

import asyncio
from typing import Any

from app.core import llm
from app.pipeline import design, game, grader

SCENE = """```js
const SCENE = {
  mode: 'desk',
  things: {
    bowl: { role: 'hero', size: [0.14, 0.07, 0.14] },   // metres
    jug: { role: 'tool', size: [0.06, 0.1, 0.06] },
    start: { role: 'button', size: [0.06, 0.03, 0.06] },
    panel: { role: 'panel', size: [0.3, 0.3, 0.01] },
  },
  relations: [
    ['jug', 'right of', 'bowl'],
    ['start', 'near', 'bowl'],
  ],
};
```"""

SECTIONS = {
    1: "## 1. Learning\n- Kind: procedure\n- The idea: batter rises when air is folded in.",
    2: "## 2. Player fantasy\nYou are the baker.",
    3: "## 3. Core loop\n1. Goal: bake a tall sponge.\n\n### Moves\n| # | Move | Hand action | Answer | Why | done() when |\n|---|---|---|---|---|---|\n| 1 | Pour the milk | Pour: handPour | The bowl fills | Wet meets dry | bowlGrams >= 150 |",
    4: "## 4. Controls\n| Action | Hand | Gesture | API | Object | Zone | Feedback | Emulator check |\n|---|---|---|---|---|---|---|---|\n| Pour | Right | tip the jug | handPour | Jug 6 cm | right | glug | `{ grab: jug, to: pour.above, tilt: 70 }`; bowlGrams rises |",
    5: f"## 5. Environment\n- Mode: desk, because it is baking at a table\n\n{SCENE}",
    6: "## 6. Levels and progression\n| Level | What changes | 1 star | 2 stars | 3 stars |\n|---|---|---|---|---|\n| 1 | guides on | 3 cm | 4 cm | 5 cm |",
    7: "## 7. Mistakes, failure and reset\n- Try again: resets the bowl",
    8: "## 8. Facts and safety\nSafety notes: none",
    9: "## 9. Visual and UI direction\n- Look: soft-clay, because baking is friendly",
    10: "## 10. Assets\n| ID | Type |\n|---|---|\n| jug | look builder |",
    11: "## 11. Checks\nHand checks: grab the jug and tip it 70 degrees over the bowl: bowlGrams rises.",
    12: "## 12. Out of scope\n- Icing",
}


def doc(leave_out: tuple[int, ...] = (), *, scene: str | None = None) -> str:
    body = {**SECTIONS}
    if scene is not None:
        body[5] = f"## 5. Environment\n- Mode: desk\n\n{scene}"
    return "# Rise and Bake — Design\n\nPour, fold and bake a sponge that rises.\n\n" + "\n\n".join(text for n, text in body.items() if n not in leave_out)


def replies(*texts: str):
    """A stub for llm.complete that answers with these texts in turn, and the messages each call was sent."""
    sent: list[list[dict[str, Any]]] = []

    async def fake_complete(messages, target=None, **kw):
        sent.append(messages)
        text = texts[min(len(sent), len(texts)) - 1]
        return llm.Completion(text=text, finish_reason="stop", prompt_tokens=10, cached_tokens=0, completion_tokens=10, ms=1)

    return fake_complete, sent


def test_the_designer_prompt_is_the_skill_with_its_references() -> None:
    prompt = design.design_doc_prompt()
    assert "design.md" in prompt and "references/controls.md" in prompt
    for name in design.DESIGN_REFERENCES:
        assert f"===== references/{name} =====" in prompt
    # The skill's own front matter is not part of the prompt; the coder's /skills/ paths are explained.
    assert not prompt.startswith("---") and "you do not have them" in prompt


def test_a_whole_design_is_one_call_with_its_mode_look_and_scene(monkeypatch) -> None:
    fake, sent = replies(doc())
    monkeypatch.setattr(llm, "complete", fake)
    made = asyncio.run(design.design_doc("teach me to bake a sponge cake"))
    assert len(sent) == 1 and sent[0][0]["content"] == design.design_doc_prompt()
    assert made["mode"] == "desk" and made["look"] == "soft-clay" and made["title"] == "Rise and Bake"
    assert made["pitch"].startswith("Pour, fold and bake") and made["problems"] == []
    assert set(made["scene"]["things"]) == {"bowl", "jug", "start", "panel"}
    assert made["design_md"].startswith("# Rise and Bake")


def test_missing_sections_are_asked_for_once_by_name(monkeypatch) -> None:
    fake, sent = replies(doc(leave_out=(10, 11, 12)), doc())
    monkeypatch.setattr(llm, "complete", fake)
    made = asyncio.run(design.design_doc("teach me to bake a sponge cake"))
    assert len(sent) == 2 and made["problems"] == []
    asked = sent[1][-1]["content"]
    assert "10. Assets" in asked and "11. Checks" in asked and "12. Out of scope" in asked and "1. Learning" not in asked
    assert sent[1][-2]["role"] == "assistant"


def test_a_missing_scene_plan_is_asked_for_and_a_worse_second_try_is_not_kept(monkeypatch) -> None:
    fake, sent = replies(doc(scene="No plan yet."), doc(leave_out=(4, 6, 8), scene="Still none."))
    monkeypatch.setattr(llm, "complete", fake)
    made = asyncio.run(design.design_doc("bake a cake"))
    assert len(sent) == 2 and "scene plan" in sent[1][-1]["content"]
    # The second document has more missing, so the first stays, with what it still lacks.
    assert "## 4. Controls" in made["design_md"] and made["scene"] is None and len(made["problems"]) == 1


def test_a_scene_plan_is_read_as_data_and_checked() -> None:
    centimetres = SCENE.replace("[0.14, 0.07, 0.14]", "[14, 7, 14]")
    _scene, problems = design._scene(doc(scene=centimetres))
    assert any("metres" in p and "0.12" in p for p in problems)
    _scene, problems = design._scene(doc(scene=SCENE.replace("'tool'", "'gadget'").replace("'right of'", "'under'")))
    assert any("gadget" in p for p in problems) and any("under" in p for p in problems)
    # Read, never run: code in the plan is an error, not something that happens.
    _scene, problems = design._scene(doc(scene=SCENE.replace("[0.06, 0.1, 0.06]", "makeSize()")))
    assert problems and "cannot be read" in problems[0]
    # A plan nested far deeper than any scene plan is refused in words, not with a crash.
    _scene, problems = design._scene(doc(scene=SCENE.replace("[0.06, 0.1, 0.06]", "[" * 5000 + "]" * 5000)))
    assert problems and "cannot be read" in problems[0] and "Nested" in problems[0]
    # Relations are written as the solver reads them, in lower case.
    _scene, problems = design._scene(doc(scene=SCENE.replace("'right of'", "'Right of'")))
    assert any("Right of" in p for p in problems)


def test_a_scene_plan_the_solver_refuses_goes_back_to_the_designer_with_its_words(monkeypatch) -> None:
    # Nov 19: a design wrote ['path', 'between', 'player'] (between takes two things); it passed, the layout failed in
    # the coder's sandbox and the coder spent its calls in the gate's code. The real solver (gate/place.ts) reads it here.
    refused = SCENE.replace("['start', 'near', 'bowl'],", "['start', 'near', 'bowl'],\n    ['jug', 'between', 'player'],")
    fake, sent = replies(doc(scene=refused), doc())
    monkeypatch.setattr(llm, "complete", fake)
    made = asyncio.run(design.design_doc("bake a cake"))
    assert len(sent) == 2
    asked = sent[1][-1]["content"]
    assert "The solver cannot place the scene plan" in asked and "between takes two things" in asked
    assert made["problems"] == [] and set(made["scene"]["things"]) == {"bowl", "jug", "start", "panel"}
    # Refused twice: the design is kept without a scene plan, so the coder is not told one is placed.
    fake, sent = replies(doc(scene=refused), doc(scene=refused))
    monkeypatch.setattr(llm, "complete", fake)
    made = asyncio.run(design.design_doc("bake a cake"))
    assert made["scene"] is None and any("between takes two things" in p for p in made["problems"])


def test_a_reply_that_is_no_design_or_a_failed_call_gives_none(monkeypatch) -> None:
    fake, _sent = replies("I cannot help with that.", "Still no.")
    monkeypatch.setattr(llm, "complete", fake)
    assert asyncio.run(design.design_doc("bake a cake")) is None

    async def broken(messages, target=None, **kw):
        raise RuntimeError("the model is down")

    monkeypatch.setattr(llm, "complete", broken)
    assert asyncio.run(design.design_doc("bake a cake")) is None


def test_your_games_save_design_md_and_hand_it_to_the_coder(monkeypatch) -> None:
    from app.services import studio

    monkeypatch.delenv("DESIGN_MODE", raising=False)
    fake, sent = replies(doc())
    handed: dict[str, Any] = {}

    async def fake_run_lesson(request, **kwargs) -> dict[str, Any]:
        handed.update(kwargs, request=request)
        return {"ok": True, "code": "// game"}

    monkeypatch.setattr(llm, "complete", fake)
    monkeypatch.setattr(game, "run_lesson", fake_run_lesson)
    monkeypatch.setattr(game, "get_checkpointer", lambda: None)
    asyncio.run(game.run_game("teach me to bake a sponge cake", thread_id="t-doc"))
    assert len(sent) == 1 and handed["design"]["design_md"].startswith("# Rise and Bake")
    assert handed["request"] == "teach me to bake a sponge cake"  # the agent writer finds the document as a file
    run = studio.read_run(handed["run_id"])
    assert run["texts"]["design.md"].startswith("# Rise and Bake") and run["events"][0]["file"] == "design.md"


def test_design_mode_json_keeps_the_one_call_json_design(monkeypatch) -> None:
    monkeypatch.setenv("DESIGN_MODE", "json")
    fake, sent = replies('{"title": "Rise", "pitch": "Bake.", "idea": "Air.", "mode": "desk", "rules": "Pour."}')
    handed: dict[str, Any] = {}

    async def fake_run_lesson(request, **kwargs) -> dict[str, Any]:
        handed.update(kwargs, request=request)
        return {"ok": True, "code": "// game"}

    monkeypatch.setattr(llm, "complete", fake)
    monkeypatch.setattr(game, "run_lesson", fake_run_lesson)
    monkeypatch.setattr(game, "get_checkpointer", lambda: None)
    asyncio.run(game.run_game("bake a cake", thread_id="t-json"))
    assert len(sent) == 1 and sent[0][0]["content"] == design.DESIGN_PROMPT and handed["design"] is None


def test_course_levels_are_designed_from_their_prompt(monkeypatch) -> None:
    from app.services import courses

    monkeypatch.delenv("DESIGN_MODE", raising=False)
    asked: list[str] = []
    handed: dict[str, Any] = {}

    async def fake_design_doc(request: str) -> dict[str, Any]:
        asked.append(request)
        return {"design_md": doc(), "mode": "world", "look": "voxel", "title": "Rise", "pitch": "Bake.", "scene": None, "problems": []}

    async def fake_run_lesson(request, **kwargs) -> dict[str, Any]:
        handed.update(kwargs, request=request)
        return {"ok": True, "code": "// level", "model": "m", "attempts": []}

    monkeypatch.setattr(design, "design_doc", fake_design_doc)
    monkeypatch.setattr(courses, "run_lesson", fake_run_lesson)
    monkeypatch.setattr(courses, "save_course", lambda course: None)
    course = {"id": "c1", "request": "baking", "lessons": [{"title": "Rise", "prompt": "Level 1: make the batter rise.", "status": "generating"}]}
    asyncio.run(courses.build_lesson(course, course["lessons"][0]))
    assert asked == ["Level 1: make the batter rise."]
    assert handed["design"]["design_md"].startswith("# Rise and Bake") and "Mode: world" in handed["request"]
    assert course["lessons"][0]["status"] == "ready"


def test_api_generate_designs_a_new_game_and_not_a_change(monkeypatch) -> None:
    from fastapi.testclient import TestClient

    from app import main

    monkeypatch.delenv("DESIGN_MODE", raising=False)
    asked: list[str] = []
    handed: list[dict[str, Any]] = []

    async def fake_design_doc(request: str) -> dict[str, Any]:
        asked.append(request)
        return {"design_md": doc(), "mode": "desk", "look": None, "title": "Rise", "pitch": "Bake.", "scene": None, "problems": []}

    async def fake_run_lesson(request, **kwargs) -> dict[str, Any]:
        handed.append({**kwargs, "request": request})
        return {"ok": True, "code": "// game", "model": "m", "attempts": []}

    monkeypatch.setattr(design, "design_doc", fake_design_doc)
    monkeypatch.setattr(main, "run_lesson", fake_run_lesson)
    with TestClient(main.app) as client:
        assert client.post("/api/generate", json={"prompt": "bake a cake", "kind": "game"}).status_code == 200
        assert client.post("/api/generate", json={"prompt": "make it pink", "kind": "game", "previousCode": "// game"}).status_code == 200
    assert asked == ["bake a cake"]
    # The one-call writer has no sandbox: the document is in its request.
    assert "# Rise and Bake" in handed[0]["request"] and handed[0]["design"]["title"] == "Rise"
    assert handed[1]["request"] == "make it pink" and handed[1]["design"] is None


def test_the_coder_builds_from_design_md_with_its_scene_plan() -> None:
    from app.pipeline.coder import agent as coder

    made = design._read_doc(doc())
    state = {"request": "bake a cake", "design": made}
    files = dict(coder._design_files(state))
    assert files["/work/design.md"].decode().startswith("# Rise and Bake")
    assert b"const SCENE = {" in files["/work/parts/scene.js"] and b'"bowl"' in files["/work/parts/scene.js"]
    task = coder._task_text(state)
    assert "/work/design.md" in task and "write no /work/plan.md" in task and "play block" in task
    assert "already copied into /work/parts/scene.js" in task
    # When the solver could not place the plan as the sandbox opened, the brief says so, with its words.
    refused = coder._task_text({**state, "layout_error": "LAYOUT: not placed.\n['a', 'between', 'b']: between takes two things"})
    assert "could not place it" in refused and "between takes two things" in refused and "already copied" not in refused
    # A repair keeps the module's own scene part: only the document goes in again.
    later = {**state, "attempts": [{"error": "gate"}]}
    assert [path for path, _ in coder._design_files(later)] == ["/work/design.md"]
    assert "already copied" not in coder._task_text(later)
    # Without a document, nothing changes.
    assert coder._design_files({"request": "x"}) == [] and "design.md" not in coder._task_text({"request": "x"})


def test_the_grader_checks_a_designed_game_against_its_design() -> None:
    assert grader.DESIGNED.strip() in grader.rubric_for("bake", designed=True)
    assert grader.DESIGNED.strip() not in grader.rubric_for("bake")
    names = [t.name for t in grader.grader_tools(object(), "game", designed=True)]
    assert names[0] == "read_design" and "read_design" not in [t.name for t in grader.grader_tools(object(), "game")]


def test_the_worked_example_passes_the_design_checks_and_is_the_real_game() -> None:
    """references/example-cake.md is a design the checks accept (12 sections, a scene plan that reads), with three
    levels and the hands kit's helpers, and its scene plan is the one the real cake game is built from (gate/examples/
    cake, which the gate's tests play through) (task 12)."""
    import re

    from app.core.config import REPO_ROOT

    text = (design.DESIGN_SKILL / "references" / "example-cake.md").read_text()
    inner = text[text.index("```markdown\n") + len("```markdown\n"): text.rstrip().rindex("```")]
    made = design._read_doc(inner)
    assert made["problems"] == [] and made["mode"] == "desk" and made["look"] == "ink-toon"
    assert made["title"] == "Rise and Bake"
    # The solver places its scene plan, as the design step now asks of every plan.
    assert asyncio.run(design._solver_problem(made["scene"])) is None
    for helper in ("handPour", "handStir", "motionHeat"):
        assert helper in inner
    levels = [line for line in design._section(inner, 6).splitlines() if re.match(r"^\| \d\.", line)]
    assert len(levels) == 3
    game = (REPO_ROOT / "gate" / "examples" / "cake" / "parts" / "scene.js").read_text()
    assert design._scene("## 5. Environment\n" + game)[0] == made["scene"]
