"""Parse, check and compile A2UI v1.0 messages. Same rules as apps/gate/src/a2ui/catalog.ts."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from app.glyphs import unsupported_glyphs

SPATIAL_CATALOG_ID = "urn:spatial-genui:catalog:spatial:1.0"
_RUNTIME = (Path(__file__).with_name("runtime.js")).read_text(encoding="utf-8")

_COMPONENTS: dict[str, dict[str, Any]] = {
    "Scene": {"kind": "scene", "required": ["children"], "refs": ["children"]},
    "Shape": {"kind": "object", "required": ["shape"], "refs": ["children"]},
    "Group": {"kind": "object", "required": ["children"], "refs": ["children"]},
    "Arrow": {"kind": "object", "required": ["from", "to"], "refs": []},
    "Orbit": {"kind": "motion", "required": ["target", "radius"], "refs": []},
    "Spin": {"kind": "motion", "required": ["target"], "refs": []},
    "Panel": {"kind": "panel", "required": ["child"], "refs": ["child"]},
    "QuizCard": {"kind": "panel", "required": ["question", "options", "answer"], "refs": []},
    "StepTour": {"kind": "panel", "required": ["steps"], "refs": []},
    "Column": {"kind": "content", "required": ["children"], "refs": ["children"]},
    "Row": {"kind": "content", "required": ["children"], "refs": ["children"]},
    "Card": {"kind": "content", "required": ["child"], "refs": ["child"]},
    "Text": {"kind": "content", "required": ["text"], "refs": []},
    "Button": {"kind": "content", "required": ["action"], "refs": ["child"]},
    "Divider": {"kind": "content", "required": [], "refs": []},
}
_SHAPE_ORDER = ("sphere", "box", "cylinder", "cone", "torus", "capsule", "ring")
_SHAPES = set(_SHAPE_ORDER)
_FUNCTIONS: dict[str, list[str]] = {
    "setData": ["path"],
    "highlight": ["target"],
    "toggleVisible": ["target"],
    "setVisible": ["target"],
    "toggleMotion": ["target"],
    "resetPositions": [],
    "checkSort": ["items"],
    "run": ["calls"],
    "formatString": ["value"],
}
_ID = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_FENCE = re.compile(r"```(?:json)?\s*\n([\s\S]*?)```")


def extract_json(reply: str) -> Any:
    fence = _FENCE.search(reply)
    text = (fence.group(1) if fence else reply).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return _repair_json(text)


def _parse_error(text: str) -> int | None:
    try:
        json.loads(text)
        return None
    except json.JSONDecodeError as exc:
        if exc.pos is not None:
            return exc.pos
        if re.search(r"end of JSON|Unexpected end", exc.msg, re.I):
            return len(text)
        return 0


def _repair_json(text: str) -> Any:
    current = re.sub(r",(\s*[}\]])", r"\1", text)
    for _round in range(4):
        at = _parse_error(current)
        if at is None:
            return json.loads(current)
        best: str | None = None
        best_at = at

        def consider(candidate: str) -> None:
            nonlocal best, best_at
            nxt = _parse_error(candidate)
            reached = 10**12 if nxt is None else nxt
            if reached > at and (best is None or reached > best_at):
                best = candidate
                best_at = reached

        for index in range(at, max(0, at - 200) - 1, -1):
            if current[index] in "}]":
                consider(current[:index] + current[index + 1:])
        for index in range(at, max(0, at - 3) - 1, -1):
            for closer in ("}", "]"):
                consider(current[:index] + closer + current[index:])
        if best is None:
            return None
        current = best
    return json.loads(current) if _parse_error(current) is None else None


def surface_from(messages: Any) -> dict[str, Any]:
    listing = messages if isinstance(messages, list) else [messages]
    surface: dict[str, Any] | None = None
    for message in listing:
        if not isinstance(message, dict):
            return {"error": "Each A2UI message must be a JSON object."}
        if message.get("version") != "1.0":
            return {"error": 'Each A2UI message needs "version": "1.0".'}
        if message.get("createSurface"):
            created = message["createSurface"]
            surface = {
                "surfaceId": created.get("surfaceId"),
                "catalogId": created.get("catalogId"),
                "components": list(created.get("components") or []),
                "dataModel": created.get("dataModel") if created.get("dataModel") is not None else {},
            }
        elif message.get("updateComponents"):
            if surface is None:
                return {"error": "updateComponents came before createSurface."}
            for component in message["updateComponents"].get("components") or []:
                at = next((index for index, item in enumerate(surface["components"]) if item.get("id") == component.get("id")), -1)
                if at >= 0:
                    surface["components"][at] = component
                else:
                    surface["components"].append(component)
        elif message.get("updateDataModel"):
            if surface is None:
                return {"error": "updateDataModel came before createSurface."}
            update = message["updateDataModel"]
            path = update.get("path") or "/"
            if path == "/":
                surface["dataModel"] = update.get("value") if update.get("value") is not None else {}
            else:
                _set_pointer(surface["dataModel"], path, update.get("value"))
        else:
            names = ", ".join(key for key in message if key != "version") or "empty"
            return {"error": f"Unknown A2UI message: {names}. Use createSurface, updateComponents or updateDataModel."}
    if surface is None:
        return {"error": "No createSurface message."}
    return {"surface": surface}


def _set_pointer(target: dict[str, Any], path: str, value: Any) -> None:
    keys = path.split("/")[1:]
    at = target
    for key in keys[:-1]:
        child = at.get(key)
        if not isinstance(child, dict):
            child = {}
            at[key] = child
        at = child
    if value is None:
        at.pop(keys[-1], None)
    else:
        at[keys[-1]] = value


def _refs_of(component: dict[str, Any]) -> list[str]:
    spec = _COMPONENTS.get(str(component.get("component")))
    if not spec:
        return []
    found: list[str] = []
    for key in spec["refs"]:
        value = component.get(key)
        if isinstance(value, list):
            found.extend(item for item in value if isinstance(item, str))
        elif isinstance(value, str):
            found.append(value)
    return found


def _finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value == value and value not in (float("inf"), float("-inf"))


def check_surface(surface: dict[str, Any]) -> list[str]:
    problems: list[str] = []
    if surface.get("catalogId") != SPATIAL_CATALOG_ID:
        problems.append(f'createSurface needs "catalogId": "{SPATIAL_CATALOG_ID}".')
    by_id: dict[str, dict[str, Any]] = {}
    for component in surface.get("components") or []:
        component_id = component.get("id") if isinstance(component, dict) else None
        if not isinstance(component_id, str) or not _ID.match(component_id):
            problems.append(f"Component id {json.dumps(component_id)} is not valid: use letters, digits and underscores (no hyphens).")
        elif component_id in by_id:
            problems.append(f'Two components have the id "{component_id}".')
        else:
            by_id[component_id] = component
    root = by_id.get("root")
    if not root or root.get("component") != "Scene":
        problems.append('The component with id "root" must be a Scene.')
    used_by: dict[str, str] = {}
    for component in surface.get("components") or []:
        if not isinstance(component, dict):
            continue
        spec = _COMPONENTS.get(str(component.get("component")))
        if not spec:
            known = ", ".join(_COMPONENTS)
            problems.append(f'"{component.get("id")}": unknown component "{component.get("component")}". Use: {known}.')
            continue
        for key in spec["required"]:
            if component.get(key) is None and key not in component:
                problems.append(f'"{component.get("id")}" ({component.get("component")}) needs "{key}".')
        for ref in _refs_of(component):
            child = by_id.get(ref)
            if child is None:
                problems.append(f'"{component.get("id")}" refers to "{ref}", which doesn\'t exist.')
            elif ref in used_by:
                problems.append(f'"{ref}" is used twice (by "{used_by[ref]}" and "{component.get("id")}"); each component has one place.')
            else:
                used_by[ref] = str(component.get("id"))
            if child is None:
                continue
            child_kind = (_COMPONENTS.get(str(child.get("component"))) or {}).get("kind")
            kind = spec["kind"]
            if kind == "scene" and child_kind == "content":
                problems.append(f'"{ref}" ({child.get("component")}) can\'t sit in the Scene directly: put panel content inside a Panel.')
            if kind in {"panel", "content"} and child_kind != "content":
                problems.append(f'"{ref}" ({child.get("component")}) can\'t be inside "{component.get("id")}": panels hold only Column, Row, Card, Text, Button, Divider.')
            if kind == "object" and child_kind != "object":
                problems.append(f'"{ref}" ({child.get("component")}) can\'t be a child of 3D object "{component.get("id")}".')
        if component.get("component") == "Shape" and str(component.get("shape")) not in _SHAPES:
            problems.append(f'"{component.get("id")}": shape must be one of {", ".join(_SHAPE_ORDER)}.')
        if component.get("component") in {"Orbit", "Spin"} and isinstance(component.get("target"), str):
            target = by_id.get(component["target"])
            if not target or (_COMPONENTS.get(str(target.get("component"))) or {}).get("kind") != "object":
                problems.append(f'"{component.get("id")}": target "{component.get("target")}" must be a Shape or Group.')
            else:
                children = root.get("children") if root else None
                if not isinstance(children, list) or component["target"] not in children:
                    problems.append(f'"{component.get("id")}": target "{component.get("target")}" must be listed directly in the Scene\'s children.')
        if component.get("component") == "QuizCard":
            options = component.get("options")
            if not isinstance(options, list) or len(options) < 2 or len(options) > 4:
                problems.append(f'"{component.get("id")}": options must list 2-4 answers.')
            elif not isinstance(component.get("answer"), (int, float)) or isinstance(component.get("answer"), bool) or component["answer"] < 0 or component["answer"] >= len(options):
                problems.append(f'"{component.get("id")}": answer is the index (0-based) of the right option.')
        if component.get("component") == "StepTour" and (not isinstance(component.get("steps"), list) or len(component["steps"]) == 0):
            problems.append(f'"{component.get("id")}": steps must be a non-empty list.')
        if isinstance(component.get("rotationDeg"), (int, float)) and not isinstance(component.get("rotationDeg"), bool) and not _finite(component["rotationDeg"]):
            problems.append(f'"{component.get("id")}": rotationDeg must be a number or [x, y, z].')
        for key in ("position", "rotationDeg", "from", "to", "center"):
            value = component.get(key)
            if key == "rotationDeg" and isinstance(value, (int, float)) and not isinstance(value, bool):
                continue
            if key in component and not (isinstance(value, list) and len(value) == 3 and all(_finite(item) for item in value)):
                problems.append(f'"{component.get("id")}": {key} must be [x, y, z] numbers.')
        if (component.get("grab") or component.get("action")) and component.get("component") != "Button" and root:
            children = root.get("children")
            if not isinstance(children, list) or component.get("id") not in children:
                problems.append(f'"{component.get("id")}": grab and action only work on objects listed directly in the Scene\'s children.')
        for action in _actions_in(component):
            problems.extend(_check_action(str(component.get("id")), action, by_id))
    reachable: set[str] = set()

    def walk(node_id: str) -> None:
        if node_id in reachable:
            return
        reachable.add(node_id)
        node = by_id.get(node_id)
        if node:
            for ref in _refs_of(node):
                walk(ref)

    walk("root")
    for node_id in by_id:
        if node_id not in reachable:
            problems.append(f'"{node_id}" is not reachable from "root" (add it to a children list or remove it).')
    bad: dict[str, str] = {}

    def scan(value: Any) -> None:
        if isinstance(value, str):
            bad.update(unsupported_glyphs(value))
        elif isinstance(value, list):
            for item in value:
                scan(item)
        elif isinstance(value, dict):
            for item in value.values():
                scan(item)

    scan(surface.get("components"))
    scan(surface.get("dataModel"))
    if bad:
        shown = "; ".join(f'"{ch}" -> {json.dumps(repl) if repl else "remove it"}' for ch, repl in list(bad.items())[:12])
        problems.append(f"Text can only use plain ASCII plus ° § ä ö ü Ä Ö Ü ß. Replace: {shown}.")
    return problems[:25]


def _actions_in(component: dict[str, Any]) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    if isinstance(component.get("action"), dict):
        found.append(component["action"])
    if component.get("component") == "StepTour" and isinstance(component.get("steps"), list):
        for step in component["steps"]:
            if isinstance(step, dict) and step.get("action"):
                found.append(step["action"])
    return found


def _check_action(owner: str, action: dict[str, Any], by_id: dict[str, dict[str, Any]]) -> list[str]:
    if not action.get("functionCall") and not action.get("event"):
        return [f'"{owner}": an action needs "functionCall" (or "event").']
    problems: list[str] = []

    def visit(call: Any) -> None:
        fn = call.get("functionCall") if isinstance(call, dict) and call.get("functionCall") else call
        name = fn.get("@call") if isinstance(fn, dict) else None
        if not isinstance(name, str) or name not in _FUNCTIONS:
            wrote = json.dumps(fn)[:120] if fn is not None else "null"
            if isinstance(name, str):
                problems.append(f'"{owner}": unknown function "{name}". Use: {", ".join(_FUNCTIONS)}.')
            else:
                problems.append(
                    f'"{owner}": a function call is {{"@call": "<name>", "args": {{...}}}}, '
                    f'e.g. {{"functionCall": {{"@call": "highlight", "args": {{"target": "some_id"}}}}}}; you wrote {wrote}.'
                )
            return
        args = fn.get("args") or {}
        for key in _FUNCTIONS[name]:
            if args.get(key) is None and key not in args:
                problems.append(f'"{owner}": {name} needs args.{key}.')
        if isinstance(args.get("target"), str) and args["target"] not in by_id:
            problems.append(f'"{owner}": {name} targets "{args["target"]}", which doesn\'t exist.')
        if name == "run":
            for step in args.get("calls") or []:
                visit(step)

    if action.get("functionCall"):
        visit(action["functionCall"])
    return problems


def compile_surface(surface: dict[str, Any]) -> str:
    data = {"components": surface.get("components") or [], "dataModel": surface.get("dataModel") if surface.get("dataModel") is not None else {}}
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return (
        f"// Compiled from A2UI ({SPATIAL_CATALOG_ID}) by the spatial renderer.\n"
        f"const SURFACE = {payload};\n\n"
        f"{_RUNTIME}\n"
        "export default function build(api) {\n"
        "  return renderSpatialA2UI(api, SURFACE);\n"
        "}\n"
    )
