"""Call the Python API over HTTP.

The research scripts in apps/gate/research can keep their scoring and browser steps and send generation
through this client instead of the TypeScript process. Re-running an RQ cell spends live model calls, so
nothing here starts a run on import.

    GENUI_API_URL=http://localhost:8787 python -m research.drive
is not a benchmark. Use post_generate / post_stream from a script that already has a prompt.
"""

from __future__ import annotations

import json
import os
from typing import Any

import httpx

API_URL = os.environ.get("GENUI_API_URL") or "http://localhost:8787"


def post_generate(prompt: str, *, kind: str = "lesson", timeout: float = 1800) -> dict[str, Any]:
    response = httpx.post(f"{API_URL}/api/generate", json={"prompt": prompt, "kind": kind}, timeout=timeout)
    response.raise_for_status()
    return response.json()


def post_stream(prompt: str, *, timeout: float = 1800) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    with httpx.stream("POST", f"{API_URL}/api/generate-stream", json={"prompt": prompt}, timeout=timeout) as response:
        response.raise_for_status()
        for line in response.iter_lines():
            if line:
                events.append(json.loads(line))
    return events
