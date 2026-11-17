"""The asset library and its tools, offline: the provider is never called here."""

from __future__ import annotations

import asyncio
import json

from app.pipeline.coder import scope
from app.pipeline.coder.sound_tools import make_sound
from app.services import media, studio


def test_tools_say_when_media_is_not_set_up() -> None:
    assert not media.enabled()
    reply = asyncio.run(make_sound.ainvoke({"prompt": "a chirp", "seconds": 1}))
    assert "not set up" in reply


def test_library_serves_ready_assets_and_holds_music_being_made() -> None:
    media.MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
    ready = media._save({"id": "snd-0123456789", "kind": "sound", "file": "snd-0123456789.mp3", "prompt": "a chirp", "runId": "lib-run", "status": "ready", "created": 2}, b"ID3")
    media._save({"id": "mus-0123456789", "kind": "music", "file": None, "prompt": "a loop", "runId": "lib-run", "status": "making", "created": 3})
    path, kind = media.file_of(ready["id"])
    assert path.read_bytes() == b"ID3" and kind == "audio/mpeg"
    assert media.file_of("mus-0123456789") is None
    assert media.read("../etc/passwd") is None and media.file_of("snd-../../x") is None
    assert [m["id"] for m in media.library(run_id="lib-run")] == ["mus-0123456789", "snd-0123456789"]


def test_tools_keep_to_the_per_game_limit(monkeypatch) -> None:
    monkeypatch.setenv("MEDIA_BASE_URL", "http://media.invalid")
    monkeypatch.setenv("MEDIA_API_KEY", "test")

    async def fake_sound(prompt: str, *, seconds: float = 1, run_id: str | None = None) -> dict:
        return media._save({"id": "snd-aaaaaaaaaa", "kind": "sound", "file": "snd-aaaaaaaaaa.mp3", "prompt": prompt, "runId": run_id, "status": "ready", "created": 1}, b"ID3")

    monkeypatch.setattr(media, "make_sound", fake_sound)

    async def run() -> list[str]:
        scope.made.set({"sound": 5})
        scope.run_id.set("limit-run")
        record = studio.StudioRun("limit-run", "a bat game", "game", "m")
        scope.studio.set(record)
        first = await make_sound.ainvoke({"prompt": "a chirp", "seconds": 1})
        second = await make_sound.ainvoke({"prompt": "another chirp", "seconds": 1})
        return [first, second]

    first, second = asyncio.run(run())
    assert json.loads(first)["id"] == "snd-aaaaaaaaaa"
    assert "already has 6" in second
    events = studio.read_run("limit-run")["events"]
    assert any(e.get("media") == "snd-aaaaaaaaaa" for e in events)


def test_long_audio_prompts_are_cut_at_a_word() -> None:
    prompt = "a bat chirp " * 60
    short = media.short_prompt(prompt)
    assert len(short) <= media.AUDIO_PROMPT_MAX + 1 and short.endswith(("bat.", "chirp.", "a."))
    assert media.short_prompt("a splash") == "a splash"


def test_library_sounds_are_found_after_a_games_own() -> None:
    record = media._save({"id": "snd-bbbbbbbbbb", "kind": "sound", "file": "snd-bbbbbbbbbb.mp3", "prompt": "wind", "name": "wind-hill",
                          "library": True, "status": "ready", "created": 1}, b"ID3", media.SOUND_LIBRARY)
    path, kind = media.file_of(record["id"])
    assert path.parent == media.SOUND_LIBRARY and kind == "audio/mpeg"
    assert media.read(record["id"])["name"] == "wind-hill"


def test_the_committed_sound_library_matches_its_table() -> None:
    import re

    from app.core.config import REPO_ROOT, SKILLS_DIR

    library = REPO_ROOT / "data" / "library" / "sounds"
    catalog = json.loads((library / "catalog.json").read_text())
    table = (SKILLS_DIR / "common" / "sound" / "references" / "library.md").read_text()
    assert len(catalog) >= 30
    for entry in catalog:
        assert re.fullmatch(r"snd-[0-9a-f]{10}", entry["id"]) and f"`{entry['id']}`" in table
        record = json.loads((library / f"{entry['id']}.json").read_text())
        assert (library / record["file"]).is_file(), entry["name"]
