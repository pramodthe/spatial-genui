"""Background model jobs. The Python worker scripts live in apps/worker3d; the vision and
render stages still run through the reference pipeline (apps/gate/acquire-bridge.ts) so a
library entry matches what the TypeScript server would have written.
"""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any

from app.clock import now_iso
from app.config import REPO_ROOT
from app.background import track

TSX = REPO_ROOT / "apps" / "gate" / "node_modules" / ".bin" / "tsx"
BRIDGE = REPO_ROOT / "apps" / "gate" / "acquire-bridge.ts"
# A course model takes 15 to 40 minutes (TRELLIS.2, then the Blender split); past this the build is given up.
ACQUIRE_TIMEOUT_S = 90 * 60
WORKER = REPO_ROOT / "apps" / "worker3d"

_jobs: dict[str, dict[str, Any]] = {}
_tail: asyncio.Task[Any] | None = None


def slug_of(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40]
    return slug or "object"


def asset_job(job_id: str) -> dict[str, Any] | None:
    return _jobs.get(job_id)


def asset_jobs() -> list[dict[str, Any]]:
    return list(_jobs.values())


def start_asset_job(wanted: dict[str, Any], options: dict[str, Any] | None = None) -> dict[str, Any]:
    job_id = slug_of(str(wanted.get("name") or ""))
    existing = _jobs.get(job_id)
    if existing and existing["status"] != "failed":
        return existing
    job: dict[str, Any] = {
        "id": job_id,
        "name": wanted.get("name") or job_id,
        "status": "queued",
        "events": [],
        "startedAt": now_iso(),
    }
    _jobs[job_id] = job
    _enqueue(job, wanted, options or {})
    return job


def _enqueue(job: dict[str, Any], wanted: dict[str, Any], options: dict[str, Any]) -> None:
    global _tail
    previous = _tail

    async def run() -> None:
        if previous is not None:
            try:
                await previous
            except Exception:
                pass
        job["status"] = "running"
        try:
            result = await acquire_asset(wanted, lambda event: job["events"].append(event), options)
        except Exception as exc:
            job["status"] = "failed"
            job["error"] = str(exc)
            job["finishedAt"] = now_iso()
            return
        job["finishedAt"] = now_iso()
        if result.get("ok"):
            job["status"] = "done"
            job["assetId"] = result.get("assetId")
            job["parts"] = result.get("parts") or []
        else:
            job["status"] = "failed"
            job["error"] = f"{result.get('stage')}: {result.get('error')}"

    _tail = track(asyncio.create_task(run()))


async def run_worker(script: str, args: list[str], timeout: float = 20 * 60) -> dict[str, Any]:
    """Run one apps/worker3d script in this process's machine (not WORKER3D_URL)."""
    python = WORKER / ".venv" / "bin" / "python3"
    if not python.exists():
        return {"ok": False, "error": "could not start the worker: apps/worker3d/.venv is missing"}
    proc = await asyncio.create_subprocess_exec(
        str(python), str(WORKER / script), *args,
        cwd=str(WORKER / "library"),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, _stderr = await asyncio.wait_for(proc.communicate(), timeout)
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


async def acquire_asset(
    wanted: dict[str, Any],
    on_event: Any = lambda _event: None,
    options: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not TSX.exists() or not BRIDGE.exists():
        return {"ok": False, "error": "The acquire bridge is not installed.", "stage": "reference", "ms": 0}
    proc = await asyncio.create_subprocess_exec(
        str(TSX), str(BRIDGE),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    assert proc.stdin is not None and proc.stdout is not None and proc.stderr is not None
    proc.stdin.write(json.dumps({"wanted": wanted, "options": options or {}}).encode())
    await proc.stdin.drain()
    proc.stdin.close()
    result: dict[str, Any] | None = None
    # stderr is read alongside stdout (keeping its last few KB for the error): a full, unread stderr pipe
    # would block the child and leave the job, the course's model and the asset queue waiting for ever.
    tail = bytearray()

    async def drain_stderr() -> None:
        async for raw in proc.stderr:  # type: ignore[union-attr]
            tail.extend(raw)
            del tail[:-4000]

    async def read_stdout() -> None:
        nonlocal result
        async for raw in proc.stdout:  # type: ignore[union-attr]
            line = raw.decode().strip()
            if not line:
                continue
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            if message.get("type") == "event":
                on_event(message.get("event") or {})
            elif message.get("type") == "result":
                result = message.get("result")

    try:
        await asyncio.wait_for(asyncio.gather(read_stdout(), drain_stderr(), proc.wait()), ACQUIRE_TIMEOUT_S)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return {"ok": False, "error": f"The model build took over {ACQUIRE_TIMEOUT_S // 60} minutes.", "stage": "reference", "ms": ACQUIRE_TIMEOUT_S * 1000}
    if result is None and tail:
        return {"ok": False, "error": tail.decode(errors="replace").strip()[-300:] or "no output", "stage": "reference", "ms": 0}
    return result or {"ok": False, "error": "no output", "stage": "reference", "ms": 0}
