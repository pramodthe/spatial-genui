"""Call the Node gate (apps/gate): static check plus the locked-down dry run."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from app.config import REPO_ROOT

TSX = REPO_ROOT / "apps" / "gate" / "node_modules" / ".bin" / "tsx"
GATE = REPO_ROOT / "apps" / "gate" / "gate.ts"
# The child is killed at 15s; the first call also bundles it.
GATE_TIMEOUT_S = 60


async def check_module(code: str, known_assets: list[str] | None = None, *, short: bool = False) -> dict[str, Any]:
    if not TSX.exists():
        return {"ok": False, "stage": "dry-run", "error": f"Gate runner missing ({TSX}). Run npm install in apps/gate."}
    payload = {"code": code, "knownAssets": known_assets or [], "short": short}
    try:
        proc = await asyncio.create_subprocess_exec(
            str(TSX), str(GATE),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except OSError as exc:
        return {"ok": False, "stage": "dry-run", "error": f"Gate failed to start: {exc}"}
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(json.dumps(payload).encode()), GATE_TIMEOUT_S)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return {"ok": False, "stage": "dry-run", "error": "Gate timed out."}
    text = stdout.decode()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        tail = stderr.decode()[-400:]
        return {"ok": False, "stage": "dry-run", "error": f"Gate returned no JSON. {tail}".strip()}
