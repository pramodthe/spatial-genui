"""A model builds a teaching object in a live Blender scene, step by step, looking at its own work. It has tools and not one shot: run code against
the scene, look from any side, list what's there, undo. The code runs only in the no-network sandbox. There are shapes and no components, so every
real part is the model's own.

Adapted from pramodthe/setout (builder/loop.py, Apache-2.0). The source is a brief (and an optional reference picture) instead of a drawing; an
independent checker lists what a correct model must show, then ticks it from renders; geometry measurements (what floats) go back to the builder.

    python -m blender_build.loop --name tank --brief "M4 Sherman medium tank of World War II" [--reference picture.jpg] [--out dir]
"""
from __future__ import annotations

import argparse
import ast
import base64
import io
import json
import re
import sys
import time
from pathlib import Path

from PIL import Image

from . import checker, meta

HERE = Path(__file__).resolve().parent
BANNED = {"exec", "eval", "compile", "open", "__import__", "globals", "locals", "vars", "getattr", "setattr", "delattr", "input", "breakpoint"}
ALLOWED = {"blender_kit", "math", "bpy", "bmesh", "mathutils", "random"}
TURNS, TOKENS, WRAP_UP = 40, 450_000, 0.8  # billed tokens (cached input is free)
CHECK_RESERVE = 50_000
VIEWS = ("three_quarter", "other_side", "front", "back", "side", "top")
AGAIN = 2  # times a dropped sandbox call is made again
REFUSALS = 3  # finish is sent back this many times at most
SHAPES = ("prism", "box", "ball", "sheet", "rounded_path", "lathe", "rod", "tube", "bevel", "smooth", "cut", "copies", "material")
TOOLS = [
    {"type": "function", "name": "run_python", "description": "Run a step of Python against the live scene. Whatever earlier steps built is still there, and constants and functions you defined stay defined. Returns any error, what the scene now holds, and two renders.",
     "parameters": {"type": "object", "additionalProperties": False, "required": ["intent", "code"], "properties": {"intent": {"type": "string", "description": "What this step adds, in a few words a person can read"}, "code": {"type": "string"}}}},
    {"type": "function", "name": "look", "description": "Render the scene from other sides. Supply exact object names to frame a close-up of those parts; use an empty parts list for the whole scene.",
     "parameters": {"type": "object", "additionalProperties": False, "required": ["views", "parts"], "properties": {"views": {"type": "array", "items": {"type": "string", "enum": list(VIEWS)}}, "parts": {"type": "array", "items": {"type": "string"}}}}},
    {"type": "function", "name": "list_parts", "description": "Read what is in the scene: every object with its group, material and extent in mm, and which parts float free of the rest. Use this to measure. Never run code only to read the scene.",
     "parameters": {"type": "object", "additionalProperties": False, "required": [], "properties": {}}},
    {"type": "function", "name": "undo", "description": "Remove your last step from the scene.", "parameters": {"type": "object", "additionalProperties": False, "required": [], "properties": {}}},
    {"type": "function", "name": "finish", "description": "Ask to end the work, only when the whole object is there and looks like a carefully made scale model. An independent checker then judges it from every side, and sends it back with what to fix.",
     "parameters": {"type": "object", "additionalProperties": False, "required": ["title", "what", "scale", "unsure"], "properties": {"title": {"type": "string", "description": "A short name, 2 to 5 words"}, "what": {"type": "string", "description": "What this object is, in a sentence or two"}, "scale": {"type": "string", "description": "The model's scale against the real thing, such as 1:20, or 'magnified 500x'"}, "unsure": {"type": "array", "items": {"type": "string"}}}}},
]
SYSTEM = """You build one object as a 3D scale model in a live Blender scene, for a hands-on lesson in a mixed-reality headset. A learner will hold it, turn it, pull its parts apart
and read their names. It must look like a carefully made museum model, never like a few plain blocks, and its structure must be true to the real thing.

First understand it. Before any code, make a compact plan from what you know of the real object: its real dimensions and proportions, its main parts, how they attach, what repeats and how
many times, and which side is the front. If a reference picture is attached it shows the intended look, but real structure wins over the picture.

Then build in small steps: the main masses first, then secondary forms (hatches, rims, handles, vents, joints, feet), then small repeated detail (bolts, slats, links, teeth, spokes).
After every step look at what you got and fix what's wrong before moving on. Never rewrite what is already right. Stopping after the main masses is a failure.

The frame, sizes in mm: build the model 250 to 400 mm across its longest side, standing on z = 0, centred on x = 0 and y = 0. z is up. The object's FRONT faces -y, toward the viewer, and x runs
to the viewer's right. A long vehicle or machine lies along x so its side shows in the front view.
Rules:
- Every key size is a named constant, and positions are derived from those constants, so parts sit exactly on what they attach to. Nothing floats, nothing is half-buried.
- Each real part is its own named object, named as a person says it ("turret", "gun barrel", "road wheel"), with a group for its assembly ("hull", "turret", "running gear").
  Repeated things are loops or copies(), each unit its own object. Left and right sides mirror exactly.
- Shape instead of stacking boxes: prism() a side silhouette for bodies, lathe() anything round with its real profile, tube() anything long and bent, cut() real openings and recesses,
  bevel() blocks so their edges catch the light, smooth() organic forms. Check each round part's axis points the way the real one does.
- Give every part a fitting material: a named one, or material(name, (r, g, b), roughness, metallic, wear=...) for paint and anything else. Use 3 to 6 materials.
- Keep it under 150 objects and 120,000 triangles: the headset must draw it at 72 frames a second. Use modest sides on small parts.
- You may use bpy and bmesh directly for anything the shapes can't make.
Call finish only when the main parts, their attachments and the fine detail are all there and you have looked at it from the front, side, top and an angle.
"""


def api() -> str:
    tree = ast.parse((HERE / "kit.py").read_text())
    lines = [f"{n.name}({ast.unparse(n.args)}): {ast.get_docstring(n) or ''}" for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in SHAPES]
    names = ", ".join(re.findall(r'^\s+"(\w+)": _material\(', (HERE / "kit.py").read_text(), re.M))
    return "Already imported in every step: bpy, math, and these shapes. They take mm and return the Blender object:\n" + "\n".join(lines) + f"\nNamed materials: {names}."


def check(code: str) -> None:
    tree = ast.parse(code)
    for node in ast.walk(tree):
        if isinstance(node, ast.Import) and any(a.name.split(".")[0] not in ALLOWED for a in node.names):
            raise ValueError(f"only {sorted(ALLOWED)} may be imported")
        if isinstance(node, ast.ImportFrom) and (node.module or "").split(".")[0] not in ALLOWED:
            raise ValueError(f"only {sorted(ALLOWED)} may be imported")
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in BANNED:
            raise ValueError(f"{node.func.id}() is not allowed")
        if isinstance(node, ast.Attribute) and node.attr.startswith("__"):
            raise ValueError("dunder attributes are not allowed")


def picture(data: bytes, longest=1000) -> dict:
    image = Image.open(io.BytesIO(data)).convert("RGB")
    image.thumbnail((longest, longest))
    out = io.BytesIO()
    image.save(out, "JPEG", quality=86)
    return {"type": "input_image", "image_url": "data:image/jpeg;base64," + base64.b64encode(out.getvalue()).decode()}


def sandbox(steps, views, export=False, measure=False) -> dict:
    """Replay the scene on Modal. Returns {file name: bytes}. A replay starts from nothing, so a dropped call is simply made again."""
    import modal
    kit = (HERE / "kit.py").read_text()
    measuring = (HERE / "measure.py").read_text() if measure else ""
    for attempt in range(AGAIN + 1):
        found: dict = {}
        try:
            for name, piece in modal.Function.from_name("spatial-genui-3d-v2-blender", "live_step").remote_gen(kit, steps, list(views), export, measuring, None):
                found[name] = found.get(name, b"") + piece
            return found
        except (modal.exception.InternalError, modal.exception.ServiceError, modal.exception.ConnectionError, modal.exception.RemoteError) as error:
            if isinstance(error, modal.exception.RemoteError) and "internal failure" not in str(error) and "preempt" not in str(error):
                raise
            if attempt == AGAIN:
                raise ConnectionError(f"the Blender sandbox kept failing: {error}") from error
            time.sleep(2 + 4 * attempt)


def summary(scene) -> str:
    rows = {}
    for row in scene["parts"]:
        rows.setdefault(row["group"], []).append(row)
    lines = [f"{len(scene['parts'])} objects, {sum(r['triangles'] for r in scene['parts'])} triangles"]
    for group, held in rows.items():
        names = {}
        for row in held:
            names[row["part"]] = names.get(row["part"], 0) + 1
        lines.append(f"{group}: " + ", ".join(f"{n} x{c}" if c > 1 else n for n, c in list(names.items())[:16]))
    return "\n".join(lines)


def floating(scene) -> list:
    """Names of parts that touch nothing else (the measurement reports them singly or as islands of parts)."""
    names = []
    for item in (scene.get("measured") or {}).get("loose", []):
        names += [str(n) for n in item] if isinstance(item, (list, tuple)) else [str(item)]
    return list(dict.fromkeys(names))


class Live:
    """One model working on one scene. `steps` is the scene, so a revision starts from an earlier one's steps."""
    def __init__(self, brief: str, reference: bytes | None = None, steps=None, intents=None, say=print, folder: Path | None = None):
        self.brief, self.reference, self.say, self.folder = brief, reference, say, folder
        self.features, self.checks, self.refused = None, [], 0
        self.steps, self.intents = list(steps or []), list(intents or [])
        if folder:
            folder.mkdir(parents=True, exist_ok=True)
        self.spent, self.calls, self.result = 0, 0, None
        self.best, self.last_check, self.checked_steps = None, None, None

    def restore_best(self) -> bool:
        if not self.best:
            return False
        changed = self.steps != self.best["steps"]
        self.steps, self.intents = list(self.best["steps"]), list(self.best["intents"])
        self.last_check, self.checked_steps = self.best["check"], tuple(self.steps)
        if changed:
            self.say("[check] restored the earlier, better model")
        return changed

    def complete(self, args, reason=None):
        report = self.last_check if self.checked_steps == tuple(self.steps) else None
        unsure = list(args.get("unsure", []))
        if reason:
            unsure.append(reason)
        if report:
            unsure += [f"{r['what']}: {r['note'] or r['state']}" for r in report["blocking"]]
        self.result = {**args, "unsure": list(dict.fromkeys(unsure)), "check": report}

    def run_python(self, args):
        try:
            check(args["code"])
        except (ValueError, SyntaxError) as error:
            return {"error": f"rejected: {error}"}, []
        found = sandbox([*self.steps, args["code"]], ("three_quarter", "front"))
        scene = json.loads(found["scene.json"])
        if scene["error"]:
            return {"error": scene["error"], "note": "The step was not kept. The scene is as it was before it."}, []
        self.steps.append(args["code"])
        self.intents.append(args["intent"])
        return {"ok": True, "scene": summary(scene), "printed": scene.get("printed", ""), "seconds": scene["seconds"]}, self.images(found, ("three_quarter", "front"))

    def list_parts(self, _):
        scene = json.loads(sandbox(self.steps, (), measure=True)["scene.json"])
        return {"parts": [{k: row[k] for k in ("name", "group", "material", "from", "to")} for row in scene["parts"]][:160],
                "floating": floating(scene)[:20], "note": "floating lists parts that touch nothing else"}, []

    def look(self, args):
        wanted = [v for v in args["views"] if v in VIEWS][:3] or ["three_quarter"]
        parts = args.get("parts") or []
        found = sandbox(self.steps, [{"view": v, "parts": parts} for v in wanted] if parts else wanted)
        names = {r["name"] for r in json.loads(found["scene.json"])["parts"]}
        if any(p not in names for p in parts):
            return {"error": "Unknown object names. Use list_parts for exact names.", "unknown": [p for p in parts if p not in names]}, []
        return {"views": wanted, "parts": parts}, self.images(found, wanted)

    def undo(self, _):
        if not self.steps:
            return {"error": "nothing to undo"}, []
        self.steps.pop()
        self.intents.pop()
        return {"ok": True, "steps_left": len(self.steps)}, []

    def finish(self, args):
        if not self.steps:
            return {"error": "nothing is built yet"}, []
        self.say("[check] judging the model from every side")
        found = sandbox(self.steps, [{"view": v, "size": [1600, 1200]} if v == "three_quarter" else v for v in VIEWS], measure=True)
        scene = json.loads(found["scene.json"])
        result, tokens = checker.check(meta.ask, self.brief, self.features, {v: found[f"{v}.jpg"] for v in VIEWS if f"{v}.jpg" in found})
        loose = floating(scene)
        result["floating"] = loose[:20]
        if loose:
            result["passed"] = False
        self.spent += tokens
        self.checks.append(result)
        self.last_check, self.checked_steps = result, tuple(self.steps)
        restored = False
        if self.best and self.steps != self.best["steps"] and checker.quality(result) > checker.quality(self.best["check"]):
            restored = self.restore_best()
            result, found, args = self.best["check"], self.best["found"], self.best["args"]
        else:
            self.best = {"steps": list(self.steps), "intents": list(self.intents), "check": result, "found": found, "args": dict(args)}
        self.say(f"[check] {result['right']} of {result['total']} right, look {result['looks']}/5" + (f", floating: {', '.join(loose[:5])}" if loose else ""))
        if self.folder:
            (self.folder / "checks.json").write_text(json.dumps(self.checks, indent=1))
        if result["passed"] or self.refused >= REFUSALS:
            self.complete(args)
            return {"ok": True}, []
        self.refused += 1
        fixes = checker.fix_list(result) + ("\n- These parts touch nothing else (floating): " + ", ".join(loose[:12]) if loose else "")
        return {"refused": True, "restored": restored, "steps_kept": len(self.steps), "checker_says": fixes,
                "note": "These findings describe the current scene. Fix the listed defects, keep what is right, then call finish."}, self.images(found, ("three_quarter", "front", "other_side"))

    def images(self, found, views) -> list:
        out = []
        for view in views:
            data = found.get(f"{view}.jpg")
            if data:
                if self.folder:
                    (self.folder / f"latest_{view}.jpg").write_bytes(data)
                out += [{"type": "input_text", "text": f"{view}:"}, picture(data)]
        return out

    def save(self):
        if self.folder:
            (self.folder / "steps.json").write_text(json.dumps({"brief": self.brief, "steps": self.steps, "intents": self.intents, "tokens": self.spent, "calls": self.calls,
                                                                "model": meta.model(), "features": self.features, "result": self.result}, indent=1))

    def run(self):
        self.features, tokens = checker.read_brief(meta.ask, self.brief, self.reference)
        self.spent += tokens
        self.say(f"[check] noted {len(self.features['items'])} things the model must show")
        text = f"Build this: {self.brief}\nAn independent checker will look for these, among others (check them against what you know of the real object):\n" + json.dumps([i["what"] for i in self.features["items"]])
        content = [{"type": "input_text", "text": text}]
        if self.reference:
            content += [{"type": "input_text", "text": "Reference picture:"}, picture(self.reference, 1200)]
        if self.steps:
            content += self.images(sandbox(self.steps, ("three_quarter", "front")), ("three_quarter", "front"))
        conversation = [{"type": "message", "role": "user", "content": content}]
        warned = False
        for turn in range(TURNS):
            if self.spent >= TOKENS - CHECK_RESERVE:
                self.say(f"stopping: {self.spent} tokens")
                break
            response = meta.respond({"instructions": SYSTEM + "\n" + api(), "tools": TOOLS, "max_output_tokens": 32768, "reasoning": {"effort": "medium"}, "input": conversation,
                                     "prompt_cache_key": f"build-{abs(hash(self.brief)) % 10**8}"})
            self.calls += 1
            usage = response.get("usage") or {}
            cached = (usage.get("input_tokens_details") or {}).get("cached_tokens") or 0
            self.spent += (usage.get("input_tokens") or 0) - cached + (usage.get("output_tokens") or 0)
            conversation += response["output"]
            calls = [o for o in response["output"] if o.get("type") == "function_call"]
            words = "".join(p.get("text", "") for o in response["output"] if o.get("type") == "message" for p in o.get("content", []))
            if words:
                self.say(f"[{turn}] {words[:400]}")
            if not calls:
                conversation.append({"type": "message", "role": "user", "content": [{"type": "input_text", "text": "Carry on with your tools. Call finish when it's done."}]})
                continue
            pictures = []
            for call in calls:
                try:
                    args = json.loads(call["arguments"] or "{}")
                except json.JSONDecodeError:
                    args = None
                started = time.time()
                if args is None:
                    result, images = {"error": "The arguments were not valid JSON; send the call again."}, []
                elif self.result:
                    result, images = {"error": "The build has finished; no further steps were run."}, []
                else:
                    try:
                        result, images = getattr(self, call["name"])(args)
                    except ConnectionError as error:
                        result, images = {"error": str(error)}, []
                self.say(f"[{turn}] {call['name']} {(args or {}).get('intent', '')} -> {str(result)[:160]} ({time.time() - started:.0f}s, {self.spent} tokens)")
                conversation.append({"type": "function_call_output", "call_id": call["call_id"], "output": json.dumps(result)})
                pictures += images
            if pictures:
                conversation.append({"type": "message", "role": "user", "content": pictures})
            if self.spent > TOKENS * WRAP_UP and not warned:
                warned = True
                conversation.append({"type": "message", "role": "user", "content": [{"type": "input_text", "text": "You are near the budget. Fix only what is plainly wrong, then call finish."}]})
            self.save()
            if self.result:
                break
        if self.result is None and self.steps:  # out of turns or budget: keep the best checked model, or check what there is
            if self.best:
                self.restore_best()
                self.complete(self.best["args"], "The build ran out of budget before the checker passed it")
            else:
                self.refused = REFUSALS
                self.finish({"title": self.features["title"], "what": self.features["detail"], "scale": "", "unsure": ["The build ran out of budget"]})
        self.save()
        return self


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", required=True)
    parser.add_argument("--brief", required=True)
    parser.add_argument("--reference")
    parser.add_argument("--out")
    parser.add_argument("--resume", action="store_true", help="carry on from the steps saved in the output folder")
    args = parser.parse_args()
    folder = Path(args.out) if args.out else HERE.parents[2] / "data" / "blender-work" / args.name
    started = time.time()
    saved = json.loads((folder / "steps.json").read_text()) if args.resume and (folder / "steps.json").exists() else {}
    live = Live(args.brief, Path(args.reference).read_bytes() if args.reference else None, steps=saved.get("steps"), intents=saved.get("intents"), folder=folder)
    live.spent, live.calls = saved.get("tokens", 0), saved.get("calls", 0)
    live.run()
    if not live.steps:
        print(json.dumps({"ok": False, "error": "nothing was built"}))
        sys.exit(1)
    found = sandbox(live.steps, VIEWS, export=True)
    for name, data in found.items():
        (folder / name).write_bytes(data)
    scene = json.loads(found["scene.json"])
    report = (live.result or {}).get("check") or {}
    print(json.dumps({"ok": "model.glb" in found, "folder": str(folder), "steps": len(live.steps), "calls": live.calls, "tokens": live.spent, "minutes": round((time.time() - started) / 60, 1),
                      "objects": len(scene["parts"]), "triangles": sum(r["triangles"] for r in scene["parts"]), "right": report.get("right"), "total": report.get("total"), "looks": report.get("looks"),
                      "passed": report.get("passed"), "title": (live.result or {}).get("title")}))


if __name__ == "__main__":
    main()
