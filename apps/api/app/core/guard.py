"""Per-visitor rate limit, daily budget and content screen."""

from __future__ import annotations

import json
import math
import os
import re
import time
from typing import Any, Literal

from app.core import llm
from app.core.config import config

RATE_WINDOW_MS = 10 * 60_000
VOICE_LIMIT = 20
LOOKUP_LIMIT = 30

SCREEN_PROMPT = """You screen requests for an educational mixed-reality app that builds interactive 3D lessons
and small interactive tools. Allow almost everything a teacher, student or curious adult would ask for:
science, history, maths, geography, art, how things work, games and everyday tools.
Refuse a request only when building it would need:
- an identifiable real person (their likeness, a named celebrity, politician or private individual);
- a brand, logo, trademark, branded product or commercial artwork (generic objects are fine: "a smartphone", not a named brand's phone);
- sexual content, graphic violence or gore, hate, harassment, self-harm, weapons instructions or illegal acts;
- anything not suitable for a 13+ audience.
Historical figures as topics (e.g. "Newton's laws") are fine; only a portrait or likeness is not.
Reply with only JSON: {"allowed": true} or {"allowed": false, "reason": "<one short, friendly sentence for the user>"}"""

RefusalReason = Literal["rate", "budget", "content"]

_recent: dict[str, list[float]] = {}
_recent_voice: dict[str, list[float]] = {}
_recent_lookups: dict[str, list[float]] = {}
_spend = {"day": "", "usd": 0.0, "runs": 0}
_prices: dict[str, dict[str, Any] | None] = {}
_screener: llm.LlmTarget | None | bool = False  # False = not loaded yet
_screened: dict[str, dict[str, Any] | None] = {}


def reset() -> None:
    _recent.clear()
    _recent_voice.clear()
    _recent_lookups.clear()
    _spend.update(day="", usd=0.0, runs=0)
    _prices.clear()
    _screened.clear()
    global _screener
    _screener = False


def visitor_of(headers: dict[str, str], remote: str | None) -> str:
    forwarded = headers.get("x-forwarded-for")
    first = forwarded.split(",")[0].strip() if forwarded else ""
    return first or remote or "unknown"


def _check_rate(visitor: str, bucket: dict[str, list[float]], limit: int, message: str) -> dict[str, Any] | None:
    now = time.time() * 1000
    times = [stamp for stamp in bucket.get(visitor, []) if now - stamp < RATE_WINDOW_MS]
    bucket[visitor] = times
    if len(times) < limit:
        return None
    minutes = math.ceil((RATE_WINDOW_MS - (now - times[0])) / 60_000)
    return {"status": 429, "reason": "rate", "error": message.format(minutes=minutes)}


def _spend_file():
    day = time.strftime("%Y-%m-%d", time.gmtime())
    return config.runs_dir / f"spend-{day}.json", day


def _today() -> dict[str, Any]:
    path, day = _spend_file()
    if _spend["day"] != day:
        if path.exists():
            saved = json.loads(path.read_text(encoding="utf-8"))
            _spend.update(day=day, usd=float(saved.get("usd") or 0), runs=int(saved.get("runs") or 0))
        else:
            _spend.update(day=day, usd=0.0, runs=0)
    return _spend


def _check_budget() -> dict[str, Any] | None:
    if _today()["usd"] < config.daily_budget_usd:
        return None
    return {"status": 503, "reason": "budget", "error": "Live lessons are paused for today. The ready-made lessons still work."}


def _price_of(model_id: str) -> dict[str, Any] | None:
    if model_id not in _prices:
        # The catalogue's price, whether or not the model can be loaded here: loading Muse fails (its entry is
        # disabled), and the fallback then charged Muse at $3/$15 per million instead of $0.10/$0.20.
        catalogue = llm.model_prices().get(model_id)
        if catalogue is not None:
            _prices[model_id] = {"priceIn": catalogue.get("priceIn"), "priceOut": catalogue.get("priceOut"), "id": model_id}
        else:
            try:
                entry = llm.load_model(model_id)
                listed = llm.model_prices().get(entry.id) or {}
                _prices[model_id] = {"priceIn": listed.get("priceIn"), "priceOut": listed.get("priceOut"), "id": entry.id}
            except Exception:
                _prices[model_id] = None
    return _prices[model_id]


async def record_spend(calls: list[dict[str, Any]]) -> None:
    usd = 0.0
    for call in calls:
        entry = _price_of(str(call["model"]))
        price_in = 3 if entry is None or entry.get("priceIn") is None else entry["priceIn"]
        price_out = 15 if entry is None or entry.get("priceOut") is None else entry["priceOut"]
        usd += (call.get("promptTokens", 0) * price_in + call.get("completionTokens", 0) * price_out) / 1e6
    spent = _today()
    spent["usd"] += usd
    spent["runs"] += 1
    config.runs_dir.mkdir(parents=True, exist_ok=True)
    path, _day = _spend_file()
    path.write_text(json.dumps({"usd": round(spent["usd"] * 1e4) / 1e4, "runs": spent["runs"]}, separators=(",", ":")), encoding="utf-8")


def spend_today() -> dict[str, Any]:
    spent = _today()
    return {"usd": round(spent["usd"] * 100) / 100, "runs": spent["runs"], "budgetUsd": config.daily_budget_usd}


def _screener_target() -> llm.LlmTarget | None:
    global _screener
    if _screener is False:
        try:
            _screener = llm.load_model(os.environ.get("MODERATION_MODEL") or config.model)
        except Exception as exc:
            print(f"Content screen unavailable ({exc}); requests are not screened.")
            _screener = None
    return _screener if isinstance(_screener, llm.LlmTarget) else None


async def _check_content(prompt: str) -> dict[str, Any]:
    if os.environ.get("MODERATION") == "off":
        return {"refusal": None}
    key = prompt.strip().lower()
    if key in _screened:
        return {"refusal": _screened[key]}
    target = _screener_target()
    if target is None:
        return {"refusal": None}
    try:
        reply = await llm.complete(
            [{"role": "system", "content": SCREEN_PROMPT}, {"role": "user", "content": prompt}],
            target,
        )
        matched = re.search(r"\{[\s\S]*\}", reply.text)
        verdict = json.loads(matched.group(0)) if matched else {"allowed": True}
        refusal = None
        if verdict.get("allowed") is False:
            refusal = {
                "status": 422,
                "reason": "content",
                "error": verdict.get("reason") or "That isn't something this app can build. Try a science or how-it-works topic.",
            }
        _screened[key] = refusal
        return {
            "refusal": refusal,
            "usage": {"model": target.id, "promptTokens": reply.prompt_tokens, "completionTokens": reply.completion_tokens},
        }
    except Exception as exc:
        print(f"Content screen failed: {exc}")
        return {"refusal": None}


def admit_voice(visitor: str) -> dict[str, Any] | None:
    now = time.time() * 1000
    times = [stamp for stamp in _recent_voice.get(visitor, []) if now - stamp < RATE_WINDOW_MS]
    if len(times) >= VOICE_LIMIT:
        return {"status": 429, "reason": "rate", "error": "Too many voice requests; try again in a few minutes."}
    times.append(now)
    _recent_voice[visitor] = times
    return None


def admit_lookup(visitor: str) -> dict[str, Any] | None:
    now = time.time() * 1000
    times = [stamp for stamp in _recent_lookups.get(visitor, []) if now - stamp < RATE_WINDOW_MS]
    _recent_lookups[visitor] = times
    if len(times) >= LOOKUP_LIMIT:
        return {"status": 429, "reason": "rate", "error": "Too many size lookups; try again in a few minutes."}
    budget = _check_budget()
    if budget:
        return budget
    times.append(now)
    return None


async def admit(visitor: str, prompt: str) -> dict[str, Any] | None:
    rate = _check_rate(
        visitor, _recent, config.rate_limit_per_10_min,
        "That's a lot of lessons in a short time. Try again in {minutes} min, or pick a ready-made lesson.",
    )
    if rate:
        return rate
    budget = _check_budget()
    if budget:
        return budget
    # Counted before the screen: each screen is a paid call, so refused prompts must use up the limit too.
    _recent[visitor].append(time.time() * 1000)
    screened = await _check_content(prompt)
    if screened.get("usage"):
        await record_spend([screened["usage"]])
    if screened.get("refusal"):
        return screened["refusal"]
    return None
