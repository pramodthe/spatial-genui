"""Parallel A2UI generation. Same plan, part checks and merge as apps/gate/src/a2ui/parallel.ts."""

from __future__ import annotations

import asyncio
import json
import re
import time
from typing import Any
from urllib.parse import urlparse

from app import config as config_mod
from app import gate, llm
from app.a2ui.catalog import SPATIAL_CATALOG_ID, check_surface, compile_surface, extract_json
from app.graphs.lesson import _new_id
from app.llm import LlmTarget
from app.prompt import BUILDER_SYSTEM, PARALLEL_PLANNER_PROMPT, json_repair_message

_KINDS = {"object", "panel", "quiz", "tour"}
_ID = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _now_ms(started: float) -> int:
    return round((time.perf_counter() - started) * 1000)


def check_plan(plan: Any) -> list[str]:
    if not isinstance(plan, dict) or not isinstance(plan.get("parts"), list):
        return ['Reply with {"title", "dataModel", "parts": [...]}']
    problems: list[str] = []
    parts = plan["parts"]
    if len(parts) < 2 or len(parts) > 6:
        problems.append("Plan 2-6 parts.")
    ids: set[str] = set()
    for part in parts:
        part_id = part.get("id") if isinstance(part, dict) else None
        if not isinstance(part_id, str) or not _ID.match(part_id) or part_id == "root":
            problems.append(f"Part id {json.dumps(part_id)} must be letters, digits and underscores (not \"root\").")
        elif part_id in ids:
            problems.append(f'Two parts are called "{part_id}".')
        else:
            ids.add(part_id)
        kind = part.get("kind") if isinstance(part, dict) else None
        if kind not in _KINDS:
            problems.append(f'Part "{part_id}": kind must be object, panel, quiz or tour.')
        brief = part.get("brief") if isinstance(part, dict) else None
        if not isinstance(brief, str) or len(brief) < 10:
            problems.append(f'Part "{part_id}" needs a brief.')
        position = part.get("position") if isinstance(part, dict) else None
        if not isinstance(position, list) or len(position) != 3 or not all(isinstance(item, (int, float)) and not isinstance(item, bool) for item in position):
            problems.append(f'Part "{part_id}": position must be [x, y, z].')
        for export in (part.get("exports") if isinstance(part, dict) else None) or []:
            if not isinstance(export, str) or not export.startswith(f"{part_id}_") or not _ID.match(export):
                problems.append(f'Export {json.dumps(export)} must start with "{part_id}_" (letters, digits, underscores).')
    data_model = plan.get("dataModel", None)
    if "dataModel" in plan and data_model is not None and not isinstance(data_model, dict):
        problems.append("dataModel must be an object.")
    return problems


def _probe(plan: dict[str, Any], part: dict[str, Any], built: dict[str, Any]) -> dict[str, Any]:
    others: list[str] = []
    for item in plan["parts"]:
        if item.get("id") != part["id"]:
            others.extend(item.get("exports") or [])
    return {
        "surfaceId": "probe",
        "catalogId": SPATIAL_CATALOG_ID,
        "dataModel": plan.get("dataModel") or {},
        "components": [
            {"id": "root", "component": "Scene", "children": [*built["top"], *others]},
            *built["components"],
            *[{"id": export, "component": "Shape", "shape": "sphere", "radius": 0.01} for export in others],
        ],
    }


def check_part(plan: dict[str, Any], part: dict[str, Any], built: Any) -> list[str]:
    if not isinstance(built, dict) or not isinstance(built.get("top"), list) or not isinstance(built.get("components"), list):
        return ['Reply with {"top": [ids], "components": [...]}']
    problems: list[str] = []
    components = built["components"]
    own = {component.get("id") for component in components if isinstance(component, dict)}
    for component_id in own:
        if not isinstance(component_id, str) or not (component_id == part["id"] or component_id.startswith(f"{part['id']}_")):
            problems.append(f'Id {json.dumps(component_id)} must start with "{part["id"]}_".')
    for export in part.get("exports") or []:
        if export not in own:
            problems.append(f'Create "{export}": it is in your part\'s exports.')
    for component_id in built["top"]:
        if component_id not in own:
            problems.append(f'top lists "{component_id}", which you didn\'t create.')
    if problems:
        return problems
    return check_surface(_probe(plan, part, built))


def merge(plan: dict[str, Any], ready: dict[str, dict[str, Any]], placeholders: bool) -> dict[str, Any]:
    children: list[str] = []
    components: list[Any] = []
    for part in plan["parts"]:
        built = ready.get(part["id"])
        if built:
            children.extend(built["top"])
            components.extend(built["components"])
        elif placeholders:
            panel = part.get("kind") != "object"
            width = min(max(part.get("width") or 0.3, 0.2), 0.6)
            children.append(f"{part['id']}__placeholder")
            components.append({
                "id": f"{part['id']}__placeholder",
                "component": "Shape",
                "shape": "box",
                "size": [width, 0.2, 0.01] if panel else [0.14, 0.14, 0.14],
                "color": "#8ab4f8",
                "opacity": 0.18,
                "position": part.get("position"),
            })
    return {
        "surfaceId": "lesson",
        "catalogId": SPATIAL_CATALOG_ID,
        "dataModel": plan.get("dataModel") or {},
        "components": [{"id": "root", "component": "Scene", "children": children}, *components],
    }


def _record(role: str, reply: llm.Completion, ok: bool, error: str) -> dict[str, Any]:
    record: dict[str, Any] = {
        "role": role,
        "ms": reply.ms,
        "promptTokens": reply.prompt_tokens,
        "completionTokens": reply.completion_tokens,
        "finishReason": reply.finish_reason,
        "ok": ok,
    }
    if not ok:
        record["error"] = error
    return record


async def _dry_run_part(plan: dict[str, Any], part: dict[str, Any], built: dict[str, Any]) -> list[str]:
    result = await gate.check_module(compile_surface(_probe(plan, part, built)), [])
    if result.get("ok"):
        return []
    return [str(result.get("error") or "dry run failed")]


async def _build_part(plan: dict[str, Any], part: dict[str, Any], target: LlmTarget, calls: list[dict[str, Any]]) -> dict[str, Any]:
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": BUILDER_SYSTEM},
        {"role": "user", "content": f"The plan:\n{json.dumps(plan, indent=1, ensure_ascii=False)}\n\nBuild part \"{part['id']}\"."},
    ]
    last_error = ""
    for _attempt in range(config_mod.config.max_repairs + 1):
        reply = await llm.complete(messages, target)
        messages.append({"role": "assistant", "content": reply.text})
        parsed = extract_json(reply.text)
        if parsed:
            problems = check_part(plan, part, parsed)
        elif reply.finish_reason == "length":
            problems = ["The reply was cut off; write a shorter part."]
        else:
            problems = ["No valid JSON found (one ```json block)."]
        if not problems and isinstance(parsed, dict):
            problems = await _dry_run_part(plan, part, parsed)
        calls.append(_record(f"part:{part['id']}", reply, not problems, " ".join(problems)))
        if not problems and isinstance(parsed, dict):
            return parsed
        last_error = " ".join(problems)
        messages.append({"role": "user", "content": json_repair_message("\n".join(problems))})
    return {"error": last_error}


async def generate_parallel(
    prompt: str,
    builder: LlmTarget,
    *,
    planner: LlmTarget | None = None,
    on_event: Any = None,
    planner_fallback: bool = False,
) -> dict[str, Any]:
    started = time.perf_counter()
    calls: list[dict[str, Any]] = []
    result: dict[str, Any] = {
        "ok": False,
        "calls": calls,
        "timings": {"planMs": 0, "firstPartMs": None, "partMs": {}, "totalMs": 0},
        "failedParts": [],
    }

    def emit(event: dict[str, Any]) -> None:
        if on_event:
            on_event(event)

    def finish(ok: bool, error: str | None = None) -> dict[str, Any]:
        result["ok"] = ok and not result["failedParts"]
        if not ok:
            result["error"] = error
        elif result["failedParts"]:
            result["error"] = f"Parts that failed (left out): {', '.join(result['failedParts'])}"
        result["timings"]["totalMs"] = _now_ms(started)
        emit({"type": "RUN_FINISHED", "ms": result["timings"]["totalMs"], "ok": result["ok"], "error": result.get("error")})
        return result

    emit({"type": "RUN_STARTED", "ms": 0})
    plan_messages: list[dict[str, Any]] = [
        {"role": "system", "content": PARALLEL_PLANNER_PROMPT},
        {"role": "user", "content": prompt},
    ]
    plan: dict[str, Any] | None = None
    for _attempt in range(2):
        if plan:
            break
        try:
            reply = await llm.complete(plan_messages, planner or builder)
        except Exception as exc:
            if not planner_fallback or planner is None:
                raise
            print(f"Planner failed ({exc}); the builder plans.")
            reply = await llm.complete(plan_messages, builder)
        problems = check_plan(extract_json(reply.text))
        calls.append(_record("planner", reply, not problems, " ".join(problems)))
        plan_messages.append({"role": "assistant", "content": reply.text})
        if not problems:
            parsed = extract_json(reply.text)
            plan = parsed if isinstance(parsed, dict) else None
        else:
            plan_messages.append({"role": "user", "content": json_repair_message("\n".join(problems))})
    result["timings"]["planMs"] = _now_ms(started)
    if not plan:
        return finish(False, "The planner did not produce a usable plan.")
    result["plan"] = plan
    ready: dict[str, dict[str, Any]] = {}
    emit({"type": "PLAN_READY", "ms": _now_ms(started), "plan": plan, "code": compile_surface(merge(plan, ready, True))})

    async def one(part: dict[str, Any]) -> None:
        emit({"type": "COMPONENT_STARTED", "ms": _now_ms(started), "partId": part["id"]})
        built = await _build_part(plan, part, builder, calls)
        if built.get("error"):
            result["failedParts"].append(part["id"])
            emit({"type": "COMPONENT_FAILED", "ms": _now_ms(started), "partId": part["id"], "error": built["error"]})
            return
        ready[part["id"]] = built
        result["timings"]["partMs"][part["id"]] = _now_ms(started)
        if result["timings"]["firstPartMs"] is None:
            result["timings"]["firstPartMs"] = _now_ms(started)
        emit({
            "type": "COMPONENT_READY",
            "ms": _now_ms(started),
            "partId": part["id"],
            "code": compile_surface(merge(plan, ready, True)),
            "ready": len(ready),
            "total": len(plan["parts"]),
        })

    await asyncio.gather(*(one(part) for part in plan["parts"]))
    if not ready:
        return finish(False, "No part was built.")
    surface = merge(plan, ready, False)
    result["code"] = compile_surface(surface)
    result["source"] = json.dumps(surface, ensure_ascii=False, separators=(",", ":"))
    missing: set[str] = set()
    for failed in result["failedParts"]:
        owner = next((part for part in plan["parts"] if part.get("id") == failed), None)
        missing.update((owner or {}).get("exports") or [])
    problems = [problem for problem in check_surface(surface) if not any(f'"{item}"' in problem for item in missing)]
    if problems:
        return finish(False, f"The merged lesson failed its checks: {' '.join(problems)}")
    return finish(True)


async def run_parallel(
    prompt: str,
    target: LlmTarget,
    *,
    planner: LlmTarget | None = None,
    on_event: Any = None,
    planner_fallback: bool = False,
    log: bool = True,
) -> dict[str, Any]:
    """The generate() result object for format a2ui-parallel, including the final host gate."""
    started = time.perf_counter()
    run = await generate_parallel(prompt, target, planner=planner, on_event=on_event, planner_fallback=planner_fallback)
    attempts = [
        {
            "ms": call["ms"],
            "promptTokens": call["promptTokens"],
            "completionTokens": call["completionTokens"],
            "finishReason": call["finishReason"],
            "stage": "ok" if call["ok"] else "validate",
            **({"error": call["error"]} if call.get("error") else {}),
            "role": call["role"],
        }
        for call in run["calls"]
    ]
    result: dict[str, Any] = {
        "id": _new_id(),
        "ok": bool(run.get("ok")),
        "prompt": prompt,
        "model": target.id,
        "provider": urlparse(target.base_url).netloc,
        "format": "a2ui-parallel",
        "attempts": attempts,
        "totalMs": round((time.perf_counter() - started) * 1000),
        "timings": run["timings"],
    }
    if run.get("source") is not None:
        result["source"] = run["source"]
    if run.get("code") is not None:
        result["code"] = run["code"]
    if run.get("error"):
        result["error"] = run["error"]
    if run.get("ok") and run.get("code"):
        checked = await gate.check_module(run["code"], [])
        if not checked.get("ok"):
            result["ok"] = False
            result["error"] = checked.get("error")
        else:
            result["stats"] = checked.get("stats")
            result["warnings"] = checked.get("warnings")
    if log:
        await _log_result(result)
    return result


async def _log_result(result: dict[str, Any]) -> None:
    try:
        folder = config_mod.config.runs_dir
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"{result['id'][:10]}.jsonl"
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(result, ensure_ascii=False) + "\n")
    except Exception as exc:
        print(f"Could not log the run: {exc}")
