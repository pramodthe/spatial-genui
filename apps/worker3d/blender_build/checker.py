"""An independent check of a built model against what was asked. One reading lists what a correct model must show, before any 3D exists.
Another ticks each item from renders of every side. Neither sees the builder's words or part names, and code decides from the ticks.
Adapted from pramodthe/setout (builder/checker.py, Apache-2.0): the source is a brief (and an optional reference picture) instead of a drawing."""
from __future__ import annotations

import io
import json

from PIL import Image

IMPORTANCE = ("must", "should")
STATES = ("right", "wrong", "missing", "cant_tell")
ITEM = {"type": "object", "additionalProperties": False, "required": ["id", "what", "importance"], "properties": {"id": {"type": "integer"}, "what": {"type": "string"}, "importance": {"type": "string", "enum": list(IMPORTANCE)}}}
FEATURES = {"type": "object", "additionalProperties": False, "required": ["title", "detail", "items"], "properties": {"title": {"type": "string"}, "detail": {"type": "string"}, "items": {"type": "array", "items": ITEM}}}
TICK = {"type": "object", "additionalProperties": False, "required": ["id", "state", "note"], "properties": {"id": {"type": "integer"}, "state": {"type": "string", "enum": list(STATES)}, "note": {"type": "string"}}}
TICKS = {"type": "object", "additionalProperties": False, "required": ["ticks", "looks", "looks_note"], "properties": {"ticks": {"type": "array", "items": TICK}, "looks": {"type": "integer"}, "looks_note": {"type": "string"}}}
READ = """Someone will build a 3D scale model of the object below for a lesson, and you will judge it later. List now what a correct model has to show.
title: a short name for the object, 2 to 5 words. detail: what it is, in a sentence.
List 8 to 16 items, each one thing a person could tick by looking at the model from outside: every main part a learner should be able to name, its real shape and proportion against its neighbours, where it attaches, and how many there are ("six road wheels on each side", "the barrel points forward from the turret front", "the handle joins the body at two points"). Use what is true of the real object; if a reference picture is attached, it shows the intended object, but real structure wins over the picture.
Be concrete. Don't list colours, textures, labels or anything hidden inside unless the brief asks for a cut-away.
importance: must = the object is wrong or unrecognisable without it. should = a good model has it.

Object: """
CHECK = """You are checking a 3D scale model made for a lesson. The images are renders of it from different sides: three_quarter and other_side show it at an angle from the front-right and front-left, front, back, side and top look straight at it. Detail images are close-ups of the three_quarter view.
You did not build this model. Judge each item below against the renders, from every view, and be strict.
state: right = you can see it, with the right shape, in the right place. wrong = it is there, but the wrong shape, size, direction or place. missing = it isn't in any view. cant_tell = no view shows that area.
A part that is only hinted at by a plain block is wrong, not right. Check directions (does the round part's axis point the right way), contact (does anything float or sink into its neighbour), counts and left-right symmetry.
note: for wrong or missing, what to change, in one line; for cant_tell, what is hidden. Otherwise empty.
looks: 1 to 5, how much it looks like a carefully made scale model: 1 = a few plain blocks, 3 = recognisable with the main forms, 5 = fine detail, bevelled edges and surfaces you would put in a museum. looks_note: the one change that would improve the look most.
The object: {brief}
Views, in order: {views}
Items:
"""


def read_brief(ask, brief: str, reference: bytes | None) -> tuple[dict, int]:
    return ask(READ + brief, [reference] if reference else [], FEATURES, "build_features")


def verdict(features, ticks) -> dict:
    answered = {t["id"]: t for t in ticks["ticks"]}
    rows = []
    for item in features["items"]:
        tick = answered.get(item["id"]) or {"state": "cant_tell", "note": "the checker gave no answer"}
        rows.append({**item, "state": tick["state"], "note": tick["note"]})
    blocking = sorted((r for r in rows if r["state"] != "right"), key=lambda r: r["importance"] != "must")
    looks = max(1, min(5, int(ticks.get("looks") or 1)))
    # A pass needs every must item right, at most one should item open, and a look worth showing.
    passed = not any(r["importance"] == "must" for r in blocking) and len(blocking) <= 1 and looks >= 4
    return {"rows": rows, "blocking": blocking, "right": sum(r["state"] == "right" for r in rows), "total": len(rows), "looks": looks, "looks_note": ticks.get("looks_note", ""), "passed": passed}


def quality(result) -> tuple:
    """Lower is better: essential parts first, then the rest, then the look."""
    return (sum(r["importance"] == "must" and r["state"] != "right" for r in result["rows"]),
            sum(r["importance"] != "must" and r["state"] != "right" for r in result["rows"]),
            -result["looks"])


def check(ask, brief: str, features, views: dict) -> tuple[dict, int]:
    """`views` is {name: jpeg} in the order the checker should look."""
    views = dict(views)
    if "three_quarter" in views:
        whole = Image.open(io.BytesIO(views["three_quarter"])).convert("RGB")
        for label, region in (("left", (0.05, 0.15, 0.6, 0.9)), ("right", (0.4, 0.15, 0.95, 0.9))):
            bounds = tuple(round(v * (whole.width if k % 2 == 0 else whole.height)) for k, v in enumerate(region))
            out = io.BytesIO()
            whole.crop(bounds).save(out, "JPEG", quality=92)
            views[f"detail {label}"] = out.getvalue()
    items = [{"id": i["id"], "what": i["what"]} for i in features["items"]]
    ticks, tokens = ask(CHECK.replace("{views}", ", ".join(views)).replace("{brief}", brief) + json.dumps(items), list(views.values()), TICKS, "build_check")
    return verdict(features, ticks), tokens


def fix_list(result) -> str:
    lines = [f"- {row['what']}: {row['state']}. {row['note']}" for row in result["blocking"]]
    if result["looks"] < 4:
        lines.append(f"- Look {result['looks']}/5: {result['looks_note']}")
    return "\n".join(lines)
