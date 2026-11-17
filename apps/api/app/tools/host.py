"""Library lookup and real size. Secrets stay in this process."""

from __future__ import annotations

import json

from langchain_core.tools import tool

from app import library, real_size as sizes


@tool
def library_lookup(query: str) -> str:
    """Find library models whose id, title or keywords match the query. Returns ids, parts and credit."""
    needle = query.strip().lower()
    found = []
    for entry in library.library_catalog().values():
        hay = " ".join([
            entry.get("id") or "",
            entry.get("title") or "",
            " ".join(entry.get("keywords") or []),
            " ".join(part.get("node") or "" for part in entry.get("parts") or []),
        ]).lower()
        if needle and needle not in hay:
            continue
        found.append({
            "id": entry["id"],
            "title": entry.get("title"),
            "parts": [part.get("node") for part in entry.get("parts") or []],
            "credit": library.short_credit(entry),
        })
        if len(found) >= 8:
            break
    return json.dumps(found)


@tool
async def real_size(subject: str) -> str:
    """How big the subject is in the real world, in metres. Uses the host cache and the size model."""
    known = sizes.known_real_size(subject)
    if known:
        return json.dumps(known)
    try:
        return json.dumps(await sizes.real_size_of(subject))
    except Exception as exc:
        return json.dumps({"error": str(exc)})
