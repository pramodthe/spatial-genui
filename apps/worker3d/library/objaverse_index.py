"""Search index over Objaverse 1.0 for retrieval (tier C of docs/3d-architecture.md, section 4.3).

Usage: python library/objaverse_index.py [--data data/objaverse]

Reads the dataset's metadata (download first: hf download allenai/objaverse --repo-type dataset
--include "metadata/*" --local-dir data/objaverse, and the same for lvis-annotations.json.gz and
object-paths.json.gz) and writes <data>/index.sqlite: one row per usable object plus an FTS5 full-text
index over name, tags, LVIS category, Sketchfab categories and description.

Kept: CC0 and CC BY objects that are not age-restricted (section 4.2: share-alike, non-commercial and
no-derivatives licences are excluded by default). Each row keeps the credit a CC BY object requires.
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
import sqlite3
from pathlib import Path

LICENCES = {"cc0": "CC0 1.0", "by": "CC BY 4.0"}


def words(text: str) -> str:
    return re.sub(r"[-_/]+", " ", text or "").strip()


def thumbnail(meta: dict) -> str | None:
    """The thumbnail closest to 512 px wide (enough for image embeddings, small to fetch)."""
    images = [t for t in (meta.get("thumbnails") or {}).get("images", []) if t.get("width", 0) >= 256]
    return min(images, key=lambda t: abs(t["width"] - 512))["url"] if images else None


def build(data: Path) -> None:
    lvis = {uid: category for category, uids in json.load(gzip.open(data / "lvis-annotations.json.gz")).items() for uid in uids}
    paths = json.load(gzip.open(data / "object-paths.json.gz"))
    db_path = data / "index.sqlite"
    db_path.unlink(missing_ok=True)
    db = sqlite3.connect(db_path)
    db.executescript("""
        CREATE TABLE objects (
            rowid INTEGER PRIMARY KEY, uid TEXT UNIQUE, name TEXT, tags TEXT, lvis TEXT, categories TEXT,
            description TEXT, licence TEXT, author TEXT, author_url TEXT, viewer_url TEXT, glb_path TEXT,
            faces INTEGER, vertices INTEGER, likes INTEGER, views INTEGER, animated INTEGER, staffpicked INTEGER,
            thumbnail TEXT);
        CREATE VIRTUAL TABLE fts USING fts5(name, tags, lvis, categories, description,
            content='objects', content_rowid='rowid', tokenize='porter unicode61');
    """)
    kept = seen = 0
    for shard in sorted((data / "metadata").glob("*.json.gz")):
        rows = []
        for uid, m in json.load(gzip.open(shard)).items():
            seen += 1
            if m.get("license") not in LICENCES or m.get("isAgeRestricted") or uid not in paths:
                continue
            user = m.get("user") or {}
            rows.append((
                uid, m.get("name") or "", " ".join(words(t["name"]) for t in m.get("tags", [])),
                words(lvis.get(uid, "")), " ".join(words(c["name"]) for c in m.get("categories", [])),
                re.sub(r"\s+", " ", m.get("description") or "")[:400], LICENCES[m["license"]],
                user.get("displayName") or user.get("username") or "", user.get("profileUrl") or "",
                m.get("viewerUrl") or "", paths[uid], m.get("faceCount") or 0, m.get("vertexCount") or 0,
                m.get("likeCount") or 0, m.get("viewCount") or 0, int((m.get("animationCount") or 0) > 0),
                int(bool(m.get("staffpickedAt"))), thumbnail(m),
            ))
        db.executemany("""INSERT INTO objects (uid, name, tags, lvis, categories, description, licence, author,
            author_url, viewer_url, glb_path, faces, vertices, likes, views, animated, staffpicked, thumbnail)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", rows)
        kept += len(rows)
    db.execute("INSERT INTO fts(fts) VALUES ('rebuild')")
    db.commit()
    db.execute("VACUUM")
    print(json.dumps({"seen": seen, "kept": kept, "lvisKept": db.execute("SELECT count(*) FROM objects WHERE lvis != ''").fetchone()[0],
                      "index": str(db_path), "mb": round(db_path.stat().st_size / 1e6, 1)}))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=Path("data/objaverse"))
    build(parser.parse_args().data)


if __name__ == "__main__":
    main()
