"""Library, asset jobs and real size. Secrets stay in this process."""

from __future__ import annotations

import json

from langchain_core.tools import tool

from app import assets, library, real_size as sizes


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
def start_asset_job(name: str, describe: str, parts: str = "") -> str:
    """Start a background 3D model job on the host. parts is a comma-separated list. Returns the job id and status."""
    wanted = {
        "name": name,
        "describe": describe,
        "parts": [part.strip() for part in parts.split(",") if part.strip()],
    }
    job = assets.start_asset_job(wanted)
    return json.dumps({"id": job["id"], "status": job["status"], "name": job["name"]})


@tool
def asset_job_status(job_id: str) -> str:
    """Read a background model job. When status is done, assetId is the library id to use."""
    job = assets.asset_job(job_id)
    if job is None:
        return json.dumps({"error": "Unknown job"})
    return json.dumps({
        "id": job["id"],
        "status": job["status"],
        "assetId": job.get("assetId"),
        "error": job.get("error"),
        "stage": (job.get("events") or [{}])[-1].get("message") if job.get("events") else None,
    })


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
