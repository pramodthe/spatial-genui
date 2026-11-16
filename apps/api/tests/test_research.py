"""Phase 4: the Python report reproduces the committed RQ1 and RQ4 cells."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from research.bench import classify_failure, row_from_result
from research.combine import combine
from research.report import DEFAULT_JUDGE, summarize
from research.rq4 import markdown

ROOT = Path(__file__).resolve().parents[3]
RQ1 = ROOT / "bench" / "results" / "rq1-a2ui-v3-sonnet"
RQ4 = ROOT / "bench" / "results" / "rq4-parallel-v3-sonnet"


def test_new_summaries_default_to_the_app_model() -> None:
    assert DEFAULT_JUDGE == "gpt-6.1-sol"
    assert summarize.__kwdefaults__ == {"judge": DEFAULT_JUDGE}


def test_rq1_cell_matches_the_committed_summary() -> None:
    # Those rows were scored by the published judge. The production default is gpt-6.1-sol.
    fresh = summarize(RQ1, judge="claude-opus-5-5")
    committed = json.loads((RQ1 / "summary.json").read_text(encoding="utf-8"))
    assert [row["model"] for row in fresh["summary"]] == [row["model"] for row in committed["summary"]]
    for got, expected in zip(fresh["summary"], committed["summary"], strict=True):
        for key, value in expected.items():
            if isinstance(value, float):
                assert got[key] == pytest.approx(value, abs=1e-9), key
            else:
                assert got[key] == value, key
    assert fresh["byTier"] == committed["byTier"]
    assert fresh["taxonomy"] == committed["taxonomy"]


def test_rq4_sonnet_cell_matches_the_committed_table() -> None:
    table = markdown(RQ1, [RQ4])
    assert "| one-shot | claude-sonnet-5-5 | 24 | 24/24 | 17 | 39.8 s | 39.8 s | 5621.5 | 3.88 (n=24) |" in table
    assert "| parallel (placeholders at 6.2 s) | claude-sonnet-5-5 | 24 | 23/24 | 14 | 18.5 s | 50.0 s | 9093 | 3.62 (n=23) |" in table


def test_http_result_becomes_a_bench_row() -> None:
    row = row_from_result(
        model_id="gpt-6.1-sol",
        family="OpenAI",
        prompt_id="heart",
        tier="T1",
        domain="body",
        rep=0,
        price_in=3,
        price_out=15,
        result={
            "ok": False,
            "error": "Syntax error: unexpected token",
            "totalMs": 1200,
            "attempts": [
                {"stage": "validate", "error": "Syntax error: unexpected token", "ms": 1200, "promptTokens": 10, "completionTokens": 4, "finishReason": "stop"},
            ],
        },
    )
    assert row["failureKinds"] == ["syntax"]
    assert row["firstTryOk"] is False
    assert row["costUSD"] == pytest.approx(0.0001)
    assert classify_failure("no-code", "", "length") == "truncated"


def test_combine_renames_one_model(tmp_path: Path) -> None:
    source = tmp_path / "src"
    source.mkdir()
    (source / "results.jsonl").write_text('{"model":"ember","promptId":"a","rep":0}\n', encoding="utf-8")
    (source / "browser.jsonl").write_text('{"model":"ember","promptId":"a","rep":0,"shot":"shots/a.png"}\n', encoding="utf-8")
    (source / "judge.jsonl").write_text('{"model":"ember","judge":"ember","promptId":"a","rep":0}\n', encoding="utf-8")
    (source / "meta.json").write_text('{"promptsFile":"bench/prompts/test-12.json"}\n', encoding="utf-8")
    out = tmp_path / "out"
    order = combine([f"{source}:ember=Ember·A-code"], out)
    assert order == ["Ember·A-code"]
    saved = json.loads((out / "results.jsonl").read_text(encoding="utf-8"))
    assert saved["model"] == "Ember·A-code"
    judged = json.loads((out / "judge.jsonl").read_text(encoding="utf-8"))
    assert judged["judge"] == "Ember·A-code"
