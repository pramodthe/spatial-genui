"""Retrieval candidates from Objaverse (tier C of docs/3d-architecture.md, section 4.3, steps 2-3).

Usage: python library/objaverse_retrieve.py --terms "bicycle,bike" --reference ref.jpg [--top 6] [--pool 40]
           [--data data/objaverse]
Prints one JSON line: {"ok": true, "candidates": [{uid, name, licence, author, viewerUrl, faces,
similarity, glb, thumbnail}, ...]} with the best `top` candidates by DINOv3 similarity to the
reference image, their GLBs downloaded to <data>/glbs/ (cached).

1. Text search: the FTS5 index from objaverse_index.py (CC0 and CC BY only), BM25 over name, tags,
   LVIS category and Sketchfab categories, with popularity and staff picks breaking ties. The best
   `pool` matches go on.
2. Image rerank: DINOv3 (ViT-L/16, on Modal: modal_retrieval.py) embeds the reference picture and each
   candidate's Sketchfab thumbnail; candidates are ranked by cosine similarity. Candidates whose
   thumbnail is gone (the model was removed from Sketchfab) are dropped.
Picking among the survivors from renders of the actual models is the caller's job (step 4).
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sqlite3
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import modal
from huggingface_hub import hf_hub_download

MAX_FACES = 400_000  # decimated on ingestion; heavier models are slow to download and rarely better
MIN_FACES = 300  # below this, a model is a placeholder, not a teaching model
# Words that describe a lesson's framing, not the object: no help when matching model titles.
STOPWORDS = {"the", "and", "for", "with", "its", "parts", "part", "diagram", "labeled", "labelled", "model", "anatomy", "cross", "section", "structure"}


def search(db: sqlite3.Connection, terms: list[str], pool: int) -> list[dict]:
    keys = ["uid", "name", "lvis", "licence", "author", "authorUrl", "viewerUrl", "glbPath", "faces", "likes",
            "staffpicked", "animated", "thumbnailUrl", "rank"]

    def run(query: str) -> list[dict]:
        rows = db.execute("""
            SELECT o.uid, o.name, o.lvis, o.licence, o.author, o.author_url, o.viewer_url, o.glb_path, o.faces, o.likes,
                   o.staffpicked, o.animated, o.thumbnail, bm25(fts, 8.0, 2.0, 6.0, 1.0, 0.3) AS rank
            FROM fts JOIN objects o ON o.rowid = fts.rowid
            WHERE fts MATCH ? AND o.faces BETWEEN ? AND ? AND o.thumbnail IS NOT NULL
            ORDER BY rank LIMIT 400""", (query, MIN_FACES, MAX_FACES)).fetchall()
        found = [dict(zip(keys, row)) for row in rows]
        # BM25 rank is negative (lower is better): popularity and staff picks scale it among good text matches.
        found.sort(key=lambda r: r["rank"] * (1 + 0.15 * math.log10(1 + r["likes"]) + 0.3 * r["staffpicked"]))
        return found

    phrases = [t.replace('"', "").strip().lower() for t in terms if t.strip()]
    found = run(" OR ".join(f'"{p}"' for p in phrases))[:pool]
    if len(found) < pool:
        # Too few exact phrases ("parts of a flower" is no model's title): widen to their content words,
        # after the phrase matches.
        words = sorted({w for p in phrases for w in re.findall(r"[a-z0-9]+", p) if len(w) > 2 and w not in STOPWORDS})
        seen = {r["uid"] for r in found}
        if words:
            found += [r for r in run(" OR ".join(f'"{w}"' for w in words)) if r["uid"] not in seen][: pool - len(found)]
    return found


def fetch(url: str, path: Path) -> bytes | None:
    if path.exists():
        return path.read_bytes()
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "spatial-genui/0.1 (education research)"})
        with urllib.request.urlopen(req, timeout=20) as res:
            data = res.read()
    except Exception:
        return None
    path.write_bytes(data)
    return data


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--terms", required=True, help="comma-separated search terms, most specific first")
    parser.add_argument("--reference", type=Path, required=True, help="reference picture of what the lesson needs")
    parser.add_argument("--top", type=int, default=6)
    parser.add_argument("--pool", type=int, default=40)
    parser.add_argument("--data", type=Path, default=Path("data/objaverse"))
    args = parser.parse_args()
    try:
        db = sqlite3.connect(f"file:{args.data / 'index.sqlite'}?mode=ro", uri=True)
        found = search(db, args.terms.split(","), args.pool)
        if not found:
            print(json.dumps({"ok": True, "candidates": [], "searched": 0}))
            return
        thumbs = args.data / "thumbs"
        thumbs.mkdir(parents=True, exist_ok=True)
        with ThreadPoolExecutor(8) as pool:
            images = list(pool.map(lambda r: fetch(r["thumbnailUrl"], thumbs / f"{r['uid']}.jpg"), found))
        alive = [(r, img) for r, img in zip(found, images) if img]
        dino = modal.Cls.from_name("spatial-genui-3d-v2-retrieval", "Dino")()
        vectors = dino.embed.remote([args.reference.read_bytes()] + [img for _, img in alive])
        ref = vectors[0]
        for (r, _), v in zip(alive, vectors[1:]):
            r["similarity"] = round(sum(a * b for a, b in zip(ref, v)), 4)
            r["thumbnail"] = str(thumbs / f"{r['uid']}.jpg")
        best = sorted((r for r, _ in alive), key=lambda r: -r["similarity"])[: args.top]
        for r in best:  # the actual models, for rendering and the final pick
            r["glb"] = hf_hub_download("allenai/objaverse", r.pop("glbPath"), repo_type="dataset", local_dir=args.data)
            r.pop("thumbnailUrl")
        print(json.dumps({"ok": True, "searched": len(found), "withThumbnail": len(alive), "candidates": best}))
    except Exception as err:
        print(json.dumps({"ok": False, "error": f"{type(err).__name__}: {err}"[:500]}))
        sys.exit(1)


if __name__ == "__main__":
    main()
