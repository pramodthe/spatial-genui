"""One benchmark row from a Python API /api/generate result.

The TypeScript bench calls the agent in process. This records the same jsonl shape from the HTTP result,
so a later run can be summarized with research.report.
"""

from __future__ import annotations

import re
from typing import Any


def classify_failure(stage: str, error: str, finish_reason: str | None, *, fmt: str = "code") -> str:
    """The paper's failure labels. Same branches as apps/gate/research/bench.ts."""
    if stage == "no-code":
        if finish_reason == "length":
            return "truncated"
        return "no-code-block" if fmt == "code" else "invalid-json"
    if stage == "validate" and fmt != "code":
        return "unsupported-glyph" if re.search(r"plain ASCII", error) else "schema"
    if stage == "validate":
        if re.match(r"^Syntax error", error):
            return "syntax"
        if re.search(r"default export|export default", error):
            return "contract"
        if re.search(r"plain ASCII", error):
            return "unsupported-glyph"
        return "forbidden-api"
    if re.search(r"timed out", error):
        return "timeout"
    if re.search(r"UIKitML", error):
        return "panel-markup"
    if re.search(r"triangles|draw calls", error):
        return "over-budget"
    if re.search(r"must return|default export", error):
        return "contract"
    if re.search(r"not inside `root`|add `handle.object3D`", error):
        return "hierarchy"
    if re.search(r"width in meters", error):
        return "panel-options"
    if re.search(r"explicit width|smallest text", error):
        return "panel-text-size"
    if re.search(r"tilted|turned \d+°", error):
        return "panel-orientation"
    if re.search(r"empty", error):
        return "empty-scene"
    if re.search(r"Runtime error", error):
        return "runtime-error"
    return "other"


def _round4(number: float) -> float:
    return round(number * 1e4) / 1e4


def row_from_result(
    *,
    model_id: str,
    family: str,
    prompt_id: str,
    tier: str,
    domain: str,
    rep: int,
    result: dict[str, Any],
    price_in: float | None = None,
    price_out: float | None = None,
    fmt: str = "code",
) -> dict[str, Any]:
    """A results.jsonl row. `result` is the JSON body of POST /api/generate."""
    attempts = result.get("attempts") or []
    prompt_tokens = sum(int(item.get("promptTokens") or 0) for item in attempts)
    completion_tokens = sum(int(item.get("completionTokens") or 0) for item in attempts)
    failed = [item for item in attempts if item.get("stage") != "ok"]

    def attempt_error(item: dict[str, Any]) -> str:
        prefix = f"{item['role']}: " if item.get("role") else ""
        return prefix + str(item.get("error") or "")[:400]

    cost = None
    if price_in is not None and price_out is not None:
        cost = _round4((prompt_tokens * price_in + completion_tokens * price_out) / 1e6)
    first_try = all(item.get("stage") == "ok" for item in attempts) if fmt == "a2ui-parallel" else (attempts[0].get("stage") == "ok" if attempts else False)
    return {
        "model": model_id,
        "family": family,
        "promptId": prompt_id,
        "tier": tier,
        "domain": domain,
        "rep": rep,
        "ok": bool(result.get("ok")),
        "firstTryOk": first_try,
        "stages": [item.get("stage") for item in attempts],
        "failureKinds": [classify_failure(str(item.get("stage") or ""), str(item.get("error") or ""), item.get("finishReason"), fmt=fmt) for item in failed],
        "attemptErrors": [attempt_error(item) for item in failed],
        "attempts": len(attempts),
        "firstAttemptMs": attempts[0].get("ms") or 0 if attempts else 0,
        "totalMs": result.get("totalMs") or 0,
        "promptTokens": prompt_tokens,
        "completionTokens": completion_tokens,
        "costUSD": cost,
        "stats": result.get("stats"),
        "error": None if result.get("ok") else str(result.get("error") or "")[:500],
        "code": result.get("code"),
        "route": result.get("route"),
        "format": fmt,
        "source": result.get("source"),
        "timings": result.get("timings"),
    }
