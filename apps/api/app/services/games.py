"""Saved games. One is written at a time, on its own queue, apart from course lessons."""

from __future__ import annotations

import asyncio
import re
import time
import uuid
from typing import Any

from app.core.background import track
from app.core.clock import js_round, now_iso
from app.core.db import load_games, save_game
from app.core.guard import record_spend
from app.pipeline.game import run_game
from app.services import live, studio

MAX_GAMES = 200
_PANEL = re.compile(r"""kit\.panel\(\s*ui\s*,\s*\{[\s\S]{0,600}?\btitle:\s*(['"`])([^'"`\n]{2,40})\1""")
_PLAIN = re.compile(r"^[\x20-\x7e]+$")

_games: dict[str, dict[str, Any]] = {}
_loaded = False
_tail: asyncio.Task[Any] | None = None


def reset() -> None:
    global _loaded, _tail
    _games.clear()
    _loaded = False
    _tail = None


def panel_title(code: str) -> str | None:
    match = _PANEL.search(code)
    if not match:
        return None
    title = match.group(2).strip()
    return title if _PLAIN.fullmatch(title) else None


def summary(game: dict[str, Any]) -> dict[str, Any]:
    out = {key: value for key, value in game.items() if key != "code"}
    watcher = live.get(live.game_key(game["id"])) if game.get("status") == "writing" else None
    if watcher is not None:
        out["live"] = {"key": watcher.key, "line": watcher.line(), "seq": watcher.seq}
    # Its card picture (GET /api/games/<id>/picture) exists: a headset panel cannot recover from a missing image.
    out["picture"] = studio.picture(f"game-{game['id']}") is not None
    return out


def load() -> None:
    global _loaded
    if _loaded:
        return
    _loaded = True
    for game in load_games():
        _games[game["id"]] = game
        if game.get("status") == "writing":
            queue(game)


def list_games() -> list[dict[str, Any]]:
    load()
    return [summary(game) for game in sorted(_games.values(), key=lambda item: item["createdAt"], reverse=True)]


def get_game(game_id: str) -> dict[str, Any] | None:
    load()
    return _games.get(game_id)


def start_game(request: str) -> dict[str, Any]:
    load()
    if len(_games) >= MAX_GAMES:
        raise RuntimeError("The games shelf is full.")
    game = {
        "id": uuid.uuid4().hex[:8],
        "request": request,
        "title": f"{request[:37]}..." if len(request) > 40 else request,
        "status": "writing",
        "createdAt": now_iso(),
    }
    _games[game["id"]] = game
    save_game(game)
    queue(game)
    return game


def retry_game(game: dict[str, Any]) -> bool:
    if game.get("status") != "failed":
        return False
    game["status"] = "writing"
    game.pop("error", None)
    save_game(game)
    queue(game)
    return True


def queue(game: dict[str, Any]) -> None:
    global _tail
    previous = _tail

    async def run() -> None:
        if previous is not None:
            try:
                await previous
            except Exception:
                pass
        try:
            await write(game)
        except Exception as exc:
            print(exc)

    _tail = track(asyncio.get_running_loop().create_task(run()))


async def write(game: dict[str, Any]) -> None:
    started = time.time() * 1000
    try:
        with live.watching(live.game_key(game["id"])) as watcher:
            watcher.set_stage("designing")
            result = await run_game(game["request"], thread_id=game["id"])
        await record_spend([
            {"model": result["model"], "promptTokens": attempt.get("promptTokens") or 0, "completionTokens": attempt.get("completionTokens") or 0}
            for attempt in result.get("attempts") or []
        ])
        if not result.get("ok") or not result.get("code"):
            raise RuntimeError(result.get("error") or "The game could not be written.")
        game.update(status="ready", code=result["code"], model=result["model"], title=panel_title(result["code"]) or game["title"])
        studio.keep_picture(f"game-{game['id']}", result.get("id"))
    except Exception as exc:
        game.update(status="failed", error=str(exc)[:300])
    game["seconds"] = js_round((time.time() * 1000 - started) / 1000)
    save_game(game)
