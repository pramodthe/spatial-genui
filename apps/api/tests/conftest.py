"""Point the API at a throwaway database before any app module is imported."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

_ROOT = Path(tempfile.mkdtemp(prefix="genui-api-"))
(_ROOT / "courses").mkdir()
(_ROOT / "runs").mkdir()
os.environ["APP_DB"] = str(_ROOT / "app.db")
os.environ["COURSES_DIR"] = str(_ROOT / "courses")
os.environ["RUNS_DIR"] = str(_ROOT / "runs")
os.environ["REAL_SIZE_CACHE"] = str(_ROOT / "sizes.json")
os.environ["CHECKPOINT_DB"] = str(_ROOT / "langgraph.sqlite")
os.environ["MODERATION"] = "off"
os.environ["COURSE_MODELS"] = "0"
os.environ["COURSE_POLISH"] = "0"

# The app reads these variables when it is imported.
from app import config as config_mod
from app import courses, db, games, guard


@pytest.fixture(autouse=True)
def _fresh_memory():

    config_mod.reload_config()
    db.close_db()
    guard.reset()
    courses.reset()
    games.reset()
    yield
