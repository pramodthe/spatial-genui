"""Stage 1, design: one model call writes the game's design document, design.md, with the xr-design-doc skill as its
prompt (agent_skills/design/xr-design-doc: the template's 12 sections, the hand actions a game can use, desk and world,
the looks). The host checks it has every section and a scene plan it can read, and asks once more for what is missing.
The coder builds from it (/work/design.md, its scene plan in /work/parts/scene.js) and the grader checks the game
against it. DESIGN_MODE=json keeps the earlier one-call JSON design (DESIGN_KEYS), for side-by-sides. The design is
also drawn as two reference pictures for the coder (never shown in the game): the first view and a front/side/top
sheet of the main thing. PLAN_PICTURES=0 turns the pictures off."""

from __future__ import annotations

import asyncio
import functools
import json
import os
import re
from typing import Any

from app.core import llm
from app.core.config import SKILLS_DIR
from app.core.guard import record_spend
from app.core.json_reply import extract_json
from app.services import media
from app.services.studio import StudioRun

DESIGN_PROMPT = """You design one mixed-reality learning game that is played with the player's hands, before any code is written. Every game here teaches one real idea by playing it: find the idea under the request (a sailing game: how wind pushes a sail; a racing game: speed, grip and turning) and make the rules depend on it, so playing well means understanding it. Players are from about 9 years old to adults.

Keep it simple enough to understand in five seconds without reading: the whole game in one sentence of about 15 words; one gesture per move (each move is one hand action: cut, throw, fold, pour, stir, twist, push, stack, steer); at most three different hand actions in the whole game; each new action gets its own learn move before the round uses it; no modes, bonus allowances or combos. Use a familiar real action, and when the idea is invisible (sound, heat, a force), make it something you can see too. Depth comes from harder versions of the same action, not from more rules.

Make it original: never use the name, characters or look of an existing game, film or brand, even when the request names one; a request that names a game gets an original game of that kind, with its own name.

Choose where it plays. "desk": a toy-sized game on the player's real desk, in mixed reality; the default, and right for most ideas you learn by hand. "world": a place the player stands in and walks around (a riverbank, a campsite, a race track, the inside of a cell); choose it when the request asks for a place, a ride, being inside something, or something too big for a desk.

Reply with only this JSON:
{"title": "2 to 4 words, original", "pitch": "the whole game in one sentence of about 15 words", "idea": "the one idea, as a sentence a player could repeat", "mode": "desk or world", "rules": "how a turn works", "controls": "what each hand does", "learn": "the moves the player learns first, each with why it matters", "scoring": "how points are earned, and why that depends on the idea", "win": "how the game is won", "lose": "how it ends (never before Start)", "difficulty": "what gets harder"}"""

DESIGN_KEYS = ("title", "pitch", "idea", "mode", "rules", "controls", "learn", "scoring", "win", "lose", "difficulty")

LOOKS = ("voxel", "soft-clay", "low-poly", "ink-toon", "painted", "paper-pop-up", "exploded-view", "circuit-city", "plain")

PICTURES_PROMPT = """You draw the plan of a mixed-reality learning game before it is built: two reference pictures for the builder, who models the game in simple 3D from them and compares what it built with them. They are never shown in the game.

From the request and the design, reply with only this JSON:
{"look": "one of: voxel, soft-clay, low-poly, ink-toon, painted, paper-pop-up, exploded-view, circuit-city, plain (the one the request names, else the one that fits)", "first_view": "a picture prompt", "hero": "a picture prompt"}

first_view: what the player sees the moment the game opens. For a desk game: the game standing on a real wooden desk in a bright room, seen from a seated player's eyes about half a metre away, the whole game in view. For a world: seen from a standing player's eyes where they start, the first thing to do one to two metres ahead at waist height and only hand-sized (small in the picture, below eye level), the place spreading out beyond it, open sky. Show only the game's own things at their real sizes, the thing to touch first clear but not filling the view, as a 3D render in the look. No text, no labels, no menus, no people, no hands.
hero: a reference sheet of the main thing the player handles or watches: front view, side view and top view side by side, the same size, on a plain white background, as a simple 3D model built from basic shapes in the look, in its colours. No text, no labels, no shadows.
Each prompt at most 80 words, naming the look's style (for example "chunky voxel cubes", "smooth soft clay", "flat-shaded low-poly facets", "ink outlines with flat toon colours")."""

PICTURE_SIZES = {"first-view": "1280x720", "hero": "1280x720"}

DESIGN_SKILL = SKILLS_DIR / "design" / "xr-design-doc"
DESIGN_REFERENCES = ("template.md", "controls.md", "environment.md", "visual.md", "example-cake.md")
# The template's 12 sections, by number and the words their headings start with.
SECTIONS = (
    "Learning", "Player fantasy", "Core loop", "Controls", "Environment", "Levels", "Mistakes", "Facts", "Visual",
    "Assets", "Checks", "Out of scope",
)
SCENE_ROLES = ("hero", "tool", "target", "button", "set", "ground", "scenery", "panel")
SCENE_RELATIONS = (
    "left of", "right of", "in front of", "behind", "beside", "near", "far", "on", "above", "in", "between", "around",
    "facing", "room",
)
# A size over this many metres was written in centimetres (a desk game is half a metre wide; a world is built in desk
# units and shown 12 times bigger).
SCENE_SIZE_MOST_M = 2

DESIGN_NOTE = (
    "The files this skill names under references/ follow below, each under its own heading. The paths under /skills/ "
    "are the coder's skills, in its sandbox: you do not have them and do not need them, only name what they offer. Reply "
    "with only the design document, in Markdown, starting with its title line, with no code fence around the whole "
    "document."
)
DESIGN_AGAIN = (
    "This design cannot be built from yet:\n{problems}\n\n"
    "Write the whole design.md again with these fixed, every one of the 12 sections in order, and change nothing else."
)
WORLD_NOTE = (
    "\n\nMode: world. This game is a place the player stands in and walks around: start the module with "
    "new-game.mjs <look> /work/module.js --world and read the learning-game skill's references/world.md."
)


def design_mode() -> str:
    """'doc' (the default): the design is design.md. DESIGN_MODE=json: the earlier one-call JSON design."""
    return "json" if os.environ.get("DESIGN_MODE") == "json" else "doc"


@functools.lru_cache(maxsize=1)
def design_doc_prompt() -> str:
    """The designer's system prompt: the skill, then each file it names under references/, with the skill's paths
    made to make sense outside the sandbox."""
    skill = (DESIGN_SKILL / "SKILL.md").read_text(encoding="utf-8")
    body = skill.split("---", 2)[2] if skill.startswith("---") else skill
    parts = [body.strip(), DESIGN_NOTE]
    for name in DESIGN_REFERENCES:
        text = (DESIGN_SKILL / "references" / name).read_text(encoding="utf-8").strip()
        parts.append(f"===== references/{name} =====\n\n{text}")
    return "\n\n".join(parts)


class _Literal:
    """Reads a JavaScript object literal as data, without running it: objects, lists, text in any quotes, numbers,
    true, false and null, bare names as keys, comments and trailing commas. Anything else is an error."""

    def __init__(self, text: str, at: int = 0) -> None:
        self.text = text
        self.at = at

    def fail(self, what: str) -> ValueError:
        return ValueError(f"{what} near \"{self.text[self.at:self.at + 24].strip()}\"")

    def skip(self) -> None:
        while self.at < len(self.text):
            if self.text[self.at].isspace():
                self.at += 1
            elif self.text.startswith("//", self.at):
                end = self.text.find("\n", self.at)
                self.at = len(self.text) if end < 0 else end
            elif self.text.startswith("/*", self.at):
                end = self.text.find("*/", self.at)
                self.at = len(self.text) if end < 0 else end + 2
            else:
                return

    def peek(self) -> str:
        self.skip()
        return self.text[self.at] if self.at < len(self.text) else ""

    def value(self) -> Any:
        ch = self.peek()
        if ch == "{":
            return self.items("}", keyed=True)
        if ch == "[":
            return self.items("]", keyed=False)
        if ch and ch in "'\"`":
            return self.string()
        number = re.compile(r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?").match(self.text, self.at)
        if number:
            self.at = number.end()
            return float(number.group()) if re.search(r"[.eE]", number.group()) else int(number.group())
        name = self.name()
        if name in ("true", "false", "null"):
            return {"true": True, "false": False, "null": None}[name]
        raise self.fail("A value is text in quotes, a number, a list or an object; found something else")

    def name(self) -> str:
        found = re.compile(r"[A-Za-z_$][\w$]*").match(self.text, self.at)
        if not found:
            raise self.fail("Expected a name")
        self.at = found.end()
        return found.group()

    def string(self) -> str:
        quote = self.text[self.at]
        self.at += 1
        out = []
        while self.at < len(self.text) and self.text[self.at] != quote:
            ch = self.text[self.at]
            if ch == "\\" and self.at + 1 < len(self.text):
                self.at += 1
                ch = {"n": "\n", "t": "\t"}.get(self.text[self.at], self.text[self.at])
            out.append(ch)
            self.at += 1
        if self.at >= len(self.text):
            raise self.fail("Text with no closing quote")
        self.at += 1
        return "".join(out)

    def items(self, close: str, *, keyed: bool) -> Any:
        self.at += 1
        made: Any = {} if keyed else []
        while True:
            ch = self.peek()
            if ch == close:
                self.at += 1
                return made
            if not ch:
                raise self.fail(f"Missing {close}")
            if keyed:
                key = self.string() if ch in "'\"`" else self.name()
                if self.peek() != ":":
                    raise self.fail(f"Expected : after {key}")
                self.at += 1
                made[key] = self.value()
            else:
                made.append(self.value())
            ch = self.peek()
            if ch == ",":
                self.at += 1
            elif ch != close:
                raise self.fail(f"Expected , or {close}")


def _unfence(text: str) -> str:
    """The document itself, when the reply wrapped the whole of it in a code fence."""
    doc = str(text or "").strip()
    if doc.startswith("```") and doc.rstrip().endswith("```"):
        doc = doc.split("\n", 1)[1] if "\n" in doc else ""
        doc = doc.rstrip()[:-3]
    return doc.strip()


def _section(doc: str, number: int) -> str:
    """The text of section `number`, from its heading to the next numbered heading."""
    found = re.search(rf"^#{{1,3}}\s*{number}[.)]?\s.*$", doc, re.M)
    if not found:
        return ""
    end = re.search(r"^#{1,3}\s*\d+[.)]?\s", doc[found.end():], re.M)
    return doc[found.end(): found.end() + end.start()] if end else doc[found.end():]


def _missing_sections(doc: str) -> list[str]:
    missing = []
    for number, name in enumerate(SECTIONS, start=1):
        if not re.search(rf"^#{{1,3}}\s*{number}[.)]?\s+{re.escape(name)}", doc, re.M | re.I):
            missing.append(f"{number}. {name}")
    return missing


def _scene(doc: str) -> tuple[dict[str, Any] | None, list[str]]:
    """Section 5's scene plan as data (never run), and what is wrong with it."""
    start = re.search(r"\bSCENE\s*=\s*(?=\{)", _section(doc, 5) or doc)
    if not start:
        return None, ["Section 5 has no scene plan: write `const SCENE = { mode, things, relations };` in a ```js block "
                      "there (environment.md): every thing once, with its role and its size in metres, and how the things "
                      "stand to each other. No coordinates."]
    try:
        scene = _Literal(_section(doc, 5) or doc, start.end()).value()
    except ValueError as exc:
        return None, [f"The scene plan in section 5 cannot be read: {exc}. Write it as one plain object: names, text in "
                      "quotes, numbers and lists only."]
    problems = []
    things = scene.get("things") if isinstance(scene, dict) else None
    if not isinstance(things, dict) or not things:
        return None, ["The scene plan in section 5 has no `things`: list every thing of the game once, by name."]
    for name, thing in things.items():
        role = thing.get("role") if isinstance(thing, dict) else None
        size = thing.get("size") if isinstance(thing, dict) else None
        if role not in SCENE_ROLES:
            problems.append(f"`{name}` in the scene plan has the role {role!r}: a role is one of {', '.join(SCENE_ROLES)}.")
        if not (isinstance(size, list) and len(size) == 3 and all(isinstance(n, (int, float)) and n > 0 for n in size)):
            problems.append(f"`{name}` in the scene plan has the size {size!r}: a size is [width, height, depth] in metres.")
        elif any(n > SCENE_SIZE_MOST_M for n in size):
            problems.append(f"`{name}` is {size} in the scene plan: sizes are in metres, the game's units, so 12 cm is "
                            "0.12.")
    relations = scene.get("relations", [])
    if not isinstance(relations, list):
        problems.append("The scene plan's `relations` is a list of [thing, relation, other thing], e.g. "
                        "['start', 'near', 'hero'].")
    else:
        for relation in relations:
            kind = relation[1] if isinstance(relation, list) and len(relation) >= 2 else None
            if not isinstance(kind, str) or kind.lower() not in SCENE_RELATIONS:
                problems.append(f"The relation {relation!r} in the scene plan is not one the solver knows: "
                                f"{', '.join(SCENE_RELATIONS)}.")
    return (scene if not problems else None), problems


def _read_doc(text: str) -> dict[str, Any]:
    """A design document and what is wrong with it: the 12 sections, the scene plan, the mode (section 5) and the look
    (section 9)."""
    doc = _unfence(text)
    lines = doc.splitlines()
    at = next((i for i, line in enumerate(lines) if re.match(r"^#\s+\S", line)), None)
    title = re.sub(r"\s*[—–:-]+\s*Design\s*$", "", lines[at][1:].strip(" #*"), flags=re.I) if at is not None else ""
    pitch = next((line.strip(" *_") for line in lines[at + 1:] if line.strip() and not line.lstrip().startswith("#")), "") if at is not None else ""
    problems = []
    missing = _missing_sections(doc)
    if missing:
        problems.append(f"These sections are missing (keep the template's headings, numbered): {', '.join(missing)}.")
    scene, scene_problems = _scene(doc)
    problems.extend(scene_problems)
    mode = re.search(r"\bMode\s*\**\s*:?\s*\**\s*`?(desk|world)\b", _section(doc, 5), re.I)
    named_mode = (scene or {}).get("mode") if (scene or {}).get("mode") in ("desk", "world") else None
    look = re.search(r"\bLook\s*\**\s*:?\s*\**\s*`?([a-z][a-z-]*)", _section(doc, 9), re.I)
    named_look = look.group(1).lower() if look else ""
    return {
        "design_md": doc,
        "title": title[:60],
        "pitch": pitch[:300],
        "mode": named_mode or (mode.group(1).lower() if mode else "desk"),
        # "custom (plain)" is the plain look with the design's own palette (references/visual.md).
        "look": "plain" if named_look == "custom" else named_look if named_look in LOOKS else None,
        "scene": scene,
        "problems": problems,
    }


def _design_or_none(read: dict[str, Any]) -> dict[str, Any] | None:
    """A reply with no title and none of the sections is not a design at all."""
    return read if read["title"] or len(_missing_sections(read["design_md"])) < len(SECTIONS) else None


async def design_doc(request: str) -> dict[str, Any] | None:
    """The game's design document: one call with the xr-design-doc skill as its prompt, checked for the template's 12
    sections and a scene plan that can be read, and written once more, with what is missing named, when it falls
    short. {design_md, mode, look, title, pitch, scene, problems}; None when the call fails or gives no document."""
    target = llm.default_target()
    messages = [{"role": "system", "content": design_doc_prompt()}, {"role": "user", "content": request}]
    try:
        reply = await llm.complete(messages, target)
        await record_spend([{"model": target.id, "promptTokens": reply.prompt_tokens, "completionTokens": reply.completion_tokens}])
    except Exception:
        return None
    first = _design_or_none(_read_doc(reply.text))
    if first is not None and not first["problems"]:
        return first
    try:
        problems = "\n".join(f"- {problem}" for problem in (first or {}).get("problems") or ["The reply was not a design document."])
        again = await llm.complete([*messages, {"role": "assistant", "content": reply.text}, {"role": "user", "content": DESIGN_AGAIN.format(problems=problems)}], target)
        await record_spend([{"model": target.id, "promptTokens": again.prompt_tokens, "completionTokens": again.completion_tokens}])
        second = _design_or_none(_read_doc(again.text))
    except Exception:
        second = None
    # The second document replaces the first only when it has less missing.
    if second is not None and (first is None or len(second["problems"]) < len(first["problems"])):
        return second
    return first


def doc_brief(request: str, designed: dict[str, Any], *, inline: bool = False) -> str:
    """The coder's request for a game with a design document. The agent writer finds the document in its sandbox
    (coder/agent.py); the one-call writer has no files, so it gets the document in its request (`inline`)."""
    text = request
    if inline:
        text += f"\n\nDesign document (build what it says; do not change its moves or its rules):\n{designed['design_md']}"
    if designed.get("mode") == "world":
        text += WORLD_NOTE
    return text


def scene_part(scene: dict[str, Any]) -> str:
    """The design's scene plan as the game's /work/parts/scene.js (agent_skills/play/learning-game/references/scene.md)."""
    return (
        "// The scene plan, from the game's design (/work/design.md, section 5): what stands in the scene and how the things\n"
        "// stand to each other (references/scene.md). `node /skills/play/learning-game/scripts/layout.mjs` finds a place for\n"
        "// every thing and writes them under this as PLACES. In the game, stand each thing where the plan put it with\n"
        "// sceneAt(THREE, object, 'name', { ground }). Change the plan here and run layout.mjs again; never edit PLACES.\n"
        f"const SCENE = {json.dumps(scene, ensure_ascii=False, indent=2)};\n"
    )


async def design(request: str) -> dict[str, Any] | None:
    """The design as JSON (DESIGN_KEYS), or None when the call fails or returns no rules."""
    try:
        target = llm.default_target()
        reply = await llm.complete([{"role": "system", "content": DESIGN_PROMPT}, {"role": "user", "content": request}], target)
        await record_spend([{"model": target.id, "promptTokens": reply.prompt_tokens, "completionTokens": reply.completion_tokens}])
        parsed = extract_json(reply.text)
    except Exception:
        return None
    if not (isinstance(parsed, dict) and isinstance(parsed.get("rules"), str) and parsed["rules"].strip()):
        return None
    kept = {key: parsed[key] for key in DESIGN_KEYS if key in parsed}
    if kept.get("mode") not in ("desk", "world"):
        kept["mode"] = "desk"
    return kept


def brief(request: str, design: dict[str, Any] | None) -> str:
    if not design:
        return request
    brief = f"{request}\n\nDesign (follow this; do not change the rules):\n{json.dumps(design, ensure_ascii=False)}"
    if design.get("mode") == "world":
        brief += ("\n\nMode: world. This game is a place the player stands in and walks around: start the module with "
                  "new-game.mjs <look> /work/module.js --world and read the learning-game skill's references/world.md.")
    return brief


def pictures_enabled() -> bool:
    """The plan's reference pictures (needs the media provider). Side by side (Nov 17, four games) the games built
    from them followed their plan and came out cleaner in three; PLAN_PICTURES=0 turns them off. Pictures that are
    on but have no provider are skipped with one line in the server log, so a missing key is not silent."""
    if os.environ.get("PLAN_PICTURES", "1") == "0":
        return False
    if not media.enabled():
        print("Plan pictures skipped: MEDIA_BASE_URL or MEDIA_API_KEY is not set.")
        return False
    return True


async def plan_pictures(request: str, design: dict[str, Any], run_id: str, studio: StudioRun | None) -> list[dict[str, Any]] | None:
    """Two reference pictures of the design for the coder: what the player sees first, and the main thing from the
    front, side and top. One small call writes the prompts (and picks the look), then both are drawn at once. A
    design document is given as it is; its look, when it names one, is the look."""
    written = design.get("design_md") if isinstance(design.get("design_md"), str) else json.dumps(design, ensure_ascii=False)
    try:
        target = llm.default_target()
        reply = await llm.complete([
            {"role": "system", "content": PICTURES_PROMPT},
            {"role": "user", "content": f"Request: {request}\n\nDesign: {written}"},
        ], target)
        await record_spend([{"model": target.id, "promptTokens": reply.prompt_tokens, "completionTokens": reply.completion_tokens}])
        asked = extract_json(reply.text)
    except Exception:
        return None
    if not isinstance(asked, dict):
        return None
    look = design.get("look") if design.get("look") in LOOKS else asked.get("look") if asked.get("look") in LOOKS else "plain"
    prompts = {name: str(asked.get(key) or "").strip() for name, key in (("first-view", "first_view"), ("hero", "hero"))}

    async def draw(name: str, prompt: str) -> dict[str, Any] | None:
        if not prompt:
            return None
        try:
            record = await media.make_image(prompt, run_id=run_id, size=PICTURE_SIZES[name])
        except Exception:
            try:
                record = await media.make_image(prompt, run_id=run_id)
            except Exception:
                return None
        return {"name": name, "id": record["id"], "file": record["file"], "prompt": prompt, "look": look}

    drawn = [p for p in await asyncio.gather(*(draw(n, t) for n, t in prompts.items())) if p]
    if studio is not None:
        # Each picture kept in the run's record, so the Studio's timeline shows it (as the final view is).
        for picture in drawn:
            found = media.file_of(picture["id"])
            if not found:
                continue
            name = f"plan/{picture['name']}{found[0].suffix}"
            studio.save(name, found[0].read_bytes())
            studio.event("designer", "plan picture", f"{look}: {picture['name']}: {picture['prompt']}", file=name)
    return drawn or None
