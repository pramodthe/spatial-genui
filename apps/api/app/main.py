"""The FastAPI app: the /api routes the headset app calls, the Studio page, and the built headset app."""

from __future__ import annotations

import json
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from urllib.parse import unquote

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from app import library
from app.core import background, config as config_mod, guard
from app.core.clock import mtime_ms
from app.core.config import REPO_ROOT
from app.core.db import close_db, open_db
from app.library.real_size import known_real_size, real_size_of
from app.pipeline.coder.agent import set_checkpointer as set_coder_checkpointer
from app.pipeline.lesson import run_lesson, set_checkpointer
from app.pipeline.prompts import EXAMPLE_MODULE
from app.services import courses, games, live, media, studio
from app.services.voice import transcribe, voice_agent_token

MAX_BODY = 200_000
MAX_AUDIO = 2_000_000
MAX_PICTURES = 2_500_000
KIT_FILE = REPO_ROOT / "apps" / "gate" / "src" / "kit" / "kit.js"
_HEX = re.compile(r"^[a-f0-9]{8}$")
_ASSET = re.compile(r"^[a-z0-9-]+$")

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
    ".json": "application/json", ".wasm": "application/wasm", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml",
    ".ktx2": "image/ktx2", ".hdr": "application/octet-stream", ".bin": "application/octet-stream",
    ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".woff2": "font/woff2",
    ".uikitml": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon",
}

_saver_cm: Any = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _saver_cm
    open_db()
    config_mod.config.checkpoint_db.parent.mkdir(parents=True, exist_ok=True)
    _saver_cm = AsyncSqliteSaver.from_conn_string(str(config_mod.config.checkpoint_db))
    saver = await _saver_cm.__aenter__()
    set_checkpointer(saver)
    set_coder_checkpointer(saver)
    courses.load()
    courses.drain_deferred()
    games.load()
    print(f"GenUI agent server on http://localhost:{config_mod.config.port}")
    print(f"Model: {config_mod.config.model} via {config_mod.config.base_url}{'' if config_mod.config.api_key else '  (LLM_API_KEY is empty!)'}")
    yield
    # Background writing stops before the stores it writes to close (it resumes on the next start).
    await background.shutdown()
    set_checkpointer(None)
    set_coder_checkpointer(None)
    if _saver_cm is not None:
        await _saver_cm.__aexit__(None, None, None)
        _saver_cm = None
    close_db()


app = FastAPI(lifespan=lifespan)


@app.middleware("http")
async def errors(request: Request, call_next):
    try:
        return await call_next(request)
    except Exception as exc:
        print(exc)
        return JSONResponse({"error": str(exc)}, status_code=500)


def _visitor(request: Request) -> str:
    host = request.client.host if request.client else None
    return guard.visitor_of({key: value for key, value in request.headers.items()}, host)


async def _read(request: Request, limit: int, message: str) -> bytes:
    """The request body, read only up to `limit` bytes (as the TS server did): a huge upload is refused early."""
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        raise RuntimeError(message)
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise RuntimeError(message)
        chunks.append(chunk)
    return b"".join(chunks)


async def _json(request: Request, limit: int = MAX_BODY) -> dict[str, Any]:
    body = await _read(request, limit, "Request body too large.")
    if not body:
        return {}
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError as exc:
        raise RuntimeError(exc.msg) from exc
    return parsed if isinstance(parsed, dict) else {}


def _prompt(body: dict[str, Any]) -> str:
    return body["prompt"].strip() if isinstance(body.get("prompt"), str) else ""


async def _spend(result: dict[str, Any]) -> None:
    calls = []
    for attempt in result.get("attempts") or []:
        model = result.get("model")
        if not model:
            continue
        calls.append({
            "model": model,
            "promptTokens": attempt.get("promptTokens") or 0,
            "completionTokens": attempt.get("completionTokens") or 0,
        })
    if calls:
        await guard.record_spend(calls)


@app.get("/api/health")
async def health() -> JSONResponse:
    return JSONResponse({
        "ok": True,
        "model": config_mod.config.model,
        "provider": config_mod.config.provider_host,
        "hasKey": bool(config_mod.config.api_key),
        "spend": guard.spend_today(),
    })


@app.get("/api/kit.js")
async def kit() -> FileResponse:
    return FileResponse(KIT_FILE, media_type="text/javascript; charset=utf-8", headers={"cache-control": "no-cache"})


@app.get("/api/library/catalog")
async def catalog() -> JSONResponse:
    entries = []
    for entry in library.library_catalog().values():
        path = library.asset_path(entry["id"])
        version = mtime_ms(path) if path else 0
        entries.append({
            **entry,
            "creditShort": library.short_credit(entry),
            "url": f"/api/library/assets/{entry['id']}.glb?v={version}",
        })
    return JSONResponse({"assets": entries})


@app.get("/api/library/assets/{filename}")
async def library_asset(filename: str) -> Response:
    if not filename.endswith(".glb"):
        return JSONResponse({"error": "Not found"}, status_code=404)
    asset_id = filename[: -len(".glb")]
    if not _ASSET.fullmatch(asset_id):
        return JSONResponse({"error": "Not found"}, status_code=404)
    path = library.asset_path(asset_id)
    if path is None:
        return JSONResponse({"error": "Unknown asset"}, status_code=404)
    return FileResponse(path, media_type="model/gltf-binary", headers={"cache-control": "public, max-age=3600"})


@app.post("/api/generate")
async def generate(request: Request) -> JSONResponse:
    body = await _json(request)
    prompt = _prompt(body)
    if not prompt or len(prompt) > 2000:
        return JSONResponse({"error": 'Send { "prompt": "…" } (1–2000 characters).'}, status_code=400)
    if prompt == "/example":
        return JSONResponse({
            "ok": True, "prompt": prompt, "model": "built-in example", "code": EXAMPLE_MODULE,
            "attempts": [{"stage": "ok", "ms": 0}], "totalMs": 0,
        })
    refusal = await guard.admit(_visitor(request), prompt)
    if refusal:
        return JSONResponse({"ok": False, "error": refusal["error"], "reason": refusal["reason"]}, status_code=refusal["status"])
    result = await run_lesson(
        prompt,
        previous_code=body.get("previousCode") if isinstance(body.get("previousCode"), str) else None,
        client_error=body.get("clientError") if isinstance(body.get("clientError"), str) else None,
        kind="game" if body.get("kind") == "game" else "lesson",
    )
    await _spend(result)
    if result.get("refused"):
        return JSONResponse({"ok": False, "error": result.get("error"), "reason": "content"}, status_code=422)
    return JSONResponse(result)


@app.post("/api/transcribe")
async def transcribe_audio(request: Request) -> JSONResponse:
    refusal = guard.admit_voice(_visitor(request))
    if refusal:
        return JSONResponse({"ok": False, "error": refusal["error"], "reason": refusal["reason"]}, status_code=refusal["status"])
    audio = await _read(request, MAX_AUDIO, "Recording too long.")
    result = await transcribe(audio)
    return JSONResponse(result, status_code=200 if result.get("ok") else 502)


@app.post("/api/voice-agent/token")
async def voice_token(request: Request) -> JSONResponse:
    refusal = guard.admit_voice(_visitor(request))
    if refusal:
        return JSONResponse({"ok": False, "error": refusal["error"], "reason": refusal["reason"]}, status_code=refusal["status"])
    result = await voice_agent_token()
    status = 200 if result.get("ok") else 503 if result.get("configured") else 501
    return JSONResponse(result, status_code=status)


@app.post("/api/real-size")
async def real_size(request: Request) -> JSONResponse:
    body = await _json(request)
    subject = body["request"].strip() if isinstance(body.get("request"), str) else ""
    if not subject or len(subject) > 500:
        return JSONResponse({"error": 'Send { "request": "…" } (1–500 characters).'}, status_code=400)
    known = known_real_size(subject)
    if known:
        return JSONResponse(known)
    refusal = guard.admit_lookup(_visitor(request))
    if refusal:
        return JSONResponse({"ok": False, "error": refusal["error"], "reason": refusal["reason"]}, status_code=refusal["status"])
    try:
        return JSONResponse(await real_size_of(subject))
    except Exception as exc:
        return JSONResponse({"error": f"Size agent failed: {exc}"}, status_code=502)


@app.post("/api/courses")
async def post_course(request: Request) -> JSONResponse:
    body = await _json(request)
    prompt = _prompt(body)
    if not prompt or len(prompt) > 500:
        return JSONResponse({"error": 'Send { "prompt": "…" } (1–500 characters).'}, status_code=400)
    refusal = await guard.admit(_visitor(request), prompt)
    if refusal:
        return JSONResponse({"ok": False, "error": refusal["error"], "reason": refusal["reason"]}, status_code=refusal["status"])
    return JSONResponse(courses.summary(courses.start_course(prompt)))


@app.get("/api/courses")
async def get_courses() -> JSONResponse:
    return JSONResponse({"courses": courses.list_courses()})


@app.post("/api/courses/{course_id}/lessons/{index}/polish")
async def polish(course_id: str, index: str, request: Request) -> JSONResponse:
    if not _HEX.fullmatch(course_id) or not re.fullmatch(r"\d", index):
        return JSONResponse({"error": "Not found"}, status_code=404)
    course = courses.get_course(course_id)
    if course is None:
        return JSONResponse({"error": "Unknown course"}, status_code=404)
    body = await _json(request, MAX_PICTURES)
    pictures = [item for item in (body.get("pictures") if isinstance(body.get("pictures"), list) else []) if isinstance(item, str) and item.startswith("data:image/jpeg;base64,")][:3]
    if not pictures:
        return JSONResponse({"error": 'Send { "pictures": [JPEG data URLs] }.'}, status_code=400)
    return JSONResponse({"started": courses.polish_lesson(course, int(index), pictures)}, status_code=202)


@app.get("/api/courses/{course_id}")
async def get_course(course_id: str) -> JSONResponse:
    if not _HEX.fullmatch(course_id):
        return JSONResponse({"error": "Not found"}, status_code=404)
    course = courses.get_course(course_id)
    if course is None:
        return JSONResponse({"error": "Unknown course"}, status_code=404)
    return JSONResponse(courses.summary(course))


STUDIO_PAGE = Path(__file__).parent / "services" / "studio.html"


@app.get("/studio")
@app.get("/studio/{run_id}")
async def studio_page(run_id: str = "") -> FileResponse:
    """The Studio: how the design step, the coder and the grader made a game (services/studio.py). The page reads /api/studio."""
    return FileResponse(STUDIO_PAGE, media_type="text/html; charset=utf-8", headers={"cache-control": "no-cache"})


@app.get("/api/studio")
async def studio_runs() -> JSONResponse:
    return JSONResponse({"runs": studio.list_runs()})


@app.get("/api/studio/{run_id}")
async def studio_run(run_id: str) -> JSONResponse:
    run = studio.read_run(run_id)
    if run is None:
        return JSONResponse({"error": "Unknown run"}, status_code=404)
    return JSONResponse(run, headers={"cache-control": "no-cache"})


@app.get("/api/studio/{run_id}/file/{name:path}")
async def studio_file(run_id: str, name: str) -> Response:
    folder = studio.run_dir(run_id)
    path = (folder / "files" / name).resolve() if folder else None
    if path is None or not path.is_relative_to((folder / "files").resolve()) or not path.is_file():
        return JSONResponse({"error": "Unknown file"}, status_code=404)
    return FileResponse(path, media_type=CONTENT_TYPES.get(path.suffix, "text/plain; charset=utf-8"))


@app.get("/api/media")
async def media_library(run: str | None = None) -> JSONResponse:
    """The asset library: every generated picture and sound (services/media.py), newest first; ?run= for one run's."""
    return JSONResponse({"media": media.library(run_id=run)}, headers={"cache-control": "no-cache"})


@app.get("/api/media/{media_id}")
async def media_file(media_id: str) -> Response:
    found = media.file_of(media_id)
    if found is None:
        record = media.read(media_id)
        status = 404 if record is None or record.get("status") == "failed" else 425  # 425: still being made
        return JSONResponse({"error": "Not ready" if status == 425 else "Unknown media"}, status_code=status)
    path, kind = found
    return FileResponse(path, media_type=kind, headers={"cache-control": "public, max-age=31536000, immutable"})


@app.get("/api/live/{key}")
async def get_live(key: str, after: int = 0) -> JSONResponse:
    """A lesson or game being written: its stage, the parts named so far, and the latest gate-checked scene
    (only when newer than `after`)."""
    if not re.fullmatch(r"(course-[0-9a-f]+-\d|game-[0-9a-f]+)", key):
        return JSONResponse({"error": "Not found"}, status_code=404)
    watcher = live.get(key)
    if watcher is None:
        return JSONResponse({"error": "Not being written"}, status_code=404)
    return JSONResponse(watcher.view(after))


@app.get("/api/courses/{course_id}/lessons/{index}")
async def get_lesson(course_id: str, index: str) -> JSONResponse:
    if not _HEX.fullmatch(course_id) or not re.fullmatch(r"\d", index):
        return JSONResponse({"error": "Not found"}, status_code=404)
    course = courses.get_course(course_id)
    if course is None:
        return JSONResponse({"error": "Unknown course"}, status_code=404)
    lesson = courses.open_lesson(course, int(index))
    if lesson is None:
        return JSONResponse({"error": "Unknown lesson"}, status_code=404)
    return JSONResponse(lesson)


@app.post("/api/games")
async def post_game(request: Request) -> JSONResponse:
    body = await _json(request)
    prompt = _prompt(body)
    if not prompt or len(prompt) > 500:
        return JSONResponse({"error": 'Send { "prompt": "…" } (1–500 characters).'}, status_code=400)
    refusal = await guard.admit(_visitor(request), prompt)
    if refusal:
        return JSONResponse({"ok": False, "error": refusal["error"], "reason": refusal["reason"]}, status_code=refusal["status"])
    return JSONResponse(games.summary(games.start_game(prompt)))


@app.get("/api/games")
async def get_games() -> JSONResponse:
    return JSONResponse({"games": games.list_games()})


@app.get("/api/games/{game_id}")
async def get_game(game_id: str) -> JSONResponse:
    if not _HEX.fullmatch(game_id):
        return JSONResponse({"error": "Not found"}, status_code=404)
    game = games.get_game(game_id)
    if game is None:
        return JSONResponse({"error": "Unknown game"}, status_code=404)
    games.retry_game(game)
    return JSONResponse(game)


@app.get("/{full_path:path}")
async def static_or_missing(full_path: str, request: Request) -> Response:
    if request.url.path.startswith("/api/"):
        return JSONResponse({"error": "Not found"}, status_code=404)
    if config_mod.config.static_dir is None:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return _static(request.url.path)


def _static(url: str) -> Response:
    root = config_mod.config.static_dir
    assert root is not None
    root = root.resolve()
    raw = unquote(url.split("?", 1)[0])
    relative = raw.lstrip("/")
    candidate = (root / relative).resolve() if relative else root
    if not candidate.is_relative_to(root):
        return JSONResponse({"error": "Forbidden"}, status_code=403)
    file = candidate
    if not file.exists() or file.is_dir():
        if Path(raw).suffix:
            return JSONResponse({"error": "Not found"}, status_code=404)
        file = root / "index.html"
    if not file.exists():
        return JSONResponse({"error": "Not found"}, status_code=404)
    media = CONTENT_TYPES.get(file.suffix.lower(), "application/octet-stream")
    cache = "public, max-age=31536000, immutable" if raw.startswith("/assets/") else "no-cache"
    return FileResponse(file, media_type=media, headers={"cache-control": cache})


def main() -> None:
    uvicorn.run("app.main:app", host="0.0.0.0", port=config_mod.config.port, reload=False)
