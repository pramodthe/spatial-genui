"""Tools that generate a game's own sounds and music into the asset library (app/media.py). Each copies what it
made into the sandbox (/work/media) so the agent can look at it and the play-test can show and play it, and records
it in the run's Studio."""

from __future__ import annotations

import json
from typing import Any

from langchain_core.tools import tool
from langgraph.config import get_config

from app import media
from app.agents import scope

# Per game: the subject's own sounds and one music loop.
LIMITS = {"sound": 6, "music": 1}


def _no_room(kind: str) -> str | None:
    if not media.enabled():
        return "Generated media is not set up on this host: use the synth sounds and the sound library."
    made = scope.made.get()
    if made is not None and made.get(kind, 0) >= LIMITS[kind]:
        return f"This game already has {LIMITS[kind]} generated {kind}s, the most it may have: use those."
    return None


def _count(kind: str) -> None:
    made = scope.made.get()
    if made is not None:
        made[kind] = made.get(kind, 0) + 1


def _why(exc: Exception) -> str:
    return str(exc)[:300] if isinstance(exc, media.MediaError) else f"{type(exc).__name__}: {str(exc)[:200]}"


def _caller() -> str:
    try:
        return str((get_config().get("metadata") or {}).get("lc_agent_name") or "director")
    except Exception:
        return "director"


async def _keep(record: dict[str, Any]) -> str:
    """Copy the asset into the sandbox and the Studio; the path the agent can read it at."""
    _count(record["kind"])
    studio = scope.studio.get()
    if studio is not None:
        studio.event(_caller(), record["kind"], record["prompt"][:400], media=record["id"], cost=record.get("costUsd"))
    backend = scope.backend.get()
    if backend is None or not record.get("file"):
        return ""
    path = f"/work/media/{record['file']}"
    try:
        await backend.aexecute("mkdir -p /work/media", timeout=30)
        sent = await backend.aupload_files([(path, (media.MEDIA_ROOT / record["file"]).read_bytes())])
    except Exception:
        return ""
    return "" if not sent or getattr(sent[0], "error", None) else path


@tool
async def make_sound(prompt: str, seconds: int = 1) -> str:
    """Generate one sound effect for this game and add it to the asset library: a sound the subject really makes
    (a bat's chirp, a splash, a kite's flutter), 1 to 10 whole seconds (the sound may end sooner). Describe one
    clean sound with no music or background noise, in under 400 characters. About 5 seconds; at most 6 per game. Returns its id: play it from SOUNDS with
    { clip: id, volume } (references/parts.md), or sound.clip(id) in code."""
    refusal = _no_room("sound")
    if refusal:
        return refusal
    try:
        record = await media.make_sound(prompt, seconds=seconds, run_id=scope.run_id.get())
    except Exception as exc:
        return f"The sound was not made ({_why(exc)}). Fix the request and try again, or use the synth sounds."
    await _keep(record)
    return json.dumps({"id": record["id"], "use": f"{{ clip: '{record['id']}', volume: 0.6 }}"})


@tool
async def make_music(prompt: str) -> str:
    """Start this game's background music, a calm instrumental loop (style, instruments, mood, tempo; no vocals;
    under 400 characters).
    It takes a few minutes and is made in the background: the id is yours now and the music plays once it is done
    (silent until then, also in the play-test). One per game. Use it as SOUNDS.music = { clip: id, loop: true,
    volume: 0.25 }, fired on Start and stopped (sfx.stop('music')) when the round ends."""
    refusal = _no_room("music")
    if refusal:
        return refusal
    record = media.start_music(prompt, run_id=scope.run_id.get())
    await _keep(record)
    return json.dumps({"id": record["id"], "use": f"SOUNDS.music = {{ clip: '{record['id']}', loop: true, volume: 0.25 }}"})


# What the coder gets. Games show their name as a text title card, not a generated picture.
SOUND_TOOLS = [make_sound, make_music]
