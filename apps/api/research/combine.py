"""Merge benchmark directories the way apps/gate/research/bench-combine.ts does.

Screenshots stay in the source directory. A label renames one model so two versions of it
can sit in one report.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from research.jsonl import read_jsonl


def _rename(model: str, only: str | None, label: str | None) -> str:
    if label and only and model == only:
        return label
    return model


def combine(sources: list[str], out: Path, *, note: str | None = None) -> list[str]:
    """Write results.jsonl, browser.jsonl, judge.jsonl and meta.json. Returns the model order."""
    merged: dict[str, list[str]] = {"results": [], "browser": [], "judge": []}
    prompts_file = None
    order: list[str] = []
    for source in sources:
        dir_part, _, model_part = source.partition(":")
        folder = Path(dir_part)
        only, label = (model_part.split("=", 1) + [None])[:2] if model_part else (None, None)
        meta_path = folder / "meta.json"
        meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
        prompts_file = prompts_file or meta.get("promptsFile")

        def keep(row: dict[str, Any]) -> bool:
            return not only or row.get("model") == only

        for row in filter(keep, read_jsonl(folder / "results.jsonl")):
            row["model"] = _rename(str(row["model"]), only, label)
            if row["model"] not in order:
                order.append(row["model"])
            merged["results"].append(json.dumps(row, ensure_ascii=False))
        for row in filter(keep, read_jsonl(folder / "browser.jsonl")):
            row["model"] = _rename(str(row["model"]), only, label)
            shot = row.get("shot")
            if shot:
                row["shot"] = os.path.relpath(folder / str(shot), out)
            merged["browser"].append(json.dumps(row, ensure_ascii=False))
        for row in filter(keep, read_jsonl(folder / "judge.jsonl")):
            row["model"] = _rename(str(row["model"]), only, label)
            row["judge"] = _rename(str(row.get("judge") or ""), only, label)
            merged["judge"].append(json.dumps(row, ensure_ascii=False))
    out.mkdir(parents=True, exist_ok=True)
    for name, lines in merged.items():
        (out / f"{name}.jsonl").write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
    (out / "meta.json").write_text(
        json.dumps({"combinedFrom": sources, "promptsFile": prompts_file, "note": note, "models": order}, indent=2) + "\n",
        encoding="utf-8",
    )
    return order
