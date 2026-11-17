"""Pick library models for a lesson: a small model call over the catalogue, keywords when it fails."""

from __future__ import annotations

import json
import re
import time
from typing import Any

from app import llm
from app.library import library_catalog
from app.llm import LlmTarget


ROUTER_SYSTEM = """You pick accurate 3D models for a mixed-reality lesson. You get the lesson request and a catalogue of models built from scientific data. Reply with only a JSON object:
{"assets": ["<catalogue ids the lesson should show>"], "molecules": ["<English names of chemical compounds the lesson needs as 3D molecules that are not in the catalogue>"]}
Choose only what the lesson needs (usually 1, at most 4). Use the catalogue when an entry fits the request; list molecules only for real chemical compounds (e.g. "caffeine", "glucose", "carbon dioxide"). If nothing fits, return empty lists."""

NOT_ROUTED = {"solar-system", "planets-to-scale", "saturn-nasa"}
MOLECULE = re.compile(r"^[\w ,'()+-]{2,60}$", re.ASCII)


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


def _keyword_route(prompt: str) -> list[str]:
    text = prompt.lower()
    scored = []
    for entry in _routable():
        hits = sum(1 for keyword in (entry.get("keywords") or []) if len(keyword) > 2 and keyword in text)
        if hits:
            scored.append((hits, entry["id"]))
    scored.sort(key=lambda item: item[0], reverse=True)
    return [asset_id for _hits, asset_id in scored[:2]]


async def route_assets(prompt: str, target: LlmTarget) -> dict[str, Any]:
    started = time.perf_counter()
    known = library_catalog()
    assets: list[str] = []
    molecules: list[str] = []
    method = "model"
    try:
        extra = dict(target.extra_body or {})
        extra["reasoning_effort"] = "low"
        router = LlmTarget(
            id=target.id, base_url=target.base_url, api_key=target.api_key, model=target.model,
            max_tokens_param=target.max_tokens_param, headers=target.headers, extra_body=extra,
        )
        reply = await llm.complete([
            {"role": "system", "content": ROUTER_SYSTEM},
            {"role": "user", "content": f"Lesson request: {prompt}\n\nCatalogue:\n{_catalogue_text()}"},
        ], router)
        start = reply.text.find("{")
        end = reply.text.rfind("}")
        parsed = json.loads(reply.text[start:end + 1])
        assets = [str(asset) for asset in (parsed.get("assets") or []) if str(asset) in known and str(asset) not in NOT_ROUTED]
        molecules = [str(name) for name in (parsed.get("molecules") or []) if isinstance(name, str) and MOLECULE.fullmatch(name)][:4]
    except Exception:
        method = "keywords"
        assets = _keyword_route(prompt)

    failed: list[str] = []
    for name in molecules:
        existing = molecule_in_library(name)
        if existing:
            assets.append(existing)
        else:
            failed.append(f"{name}: not in the library")
    unique: list[str] = []
    for asset_id in assets:
        if asset_id not in unique:
            unique.append(asset_id)
    route: dict[str, Any] = {
        "assets": unique[:4],
        "failed": failed,
        "ms": round((time.perf_counter() - started) * 1000),
        "method": method,
    }
    return route
