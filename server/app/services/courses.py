"""Saved courses: a plan of 3 to 5 levels, then the lessons one at a time.

With GAME_MODE=pi a level is built by the pi runner (services/pi_build.py) as a page of its own, served at its `url`
(/api/learn/<course>/<index>/), as a pi game is, and a ready one can be fixed by saying what is wrong on its page
(fix_lesson). Levels made before by the agent writer keep their code and open in the room."""

from __future__ import annotations

import asyncio
import json
import os
import re
import time
import uuid
from typing import Any

from app.core import config as config_mod, llm
from app.core.background import track
from app.core.clock import js_round, now_iso
from app.core.db import count_courses, load_courses, save_course
from app.core.guard import attempt_calls, record_spend
from app.core.json_reply import extract_json
from app.pipeline import design
from app.pipeline.lesson import run_lesson
from app.services import live, pi_build, studio

PLANNER_PROMPT = """You plan a short learning adventure for a mixed-reality headset, for players from about 9 years old to adults. Each level is one learning game on the player's desk: the player does the real thing with their hands, one move at a time, each move says in one line why it matters, and the level ends with a challenge that measures the same idea (a distance, a time, a score) with stars and Try again. Like folding a paper plane fold by fold and then throwing it to see how far it flies. No video, no long reading, no typing.

Plan 3 to 5 levels for the player's request:
- One idea per level, each building on the one before and a little harder: the first level lets the player discover the main idea by doing it; each later level changes one thing (a new force, a new part, a harder target) so the player uses what they learned.
- Every level is something to DO with the hands in 3D: build it, test it, steer it, sort it, balance it or grow it. No level that is only facts on a panel, and no quiz: the player asks the voice tutor when they want to be tested or to know more.
- Each level is simple enough to understand in five seconds, said in one sentence: one gesture per move (fold, throw, cut, pour, stir, twist, push, stack, steer); at most three different hand actions per level; each new action gets its own learn move before the round uses it; no level adds modes or bonus rules.
- A request for a game with no subject still teaches: find the real idea under it (a racing game: speed, grip and turning; a tower game: centre of mass) and plan the levels on it, keeping it a game.
- "prompt" is the full request for the agent that builds that level. It knows nothing else, so in 2 to 4 sentences name the idea, the goal in the player's words, what the hands do (the moves), and what the challenge measures.
- "style" is the look every lesson of the course is drawn in. When the request names one, use it. Otherwise pick the one that fits best, or null for plain realistic materials: "exploded-view" (what is inside an object and how it goes together), "paper-pop-up" (a story or process in a few steps), "ink-toon" (steps, recipes and how-tos with a few objects), "painted" (a process or story that happens in a place), "soft-clay" (friendly objects on a table: amounts, growth, comparison), "voxel" (a small model that builds up in stages), "low-poly" (cycles and journeys in a landscape), "circuit-city" (something travelling through a system, stage by stage).

Reply with only this JSON:
{"title": "2 to 5 words", "subtitle": "one short line", "style": null, "lessons": [{"title": "2 to 4 words", "objective": "After this you can ...", "prompt": "..."}]}"""

STYLES = {
    "exploded-view": "Exploded view", "paper-pop-up": "Paper pop-up",
    "ink-toon": "Ink and toon", "painted": "Painted", "soft-clay": "Soft clay", "voxel": "Voxel",
    "low-poly": "Low-poly", "circuit-city": "Circuit city",
}

OLD_LOOK = "\nDraw it in the "  # plan()'s look line for the agent writer, with its skill and scripts
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
            rest["live"] = watcher.shelf()
        rest["picture"] = studio.picture(f"course-{course['id']}-{index}") is not None
        lessons.append(rest)
    return {**course, "lessons": lessons}


def _import_legacy() -> None:
    folder = config_mod.config.courses_dir
    if not folder.exists():
        return
    for path in sorted(folder.glob("*.json")):
        try:
            course = json.loads(path.read_text(encoding="utf-8"))
            save_course(course)
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
        cut_off = False
        for index, lesson in enumerate(course["lessons"]):
            if lesson.get("status") == "generating" and lesson.get("builder") == "pi":
                # A pi build is not resumed (as for games): a fix gives back the level as it was, a build is failed and
                # is built again when the level is opened.
                cut_off = True
                if lesson.pop("fixing", None) is not None:
                    pi_build.restore_build(level_name(course["id"], index))
                    lesson.update(status="ready", note="The server restarted while this level was being fixed; it is as it was before.")
                else:
                    lesson.update(status="failed", error="The server restarted while this level was being built. Open it to build it again.")
            elif lesson.get("status") == "generating":
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
        elif planning or cut_off:
            save_course(course)
        _courses[course["id"]] = course
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
    if pi_build.enabled():
        course["builder"] = "pi"
    _courses[course["id"]] = course
    _spawn(_plan(course["id"]))
    return course


async def _plan(course_id: str) -> None:
    """Run the course graph. A course whose planning fails is saved as failed (as the TS server's plan() did),
    instead of staying "planning" until a restart."""
    # The course graph imports this module, so the import stays here.
    from app.pipeline.course import run_course

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


async def plan(course: dict[str, Any]) -> None:
    try:
        target = _planner_target()
        reply = await llm.complete(
            [{"role": "system", "content": PLANNER_PROMPT}, {"role": "user", "content": course["request"]}],
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
            f"\nDraw it in the {STYLES[style]} look, like every level of this course: start with "
            f"`node /skills/play/learning-game/scripts/new-game.mjs {style} /work/module.js` and draw it with the {style} "
            f"skill; finish with `node /skills/play/learning-game/scripts/check.mjs /work/module.js`."
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


def queue(course: dict[str, Any], index: int, retry: bool = False) -> None:
    lessons = course.get("lessons") or []
    if index < 0 or index >= len(lessons):
        return
    lesson = lessons[index]
    if not (lesson.get("status") == "pending" or (retry and lesson.get("status") == "failed")):
        return
    lesson["status"] = "generating"
    lesson.pop("error", None)
    if pi_build.enabled():
        lesson["builder"] = "pi"
    else:
        lesson.pop("builder", None)
    _chain(build_lesson(course, lesson))


def level_name(course_id: str, index: int) -> str:
    """The pi runner's name for a level (its project, runs and results)."""
    return f"{course_id}-{index}"


def level_url(course_id: str, index: int) -> str:
    return f"/api/learn/{course_id}/{index}/"


def pi_request(lesson: dict[str, Any]) -> str:
    """What the pi runner is asked to build for a level: its prompt, with the course's look said in plain words (the
    look line plan() wrote, up to its colon) and without the agent writer's skill and scripts."""
    prompt, _, look = lesson["prompt"].partition(OLD_LOOK)
    return f"{prompt}{OLD_LOOK}{look.split(':', 1)[0].strip()}." if look else prompt


def fix_lesson(course: dict[str, Any], index: int, text: str) -> bool:
    """Ask a level's own session to fix what a player says is wrong (as games.fix_game). Only a ready level built by
    the pi runner."""
    lessons = course.get("lessons") or []
    if index < 0 or index >= len(lessons):
        return False
    lesson = lessons[index]
    if lesson.get("builder") != "pi" or lesson.get("status") != "ready" or not lesson.get("url"):
        return False
    lesson.update(status="generating", fixing=text)
    lesson.pop("note", None)
    save_course(course)
    _chain(build_lesson(course, lesson))
    return True


async def _build_with_pi(course: dict[str, Any], lesson: dict[str, Any]) -> None:
    """A level built, or with `fixing` fixed, by the pi runner, as games.write does for a pi game."""
    started = time.time() * 1000
    index = course["lessons"].index(lesson)
    name = level_name(course["id"], index)
    fix = lesson.get("fixing")
    try:
        with live.watching(live.lesson_key(course["id"], index)) as watcher:
            watcher.set_stage("fixing" if fix else "designing")
            result = await pi_build.build({"id": name, "request": pi_request(lesson), "fixes": lesson.get("fixes")}, watcher, follow_up=fix)
        await record_spend([{"model": result["model"], "usd": result["usd"]}])
        if fix is not None:
            lesson.pop("fixing", None)
            if result.get("ok"):  # its note is what Muse says it changed, for the player
                lesson.update(status="ready", fixes=int(lesson.get("fixes") or 0) + 1, note=result.get("answer") or "Muse fixed it.")
            else:
                lesson.update(status="ready", note=f"The fix did not work, so the level is as it was: {result.get('error')}"[:300])
            save_course(course)  # its seconds stay the build's
            return
        if not result.get("ok"):
            raise RuntimeError(result.get("error") or "The level could not be built.")
        lesson.update(status="ready", url=level_url(course["id"], index), model=result["model"], generatedAt=now_iso())
    except Exception as exc:
        if fix is not None:  # the level had a build before the fix: it keeps it
            pi_build.restore_build(name)
            lesson.pop("fixing", None)
            lesson.update(status="ready", note=f"The fix did not work, so the level is as it was: {exc}"[:300])
            save_course(course)
            return
        lesson.update(status="failed", error=str(exc)[:300])
    lesson["seconds"] = js_round((time.time() * 1000 - started) / 1000)
    if course["lessons"] and all(item.get("status") == "ready" for item in course["lessons"]):
        course["status"] = "ready"
    save_course(course)


async def build_lesson(course: dict[str, Any], lesson: dict[str, Any]) -> None:
    if lesson.get("builder") == "pi":
        await _build_with_pi(course, lesson)
        return
    started = time.time() * 1000
    try:
        index = course["lessons"].index(lesson)
        # Every level is a learning game, which needs the skills only the agent writer has (sandbox, scripts).
        # LESSON_MODE=classic sends unstyled lessons to the one-call writer instead (faster, no skills).
        styled = "/skills/looks/" in lesson["prompt"] or "/skills/play/" in lesson["prompt"]
        mode = "classic" if os.environ.get("LESSON_MODE") == "classic" and not styled else "agent"
        with live.watching(live.lesson_key(course["id"], index)):
            # A level is designed first, as a game is (design.py design_doc, from the level's prompt); DESIGN_MODE=json
            # builds it from its prompt alone, as before.
            designed = await design.design_doc(lesson["prompt"]) if design.design_mode() == "doc" else None
            result = await run_lesson(
                design.doc_brief(lesson["prompt"], designed, inline=mode == "classic") if designed else lesson["prompt"],
                thread_id=f"{course['id']}:lesson:{index}",
                mode=mode,
                design=designed,
            )
        await record_spend(attempt_calls(result))
        if not result.get("ok") or not result.get("code"):
            raise RuntimeError(result.get("error") or "The lesson could not be written.")
        lesson.update(status="ready", code=result["code"], model=result["model"], generatedAt=now_iso())
        studio.keep_picture(f"course-{course['id']}-{index}", result.get("id"))
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
            result = await run_lesson(
                lesson["prompt"],
                previous_code=lesson.get("code"),
                pictures=pictures,
                thread_id=f"{course['id']}:polish:{index}",
            )
            await record_spend(attempt_calls(result))
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
    """Lessons a restart put back to pending are already re-queued by load()."""
    load()
