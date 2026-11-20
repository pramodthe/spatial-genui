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
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from app import library
from app.core import background, config as config_mod, guard
from app.core.clock import mtime_ms
from app.core.config import REPO_ROOT
from app.core.db import close_db, open_db
from app.library.real_size import known_real_size, real_size_of
from app.pipeline import design
from app.pipeline.coder.agent import set_checkpointer as set_coder_checkpointer
from app.pipeline.lesson import run_lesson, set_checkpointer
from app.pipeline.prompts import EXAMPLE_MODULE
from app.services import courses, games, live, media, pi_build, studio
from app.services.voice import transcribe, voice_agent_token

MAX_BODY = 200_000
MAX_AUDIO = 2_000_000
MAX_PICTURES = 2_500_000
KIT_FILE = REPO_ROOT / "gate" / "src" / "kit" / "kit.js"
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
    calls = guard.attempt_calls(result)
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
    previous_code = body.get("previousCode") if isinstance(body.get("previousCode"), str) else None
    game = body.get("kind") == "game"
    # A new game is designed first (design.py design_doc), as one from Your games is; this one-call writer gets the
    # document in its request. A change to an existing module is not designed again.
    designed = await design.design_doc(prompt) if game and previous_code is None and design.design_mode() == "doc" else None
    result = await run_lesson(
        design.doc_brief(prompt, designed, inline=True) if designed else prompt,
        previous_code=previous_code,
        client_error=body.get("clientError") if isinstance(body.get("clientError"), str) else None,
        kind="game" if game else "lesson",
        design=designed,
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


def _picture(name: str) -> Response:
    """A card picture (services/studio.py): the finished game as it opens. 404 until its run has made one."""
    path = studio.picture(name)
    if path is None:
        return JSONResponse({"error": "No picture"}, status_code=404)
    return FileResponse(path, media_type="image/png", headers={"cache-control": "public, max-age=3600"})


@app.get("/api/games/{game_id}/picture")
async def game_picture(game_id: str) -> Response:
    if not _HEX.fullmatch(game_id):
        return JSONResponse({"error": "Not found"}, status_code=404)
    return _picture(f"game-{game_id}")


@app.get("/api/courses/{course_id}/lessons/{index}/picture")
async def lesson_picture(course_id: str, index: str) -> Response:
    if not _HEX.fullmatch(course_id) or not re.fullmatch(r"\d", index):
        return JSONResponse({"error": "Not found"}, status_code=404)
    return _picture(f"course-{course_id}-{index}")


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


@app.post("/api/games/{game_id}/fix")
async def post_game_fix(game_id: str, request: Request) -> JSONResponse:
    """A player says what is wrong with a ready game (one the pi runner built); its own session fixes it."""
    if not _HEX.fullmatch(game_id):
        return JSONResponse({"error": "Not found"}, status_code=404)
    game = games.get_game(game_id)
    if game is None:
        return JSONResponse({"error": "Unknown game"}, status_code=404)
    body = await _json(request)
    text = body["text"].strip() if isinstance(body.get("text"), str) else ""
    if not text or len(text) > 500:
        return JSONResponse({"error": 'Send { "text": "…" } (1–500 characters).'}, status_code=400)
    refusal = await guard.admit(_visitor(request), text)
    if refusal:
        return JSONResponse({"ok": False, "error": refusal["error"], "reason": refusal["reason"]}, status_code=refusal["status"])
    if not games.fix_game(game, text):
        return JSONResponse({"error": "Only a ready game that Muse built as its own page can be fixed."}, status_code=409)
    return JSONResponse(games.summary(game))


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


# A game built by the pi runner is a page of its own. It lives under /api/ so the headset's dev server forwards it
# with the rest of the API, and it is served from the same origin as the Lab.
_LINK = (
    "padding:10px 16px;border-radius:999px;background:rgba(20,20,28,.82);color:#fff;"
    "font:600 16px/1.2 system-ui,sans-serif;text-decoration:none;border:0;cursor:pointer"
)
_PANEL = (
    "display:flex;flex-direction:column;gap:8px;padding:14px;border-radius:16px;background:rgba(20,20,28,.9);color:#fff;"
    "font:500 16px/1.35 system-ui,sans-serif;width:min(420px,calc(100vw - 32px));box-sizing:border-box"
)
_FIELD = "padding:10px 12px;border-radius:10px;border:0;font:500 16px system-ui,sans-serif;color:#14141c;background:#fff"
_GO = "padding:10px 16px;border-radius:999px;border:0;background:#ffd21f;color:#14141c;font:700 16px system-ui,sans-serif;cursor:pointer"
# The box asks the game's own record whether a fix is going on, its live line what Muse is doing now, and shows Muse's
# answer in its own words when it is done (as text, never HTML).
_FIX_SCRIPT = """<script>(() => {
  const id = "__GAME__";
  const $ = (name) => document.getElementById("lab-fix" + name);
  const form = $(""), text = $("-text"), go = $("-go"), play = $("-play"), say = $("-say");
  let fixes = null;
  const busy = (on) => { text.disabled = go.disabled = on; };
  $("-open").addEventListener("click", () => { form.hidden = !form.hidden; if (!form.hidden) text.focus(); });
  play.addEventListener("click", () => location.reload());
  const look = async () => {
    const game = await (await fetch("/api/games/" + id, { cache: "no-store" })).json();
    if (game.status === "writing" && game.fixing) {
      if (fixes === null) fixes = game.fixes || 0;
      form.hidden = false; busy(true); play.hidden = true; text.value = game.fixing;
      const live = await fetch("/api/live/game-" + id, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const now = !live ? "Starting" : live.stage === "checking" ? "Playing the whole game once more to check it" : live.detail || "Looking at the game";
      const min = live ? Math.floor(live.seconds / 60) : 0;
      say.textContent = `Muse is fixing it. Now: ${now} (${min ? min + " min so far" : "just started"}). It takes a few minutes; until then the game stays as it is.`;
      setTimeout(() => look().catch(() => setTimeout(look, 3000)), 3000);
      return;
    }
    busy(false);
    if (fixes !== null) {
      text.value = "";
      say.textContent = game.note || "";
      play.hidden = (game.fixes || 0) <= fixes;
      fixes = null;
    }
  };
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const words = text.value.trim();
    if (!words) return;
    busy(true); say.textContent = "Sending it to Muse...";
    try {
      const res = await fetch("/api/games/" + id + "/fix", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: words }) });
      const game = await res.json();
      if (!res.ok) throw new Error(game.error || res.statusText);
      fixes = game.fixes || 0;
      await look();
    } catch (err) { busy(false); say.textContent = "That didn't work: " + err.message; }
  });
  look().catch(() => {});
})();</script>"""


def _lab_bar(game_id: str | None = None) -> str:
    """On a game page: the way back to the Lab, and for a game this server can fix (`game_id`), a box to tell Muse
    what is wrong. The player is on this page when they leave the game, so the fix is asked for here, about this game;
    the box follows the fix and offers the fixed game when it is ready."""
    back = f'<a href="/" style="{_LINK}">&larr; Back to the Lab</a>'
    if game_id is None:
        return f'<div style="position:fixed;left:16px;top:16px;z-index:2147483647;display:flex;gap:8px">{back}</div>'
    return (
        "<style>#lab-fix[hidden]{display:none!important}</style>"  # its own display:flex would show it while hidden
        '<div style="position:fixed;left:16px;top:16px;z-index:2147483647;display:flex;flex-direction:column;'
        'align-items:flex-start;gap:8px">'
        f'<div style="display:flex;gap:8px;flex-wrap:wrap">{back}'
        f'<button type="button" id="lab-fix-open" style="{_LINK}">Something wrong? Tell Muse</button></div>'
        f'<form id="lab-fix" hidden style="{_PANEL}">'
        '<label for="lab-fix-text" style="font-weight:700">What is wrong in this game?</label>'
        f'<input id="lab-fix-text" maxlength="500" autocomplete="off" placeholder="The stand is upside down" style="{_FIELD}">'
        '<div style="display:flex;gap:8px">'
        f'<button id="lab-fix-go" style="{_GO}">Fix it</button>'
        f'<button type="button" id="lab-fix-play" hidden style="{_GO}">Play the fixed game</button></div>'
        '<p id="lab-fix-say" style="margin:0">Muse opens this game, looks at it from where you stand, fixes what you '
        "say and plays it again: a few minutes. Until then the game stays as it is.</p></form></div>"
        + _FIX_SCRIPT.replace("__GAME__", game_id)
    )


@app.get("/api/play/{game_id}")
async def play_root(game_id: str) -> Response:
    return RedirectResponse(f"/api/play/{game_id}/", status_code=301)  # its pages load their files relative to the slash


_HOST = re.compile(r"^[A-Za-z0-9.\-]+(:\d{1,5})?$|^\[[0-9A-Fa-f:.]+\](:\d{1,5})?$")
GAME_CDNS = "https://unpkg.com https://cdn.jsdelivr.net"  # where IWSDK's own code fetches fonts and decoders


def _page_policy(request: Request, folder: str, lab: tuple[str, ...] = ()) -> str:
    """A game page is written by an agent and served beside the Lab: it may load and fetch its own files (`folder`)
    and the CDNs IWSDK uses, and of the Lab's API only the paths in `lab` (a fixable game's record, fix and live line,
    for the box on the page). Its own folder is named with the host the browser asked for and no scheme, which
    matches both the headset's dev server (HTTPS, forwarding to this one) and a direct request."""
    host = request.headers.get("host", "")
    own = f"{host}/{folder}" if _HOST.fullmatch(host) else "'none'"
    sources = f"{own} {GAME_CDNS}"
    record = "".join(f"{host}/{path} " for path in lab) if _HOST.fullmatch(host) else ""
    return "; ".join([
        f"default-src {sources} blob: data:",
        f"script-src {sources} blob: 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
        f"worker-src {own} blob: data:",  # IWSDK starts its locomotion worker from a data: address
        f"connect-src {sources} {record}blob: data:",
        f"img-src {sources} https://api.dicebear.com blob: data:",
        f"style-src {sources} 'unsafe-inline'",
        f"font-src {sources} data:",
        f"media-src {own} blob: data:",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'self'",
    ])


def _page_file(root: Path, path: str, policy: str, bar: str) -> Response:
    """A file of a page that lives in `root`: its index.html with the Lab's bar and the page's policy, any other file
    as it is. Nothing outside `root` is served."""
    root = root.resolve()
    file = (root / unquote(path)).resolve() if path else root
    if not file.is_relative_to(root):
        return JSONResponse({"error": "Forbidden"}, status_code=403)
    if file.is_dir():
        file = file / "index.html"
    if not file.is_file():
        return JSONResponse({"error": "Not found"}, status_code=404)
    if file.name == "index.html":
        page = file.read_text(encoding="utf-8")
        page = page.replace("</body>", f"{bar}</body>", 1) if "</body>" in page else page + bar
        return HTMLResponse(page, headers={"cache-control": "no-cache", "content-security-policy": policy})
    return FileResponse(file, media_type=CONTENT_TYPES.get(file.suffix.lower(), "application/octet-stream"),
                        headers={"cache-control": "no-cache"})


@app.get("/api/play/{game_id}/{path:path}")
async def play(game_id: str, path: str, request: Request) -> Response:
    if not _HEX.fullmatch(game_id):
        return JSONResponse({"error": "Not found"}, status_code=404)
    game = games.get_game(game_id)
    if game is None or not game.get("url"):
        return JSONResponse({"error": "Unknown game"}, status_code=404)
    # The fix box only where this server can run the fix (GAME_MODE=pi on the machine with the runner).
    fixable = pi_build.enabled()
    lab = (f"api/games/{game_id}", f"api/games/{game_id}/fix", f"api/live/game-{game_id}") if fixable else ()
    policy = _page_policy(request, f"api/play/{game_id}/", lab)
    return _page_file(pi_build.dist_dir(game_id), path, policy, _lab_bar(game_id if fixable else None))  # hex: safe in the page


_SHOWCASE = re.compile(r"[a-z0-9][a-z0-9-]{0,39}")


@app.get("/api/showcase/{name}")
async def showcase_root(name: str) -> Response:
    if not _SHOWCASE.fullmatch(name):
        return JSONResponse({"error": "Not found"}, status_code=404)
    return RedirectResponse(f"/api/showcase/{name}/", status_code=301)  # its files load relative to the slash


@app.get("/api/showcase/{name}/{path:path}")
async def showcase(name: str, path: str, request: Request) -> Response:
    """A ready-made page for one of the Lab's showcase tiles (SHOWCASE_DIR/<name>/, a built game): served as a game
    page is, with its policy and the way back, and nothing to fix."""
    root = config_mod.config.showcase_dir / name
    if not _SHOWCASE.fullmatch(name) or not (root / "index.html").is_file():
        return JSONResponse({"error": "Not found"}, status_code=404)
    return _page_file(root, path, _page_policy(request, f"api/showcase/{name}/"), _lab_bar())


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
