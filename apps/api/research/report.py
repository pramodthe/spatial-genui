"""Benchmark report. Same numbers as apps/gate/research/bench-report.ts.

A scene counts only when the server checks passed and the emulator mounted it without errors.
A failed scene scores 1/5 so every model's quality average covers all of its scenes.

`judge` picks the primary column in rows that are already on disk. New runs default to the
app model, gpt-6.1-sol. Pass a historical judge id, including claude-*, to re-read a published summary.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

from research.jsonl import read_jsonl

FAILED_SCENE_SCORE = 1
# The app model. Historical summaries pass their own judge id into summarize().
DEFAULT_JUDGE = "gpt-6.1-sol"


def js_round(number: float, digits: int = 2) -> float:
    """Math.round: half away from zero, not Python's bankers' round."""
    factor = 10**digits
    return math.copysign(math.floor(abs(number) * factor + 0.5), number) / factor


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _median(values: list[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2


def _rate(hits: float, total: float) -> float:
    return hits / total if total else 0.0


def _key(row: dict[str, Any]) -> str:
    return f"{row['model']}|{row['promptId']}|{row['rep']}"


def summarize(directory: Path, *, judge: str = DEFAULT_JUDGE) -> dict[str, Any]:
    """The summary.json object for one results directory. Does not write the file."""
    folder = Path(directory)
    rows = read_jsonl(folder / "results.jsonl")
    browser = read_jsonl(folder / "browser.jsonl")
    judged = read_jsonl(folder / "judge.jsonl")
    browser_by = {_key(item): item for item in browser}

    def crashed(row: dict[str, Any]) -> bool:
        mounted = browser_by.get(_key(row))
        return bool(mounted and not mounted.get("harnessError") and (not mounted.get("mounted") or mounted.get("runtimeErrors")))

    def works(row: dict[str, Any]) -> bool:
        return bool(row.get("ok")) and not crashed(row)

    scored_judgements = [item for item in judged if item.get("scores")]

    def judge_score(item: dict[str, Any]) -> float:
        return _mean([float(value) for value in item["scores"].values()])

    primary = judge if any(item.get("judge") == judge for item in scored_judgements) else None
    panel = [item for item in scored_judgements if item.get("judge") != primary]
    grand = _mean([judge_score(item) for item in panel])
    shifts: dict[str, float] = {}
    for name in dict.fromkeys(item["judge"] for item in panel):
        theirs = [judge_score(item) for item in panel if item["judge"] == name]
        shifts[name] = grand - _mean(theirs)

    def scene_quality(scenes: list[dict[str, Any]], pick, adjust=lambda _item: 0.0) -> float | None:
        per_scene: list[float] = []
        for row in scenes:
            if not works(row):
                per_scene.append(FAILED_SCENE_SCORE)
                continue
            matched = [item for item in scored_judgements if _key(item) == _key(row) and pick(item)]
            if matched:
                per_scene.append(_mean([judge_score(item) + adjust(item) for item in matched]))
        return js_round(_mean(per_scene), 2) if per_scene else None

    models = list(dict.fromkeys(row["model"] for row in rows))
    summary: list[dict[str, Any]] = []
    for model in models:
        all_rows = [row for row in rows if row["model"] == model]
        scored = [row for row in all_rows if not row.get("apiError")]
        ok = [row for row in scored if works(row)]
        mounted = [browser_by[_key(row)] for row in scored if _key(row) in browser_by and not browser_by[_key(row)].get("harnessError")]
        grab_tests = [item for item in mounted if (item.get("grab") or {}).get("tested")]
        press_tests = [item for item in mounted if (item.get("press") or {}).get("tested")]
        family = all_rows[0].get("family") if all_rows else None

        def in_panel(item: dict[str, Any]) -> bool:
            return item.get("judge") != primary

        def other_family(item: dict[str, Any]) -> bool:
            return in_panel(item) and bool(item.get("judgeFamily")) and item.get("judgeFamily") != family

        priced = [row for row in scored if row.get("costUSD") is not None]
        panel_for_model = any(item.get("model") == model for item in panel)
        other_for_model = any(item.get("model") == model and other_family(item) for item in panel)
        cost = js_round(sum(float(row["costUSD"]) for row in priced), 3) if priced else None
        summary.append({
            "model": model,
            "family": family,
            "n": len(scored),
            "apiErrors": len(all_rows) - len(scored),
            "passAt1": _rate(sum(1 for row in scored if row.get("firstTryOk") and not crashed(row)), len(scored)),
            "successWithRepair": _rate(len(ok), len(scored)),
            "failedScenes": len(scored) - len(ok),
            "meanAttempts": js_round(_mean([float(row.get("attempts") or 0) for row in scored]), 2),
            "mountedClean": _rate(sum(1 for item in mounted if item.get("mounted") and not item.get("runtimeErrors")), len(mounted)) if mounted else None,
            "grabWorks": _rate(sum(1 for item in grab_tests if (item.get("grab") or {}).get("held")), len(grab_tests)) if grab_tests else None,
            "pressWorks": _rate(sum(1 for item in press_tests if (item.get("press") or {}).get("fired")), len(press_tests)) if press_tests else None,
            "panelButtonsWork": (
                _rate(sum(float((item.get("panelPress") or {}).get("worked") or 0) for item in mounted), sum(float((item.get("panelPress") or {}).get("tested") or 0) for item in mounted))
                if any((item.get("panelPress") or {}).get("tested") for item in mounted)
                else None
            ),
            "qualityPrimary": scene_quality(scored, lambda item: item.get("judge") == primary) if primary and model != primary else None,
            "quality1to5": scene_quality(scored, in_panel) if panel_for_model else None,
            "qualityOtherJudges": scene_quality(scored, other_family) if other_for_model else None,
            "qualityOtherJudgesAdjusted": scene_quality(scored, other_family, lambda item: shifts.get(item["judge"], 0.0)) if other_for_model else None,
            "medianFirstAttemptS": js_round(_median([float(row.get("firstAttemptMs") or 0) / 1000 for row in scored]), 1),
            "medianTotalS": js_round(_median([float(row.get("totalMs") or 0) / 1000 for row in scored]), 1),
            "meanOutputTokens": round(_mean([float(row.get("completionTokens") or 0) for row in scored])),
            "costUSD": cost,
            "costPerSuccessUSD": js_round(sum(float(row["costUSD"]) for row in priced) / len(ok), 4) if priced and ok else None,
            "meanCrowdedGrabPairs": js_round(_mean([float((row.get("stats") or {}).get("crowdedGrabPairs") or 0) for row in ok]), 2),
        })
    summary.sort(key=lambda item: (-item["successWithRepair"], -(item["qualityPrimary"] or 0), -item["passAt1"]))

    kinds = sorted({kind for row in rows for kind in (row.get("failureKinds") or [])})
    taxonomy = [
        {"model": model, **{kind: sum(1 for row in rows if row["model"] == model for got in (row.get("failureKinds") or []) if got == kind) for kind in kinds}}
        for model in models
    ]
    tiers = sorted({row.get("tier") for row in rows})
    by_tier = []
    for model in models:
        entry: dict[str, Any] = {"model": model}
        for tier in tiers:
            subset = [row for row in rows if row["model"] == model and row.get("tier") == tier and not row.get("apiError")]
            entry[tier] = f"{sum(1 for row in subset if works(row))}/{len(subset)}" if subset else "–"
        by_tier.append(entry)
    return {"summary": summary, "taxonomy": taxonomy, "byTier": by_tier}
