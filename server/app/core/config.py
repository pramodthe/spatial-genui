"""Settings, read from the environment and the .env at the repo root.

Python does not read Anthropic settings. The running model is Meta's Muse Ember (muse-ember-1.0 on Meta's Model API,
with META_API_KEY) unless LLM_BASE_URL and LLM_MODEL name another non-Anthropic endpoint.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[3]
# The agent skills (the sandbox mounts them at /skills) and the models the API can call, with their prices.
SKILLS_DIR = REPO_ROOT / "agent_skills"
MODELS_FILE = REPO_ROOT / "server" / "models.json"
load_dotenv(REPO_ROOT / ".env", override=False)


def _path(env: str, default: Path) -> Path:
    raw = os.environ.get(env)
    if not raw:
        return default
    path = Path(raw).expanduser()
    # Node's path.resolve is relative to the process working directory.
    return path.resolve() if path.is_absolute() else (Path.cwd() / path).resolve()


@dataclass(frozen=True)
class Config:
    base_url: str
    api_key: str
    model: str
    port: int
    max_repairs: int
    max_completion_tokens: int
    runs_dir: Path
    app_db: Path
    library_dir: Path
    courses_dir: Path
    real_size_cache: Path
    checkpoint_db: Path
    static_dir: Path | None
    rate_limit_per_10_min: int
    daily_budget_usd: float
    course_build_all: bool
    course_polish: bool

    @property
    def provider_host(self) -> str:
        return urlparse(self.base_url).netloc


def load_config() -> Config:
    base = os.environ.get("LLM_BASE_URL") or "https://api.meta.ai/v1"
    return Config(
        base_url=base,
        api_key=os.environ.get("LLM_API_KEY") or (os.environ.get("META_API_KEY") or "" if "api.meta.ai" in base else ""),
        model=os.environ.get("LLM_MODEL") or "muse-ember-1.0",
        port=int(os.environ.get("GENUI_PORT") or 8787),
        max_repairs=2,
        max_completion_tokens=64000,
        runs_dir=_path("RUNS_DIR", REPO_ROOT / "server" / "runs"),
        app_db=_path("APP_DB", REPO_ROOT / "server" / "data" / "app.db"),
        library_dir=_path("LIBRARY_DIR", REPO_ROOT / "server" / "library"),
        courses_dir=_path("COURSES_DIR", REPO_ROOT / "server" / "data" / "courses"),
        real_size_cache=_path("REAL_SIZE_CACHE", REPO_ROOT / "server" / "data" / "real-sizes.json"),
        checkpoint_db=_path("CHECKPOINT_DB", REPO_ROOT / "server" / "data" / "langgraph.sqlite"),
        static_dir=_path("STATIC_DIR", Path()) if os.environ.get("STATIC_DIR") else None,
        rate_limit_per_10_min=int(os.environ.get("RATE_LIMIT_PER_10_MIN") or 6),
        daily_budget_usd=float(os.environ.get("DAILY_BUDGET_USD") or 15),
        course_build_all=os.environ.get("COURSE_BUILD_ALL") == "1",
        course_polish=os.environ.get("COURSE_POLISH") != "0",
    )


config = load_config()


def reload_config() -> Config:
    """Tests change environment variables and then rebuild `config`."""
    global config
    config = load_config()
    return config
