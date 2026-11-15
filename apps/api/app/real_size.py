"""How big a lesson's subject is, cached. Same prompt and file as the removed TypeScript server's real-size.ts."""

from __future__ import annotations

import json
import math
import os
import re
from typing import Any

from app import llm
from app.config import config
from app.guard import record_spend

PROMPT = """A mixed-reality learning app shows a 3D model of a lesson's subject on the learner's desk, and can also
show it at its true size. Given the lesson's request or title, name the one physical thing the lesson is about and
give its typical largest real-world dimension in metres (a two-storey house about 8, an adult human heart about 0.12,
an E. coli bacterium about 0.000002, a guitar about 1). For a process that happens to one kind of thing, give that
thing ("how bacteria divide": a bacterium; "how a jet engine works": a jet engine). Give null only when there is no
single thing to show at its true size: a cycle or system spread over a landscape or space (the water cycle, the solar
system as a whole) or nothing physical.
Reply with JSON only: {"subject": "...", "sizeM": number or null, "dimension": "height" | "length" | "width" | "diameter"}"""

_cache: dict[str, dict[str, Any]] = {}
_loaded = False
_sizer: llm.LlmTarget | None | bool = False


def _load() -> None:
    global _loaded
    if _loaded:
        return
    _loaded = True
    path = config.real_size_cache
    if not path.exists():
        return
    try:
        for key, value in json.loads(path.read_text(encoding="utf-8")).items():
            _cache[key] = value
    except Exception:
        # A damaged cache is rebuilt as subjects are asked again.
        return


def known_real_size(request: str) -> dict[str, Any] | None:
    _load()
    return _cache.get(request.strip().lower())


def _sizer_target() -> llm.LlmTarget | None:
    global _sizer
    if _sizer is False:
        try:
            _sizer = llm.load_model(os.environ.get("SIZE_MODEL") or config.model)
        except Exception as exc:
            print(f"Size agent unavailable ({exc}); real-size views are off.")
            _sizer = None
    return _sizer if isinstance(_sizer, llm.LlmTarget) else None


async def real_size_of(request: str) -> dict[str, Any]:
    _load()
    key = request.strip().lower()
    known = _cache.get(key)
    if known:
        return known
    target = _sizer_target()
    if target is None:
        return {"subject": request, "sizeM": None, "dimension": "length"}
    reply = await llm.complete([{"role": "system", "content": PROMPT}, {"role": "user", "content": request}], target)
    await record_spend([{"model": target.id, "promptTokens": reply.prompt_tokens, "completionTokens": reply.completion_tokens}])
    matched = re.search(r"\{[\s\S]*\}", reply.text)
    parsed = json.loads(matched.group(0)) if matched else {}
    size = parsed.get("sizeM")
    # A finite positive number only, as the TS server's JSON.parse + typeof check: no booleans, NaN or Infinity
    # (Python's json accepts Infinity, and a non-finite size cached here would break that subject for good).
    size_m = size if isinstance(size, (int, float)) and not isinstance(size, bool) and math.isfinite(size) and size > 0 else None
    answer = {
        "subject": str(parsed.get("subject") or request)[:120],
        "sizeM": size_m,
        "dimension": str(parsed.get("dimension") or "length"),
    }
    _cache[key] = answer
    path = config.real_size_cache
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(_cache, indent=1, ensure_ascii=False), encoding="utf-8")
    return answer
