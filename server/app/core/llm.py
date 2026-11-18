"""Model calls: OpenAI-compatible chat completions for one-call steps, chat models for the agents, and the model
list with prices (models.json).

The agents' chat model uses OpenAI's Responses API on api.openai.com and Chat Completions on other
OpenAI-compatible services.
"""

from __future__ import annotations

import asyncio
from email.utils import parsedate_to_datetime
import json
import os
import random
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse

import httpx
from langchain_openai import ChatOpenAI

from app.core.config import config, MODELS_FILE

REQUEST_TIMEOUT_S = 30 * 60
MAX_RETRIES = 3
# Ember's published price tier is "up to 200K input tokens" (models.json). 85% of that is the
# 170k summarization fallback Deep Agents uses when a profile is missing, so Muse gets this window.
MUSE_MAX_INPUT_TOKENS = 200_000
MUSE_BASE_URL = "https://api.meta.ai/v1"


@dataclass
class LlmTarget:
    id: str
    base_url: str
    api_key: str
    model: str
    max_tokens_param: str = "max_completion_tokens"
    headers: dict[str, str] | None = None
    extra_body: dict[str, Any] | None = None


@dataclass
class Completion:
    text: str
    finish_reason: str | None
    prompt_tokens: int
    cached_tokens: int
    completion_tokens: int
    ms: int


def refuse_anthropic(
    model: str | None = None,
    base_url: str | None = None,
    *,
    family: str | None = None,
    api_key_env: str | None = None,
    also: str | None = None,
) -> None:
    """Reject an Anthropic host, a claude model id, or ANTHROPIC_API_KEY before any request."""
    host = urlparse(base_url or "").netloc.lower()
    names = [model or "", also or ""]
    blocked = (
        host == "api.anthropic.com"
        or host.endswith(".anthropic.com")
        or any(name.lower().startswith("claude") for name in names)
        or (family or "").lower() == "anthropic"
        or api_key_env == "ANTHROPIC_API_KEY"
    )
    if not blocked:
        return
    label = next((name for name in names if name), None) or host or "Anthropic"
    raise RuntimeError(f"Anthropic is disabled ({label}). Use a Meta Muse model.")


def _refuse_target(target: LlmTarget) -> None:
    refuse_anthropic(target.model, target.base_url, also=target.id)
    if target.headers and any("anthropic" in key.lower() for key in target.headers):
        raise RuntimeError("Anthropic is disabled (request header). Use a Meta Muse model.")


def default_target() -> LlmTarget:
    refuse_anthropic(config.model, config.base_url)
    return LlmTarget(id=config.model, base_url=config.base_url, api_key=config.api_key, model=config.model)


def _hosts_match(left: str, right: str) -> bool:
    return urlparse(left).netloc == urlparse(right).netloc


def load_model(model_id: str, file: Path = MODELS_FILE) -> LlmTarget:
    models = json.loads(file.read_text(encoding="utf-8"))["models"]
    entry = next((item for item in models if item["id"] == model_id), None)
    if entry is None:
        known = ", ".join(item["id"] for item in models)
        raise RuntimeError(f"Unknown model {model_id}; known: {known}")
    refuse_anthropic(
        entry["id"],
        entry.get("baseURL"),
        family=entry.get("family"),
        api_key_env=entry.get("apiKeyEnv"),
        also=str(entry.get("model") or ""),
    )
    api_key = os.environ.get(entry["apiKeyEnv"]) or ""
    if not api_key and _hosts_match(entry["baseURL"], config.base_url):
        api_key = config.api_key
    if not api_key:
        raise RuntimeError(f"No API key for {model_id}: set {entry['apiKeyEnv']} in .env.")
    built = LlmTarget(
        id=entry["id"],
        base_url=entry["baseURL"],
        api_key=api_key,
        model=entry["model"],
        max_tokens_param=entry.get("maxTokensParam") or "max_completion_tokens",
        headers=entry.get("headers"),
        extra_body=dict(entry["extraBody"]) if entry.get("extraBody") else None,
    )
    _refuse_target(built)
    return built


def model_prices() -> dict[str, dict[str, Any]]:
    models = json.loads(MODELS_FILE.read_text(encoding="utf-8"))["models"]
    prices = {item["id"]: item for item in models}
    # The agents ask by the API's model name ("muse-ember-1.0"), not the catalogue id ("muse-ember-1.0-max"); a
    # miss charged Ember at the $3/$15 stand-in and stopped its runs at the $2 budget after 6 cents of real use.
    for item in models:
        prices.setdefault(item["model"], item)
    return prices


def _message_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, dict):
                parts.append(str(part.get("text") or ""))
            else:
                parts.append(str(part))
        return "".join(parts)
    return "" if content is None else str(content)


async def complete(
    messages: list[dict[str, Any]],
    target: LlmTarget | None = None,
    *,
    on_text: Callable[[str], None] | None = None,
) -> Completion:
    """One chat completion. Sampling is left at the provider default.

    With `on_text` the reply is streamed and the callback gets the whole text so far after every chunk (the live
    preview); the Completion returned is the same either way."""
    target = target or default_target()
    _refuse_target(target)
    if not target.api_key:
        raise RuntimeError(f"No API key for {target.id}. Add it to the .env file at the repo root.")
    body: dict[str, Any] = {
        "model": target.model,
        "messages": messages,
        target.max_tokens_param: config.max_completion_tokens,
    }
    if target.extra_body:
        body.update(target.extra_body)
    effort = os.environ.get("LLM_REASONING_EFFORT")
    if effort and target.model == config.model and "reasoning_effort" not in body:
        # The app's own model at the effort .env asks for; a call that sets one (the router's "low") keeps it.
        body["reasoning_effort"] = effort
    headers = {"authorization": f"Bearer {target.api_key}", "content-type": "application/json"}
    if target.headers:
        headers.update(target.headers)
    url = target.base_url.rstrip("/") + "/chat/completions"
    started = time.perf_counter()
    if on_text is None:
        data = (await _post(url, headers, body)).json()
    else:
        data = await _stream(url, headers, {**body, "stream": True, "stream_options": {"include_usage": True}}, on_text)
    choice = (data.get("choices") or [{}])[0]
    message = choice.get("message") or {}
    usage = data.get("usage") or {}
    details = usage.get("prompt_tokens_details") or {}
    return Completion(
        text=_message_content(message.get("content")),
        finish_reason=choice.get("finish_reason"),
        prompt_tokens=int(usage.get("prompt_tokens") or 0),
        cached_tokens=int(details.get("cached_tokens") or 0),
        completion_tokens=int(usage.get("completion_tokens") or 0),
        ms=round((time.perf_counter() - started) * 1000),
    )


async def _post(url: str, headers: dict[str, str], body: dict[str, Any]) -> httpx.Response:
    timeout = httpx.Timeout(REQUEST_TIMEOUT_S, connect=60.0)
    last_error: Exception | None = None
    async with httpx.AsyncClient(timeout=timeout) as client:
        for attempt in range(MAX_RETRIES + 1):
            wait: float | None = None
            try:
                response = await client.post(url, headers=headers, json=body)
            except httpx.TransportError as exc:
                last_error = exc
                response = None
            else:
                # As the OpenAI SDK the TS server used: retry 408, 409, 429 and any 5xx; honour Retry-After.
                if response.status_code not in {408, 409, 429} and response.status_code < 500:
                    if response.status_code >= 400:
                        detail = response.text[:500]
                        raise RuntimeError(f"Model request failed (HTTP {response.status_code}): {detail}")
                    return response
                last_error = RuntimeError(f"HTTP {response.status_code}: {response.text[:200]}")
                wait = _retry_after(response)
            if attempt < MAX_RETRIES:
                backoff = min(8.0, 0.5 * (2**attempt)) + random.random() * 0.1
                await asyncio.sleep(backoff if wait is None else wait)
    raise RuntimeError(f"Model request failed after retries: {last_error}")


async def _stream(url: str, headers: dict[str, str], body: dict[str, Any], on_text: Callable[[str], None]) -> dict[str, Any]:
    """A streamed completion, put back together in the shape of a plain one. Retried as _post is; a stream that
    breaks part-way starts again from the beginning (on_text then sees the text restart)."""
    timeout = httpx.Timeout(REQUEST_TIMEOUT_S, connect=60.0)
    last_error: Exception | None = None
    async with httpx.AsyncClient(timeout=timeout) as client:
        for attempt in range(MAX_RETRIES + 1):
            wait: float | None = None
            try:
                async with client.stream("POST", url, headers=headers, json=body) as response:
                    if response.status_code in {408, 409, 429} or response.status_code >= 500:
                        await response.aread()
                        last_error = RuntimeError(f"HTTP {response.status_code}: {response.text[:200]}")
                        wait = _retry_after(response)
                    elif response.status_code >= 400:
                        await response.aread()
                        raise RuntimeError(f"Model request failed (HTTP {response.status_code}): {response.text[:500]}")
                    else:
                        text = ""
                        finish: str | None = None
                        usage: dict[str, Any] = {}
                        async for line in response.aiter_lines():
                            if not line.startswith("data:"):
                                continue
                            payload = line[5:].strip()
                            if payload == "[DONE]":
                                break
                            chunk = json.loads(payload)
                            usage = chunk.get("usage") or usage
                            for choice in chunk.get("choices") or []:
                                delta = (choice.get("delta") or {}).get("content")
                                if delta:
                                    text += delta
                                    on_text(text)
                                finish = choice.get("finish_reason") or finish
                        return {"choices": [{"message": {"content": text}, "finish_reason": finish}], "usage": usage}
            except httpx.TransportError as exc:
                last_error = exc
            if attempt < MAX_RETRIES:
                backoff = min(8.0, 0.5 * (2**attempt)) + random.random() * 0.1
                await asyncio.sleep(backoff if wait is None else wait)
    raise RuntimeError(f"Model request failed after retries: {last_error}")


def _retry_after(response: httpx.Response) -> float | None:
    """The server's Retry-After (seconds or an HTTP date), capped at 60 s like the SDK; None if absent."""
    value = response.headers.get("retry-after-ms")
    if value:
        try:
            return min(60.0, max(0.0, float(value) / 1000))
        except ValueError:
            pass
    value = response.headers.get("retry-after")
    if not value:
        return None
    try:
        return min(60.0, max(0.0, float(value)))
    except ValueError:
        try:
            when = parsedate_to_datetime(value)
        except (TypeError, ValueError):
            return None
        return min(60.0, max(0.0, when.timestamp() - time.time()))


def compatible_chat():
    """The agents' model on another OpenAI-compatible service, when .env names one (LLM_BASE_URL, LLM_API_KEY,
    LLM_MODEL): Chat Completions, at LLM_REASONING_EFFORT when it is set (GLM: none turns its thinking off)."""
    refuse_anthropic(config.model, config.base_url)
    effort = os.environ.get("LLM_REASONING_EFFORT")
    return ChatOpenAI(
        model=config.model,
        api_key=config.api_key or "missing",
        base_url=config.base_url,
        use_responses_api=False,
        extra_body={"reasoning_effort": effort} if effort else None,
        max_tokens=config.max_completion_tokens,
        max_retries=MAX_RETRIES,
        timeout=REQUEST_TIMEOUT_S,
    )


def muse_chat(model: str = "muse-spark-1.3-contributor", *, reasoning_effort: str | None = None):
    """Muse through Meta's OpenAI-compatible endpoint. A profile stops the 170k summary fallback."""
    refuse_anthropic(model, MUSE_BASE_URL)
    extra = {"reasoning_effort": reasoning_effort} if reasoning_effort else None
    return ChatOpenAI(
        model=model,
        api_key=os.environ.get("META_API_KEY") or "missing",
        base_url=MUSE_BASE_URL,
        use_responses_api=False,
        max_tokens=config.max_completion_tokens,
        max_retries=MAX_RETRIES,
        timeout=REQUEST_TIMEOUT_S,
        extra_body=extra,
        # structured_output: Muse takes a JSON-schema response format but only tool_choice "auto"; with this LangChain
        # asks for structured results (the rubric grader's verdict) that way instead of forcing a tool call (a 400).
        profile={"max_input_tokens": MUSE_MAX_INPUT_TOKENS, "structured_output": True},
    )


def agent_model():
    """The app's own model for the agents: Meta's Muse (the default, Muse Ember), or the OpenAI-compatible service
    .env names instead."""
    refuse_anthropic(config.model, config.base_url)
    if "api.meta.ai" in config.base_url or config.model.startswith("muse"):
        effort = None
        try:
            entry = load_model(config.model)
            effort = (entry.extra_body or {}).get("reasoning_effort") or os.environ.get("LLM_REASONING_EFFORT")
            return muse_chat(entry.model, reasoning_effort=str(effort) if effort else None)
        except Exception:
            return muse_chat(config.model, reasoning_effort=os.environ.get("LLM_REASONING_EFFORT"))
    return compatible_chat()

