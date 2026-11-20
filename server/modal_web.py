"""Muse's Lab on Modal: the API and the built headset app behind one public HTTPS address.

    cd headset && npm run build
    cd server && uv run modal deploy modal_web.py

One container serves everything (SQLite and the live previews are in its memory), its data lives on the
`muses-lab-data` volume, and its keys come from the `muses-lab-env` secret (made from the repo's .env).
Games are written by the same coder sandboxes the local server opens. The container stops after 20 idle minutes
and starts again on the next visit (a few seconds).

The Lab's showcase tiles (headset/src/genui/games.ts, SHOWCASE_GAMES) open built games kept on the volume, one
folder each, uploaded once:

    uv run modal volume put muses-lab-data <a game's dist folder> /showcase/<page>
"""

from __future__ import annotations

from pathlib import Path

import modal

ROOT = Path(__file__).resolve().parents[1]
REPO = "/repo"
DATA = "/data"
SKIP = {".env", "node_modules", "runs", ".venv", ".cache", "__pycache__", "evals", ".iwsdk", "data"}


def _ignore(path: Path) -> bool:
    return any(part in SKIP for part in Path(path).parts) or Path(path).name.startswith(".env")


image = (
    modal.Image.from_registry("node:22-bookworm-slim", add_python="3.12")
    .apt_install("ca-certificates")
    .uv_sync(str(ROOT / "server"), frozen=True)
    .add_local_file(str(ROOT / "gate" / "package.json"), f"{REPO}/gate/package.json", copy=True)
    .add_local_file(str(ROOT / "gate" / "package-lock.json"), f"{REPO}/gate/package-lock.json", copy=True)
    .run_commands(f"cd {REPO}/gate && npm ci --no-audit --no-fund")
    .env({
        "STATIC_DIR": f"{REPO}/headset/dist",
        "APP_DB": f"{DATA}/app.db",
        "CHECKPOINT_DB": f"{DATA}/langgraph.sqlite",
        "STUDIO_DIR": f"{DATA}/studio",
        "PICTURES_DIR": f"{DATA}/pictures",
        "MEDIA_DIR": f"{DATA}/media",
        "COURSES_DIR": f"{DATA}/courses",
        "RUNS_DIR": f"{DATA}/runs",
        "REAL_SIZE_CACHE": f"{DATA}/real-sizes.json",
        "SHOWCASE_DIR": f"{DATA}/showcase",
    })
    .add_local_dir(str(ROOT / "gate"), f"{REPO}/gate", ignore=_ignore, copy=True)
    .run_commands(f"mkdir -p {REPO}/gate/.cache")
    .add_local_dir(str(ROOT / "agent_skills"), f"{REPO}/agent_skills", ignore=_ignore, copy=True)
    .add_local_dir(str(ROOT / "headset"), f"{REPO}/headset", ignore=_ignore, copy=True)
    .add_local_dir(str(ROOT / "server"), f"{REPO}/server", ignore=_ignore, copy=True)
)

app = modal.App("muses-lab", image=image)
volume = modal.Volume.from_name("muses-lab-data", create_if_missing=True)


@app.function(
    secrets=[modal.Secret.from_name("muses-lab-env")],
    volumes={DATA: volume},
    max_containers=1,
    min_containers=0,  # nothing runs, or is paid for, while nobody visits
    scaledown_window=20 * 60,
    timeout=24 * 3600,
    cpu=2,
    memory=4096,
)
@modal.concurrent(max_inputs=100)
@modal.asgi_app()
def web():
    import os
    import sys

    os.chdir(f"{REPO}/server")
    sys.path.insert(0, f"{REPO}/server")
    from app.main import app as fastapi_app

    return fastapi_app
