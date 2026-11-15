"""The Python client must not call Anthropic."""

from __future__ import annotations

from urllib.parse import urlparse

import pytest

from app.llm import LlmTarget, complete, default_target, load_model, refuse_anthropic

CLAUDE_IDS = ("claude-opus-5-5", "claude-fable-5-2", "claude-sonnet-5-5", "claude-haiku-5-5")


def test_default_target_is_not_anthropic() -> None:
    target = default_target()
    assert urlparse(target.base_url).netloc != "api.anthropic.com"
    assert not target.model.lower().startswith("claude")
    assert target.headers is None


def test_catalog_claude_models_are_refused_before_the_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    for model_id in CLAUDE_IDS:
        with pytest.raises(RuntimeError, match="Anthropic is disabled"):
            load_model(model_id)


def test_muse_catalog_is_not_treated_as_anthropic() -> None:
    try:
        target = load_model("muse-ember-1.0-max")
    except RuntimeError as exc:
        assert "Anthropic is disabled" not in str(exc)
        return
    assert "anthropic" not in urlparse(target.base_url).netloc


def test_openai_and_muse_targets_are_allowed() -> None:
    refuse_anthropic("gpt-6.1-sol", "https://api.openai.com/v1/", family="OpenAI", api_key_env="OPENAI_API_KEY")
    refuse_anthropic("muse-spark-1.3", "https://api.meta.ai/v1", family="Meta", api_key_env="META_API_KEY")


async def test_complete_refuses_anthropic_before_http(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fail_post(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("HTTP was attempted")

    monkeypatch.setattr("app.llm._post", fail_post)
    anthropic = LlmTarget(
        id="claude-opus-5-5",
        base_url="https://api.anthropic.com/v1/",
        api_key="blocked",
        model="claude-opus-5-5",
    )
    disguised = LlmTarget(
        id="gpt-6.1-sol",
        base_url="https://api.openai.com/v1/",
        api_key="blocked",
        model="gpt-6.1-sol",
        headers={"anthropic-workspace-id": "ws"},
    )
    with pytest.raises(RuntimeError, match="Anthropic is disabled"):
        await complete([{"role": "user", "content": "hi"}], anthropic)
    with pytest.raises(RuntimeError, match="Anthropic is disabled"):
        await complete([{"role": "user", "content": "hi"}], disguised)
