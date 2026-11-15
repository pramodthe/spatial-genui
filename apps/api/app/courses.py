"""Saved courses: plan, optional 3D model, lessons one at a time. Same rules as courses.ts."""

from __future__ import annotations

import asyncio
import json
import os
import re
import time
import uuid
from typing import Any

from app import config as config_mod
from app import library, live, llm
from app.a2ui.catalog import extract_json
from app.clock import now_iso
from app.db import count_courses, load_courses, save_course, save_model, saved_models
from app.assets import start_asset_job
from app.clock import js_round
from app.graphs.lesson import run_lesson
from app.guard import record_spend
from app.background import track

PLANNER_PROMPT = """You plan a short hands-on course for a mixed-reality headset. Each lesson is one interactive 3D scene on the learner's desk: a detailed model they can pick up, turn and take apart, with one small panel of text and buttons. A lesson has no video, no long reading and no typing.

Plan 3 to 4 lessons for the learner's request:
- One idea or mechanism per lesson, ordered so each builds on the one before. The first lesson shows the whole thing and names its main parts.
- Every lesson must be something to SEE and HANDLE in 3D: a structure with parts, a process shown step by step, a cause and its effect the learner can change with a button or by moving something. No lesson that is only facts on a panel, and no quiz or flash-card lesson: the learner asks the voice tutor when they want to be tested or to know more.
- "prompt" is the full request for the agent that builds that lesson. It knows nothing else, so name the subject, what the 3D model must show, and what the learner does with it (2 to 3 sentences).
- "model": when the course is about ONE real physical object (a jet engine, a microscope, a guitar, a heart), describe it, and a realistic 3D model of its outside is built with separate parts. "name" is its everyday name (1 to 3 words), "describe" is one sentence on what it looks like from outside, "parts" are 4 to 7 outside parts a learner could take off and name. The lessons then use this model. Use null when the course is about a process, an idea or several things (the water cycle, photosynthesis, the solar system).
- If the request comes with a list of models already made and one of them is this course's object, use it instead of describing a new one: "model": {"use": "<its id>"}. Then plan the lessons around the parts it has.
- "style" is the look every lesson of the course is drawn in. When the request names one, use it. Otherwise pick the one that fits best, or null for plain realistic materials: "exploded-view" (what is inside an object and how it goes together), "paper-pop-up" (a story or process in a few steps), "pencil-sketch" (how something is built, anatomy of an object), "ink-toon" (steps, recipes and how-tos with a few objects), "painted" (a process or story that happens in a place), "soft-clay" (friendly objects on a table: amounts, growth, comparison), "voxel" (a small model that builds up in stages), "low-poly" (cycles and journeys in a landscape), "circuit-city" (something travelling through a system, stage by stage). With a style, set "model" to null: the lessons build everything in the look.

Reply with only this JSON:
{"title": "2 to 5 words", "subtitle": "one short line", "style": null, "model": {"name": "...", "describe": "...", "parts": ["..."]}, "lessons": [{"title": "2 to 4 words", "objective": "After this you can ...", "prompt": "..."}]}"""

STYLES = {
    "exploded-view": "Exploded view", "paper-pop-up": "Paper pop-up", "pencil-sketch": "Pencil sketch",
    "ink-toon": "Ink and toon", "painted": "Painted", "soft-clay": "Soft clay", "voxel": "Voxel",
    "low-poly": "Low-poly", "circuit-city": "Circuit city",
}

PLAIN_NAME = re.compile(r"^[\w '-]{2,40}$", re.ASCII)
REMOVED_KIT = re.compile(r"\bkit\.(matchQuiz|flashcards)\b")
MAX_COURSES = 200

_courses: dict[str, dict[str, Any]] = {}
_loaded = False
_planner: llm.LlmTarget | None = None
_planner_loaded = False
_tail: asyncio.Task[Any] | None = None
_deferred: list[Any] = []


def reset() -> None:
    global _loaded, _planner, _planner_loaded, _tail
    _courses.clear()
    _loaded = False
    _planner = None
    _planner_loaded = False
    _tail = None
    _deferred.clear()


def _spawn(coro: Any) -> None:
    try:
        track(asyncio.get_running_loop().create_task(coro))
    except RuntimeError:
        _deferred.append(coro)


def drain_deferred() -> None:
    while _deferred:
        track(asyncio.get_running_loop().create_task(_deferred.pop(0)))


def summary(course: dict[str, Any]) -> dict[str, Any]:
    lessons = []
    for index, lesson in enumerate(course["lessons"]):
        rest = {key: value for key, value in lesson.items() if key not in {"code", "firstCode", "critique", "prompt"}}
        watcher = live.get(live.lesson_key(course["id"], index)) if lesson.get("status") == "generating" else None
        if watcher is not None:
            rest["live"] = {"key": watcher.key, "line": watcher.line(), "seq": watcher.seq}
        lessons.append(rest)
    return {**course, "lessons": lessons}


def _remember(model: dict[str, Any] | None) -> None:
    if model and model.get("status") == "ready" and model.get("assetId"):
        save_model({
            "id": model["assetId"],
            "name": model["name"],
            "describe": model.get("describe") or "",
            "parts": model.get("built") or model.get("parts") or [],
            "seconds": model.get("seconds"),
        })


def _import_legacy() -> None:
    folder = config_mod.config.courses_dir
    if not folder.exists():
        return
    for path in sorted(folder.glob("*.json")):
        try:
            course = json.loads(path.read_text(encoding="utf-8"))
            save_course(course)
            _remember(course.get("model"))
        except Exception as exc:
            print(f"Skipping unreadable course file {path.name}: {exc}")


def load() -> None:
    global _loaded
    if _loaded:
        return
    _loaded = True
    if count_courses() == 0:
        _import_legacy()
    for course in load_courses():
        resume_at: list[int] = []
        for index, lesson in enumerate(course["lessons"]):
            if lesson.get("status") == "generating":
                lesson["status"] = "pending"
                resume_at.append(index)
            if lesson.get("polish") == "running":
                lesson.pop("polish", None)
        planning = course.get("status") == "planning"
        if planning:
            course["status"] = "failed"
            course["error"] = "The server restarted while planning."
        runnable = [lesson for lesson in course["lessons"] if not REMOVED_KIT.search(f"{lesson.get('code') or ''}\n{lesson.get('prompt') or ''}")]
        if runnable and len(runnable) < len(course["lessons"]):
            course["lessons"] = runnable
            if course.get("status") == "building" and all(lesson.get("status") == "ready" for lesson in runnable):
                course["status"] = "ready"
            save_course(course)
        elif planning:
            save_course(course)
        _courses[course["id"]] = course
        if (course.get("model") or {}).get("status") == "building":
            _spawn(build_model(course))
        else:
            for index in resume_at:
                if index < len(course["lessons"]):
                    queue(course, index)


def list_courses() -> list[dict[str, Any]]:
    load()
    return [summary(course) for course in sorted(_courses.values(), key=lambda item: item["createdAt"], reverse=True)]


def get_course(course_id: str) -> dict[str, Any] | None:
    load()
    return _courses.get(course_id)


def _planner_target() -> llm.LlmTarget:
    global _planner, _planner_loaded
    if not _planner_loaded:
        _planner_loaded = True
        try:
            _planner = llm.load_model(os.environ.get("COURSE_PLANNER") or config_mod.config.model)
        except Exception as exc:
            print(f"Course planner unavailable ({exc}); the main model plans.")
            _planner = llm.default_target()
    return _planner or llm.default_target()


def start_course(request: str) -> dict[str, Any]:
    load()
    if len(_courses) >= MAX_COURSES:
        raise RuntimeError("The course shelf is full.")
    title = f"{request[:37]}..." if len(request) > 40 else request
    course: dict[str, Any] = {
        "id": uuid.uuid4().hex[:8],
        "request": request,
        "title": title,
        "subtitle": "Planning the course...",
        "status": "planning",
        "createdAt": now_iso(),
        "lessons": [],
    }
    _courses[course["id"]] = course
    _spawn(_plan(course["id"]))
    return course


async def _plan(course_id: str) -> None:
    """Run the course graph. A course whose planning fails is saved as failed (as the TS server's plan() did),
    instead of staying "planning" until a restart."""
    # The course graph imports this module, so the import stays here.
    from app.graphs.course import run_course

    try:
        await run_course(course_id)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        course = _courses.get(course_id)
        if course is not None and course.get("status") == "planning":
            course.update(status="failed", error=str(exc), subtitle="")
            save_course(course)
        raise


def _chain(coro: Any) -> None:
    global _tail
    previous = _tail

    async def run() -> None:
        if previous is not None:
            try:
                await previous
            except Exception:
                pass
        try:
            await coro
        except Exception as exc:
            print(exc)

    _tail = track(asyncio.create_task(run()))


def _models_made() -> list[dict[str, Any]]:
    catalog = library.library_catalog()
    return [model for model in saved_models() if model["id"] in catalog]


def _wanted_model(model: Any) -> dict[str, Any] | None:
    if not isinstance(model, dict):
        return None
    name = model.get("name")
    describe = model.get("describe")
    if not isinstance(name, str) or not PLAIN_NAME.fullmatch(name.strip()) or not isinstance(describe, str) or not describe.strip():
        return None
    parts = [str(part).strip().lower() for part in (model.get("parts") or [])]
    parts = [part for part in parts if PLAIN_NAME.fullmatch(part)][:8]
    return {"name": name.strip().lower(), "describe": describe.strip()[:300], "parts": parts}


async def plan(course: dict[str, Any]) -> None:
    try:
        target = _planner_target()
        made = _models_made() if config_mod.config.course_models else []
        have = ""
        if made:
            lines = "\n".join(f"- {item['id']}: {item['name']} (parts: {', '.join(item['parts'])})" for item in made)
            have = f"\n\nModels already made:\n{lines}"
        reply = await llm.complete(
            [{"role": "system", "content": PLANNER_PROMPT}, {"role": "user", "content": course["request"] + have}],
            target,
        )
        await record_spend([{"model": target.id, "promptTokens": reply.prompt_tokens, "completionTokens": reply.completion_tokens}])
        outline = extract_json(reply.text)
        outline = outline if isinstance(outline, dict) else None
        raw_lessons = outline.get("lessons") if outline else None
        lessons = []
        for item in raw_lessons if isinstance(raw_lessons, list) else []:
            if isinstance(item, dict) and isinstance(item.get("title"), str) and isinstance(item.get("prompt"), str) and item["prompt"].strip():
                lessons.append(item)
        lessons = lessons[:5]
        if len(lessons) < 2:
            raise RuntimeError("The planner returned no usable outline.")
        title = outline.get("title") if outline else None
        if isinstance(title, str) and title.strip():
            course["title"] = title.strip()[:60]
        subtitle = outline.get("subtitle") if outline else None
        course["subtitle"] = subtitle.strip()[:120] if isinstance(subtitle, str) else ""
        names = ", ".join(item["title"] for item in lessons)
        style = outline.get("style") if outline else None
        style = style.strip().lower() if isinstance(style, str) else None
        if style in STYLES:
            course["style"] = style
        look = (
            f"\nDraw it in the {STYLES[style]} look, like every lesson of this course: follow the styles skill (start "
            f"with `node /skills/common/styles/scripts/new-lesson.mjs {style} /work/module.js`, read "
            f"references/briefs/{style}.md and references/hands.md, finish with scripts/check-lesson.mjs)."
        ) if style in STYLES else ""
        course["lessons"] = []
        for index, item in enumerate(lessons):
            objective = item.get("objective")
            course["lessons"].append({
                "title": item["title"].strip()[:60],
                "objective": objective.strip()[:200] if isinstance(objective, str) else "",
                "prompt": (
                    f"{item['prompt'].strip()[:1200]}\n(This is lesson {index + 1} of {len(lessons)} in the course "
                    f"\"{course['title']}\": {names}. Cover only this lesson's idea.)"
                    f"{look}"
                ),
                "status": "pending",
            })
        course["status"] = "building"
        reused = None
        use = (outline or {}).get("model") if isinstance((outline or {}).get("model"), dict) else None
        use_id = use.get("use") if isinstance(use, dict) else None
        if config_mod.config.course_models:
            reused = next((item for item in made if item["id"] == use_id), None)
        wanted = _wanted_model(outline.get("model") if outline else None) if config_mod.config.course_models and not reused and not look else None
        if reused:
            course["model"] = {
                "name": reused["name"], "describe": reused["describe"], "parts": reused["parts"],
                "status": "ready", "assetId": reused["id"], "built": reused["parts"],
            }
        elif wanted:
            course["model"] = {**wanted, "status": "building", "stage": "Waiting to start"}
        save_course(course)
    except Exception as exc:
        course["status"] = "failed"
        course["error"] = str(exc)
        course["subtitle"] = ""
        save_course(course)


def queue_first(course: dict[str, Any]) -> None:
    queue(course, 0)
    if config_mod.config.course_build_all:
        for index in range(1, len(course["lessons"])):
            queue(course, index)


async def build_model(course: dict[str, Any]) -> None:
    model = course["model"]
    started = time.time() * 1000
    job = start_asset_job(
        {"name": model["name"], "describe": model["describe"], "parts": model.get("parts") or []},
        {"search": False, "parts": "blender"},
    )
    while job["status"] in {"queued", "running"}:
        events = job.get("events") or []
        model["stage"] = events[-1]["message"] if events else "Waiting to start"
        await asyncio.sleep(2)
    model.pop("stage", None)
    if job["status"] == "done" and job.get("assetId"):
        model.update(status="ready", assetId=job["assetId"], built=job.get("parts") or [])
    else:
        model.update(status="failed", error=str(job.get("error") or "no model")[:300])
    model["seconds"] = js_round((time.time() * 1000 - started) / 1000)
    save_course(course)
    _remember(model)
    queue_first(course)


def _model_for(course: dict[str, Any]) -> dict[str, Any]:
    model = course.get("model") or {}
    if model.get("status") != "ready" or not model.get("assetId"):
        return {"note": "", "assets": None}
    parts = ", ".join(model.get("built") or [])
    return {
        "note": (
            f"\nA realistic 3D model of the {model['name']} was made for this course ('{model['assetId']}', "
            f"with separate parts: {parts}). Use it whenever the lesson shows the {model['name']} from outside, "
            "so that every lesson of the course shows the same object."
        ),
        "assets": [model["assetId"]],
    }


def queue(course: dict[str, Any], index: int, retry: bool = False) -> None:
    lessons = course.get("lessons") or []
    if index < 0 or index >= len(lessons):
        return
    lesson = lessons[index]
    if not (lesson.get("status") == "pending" or (retry and lesson.get("status") == "failed")):
        return
    if (course.get("model") or {}).get("status") == "building":
        return
    lesson["status"] = "generating"
    lesson.pop("error", None)
    _chain(build_lesson(course, lesson))


async def build_lesson(course: dict[str, Any], lesson: dict[str, Any]) -> None:
    started = time.time() * 1000
    try:
        given = _model_for(course)
        index = course["lessons"].index(lesson)
        # A lesson in a look needs the styles skill, which only the agent writer has (sandbox, scripts). The look is in
        # the lesson's prompt, which is saved, so this holds after a restart. LESSON_MODE=agent sends every lesson there.
        styled = "/skills/common/styles/" in lesson["prompt"]
        mode = "agent" if styled or os.environ.get("LESSON_MODE") == "agent" else "classic"
        with live.watching(live.lesson_key(course["id"], index)):
            result = await run_lesson(
                lesson["prompt"] + given["note"],
                on_demand=False,
                assets=given["assets"],
                thread_id=f"{course['id']}:lesson:{index}",
                mode=mode,
            )
        await record_spend([
            {"model": result["model"], "promptTokens": attempt.get("promptTokens") or 0, "completionTokens": attempt.get("completionTokens") or 0}
            for attempt in result.get("attempts") or []
        ])
        if not result.get("ok") or not result.get("code"):
            raise RuntimeError(result.get("error") or "The lesson could not be written.")
        lesson.update(status="ready", code=result["code"], model=result["model"], generatedAt=now_iso())
    except Exception as exc:
        lesson.update(status="failed", error=str(exc)[:300])
    lesson["seconds"] = js_round((time.time() * 1000 - started) / 1000)
    if course["lessons"] and all(item.get("status") == "ready" for item in course["lessons"]):
        course["status"] = "ready"
    save_course(course)


def open_lesson(course: dict[str, Any], index: int) -> dict[str, Any] | None:
    lessons = course.get("lessons") or []
    if index < 0 or index >= len(lessons):
        return None
    queue(course, index, True)
    if lessons[index].get("status") == "ready":
        queue(course, index + 1)
    return lessons[index]


def polish_lesson(course: dict[str, Any], index: int, pictures: list[str]) -> bool:
    if not config_mod.config.course_polish:
        return False
    lessons = course.get("lessons") or []
    if index < 0 or index >= len(lessons):
        return False
    lesson = lessons[index]
    if lesson.get("status") != "ready" or not lesson.get("code") or lesson.get("polish"):
        return False
    lesson["polish"] = "running"

    async def run() -> None:
        try:
            given = _model_for(course)
            result = await run_lesson(
                lesson["prompt"] + given["note"],
                previous_code=lesson.get("code"),
                pictures=pictures,
                on_demand=False,
                assets=given["assets"],
                thread_id=f"{course['id']}:polish:{index}",
            )
            await record_spend([
                {"model": result["model"], "promptTokens": attempt.get("promptTokens") or 0, "completionTokens": attempt.get("completionTokens") or 0}
                for attempt in result.get("attempts") or []
            ])
            if not result.get("ok") or not result.get("code"):
                raise RuntimeError(result.get("error") or "no revision")
            if result.get("critique"):
                lesson["critique"] = result["critique"]
            if result.get("kept"):
                lesson["polish"] = "kept"
            else:
                lesson["firstCode"] = lesson.get("code")
                lesson["code"] = result["code"]
                lesson["polish"] = "done"
        except Exception as exc:
            lesson["polish"] = "failed"
            print(f"Polishing \"{lesson['title']}\" failed: {exc}")
        save_course(course)

    _chain(run())
    return True


def resume_pending() -> None:
    """Lessons a restart put back to pending, and model builds, are already re-queued by load()."""
    load()
