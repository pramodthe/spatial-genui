"""JSON from a model's reply: the fenced block when there is one, with small repairs for the usual slips
(a missing comma or bracket, a trailing comma)."""

from __future__ import annotations

import json
import re
from typing import Any

_FENCE = re.compile(r"```(?:json)?\s*\n([\s\S]*?)```")


def extract_json(reply: str) -> Any:
    fence = _FENCE.search(reply)
    text = (fence.group(1) if fence else reply).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return _repair_json(text)


def _parse_error(text: str) -> int | None:
    try:
        json.loads(text)
        return None
    except json.JSONDecodeError as exc:
        if exc.pos is not None:
            return exc.pos
        if re.search(r"end of JSON|Unexpected end", exc.msg, re.I):
            return len(text)
        return 0


def _repair_json(text: str) -> Any:
    current = re.sub(r",(\s*[}\]])", r"\1", text)
    for _round in range(4):
        at = _parse_error(current)
        if at is None:
            return json.loads(current)
        best: str | None = None
        best_at = at

        def consider(candidate: str) -> None:
            nonlocal best, best_at
            nxt = _parse_error(candidate)
            reached = 10**12 if nxt is None else nxt
            if reached > at and (best is None or reached > best_at):
                best = candidate
                best_at = reached

        # The error can sit just past the end (a reply cut off mid-object): start at the last character.
        for index in range(min(at, len(current) - 1), max(0, at - 200) - 1, -1):
            if current[index] in "}]":
                consider(current[:index] + current[index + 1:])
        for index in range(at, max(0, at - 3) - 1, -1):
            for closer in ("}", "]"):
                consider(current[:index] + closer + current[index:])
        if best is None:
            return None
        current = best
    return json.loads(current) if _parse_error(current) is None else None
