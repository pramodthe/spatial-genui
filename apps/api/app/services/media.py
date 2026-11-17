"""Generated media: the design step's reference pictures for the coder (never shown in a game) and a game's sounds
(effects, music), kept in an asset library. One file per asset under data/media (<id>.<ext>), with <id>.json beside
it: the kind, the prompt, the model, the price and the run that made it. A game plays a sound by id
(SOUNDS = { clip: id }); the headset fetches it from /api/media/<id>.

The provider is any API with OpenAI-style image generation (POST /images/generations, b64_json) and a queued audio
endpoint (POST /audio/queue, then /audio/retrieve until the audio is back, then /audio/complete), set by
MEDIA_BASE_URL and MEDIA_API_KEY. Without them the tools say so and games keep the kit's shapes and synth sounds.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import time
import uuid
from pathlib import Path
from typing import Any

import httpx

from app.core.background import track
from app.core.config import REPO_ROOT

MEDIA_ROOT = Path(os.environ.get("MEDIA_DIR") or REPO_ROOT / "data" / "media")
# The sound library: sounds made once (scripts/build_sound_library.py), committed with the 3D models, that every game
# can use by id (skills/common/sound/references/library.md). Looked up after the games' own media.
SOUND_LIBRARY = Path(os.environ.get("SOUND_LIBRARY_DIR") or REPO_ROOT / "data" / "library" / "sounds")
MEDIA_ID = re.compile(r"^(img|snd|mus)-[0-9a-f]{10}$")
KINDS = {"img": "image", "snd": "sound", "mus": "music"}
# Defaults; MEDIA_IMAGE_MODEL, MEDIA_SOUND_MODEL and MEDIA_MUSIC_MODEL choose others from the provider's list.
IMAGE_MODEL = "flux-2-pro"
SOUND_MODEL = "elevenlabs-sound-effects-v2"
MUSIC_MODEL = "ace-step-15"
AUDIO_TYPES = {"audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/flac": "flac", "audio/ogg": "ogg"}
IMAGE_TYPES = {"png": "image/png", "webp": "image/webp", "jpg": "image/jpeg", "jpeg": "image/jpeg"}
# Audio models refuse longer prompts (450 characters for the sound-effect model); a longer one is cut at a word.
AUDIO_PROMPT_MAX = 440
POLL_S = 2.0
SOUND_WAIT_S = 120
MUSIC_WAIT_S = 600

_prices: dict[str, dict[str, Any]] = {}


def enabled() -> bool:
    return bool(os.environ.get("MEDIA_BASE_URL") and os.environ.get("MEDIA_API_KEY"))


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=os.environ["MEDIA_BASE_URL"].rstrip("/"),
        headers={"Authorization": f"Bearer {os.environ['MEDIA_API_KEY']}"},
        timeout=httpx.Timeout(180, connect=20),
    )


def _model(kind: str) -> str:
    default = {"image": IMAGE_MODEL, "sound": SOUND_MODEL, "music": MUSIC_MODEL}[kind]
    return os.environ.get(f"MEDIA_{kind.upper()}_MODEL") or default


async def _price(client: httpx.AsyncClient, kind: str, model: str, seconds: float) -> float | None:
    """The provider's listed price for one asset, when its model list carries one."""
    if model not in _prices:
        try:
            listing = (await client.get("/models", params={"type": "image" if kind == "image" else "music"})).json()
            for entry in listing.get("data") or []:
                _prices[entry.get("id")] = ((entry.get("model_spec") or {}).get("pricing")) or {}
        except (httpx.HTTPError, ValueError):
            return None
    pricing = _prices.get(model) or {}
    if "generation" in pricing:
        return pricing["generation"].get("usd")
    if "per_second" in pricing:
        return round(pricing["per_second"].get("usd", 0) * seconds, 4)
    if "resolutions" in pricing:
        return (pricing["resolutions"].get("1K") or next(iter(pricing["resolutions"].values()), {})).get("usd")
    if "durations" in pricing:
        for bucket in pricing["durations"].values():
            if bucket.get("min_seconds", 0) <= seconds <= bucket.get("max_seconds", 1e9):
                return bucket.get("usd")
    return None


def _image_ext(data: bytes) -> str:
    """The picture's real format: a provider may answer with another than the one asked for."""
    if data[:4] == b"\x89PNG":
        return "png"
    if data[:2] == b"\xff\xd8":
        return "jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return "png"


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


def _save(record: dict[str, Any], data: bytes | None = None, root: Path | None = None) -> dict[str, Any]:
    root = root or MEDIA_ROOT
    root.mkdir(parents=True, exist_ok=True)
    if data is not None:
        (root / record["file"]).write_bytes(data)
        record["bytes"] = len(data)
    (root / f"{record['id']}.json").write_text(json.dumps(record, indent=1))
    return record


async def make_image(prompt: str, *, run_id: str | None = None, size: str = "1024x1024") -> dict[str, Any]:
    """One picture from a prompt, saved to the library."""
    model = _model("image")
    started = time.monotonic()
    async with _client() as client:
        reply = await client.post("/images/generations", json={"model": model, "prompt": prompt, "size": size, "n": 1, "response_format": "b64_json", "output_format": "png"})
        _check(reply)
        item = (reply.json().get("data") or [{}])[0]
        if item.get("b64_json"):
            data = base64.b64decode(item["b64_json"])
        elif item.get("url"):
            data = (await client.get(item["url"])).content
        else:
            raise RuntimeError("the image reply had no picture")
        price = await _price(client, "image", model, 0)
    media_id = _new_id("img")
    record = {"id": media_id, "kind": "image", "file": f"{media_id}.{_image_ext(data)}", "prompt": prompt, "model": model, "costUsd": price,
              "seconds": round(time.monotonic() - started, 1), "runId": run_id, "status": "ready", "created": time.time()}
    return _save(record, data)


def short_prompt(prompt: str, limit: int = AUDIO_PROMPT_MAX) -> str:
    prompt = " ".join(prompt.split())
    return prompt if len(prompt) <= limit else prompt[:limit].rsplit(" ", 1)[0].rstrip(",;:") + "."


class MediaError(RuntimeError):
    """The provider refused or failed a request; the message is its own words, for the agent to act on."""


def _check(reply: httpx.Response) -> None:
    if reply.is_success:
        return
    try:
        body = reply.json()
        detail = "; ".join(i.get("message", "") for i in body.get("issues") or []) or body.get("error") or reply.text
    except ValueError:
        detail = reply.text
    raise MediaError(f"{reply.status_code}: {str(detail)[:300]}")


async def _queued_audio(client: httpx.AsyncClient, model: str, prompt: str, seconds: float, wait_s: float, *, loop: bool = False) -> tuple[bytes, str]:
    body = {"model": model, "prompt": short_prompt(prompt), "duration_seconds": seconds, **({"loop": True} if loop else {})}
    queued = await client.post("/audio/queue", json=body)
    _check(queued)
    queue_id = queued.json()["queue_id"]
    deadline = time.monotonic() + wait_s
    try:
        while time.monotonic() < deadline:
            reply = await client.post("/audio/retrieve", json={"model": model, "queue_id": queue_id})
            _check(reply)
            kind = (reply.headers.get("content-type") or "").split(";")[0].strip()
            if kind.startswith("audio/"):
                return reply.content, AUDIO_TYPES.get(kind, "mp3")
            status = str(reply.json().get("status") or "").upper()
            if status not in ("QUEUED", "PROCESSING", "PENDING", "RUNNING"):
                raise RuntimeError(f"the sound was not made ({status.lower() or 'no status'})")
            await asyncio.sleep(POLL_S)
        raise TimeoutError(f"the sound took longer than {int(wait_s)} s")
    finally:
        try:
            await client.post("/audio/complete", json={"model": model, "queue_id": queue_id})
        except httpx.HTTPError:
            pass


async def make_sound(prompt: str, *, seconds: float = 1.0, run_id: str | None = None, loop: bool = False,
                     root: Path | None = None, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    """One sound effect from a prompt (1 to 10 whole seconds: the queue takes no fractions), saved to the games' media
    (or `root`, for the sound library). loop: made so its end joins its start (an ambience)."""
    seconds = int(max(1, min(10, round(float(seconds)))))
    model = _model("sound")
    started = time.monotonic()
    async with _client() as client:
        data, ext = await _queued_audio(client, model, prompt, seconds, SOUND_WAIT_S, loop=loop)
        price = await _price(client, "sound", model, seconds)
    media_id = _new_id("snd")
    record = {"id": media_id, "kind": "sound", "file": f"{media_id}.{ext}", "prompt": prompt, "model": model, "costUsd": price,
              "length": seconds, "loop": loop, "seconds": round(time.monotonic() - started, 1), "runId": run_id, "status": "ready",
              "created": time.time(), **(extra or {})}
    return _save(record, data, root)


def start_music(prompt: str, *, seconds: int = 60, run_id: str | None = None) -> dict[str, Any]:
    """A music loop made in the background (a few minutes): the id is known now, the file arrives when it is done."""
    seconds = int(max(10, min(120, seconds)))
    media_id = _new_id("mus")
    record = _save({"id": media_id, "kind": "music", "file": None, "prompt": prompt, "model": _model("music"), "costUsd": None,
                    "length": seconds, "runId": run_id, "status": "making", "created": time.time()})
    track(asyncio.get_running_loop().create_task(_finish_music(dict(record))))
    return record


async def _finish_music(record: dict[str, Any]) -> None:
    started = time.monotonic()
    try:
        async with _client() as client:
            data, ext = await _queued_audio(client, record["model"], record["prompt"], record["length"], MUSIC_WAIT_S)
            record["costUsd"] = await _price(client, "music", record["model"], record["length"])
        record.update(file=f"{record['id']}.{ext}", status="ready", seconds=round(time.monotonic() - started, 1))
        _save(record, data)
    except Exception as exc:
        record.update(status="failed", error=str(exc)[:300])
        _save(record)


def _root_of(media_id: str) -> Path | None:
    for root in (MEDIA_ROOT, SOUND_LIBRARY):
        if (root / f"{media_id}.json").exists():
            return root
    return None


def read(media_id: str) -> dict[str, Any] | None:
    if not MEDIA_ID.match(media_id):
        return None
    root = _root_of(media_id)
    try:
        return json.loads((root / f"{media_id}.json").read_text()) if root else None
    except ValueError:
        return None


def file_of(media_id: str) -> tuple[Path, str] | None:
    """The asset's file and its content type, once it is made (a game's own media, else the sound library)."""
    record = read(media_id)
    if not record or not record.get("file"):
        return None
    path = (_root_of(media_id) or MEDIA_ROOT) / record["file"]
    if not path.is_file():
        return None
    ext = path.suffix.lstrip(".")
    kind = IMAGE_TYPES.get(ext) or next((t for t, e in AUDIO_TYPES.items() if e == ext), "application/octet-stream")
    return path, kind


def library(limit: int = 200, run_id: str | None = None) -> list[dict[str, Any]]:
    if not MEDIA_ROOT.exists():
        return []
    records = []
    for path in MEDIA_ROOT.glob("*.json"):
        try:
            record = json.loads(path.read_text())
        except ValueError:
            continue
        if run_id is None or record.get("runId") == run_id:
            records.append(record)
    return sorted(records, key=lambda r: r.get("created", 0), reverse=True)[:limit]
