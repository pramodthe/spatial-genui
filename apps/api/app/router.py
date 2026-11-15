"""Pick library models for a lesson. Same prompt and fallback as apps/gate/src/router.ts."""

from __future__ import annotations

import asyncio
import json
import re
import time
from typing import Any

from app import llm
from app.library import library_catalog, library_dir
from app.llm import LlmTarget

WORKER = llm.REPO_ROOT / "apps" / "worker3d"
PYTHON = WORKER / ".venv" / "bin" / "python3"

ROUTER_SYSTEM = """You pick accurate 3D models for a mixed-reality lesson. You get the lesson request and a catalogue of models built from scientific data. Reply with only a JSON object:
{"assets": ["<catalogue ids the lesson should show>"], "molecules": ["<English names of chemical compounds the lesson needs as 3D molecules that are not in the catalogue>"]}
Choose only what the lesson needs (usually 1, at most 4). Use the catalogue when an entry fits the request; list molecules only for real chemical compounds (e.g. "caffeine", "glucose", "carbon dioxide"). If nothing fits, return empty lists."""

ROUTER_OBJECTS = """
Also add "objects": a list with at most one real-world physical object the lesson is about that should be shown as a realistic 3D model and is not in the catalogue (e.g. a microscope, a violin, a steam locomotive): {"name": "<its everyday name, 1-3 words>", "describe": "<one line: what it is and what it looks like, as you would brief an artist>", "parts": ["<3-7 parts the lesson would label>"]}. It must be the thing the lesson teaches (its parts, how it works), not a prop used to teach something else (a pizza for fractions, coins for counting, a ball for gravity): the lesson builds props itself so they can be cut, counted or thrown. Leave the list empty when a catalogue entry fits, for molecules and other things the catalogue builds from data, for abstract ideas, and for scenes with many objects."""

NOT_ROUTED = {"solar-system", "planets-to-scale", "saturn-nasa"}
PLAIN = re.compile(r"^[\w '-]{2,40}$", re.ASCII)
MOLECULE = re.compile(r"^[\w ,'()+-]{2,60}$", re.ASCII)
_build_tail: asyncio.Task[Any] | None = None


def _routable() -> list[dict[str, Any]]:
    return [entry for entry in library_catalog().values() if entry["id"] not in NOT_ROUTED]


def _catalogue_text() -> str:
    lines = []
    for entry in _routable():
        keywords = entry.get("keywords") or []
        extra = f" [{', '.join(keywords[:10])}]" if keywords else ""
        lines.append(f"- {entry['id']}: {entry['title']}{extra}")
    return "\n".join(lines)


def molecule_in_library(name: str) -> str | None:
    wanted = name.lower().strip()
    for entry in library_catalog().values():
        if entry.get("kind") == "chemistry" and wanted in (entry.get("keywords") or []):
            return entry["id"]
    return None


async def _spawn_build(name: str) -> dict[str, Any]:
    if not PYTHON.exists():
        return {"ok": False, "error": "no output"}
    proc = await asyncio.create_subprocess_exec(
        str(PYTHON), str(WORKER / "library" / "molecule_build.py"), name, "--out", str(library_dir()),
        cwd=str(WORKER / "library"),
        env={"PATH": "/usr/bin:/bin"},
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, _stderr = await asyncio.wait_for(proc.communicate(), 60)
    except asyncio.TimeoutError:
        proc.kill()
        return {"ok": False, "error": "no output"}
    lines = [line for line in stdout.decode().strip().split("\n") if line.startswith("{")]
    if not lines:
        return {"ok": False, "error": "no output"}
    try:
        return json.loads(lines[-1])
    except json.JSONDecodeError:
        return {"ok": False, "error": "unreadable output"}


async def _build_molecule(name: str) -> dict[str, Any]:
    global _build_tail
    previous = _build_tail

    async def run() -> dict[str, Any]:
        if previous is not None:
            try:
                await previous
            except Exception:
                pass
        found = molecule_in_library(name)
        if found:
            return {"ok": True, "id": found, "existed": True}
        return await _spawn_build(name)

    task = asyncio.create_task(run())
    _build_tail = task
    try:
        return await task
    except Exception:
        return {"ok": False, "error": "no output"}


def _keyword_route(prompt: str) -> list[str]:
    text = prompt.lower()
    scored = []
    for entry in _routable():
        hits = sum(1 for keyword in (entry.get("keywords") or []) if len(keyword) > 2 and keyword in text)
        if hits:
            scored.append((hits, entry["id"]))
    scored.sort(key=lambda item: item[0], reverse=True)
    return [asset_id for _hits, asset_id in scored[:2]]


async def route_assets(prompt: str, target: LlmTarget, *, want_objects: bool = False) -> dict[str, Any]:
    started = time.perf_counter()
    known = library_catalog()
    assets: list[str] = []
    molecules: list[str] = []
    wanted: list[dict[str, Any]] = []
    method = "model"
    try:
        extra = dict(target.extra_body or {})
        extra["reasoning_effort"] = "low"
        router = LlmTarget(
            id=target.id, base_url=target.base_url, api_key=target.api_key, model=target.model,
            max_tokens_param=target.max_tokens_param, headers=target.headers, extra_body=extra,
        )
        reply = await llm.complete([
            {"role": "system", "content": ROUTER_SYSTEM + (ROUTER_OBJECTS if want_objects else "")},
            {"role": "user", "content": f"Lesson request: {prompt}\n\nCatalogue:\n{_catalogue_text()}"},
        ], router)
        start = reply.text.find("{")
        end = reply.text.rfind("}")
        parsed = json.loads(reply.text[start:end + 1])
        if want_objects and isinstance(parsed.get("objects"), list):
            # The first valid entry, as the TS router (it filters before taking one).
            for obj in parsed["objects"]:
                if not isinstance(obj, dict) or not isinstance(obj.get("name"), str) or not PLAIN.fullmatch(obj["name"]):
                    continue
                if not isinstance(obj.get("describe"), str):
                    continue
                parts = [str(part) for part in (obj.get("parts") or []) if isinstance(part, str) and PLAIN.fullmatch(part)][:8]
                wanted.append({"name": obj["name"].strip().lower(), "describe": obj["describe"][:300], "parts": parts})
                break
        assets = [str(asset) for asset in (parsed.get("assets") or []) if str(asset) in known and str(asset) not in NOT_ROUTED]
        molecules = [str(name) for name in (parsed.get("molecules") or []) if isinstance(name, str) and MOLECULE.fullmatch(name)][:4]
    except Exception:
        method = "keywords"
        assets = _keyword_route(prompt)

    built: list[str] = []
    failed: list[str] = []
    for name in molecules:
        existing = molecule_in_library(name)
        if existing:
            assets.append(existing)
            continue
        result = await _build_molecule(name)
        if result.get("ok") and result.get("id"):
            assets.append(result["id"])
            if not result.get("existed"):
                built.append(result["id"])
        else:
            failed.append(f"{name}: {result.get('error')}")
    unique: list[str] = []
    for asset_id in assets:
        if asset_id not in unique:
            unique.append(asset_id)
    route: dict[str, Any] = {
        "assets": unique[:4],
        "built": built,
        "failed": failed,
        "ms": round((time.perf_counter() - started) * 1000),
        "method": method,
    }
    if wanted:
        route["wanted"] = wanted
    return route
