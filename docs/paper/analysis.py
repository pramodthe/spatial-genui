"""Recomputes every number in the paper from the raw benchmark records in bench/results and writes data.json.

Run from the repository root: python3 docs/paper/analysis.py
Standard library only. Confidence intervals are paired percentile bootstraps over requests (10,000 resamples, fixed
seed), so two arms are compared on the same requests.
"""

from __future__ import annotations

import json
import math
import random
import statistics as st
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "bench" / "results"
OUT = Path(__file__).with_name("data.json")
RESAMPLES = 10_000
RUBRIC = ("fidelity", "clarity", "correctness", "handsOn")
# Every scene is scored by one independent judge; run 1 also kept three other judges' scores, which are not used.
JUDGE = "claude-opus-5-5"


def rows(folder: str, name: str) -> list[dict]:
    path = RESULTS / folder / name
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def quality(scores: dict) -> float:
    """Quality is the mean of the four rubric scores (1-5) the judge gave a scene."""
    return st.mean(scores[k] for k in RUBRIC)


def scene_scores(results: list[dict], judged: list[dict]) -> dict[tuple[str, int], float]:
    """Every attempted scene's quality, keyed by (request, repetition). A scene that failed every check scores 1, the
    lowest score, so an arm's mean counts its failures instead of averaging only what worked."""
    by = {(j["promptId"], j["rep"]): quality(j["scores"]) for j in judged}
    return {(r["promptId"], r["rep"]): by.get((r["promptId"], r["rep"]), 1.0) if r["ok"] else 1.0 for r in results}


def bootstrap_mean(values: list[float], seed: int = 7) -> tuple[float, float]:
    rng = random.Random(seed)
    n = len(values)
    means = sorted(st.mean(rng.choices(values, k=n)) for _ in range(RESAMPLES))
    return means[int(0.025 * RESAMPLES)], means[int(0.975 * RESAMPLES) - 1]


def sign_test(wins: int, losses: int) -> float:
    """Two-sided exact sign test on the requests that differ (ties dropped)."""
    n = wins + losses
    if n == 0:
        return 1.0
    tail = sum(math.comb(n, k) for k in range(max(wins, losses), n + 1)) / 2 ** n
    return min(1.0, 2 * tail)


def paired(a: dict[str, float], b: dict[str, float]) -> dict:
    """Mean of a - b over the requests both arms have, with a bootstrap CI and wins/ties/losses for a."""
    keys = sorted(set(a) & set(b))
    diffs = [a[k] - b[k] for k in keys]
    low, high = bootstrap_mean(diffs)
    wins, losses = sum(d > 1e-9 for d in diffs), sum(d < -1e-9 for d in diffs)
    return {
        "n": len(keys), "mean": round(st.mean(diffs), 3), "ci": [round(low, 3), round(high, 3)],
        "wins": wins, "ties": len(keys) - wins - losses, "losses": losses, "signP": round(sign_test(wins, losses), 4),
    }


def median_s(ms: list[float]) -> float:
    return round(st.median(ms) / 1000, 1)


def quartiles_s(ms: list[float]) -> list[float]:
    q = st.quantiles(ms, n=4)
    return [round(q[0] / 1000, 1), round(q[2] / 1000, 1)]


def arm_summary(results: list[dict], judged: list[dict], browser: list[dict]) -> dict:
    """One arm (a model, or a model and an output format) over its requests and repetitions."""
    q = list(scene_scores(results, judged).values())
    low, high = bootstrap_mean(q)
    working = [quality(j["scores"]) for j in judged]
    grabs = [b["grab"]["held"] for b in browser if b.get("grab", {}).get("tested")]
    presses = [b["press"]["fired"] for b in browser if b.get("press", {}).get("tested")]
    tested = sum(b.get("panelPress", {}).get("tested", 0) for b in browser)
    worked = sum(b.get("panelPress", {}).get("worked", 0) for b in browser)
    ok = [r for r in results if r["ok"]]
    costs = [r["costUSD"] for r in results if r.get("costUSD") is not None]
    return {
        "n": len(results),
        "success": sum(r["ok"] for r in results),
        "firstTry": sum(r["firstTryOk"] for r in results),
        "mounted": sum(b["mounted"] and not b["runtimeErrors"] for b in browser),
        "browsed": len(browser),
        "quality": round(st.mean(q), 3), "qualityCI": [round(low, 3), round(high, 3)],
        "qualityWorking": round(st.mean(working), 3) if working else None,
        "rubric": {k: round(st.mean(j["scores"][k] for j in judged), 3) for k in RUBRIC},
        "grab": [sum(grabs), len(grabs)], "press": [sum(presses), len(presses)], "panelButtons": [worked, tested],
        "medianS": median_s([r["totalMs"] for r in results]), "iqrS": quartiles_s([r["totalMs"] for r in results]),
        "latencyS": sorted(round(r["totalMs"] / 1000, 1) for r in results),
        "outputTokens": round(st.mean(r["completionTokens"] for r in results)),
        "costPerSuccess": round(sum(costs) / len(ok), 4) if costs and len(costs) == len(results) else None,
    }


def per_request(results: list[dict], judged: list[dict]) -> dict[str, float]:
    """Each request's quality (failures score 1), averaged over its repetitions."""
    by = defaultdict(list)
    for (prompt, _), q in scene_scores(results, judged).items():
        by[prompt].append(q)
    return {k: st.mean(v) for k, v in by.items()}


def split(records: list[dict], key: str = "model") -> dict[str, list[dict]]:
    by = defaultdict(list)
    for r in records:
        by[r[key]].append(r)
    return by


def run_arms(folder: str) -> tuple[dict, dict]:
    res, bro = (split(rows(folder, f)) for f in ("results.jsonl", "browser.jsonl"))
    jud = split([j for j in rows(folder, "judge.jsonl") if j["judge"] == JUDGE])
    arms = {m: arm_summary(res[m], jud.get(m, []), bro.get(m, [])) for m in res}
    return arms, {m: per_request(res[m], jud.get(m, [])) for m in res}


def rq1() -> dict:
    """Open code (A) against declarative A2UI (C) and controlled templates (D), each with two models."""
    arms, by_request = run_arms("rq1-compare")
    pairs = {}
    for model in ("Sonnet", "Ember"):
        a, c, d = (by_request[f"{model}·{x}"] for x in ("A-code", "C-a2ui", "D-template"))
        pairs[model] = {"A-C": paired(a, c), "A-D": paired(a, d), "C-D": paired(c, d)}
    return {"arms": arms, "paired": pairs}


def rq2() -> dict:
    """Five models on the same system (run 4), the same models before the system changes (runs 1-2), complex apps (run 5)."""
    fair, fair_req = run_arms("compare-fair")
    before = {}
    for folder in ("run-1", "run-2-kimi"):
        arms, _ = run_arms(folder)
        before.update({m: a["quality"] for m, a in arms.items()})
    # Ember's run-2 records were replaced by run 3; its run-2 mean is kept in docs/spec.md (Phase 2, run 2).
    before.setdefault("muse-ember-1.0-max", 3.77)
    ember_iter, _ = run_arms("run-3-ember-max")
    hard, _ = run_arms("run-5-hard")
    best = max(fair_req, key=lambda m: fair[m]["quality"])
    vs_best = {m: paired(fair_req[best], fair_req[m]) for m in fair_req if m != best}
    spread_before = round(max(before.values()) - min(before.values()), 3)
    spread_after = round(max(a["quality"] for a in fair.values()) - min(a["quality"] for a in fair.values()), 3)
    spread_hard = round(max(a["quality"] for a in hard.values()) - min(a["quality"] for a in hard.values()), 3)
    return {"fair": fair, "before": before, "emberRun3": ember_iter, "hard": hard, "best": best, "vsBest": vs_best,
            "spread": {"before": spread_before, "after": spread_after, "hard": spread_hard}}


def rq4() -> dict:
    """Parallel builders against one-shot A2UI with the same checker, builder model and judge."""
    out = {}
    for model, one, par in (("Sonnet", "rq1-a2ui-v3-sonnet", "rq4-parallel-v3-sonnet"), ("Ember", "rq1-a2ui-v3-ember", "rq4-parallel-v3-ember")):
        one_arms, one_req = run_arms(one)
        par_arms, par_req = run_arms(par)
        (one_name, o), = one_arms.items()
        (par_name, p), = par_arms.items()
        # As in bench/results/rq4-compare: times and output tokens are medians over the scenes that succeeded.
        one_ok = [r for r in rows(one, "results.jsonl") if r["ok"]]
        par_ok = [r for r in rows(par, "results.jsonl") if r["ok"]]
        timings = [r["timings"] for r in par_ok]
        keep = ("n", "success", "firstTry", "quality", "qualityWorking")
        out[model] = {
            "oneShot": {**{k: o[k] for k in keep}, "fullS": median_s([r["totalMs"] for r in one_ok]),
                        "outputTokens": round(st.median(r["completionTokens"] for r in one_ok))},
            "parallel": {**{k: p[k] for k in keep}, "fullS": median_s([r["totalMs"] for r in par_ok]),
                         "outputTokens": round(st.median(r["completionTokens"] for r in par_ok))},
            "placeholdersS": median_s([t["planMs"] for t in timings]),
            "firstContentS": median_s([t["firstPartMs"] for t in timings]),
            "qualityDelta": paired(par_req[par_name], one_req[one_name]),
        }
    return out


def three_d() -> dict:
    """Three ways to build a named-part 3D object, judged on the same four-view render."""
    judged = [j for j in rows("3d-run-1", "judge.jsonl") if j.get("round") == 0 and j["variant"] == "base"]
    results = rows("3d-run-1", "results.jsonl")
    by = defaultdict(dict)
    for j in judged:
        by[j["pipeline"]][j["objectId"]] = j["overall"]
    pipes = {}
    for name, scores in by.items():
        base = [r for r in results if r["pipeline"] == name and r["variant"] == "base"]
        first = [r["rounds"][0] for r in base]
        pipes[name] = {
            "overall": round(st.mean(scores.values()), 3),
            "medianS": median_s([r["firstMs"] for r in base]),
            "triangles": round(st.median(f["stats"]["triangles"] for f in first)),
            "meshes": round(st.median(f["stats"]["meshes"] for f in first)),
        }
    # The critic loop keeps the round it scored highest (finalRound): its gain is that round's judge score minus round
    # 0's, per job. A reference image's effect is the "ref" variant's round 0 against "base", per pipeline and object.
    all_judged = {(j["pipeline"], j["objectId"], j["variant"], j["round"]): j["overall"] for j in rows("3d-run-1", "judge.jsonl")}
    critic = {f'{r["pipeline"]}/{r["objectId"]}/{r["variant"]}': all_judged[(r["pipeline"], r["objectId"], r["variant"], r["finalRound"])] for r in results}
    first = {f'{r["pipeline"]}/{r["objectId"]}/{r["variant"]}': all_judged[(r["pipeline"], r["objectId"], r["variant"], 0)] for r in results}
    with_ref = {f'{p}/{o}': v for (p, o, var, rnd), v in all_judged.items() if var == "ref" and rnd == 0}
    without = {f'{p}/{o}': v for (p, o, var, rnd), v in all_judged.items() if var == "base" and rnd == 0}
    return {"pipelines": pipes, "P1-P2": paired(by["p1-threejs"], by["p2-cadquery"]), "P1-P3": paired(by["p1-threejs"], by["p3-blender"]),
            "critic": paired(critic, first), "reference": paired(with_ref, without),
            "criticWorse": sum(critic[k] < first[k] for k in critic)}


def factors() -> dict:
    """The 35-game factor study: setup means and the paired changes on the same requests."""
    games = json.loads((RESULTS / "play-factors" / "scores.json").read_text())
    by = defaultdict(dict)
    setups = {}
    for g in games:
        by[g["setup"]][g["case"]] = g["judge"]["total"]
        s = setups.setdefault(g["setup"], {"detail": g["setup_detail"], "model": g["model"], "totals": [], "fixes": 0, "minutes": []})
        s["totals"].append(g["judge"]["total"])
        s["fixes"] += g["layout_must_fixes"]
        s["minutes"].append(g["build_minutes"])
    summary = {k: {"detail": v["detail"], "model": v["model"], "games": len(v["totals"]), "score": round(st.mean(v["totals"]), 2),
                   "layoutFixes": v["fixes"], "buildMin": round(st.mean(v["minutes"]), 1)} for k, v in setups.items()}
    pairs = {}
    for name, a, b in (("Model: S to DeepSeek", "S", "DeepSeek"), ("Model: S to Sonnet", "S", "Sonnet"), ("Pipeline cleanup: N to S", "N", "S"),
                       ("Layout checker v1: A to L", "A", "L"), ("Layout checker v2: A to M", "A", "M"), ("Layout checker v3: O to N", "O", "N"), ("Planning pictures: S to P", "S", "P"), ("ECS kit: B to E", "B", "E")):
        keys = sorted(set(by[a]) & set(by[b]))
        diffs = [by[b][k] - by[a][k] for k in keys]
        pairs[name] = {"from": a, "to": b, "n": len(keys), "mean": round(st.mean(diffs), 2), "diffs": dict(zip(keys, diffs)),
                       "fixes": [summary[a]["layoutFixes"], summary[b]["layoutFixes"]]}
    return {"setups": summary, "pairs": pairs, "games": len(games)}


# The emulator interaction matrix (Nov 14): its raw probe files were kept local, so the table is copied from
# docs/spec.md (Phase 4, "Emulator results"). Cells are [worked, offered]; None means no lesson offers it.
MATRIX_SOURCES = ["Hand-written", "Open code", "Course model GLB", "Library GLB", "A2UI (C)", "Templates (D)"]
MATRIX = [
    ("Lessons mounted", [[2, 2], [23, 23], [12, 12], [4, 4], [12, 12], [12, 12]]),
    ("Direct grab, carried", [[2, 2], [11, 11], [3, 7], None, [4, 4], [1, 2]]),
    ("Distance grab, carried", [[1, 1], [4, 8], [0, 1], [3, 3], None, [1, 1]]),
    ("Grab one part of a model", [[1, 1], None, [1, 1], [3, 3], None, None]),
    ("Panel button, point and pinch", [[2, 2], [20, 23], [9, 12], [4, 4], [10, 11], [9, 11]]),
    ("Panel button, fingertip poke", [[2, 2], [21, 23], [9, 12], [4, 4], [10, 11], [6, 11]]),
    ("Panel toggle, point and pinch", [[1, 1], [2, 2], None, None, None, None]),
    ("Panel slider, pinch and sweep", [[1, 1], [1, 1], None, None, None, None]),
    ("3D press, point and pinch", [[1, 1], [8, 13], [5, 9], [1, 3], [7, 7], [8, 9]]),
    ("3D press, fingertip poke", [[1, 1], [11, 13], [9, 9], [3, 3], [7, 7], [9, 9]]),
    ("Explode a model", [[1, 1], None, [1, 1], [3, 3], None, None]),
    ("Move bar: pinch and drag", [[2, 2], [20, 23], [12, 12], [4, 4], [12, 12], [12, 12]]),
]


def matrix() -> dict:
    cells = [c for _, row in MATRIX[1:] for c in row if c]
    return {"sources": MATRIX_SOURCES, "rows": [{"name": n, "cells": r} for n, r in MATRIX],
            "lessons": sum(c[1] for c in MATRIX[0][1]), "probes": [sum(c[0] for c in cells), sum(c[1] for c in cells)],
            "repeat": [228, 238]}


# Headset measurements on a Quest 3 (Nov 17-18): page memory over consecutive games, before and after the unmount fix
# in apps/xr/src/genui/host.ts, and how far one controller drag scrolled the dashboard list before and after the fix.
HEADSET = {
    "memoryBefore": {"games": 12, "fromMB": 409, "toMB": 571},
    "memoryAfter": {"games": 16, "pageMB": 407, "heapMB": 96},
    "scrollPx": {"before": 13, "after": 230},
}


def main() -> None:
    data = {"rq1": rq1(), "rq2": rq2(), "rq4": rq4(), "threeD": three_d(), "factors": factors(), "matrix": matrix(), "headset": HEADSET}
    text = json.dumps(data, indent=1, ensure_ascii=False)
    OUT.write_text(text)
    # The paper page reads the same numbers as a script, which also works when it is opened from disk.
    OUT.with_suffix(".js").write_text(f"window.DATA = {text};\n")
    print(f"wrote {OUT.relative_to(ROOT)} and data.js")


if __name__ == "__main__":
    main()
