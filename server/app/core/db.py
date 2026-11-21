"""SQLite courses, lessons and games."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from app.core.config import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  request TEXT NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  model TEXT,
  builder TEXT
);
CREATE TABLE IF NOT EXISTS lessons (
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  title TEXT NOT NULL,
  kind TEXT,
  objective TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  code TEXT,
  model TEXT,
  seconds INTEGER,
  generated_at TEXT,
  polish TEXT,
  first_code TEXT,
  critique TEXT,
  builder TEXT,
  url TEXT,
  fixing TEXT,
  fixes INTEGER,
  note TEXT,
  PRIMARY KEY (course_id, idx)
);
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  request TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  code TEXT,
  model TEXT,
  seconds INTEGER,
  created_at TEXT NOT NULL,
  builder TEXT,
  url TEXT,
  fixing TEXT,
  fixes INTEGER,
  note TEXT
);
"""
# Columns added after the first release, with their types: a database made before them gets them when it opens.
PAGE_COLUMNS = {"builder": "TEXT", "url": "TEXT", "fixing": "TEXT", "fixes": "INTEGER", "note": "TEXT"}  # a pi build
LATER_COLUMNS = {"games": PAGE_COLUMNS, "lessons": PAGE_COLUMNS, "courses": {"builder": "TEXT"}}

_conn: sqlite3.Connection | None = None


def omit_null(values: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in values.items() if value is not None}


def _connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.executescript(SCHEMA)
    for table, columns in LATER_COLUMNS.items():
        have = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
        for name, kind in columns.items():
            if name not in have:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {kind}")
    return conn


def open_db() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = _connect(config.app_db)
    return _conn


def close_db() -> None:
    global _conn
    if _conn is not None:
        _conn.close()
        _conn = None


def _lesson_from_row(row: sqlite3.Row) -> dict[str, Any]:
    lesson: dict[str, Any] = {
        "title": row["title"],
        "objective": row["objective"],
        "prompt": row["prompt"],
        "status": row["status"],
    }
    lesson.update(omit_null({
        "error": row["error"],
        "code": row["code"],
        "model": row["model"],
        "seconds": row["seconds"],
        "generatedAt": row["generated_at"],
        "polish": row["polish"],
        "firstCode": row["first_code"],
        "critique": row["critique"],
        "builder": row["builder"],
        "url": row["url"],
        "fixing": row["fixing"],
        "fixes": row["fixes"],
        "note": row["note"],
    }))
    return lesson


def load_courses() -> list[dict[str, Any]]:
    conn = open_db()
    lessons: dict[str, list[dict[str, Any]]] = {}
    for row in conn.execute("SELECT * FROM lessons ORDER BY course_id, idx"):
        lessons.setdefault(row["course_id"], []).append(_lesson_from_row(row))
    courses: list[dict[str, Any]] = []
    for row in conn.execute("SELECT * FROM courses"):
        course: dict[str, Any] = {
            "id": row["id"],
            "request": row["request"],
            "title": row["title"],
            "subtitle": row["subtitle"],
            "status": row["status"],
            "createdAt": row["created_at"],
        }
        model = json.loads(row["model"]) if row["model"] else None
        course.update(omit_null({"error": row["error"], "model": model, "builder": row["builder"]}))
        course["lessons"] = lessons.get(row["id"], [])
        courses.append(course)
    return courses


def save_course(course: dict[str, Any]) -> None:
    conn = open_db()
    conn.execute("BEGIN")
    try:
        conn.execute(
            """INSERT INTO courses (id, request, title, subtitle, status, error, created_at, model, builder) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET request = excluded.request, title = excluded.title, subtitle = excluded.subtitle,
                 status = excluded.status, error = excluded.error, model = excluded.model, builder = excluded.builder""",
            (
                course["id"], course["request"], course["title"], course.get("subtitle") or "", course["status"],
                course.get("error"), course["createdAt"],
                json.dumps(course["model"]) if course.get("model") is not None else None, course.get("builder"),
            ),
        )
        conn.execute("DELETE FROM lessons WHERE course_id = ?", (course["id"],))
        for index, lesson in enumerate(course.get("lessons") or []):
            conn.execute(
                """INSERT INTO lessons (course_id, idx, title, kind, objective, prompt, status, error, code, model, seconds, generated_at, polish, first_code, critique,
                                        builder, url, fixing, fixes, note)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    course["id"], index, lesson["title"], None, lesson.get("objective") or "", lesson.get("prompt") or "",
                    lesson["status"], lesson.get("error"), lesson.get("code"), lesson.get("model"), lesson.get("seconds"),
                    lesson.get("generatedAt"), lesson.get("polish"), lesson.get("firstCode"), lesson.get("critique"),
                    lesson.get("builder"), lesson.get("url"), lesson.get("fixing"), lesson.get("fixes"), lesson.get("note"),
                ),
            )
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise


def count_courses() -> int:
    row = open_db().execute("SELECT COUNT(*) AS n FROM courses").fetchone()
    return int(row["n"])


def load_games() -> list[dict[str, Any]]:
    games = []
    for row in open_db().execute("SELECT * FROM games"):
        game: dict[str, Any] = {
            "id": row["id"],
            "request": row["request"],
            "title": row["title"],
            "status": row["status"],
            "createdAt": row["created_at"],
        }
        game.update(omit_null({
            "error": row["error"],
            "code": row["code"],
            "model": row["model"],
            "seconds": row["seconds"],
            "builder": row["builder"],
            "url": row["url"],
            "fixing": row["fixing"],
            "fixes": row["fixes"],
            "note": row["note"],
        }))
        games.append(game)
    return games


def save_game(game: dict[str, Any]) -> None:
    open_db().execute(
        """INSERT INTO games (id, request, title, status, error, code, model, seconds, created_at, builder, url, fixing, fixes, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET title = excluded.title, status = excluded.status, error = excluded.error,
             code = excluded.code, model = excluded.model, seconds = excluded.seconds, url = excluded.url,
             fixing = excluded.fixing, fixes = excluded.fixes, note = excluded.note""",
        (
            game["id"], game["request"], game["title"], game["status"], game.get("error"), game.get("code"),
            game.get("model"), game.get("seconds"), game["createdAt"], game.get("builder"), game.get("url"),
            game.get("fixing"), game.get("fixes"), game.get("note"),
        ),
    )
