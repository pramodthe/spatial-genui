"""Meta Model API (Responses endpoint), stdlib only. The key comes from the environment or the repo's .env; it is never logged.
Adapted from pramodthe/setout (app/meta_client.py, Apache-2.0)."""
from __future__ import annotations

import base64
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def _env() -> dict:
    env = {}
    for folder in (ROOT, *ROOT.parents[:3]):  # a worktree's .env lives in the main checkout
        f = folder / ".env"
        if f.exists():
            for line in f.read_text().splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env.setdefault(k.strip(), v.strip())
    env.update({k: v for k, v in os.environ.items() if k.startswith(("META_", "BUILD_"))})
    return env


def model() -> str:
    return _env().get("BUILD_MODEL") or "muse-spark-1.3-contributor"


def respond(payload: dict, timeout: int = 300, tries: int = 4) -> dict:
    """One Responses turn. Timeouts, 429 and 5xx are tried again with a growing pause."""
    e = _env()
    key = e.get("META_API_KEY")
    if not key:
        raise RuntimeError("META_API_KEY is not set")
    base = (e.get("META_API_BASE") or "https://api.meta.ai/v1").rstrip("/")
    body = json.dumps({"model": model(), **payload, "stream": False}, allow_nan=False).encode()
    for attempt in range(tries):
        request = urllib.request.Request(f"{base}/responses", data=body, headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                result = json.load(response)
            if isinstance(result.get("output"), list):
                return result
            raise RuntimeError("provider response has no output array")
        except urllib.error.HTTPError as error:
            if error.code not in (408, 429) and error.code < 500:
                raise RuntimeError(f"provider rejected the request ({error.code}): {error.read().decode(errors='replace')[:300]}") from error
            last = error
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            last = error
        if attempt == tries - 1:
            raise RuntimeError(f"the model API kept failing: {last}")
        time.sleep(10 * (attempt + 1))


def ask(prompt: str, images: list, schema: dict, name: str) -> tuple[dict, int]:
    """A structured answer from text and images. Returns (object, billed tokens)."""
    content = [{"type": "input_text", "text": prompt}] + [{"type": "input_image", "image_url": "data:image/jpeg;base64," + base64.b64encode(i).decode()} for i in images]
    result = respond({"reasoning": {"effort": "medium"}, "max_output_tokens": 24576, "input": [{"type": "message", "role": "user", "content": content}],
                      "text": {"format": {"type": "json_schema", "name": name, "schema": schema, "strict": True}}})
    texts = ["".join(p.get("text", "") for p in item.get("content", [])) for item in result["output"] if item.get("type") == "message"]
    usage = result.get("usage") or {}
    for text in ["".join(texts), *reversed(texts)]:
        try:
            return json.loads(text), usage.get("total_tokens", 0)
        except json.JSONDecodeError:
            continue
    raise RuntimeError(f"{name}: the model returned no JSON")
