"""RQ4 table: one-shot A2UI against parallel builders. Same figures as bench-rq4.ts."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from research.jsonl import read_jsonl


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2


def _mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def _whole(number: float) -> str:
    return str(int(number)) if float(number).is_integer() else str(number)


def _seconds(ms: float | None) -> str:
    return "-" if ms is None else f"{ms / 1000:.1f} s"


def _load(directory: Path) -> tuple[list[dict[str, Any]], dict[str, list[float]]]:
    rows = [row for row in read_jsonl(directory / "results.jsonl") if not row.get("apiError")]
    quality: dict[str, list[float]] = {}
    for item in read_jsonl(directory / "judge.jsonl"):
        score = item.get("overall")
        if score is None and item.get("scores"):
            score = _mean([float(value) for value in item["scores"].values()])
        if score is None:
            continue
        key = f"{item['model']}|{item['promptId']}|{item['rep']}"
        quality.setdefault(key, []).append(float(score))
    return rows, quality


def rows_for(kind: str, directory: Path) -> list[dict[str, Any]]:
    """One dict per model, with the same columns as the RQ4 markdown table."""
    rows, quality = _load(directory)
    table: list[dict[str, Any]] = []
    for model in dict.fromkeys(row["model"] for row in rows):
        mine = [row for row in rows if row["model"] == model]
        ok = [row for row in mine if row.get("ok")]
        if kind == "parallel":
            first = [float((row.get("timings") or {}).get("firstPartMs") or row.get("totalMs") or 0) for row in ok]
            plan = _median([float((row.get("timings") or {}).get("planMs") or 0) for row in ok])
        else:
            first = [float(row.get("totalMs") or 0) for row in ok]
            plan = None
        scores = [score for row in ok for score in quality.get(f"{row['model']}|{row['promptId']}|{row['rep']}", [])]
        mean_quality = _mean(scores)
        table.append({
            "kind": kind,
            "plan_s": None if plan is None else plan / 1000,
            "model": model,
            "n": len(mine),
            "success": f"{len(ok)}/{len(mine)}",
            "first_try": sum(1 for row in mine if row.get("firstTryOk")),
            "first_content": _seconds(_median(first)),
            "full_lesson": _seconds(_median([float(row.get("totalMs") or 0) for row in ok])),
            "output_tokens": _median([float(row.get("completionTokens") or 0) for row in ok]),
            "quality": None if mean_quality is None else round(mean_quality, 2),
            "quality_n": len(scores),
        })
    return table


def markdown(one_shot: Path, parallel: list[Path]) -> str:
    lines = [
        "| Version | Model | n | Success | First try | First content (median) | Full lesson (median) | Output tokens (median) | Quality (judges) |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    sets = [("one-shot", one_shot), *[("parallel", path) for path in parallel]]
    for kind, directory in sets:
        for row in rows_for(kind, directory):
            label = kind
            if row["plan_s"] is not None:
                label = f"{kind} (placeholders at {row['plan_s']:.1f} s)"
            quality = "not judged" if row["quality"] is None else f"{row['quality']:.2f} (n={row['quality_n']})"
            tokens = "-" if row["output_tokens"] is None else (_whole(row["output_tokens"]))
            lines.append(
                f"| {label} | {row['model']} | {row['n']} | {row['success']} | {row['first_try']} | {row['first_content']} | {row['full_lesson']} | {tokens} | {quality} |"
            )
    return "\n".join(lines)
