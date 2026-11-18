"""What a run costs: the cost meter prices cached input at the model's cached price, every meter (the coder, its grader,
the model-maker) adds to the attempt's dollar total, and the daily budget is charged from that total instead of from
tokens at the full input price."""

from __future__ import annotations

import pytest
from langchain_core.messages import AIMessage

from app.core import guard, llm
from app.core.clock import now_iso
from app.pipeline.coder import scope
from app.pipeline.coder.middleware import CostMeterMiddleware
from app.services import games


def _reply(prompt: int, cached: int, completion: int) -> AIMessage:
    return AIMessage(content="", usage_metadata={
        "input_tokens": prompt, "output_tokens": completion, "total_tokens": prompt + completion,
        "input_token_details": {"cache_read": cached},
    })


def test_sol_has_a_cached_price() -> None:
    sol = llm.model_prices()["gpt-6.1-sol"]
    assert sol["priceCached"] == 0.1 and sol["priceIn"] == 2 and sol["priceOut"] == 10


def test_every_meter_adds_to_the_attempts_dollars_with_cached_input_at_its_price() -> None:
    token = scope.spent.set({"usd": 0.0})
    try:
        coder = CostMeterMiddleware(budget_usd=3.0, model_id="gpt-6.1-sol")
        grader = CostMeterMiddleware(budget_usd=0.5, model_id="gpt-6.1-sol", key="grader_cost_usd")
        # 100k in, 95k of them a cache read, 1k out: 5k x $2 + 95k x $0.10 + 1k x $10 a million = $0.0295
        # (it was $0.21 with cached input at the full price).
        assert coder.after_model({"messages": [_reply(100_000, 95_000, 1_000)]}, None) == {"cost_usd": pytest.approx(0.0295)}
        # The grader's own state is thrown away by the rubric middleware; its spend still reaches the total.
        grader.after_model({"messages": [_reply(10_000, 0, 500)]}, None)
        assert scope.spent.get()["usd"] == pytest.approx(0.0295 + 0.025)
    finally:
        scope.spent.reset(token)
    # Outside a run there is no total to add to, and the meter still works.
    assert CostMeterMiddleware(budget_usd=3.0, model_id="gpt-6.1-sol").after_model({"messages": [_reply(1_000, 0, 0)]}, None) == {"cost_usd": pytest.approx(0.002)}


@pytest.mark.asyncio
async def test_the_daily_budget_is_charged_from_the_meters_dollars() -> None:
    calls = guard.attempt_calls({"model": "gpt-6.1-sol", "attempts": [
        {"promptTokens": 10_000_000, "completionTokens": 0, "costUsd": 0.5},  # an agent attempt: its meters' dollars
        {"promptTokens": 1_000, "completionTokens": 1_000},                    # a one-call attempt: its tokens
    ]})
    assert calls == [{"model": "gpt-6.1-sol", "usd": 0.5}, {"model": "gpt-6.1-sol", "promptTokens": 1_000, "completionTokens": 1_000}]
    before = guard._today()["usd"]
    await guard.record_spend(calls)
    assert guard._today()["usd"] - before == pytest.approx(0.5 + (1_000 * 2 + 1_000 * 10) / 1e6)
    assert guard.attempt_calls({"attempts": [{"costUsd": 1.0}]}) == []  # no model: nothing ran


@pytest.mark.asyncio
async def test_a_game_charges_what_its_agents_spent(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_run_game(request: str, *, thread_id: str) -> dict:
        return {"ok": True, "code": "export default function build() {}", "model": "gpt-6.1-sol",
                "attempts": [{"promptTokens": 10_000_000, "completionTokens": 0, "costUsd": 0.75}]}

    monkeypatch.setattr(games, "run_game", fake_run_game)
    before = guard._today()["usd"]
    game = {"id": "spend001", "request": "a kite", "title": "a kite", "status": "writing", "createdAt": now_iso()}
    await games.write(game)
    assert game["status"] == "ready"
    # Its meters' $0.75, not 10M tokens at $2 a million.
    assert guard._today()["usd"] - before == pytest.approx(0.75)
