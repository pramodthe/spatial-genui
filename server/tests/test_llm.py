"""The Python client must not call Anthropic."""

from __future__ import annotations

from urllib.parse import urlparse

import pytest

from app.core import llm
from app.core.llm import complete, default_target, LlmTarget, load_model, refuse_anthropic

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

    monkeypatch.setattr("app.core.llm._post", fail_post)
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


async def test_reasoning_effort_reaches_the_app_model_only(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.core.config import config

    sent: list[dict] = []

    class Reply:
        def json(self) -> dict:
            return {"choices": [{"message": {"content": "ok"}}], "usage": {}}

    async def record(_url: str, _headers: dict, body: dict) -> Reply:
        sent.append(body)
        return Reply()

    monkeypatch.setattr("app.core.llm._post", record)
    monkeypatch.setenv("LLM_REASONING_EFFORT", "max")
    app_model = LlmTarget(id=config.model, base_url="https://api.openai.com/v1/", api_key="k", model=config.model)
    router = LlmTarget(**{**app_model.__dict__, "extra_body": {"reasoning_effort": "low"}})
    other = LlmTarget(id="other", base_url="https://api.openai.com/v1/", api_key="k", model="some-other-model")
    for target in (app_model, router, other):
        await complete([{"role": "user", "content": "hi"}], target)
    assert [body.get("reasoning_effort") for body in sent] == ["max", "low", None]


def test_the_app_runs_on_muse_by_default(monkeypatch) -> None:
    """With no model in .env the app is Meta's Muse Ember on Meta's key, and its agents are Muse: no OpenAI anywhere."""
    from app.core import config as config_mod

    for name in ("LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL", "LLM_REASONING_EFFORT", "OPENAI_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("META_API_KEY", "meta-test-key")
    settings = config_mod.load_config()
    assert settings.base_url == "https://api.meta.ai/v1" and settings.model == "muse-ember-1.0"
    assert settings.api_key == "meta-test-key"
    monkeypatch.setattr(llm, "config", settings)
    agent = llm.agent_model()
    assert agent.model_name == "muse-ember-1.0" and "api.meta.ai" in str(agent.openai_api_base)
    assert not hasattr(llm, "gpt_chat")


def test_another_service_in_env_gets_the_agents_whatever_the_model_is_called(monkeypatch) -> None:
    """LLM_BASE_URL names another service and LLM_MODEL is left out (so it is muse-ember-1.0): the agents call that
    service with its own key, not Meta's endpoint with Meta's key."""
    from app.core import config as config_mod

    for name in ("LLM_MODEL", "LLM_REASONING_EFFORT", "OPENAI_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("LLM_BASE_URL", "https://llm.example/v1")
    monkeypatch.setenv("LLM_API_KEY", "other-key")
    monkeypatch.setenv("META_API_KEY", "meta-test-key")
    settings = config_mod.load_config()
    monkeypatch.setattr(llm, "config", settings)
    agent = llm.agent_model()
    assert str(agent.openai_api_base) == "https://llm.example/v1"
    assert agent.openai_api_key.get_secret_value() == "other-key"


def test_meta_is_known_by_its_exact_host_and_only_it_gets_metas_key(monkeypatch) -> None:
    """A URL that only contains api.meta.ai (another host, or a proxy path) is not Meta's: its agents go to it, and it
    is never given META_API_KEY."""
    from app.core import config as config_mod

    assert config_mod.is_meta("https://api.meta.ai/v1") and config_mod.is_meta("https://API.meta.ai:443/v1")
    for url in ("https://api.meta.ai.example.com/v1", "https://proxy.internal/api.meta.ai/v1", "", None):
        assert not config_mod.is_meta(url)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("LLM_MODEL", raising=False)
    monkeypatch.setenv("META_API_KEY", "meta-test-key")
    monkeypatch.setenv("LLM_BASE_URL", "https://api.meta.ai.example.com/v1")
    lookalike = config_mod.load_config()
    assert lookalike.api_key == ""
    monkeypatch.setattr(llm, "config", lookalike)
    assert str(llm.agent_model().openai_api_base) == "https://api.meta.ai.example.com/v1"
