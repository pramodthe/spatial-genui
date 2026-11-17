"""Speech to text (Muse) and Deepgram voice-tutor tokens."""

from __future__ import annotations

import json
import os
import time
from typing import Any

import httpx

META_BASE = (os.environ.get("META_API_BASE") or "https://api.meta.ai/v1").rstrip("/")
VOICE_MODEL = os.environ.get("VOICE_MODEL") or "muse-voice-transcribe-1.0"


async def voice_agent_token() -> dict[str, Any]:
    key = os.environ.get("DEEPGRAM_API_KEY")
    if not key:
        print("Voice tutor: DEEPGRAM_API_KEY is not set.")
        return {"ok": False, "configured": False, "error": "The voice tutor is not available on this server."}
    busy = {"ok": False, "configured": True, "error": "The voice tutor is not available right now. Try again in a moment."}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                "https://api.deepgram.com/v1/auth/grant",
                headers={"authorization": f"Token {key}", "content-type": "application/json"},
                json={"ttl_seconds": 60},
            )
        try:
            body = response.json()
        except Exception:
            body = {}
        if not response.is_success or not body.get("access_token"):
            print(f"Voice tutor: Deepgram refused a token (HTTP {response.status_code}): {body.get('err_msg') or 'no message'}")
            return busy
        return {"ok": True, "token": body["access_token"]}
    except Exception as exc:
        print(f"Voice tutor: Deepgram could not be reached: {exc}")
        return busy


async def transcribe(wav: bytes) -> dict[str, Any]:
    key = os.environ.get("META_API_KEY")
    if not key:
        print("Voice input: META_API_KEY is not set.")
        return {"ok": False, "error": "Voice input is not available on this server."}
    if len(wav) < 1000 or wav[:4] != b"RIFF":
        return {"ok": False, "error": "Send a WAV recording."}
    if len(wav) < 28:
        return {"ok": False, "error": "Send a WAV recording."}
    sample_rate = int.from_bytes(wav[24:28], "little")
    if sample_rate not in (16000, 24000):
        return {"ok": False, "error": "The recording must be 16 or 24 kHz."}
    started = time.perf_counter()
    try:
        files = {
            "request": ("request", json_request(sample_rate), "application/json"),
            "audio": ("voice.wav", wav, "audio/wav"),
        }
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(f"{META_BASE}/asr/transcribe", headers={"authorization": f"Bearer {key}"}, files=files)
        try:
            body = response.json()
        except Exception:
            body = {}
        transcript = body.get("transcript")
        if not response.is_success or not isinstance(transcript, str):
            message = (body.get("error") or {}).get("message") if isinstance(body.get("error"), dict) else None
            return {"ok": False, "error": message or f"Transcription failed (HTTP {response.status_code})."}
        result: dict[str, Any] = {
            "ok": True,
            "text": transcript.strip(),
            "ms": round((time.perf_counter() - started) * 1000),
        }
        if body.get("audioDurationMs") is not None:
            result["audioMs"] = body["audioDurationMs"]
        return result
    except Exception as exc:
        return {"ok": False, "error": f"Transcription failed: {exc}"}


def json_request(sample_rate: int) -> bytes:
    return json.dumps({"model": VOICE_MODEL, "audioEncoding": "WAV", "sampleRate": sample_rate}, separators=(",", ":")).encode()
