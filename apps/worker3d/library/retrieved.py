"""Bring a retrieved model (tier C of docs/3d-architecture.md) into the library with named parts.

Step 1  python library/retrieved.py prepare <model.glb> <work dir>
        Splits the model into physically separate pieces (faces joined through shared positions; UV
        seams don't split a piece), merges small pieces into the nearest large one (at most 12 groups),
        and writes <work>/group_<n>.glb for each group (that group solid red, the rest faint, to be named
        from a render) and <work>/groups.npz (the group of every face of every mesh). Prints the groups.
Step 2  apps/server/src/three-d/ingest-retrieved.ts renders each group and asks Muse Ember to name the
        groups, pick the view a learner should see first, and give the object's real size; it writes
        <work>/names.json and <work>/meta.json.
Step 3  python library/retrieved.py ingest <model.glb> <work dir> [--out data/library]
        Writes the asset with the author's own materials and textures, one named node per part, turned
        to face +Z, at real size (or at a stated scale when the real thing is too big for a desk).

Trusted code: it reads downloaded model files (no code in them runs) and writes library files.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

import numpy as np
import trimesh

from common import write_asset

# Catalogue colours for parts (the model keeps its own materials; these only tag parts in listings).
PALETTE = ["#e6194b", "#3cb44b", "#4363d8", "#ffe119", "#f58231", "#911eb4", "#42d4f4", "#f032e6", "#bfef45",
           "#fabed4", "#469990", "#9a6324"]
MAX_GROUPS = len(PALETTE)
SEED_SHARE = 0.02  # a piece with at least this share of the surface starts its own group
DESK_SIZE_M = 0.6  # things too big for a desk are shown at this size, with the scale stated
MAX_REAL_SIZE_M = 2.5
MIN_REAL_SIZE_M = 0.05  # smaller things (a cell, a molecule) are shown enlarged, with the magnification stated
MAGNIFIED_SIZE_M = 0.3
TURN_DEG = {"front": 0, "side": -90, "back": 180, "opposite side": 90}  # turn that brings this render view to +Z (side = seen from +X)


REFINE_MAX_FACES = 60_000
REFINE_EDGE_SHARE = 0.015


def load_meshes(glb: Path, refine: bool = False) -> list[trimesh.Trimesh]:
    """The model's meshes in world coordinates. refine: split low-poly faces (uniformly, keeping UVs and
    materials) until a typical edge is under 1.5% of the model's size or the model reaches about 60k
    faces, so part boundaries found on renders can fall between faces. Deterministic, so every step of
    one segmentation sees the same faces."""
    scene = trimesh.load(glb, force="scene")
    meshes = [m for m in scene.dump(concatenate=False) if isinstance(m, trimesh.Trimesh) and len(m.faces)]
    if refine and meshes:
        extent = float(np.max(np.ptp(np.concatenate([m.vertices for m in meshes]), axis=0)))
        while sum(len(m.faces) for m in meshes) * 4 <= REFINE_MAX_FACES:
            coarse = [i for i, m in enumerate(meshes) if np.percentile(m.edges_unique_length, 90) > REFINE_EDGE_SHARE * extent]
            if not coarse:
                break
            for i in coarse:
                meshes[i] = meshes[i].subdivide()
    return meshes


def pieces_of(mesh: trimesh.Trimesh) -> np.ndarray:
    """Connected piece of every face, joining faces that share a position (not a UV or normal)."""
    shape = trimesh.Trimesh(mesh.vertices, mesh.faces, process=False)
    shape.merge_vertices(merge_tex=True, merge_norm=True)
    return trimesh.graph.connected_component_labels(shape.face_adjacency, node_count=len(shape.faces))


def prepare(glb: Path, work: Path, refine: bool = False) -> None:
    meshes = load_meshes(glb, refine)
    pieces = []  # (mesh index, piece label, area, centroid, bounds)
    labels = []
    for i, mesh in enumerate(meshes):
        label = pieces_of(mesh)
        labels.append(label)
        areas = mesh.area_faces
        centers = mesh.triangles_center
        for piece in np.unique(label):
            faces = np.flatnonzero(label == piece)
            area = float(areas[faces].sum())
            centroid = (centers[faces] * areas[faces, None]).sum(axis=0) / max(area, 1e-12)
            corners = mesh.vertices[mesh.faces[faces].ravel()]
            pieces.append((i, int(piece), area, centroid, np.array([corners.min(axis=0), corners.max(axis=0)])))
    total = sum(p[2] for p in pieces)
    order = sorted(range(len(pieces)), key=lambda k: -pieces[k][2])
    seeds = [k for k in order if pieces[k][2] >= SEED_SHARE * total][:MAX_GROUPS] or order[:1]
    # Stray pieces (leftovers in the author's file, far from the model) are dropped: they would inflate
    # its size and push it off-centre. Kept: everything reachable from the large pieces through a chain
    # of near neighbours (bounding boxes within 5% of the model's size), so thin legs and spokes stay.
    lows = np.array([p[4][0] for p in pieces])
    highs = np.array([p[4][1] for p in pieces])
    link = 0.05 * float(np.max(highs.max(axis=0) - lows.min(axis=0)))
    reached = np.zeros(len(pieces), dtype=bool)
    reached[seeds] = True
    frontier = list(seeds)
    while frontier:
        k = frontier.pop()
        gap = np.linalg.norm(np.maximum(0, np.maximum(lows - highs[k], lows[k] - highs)), axis=1)
        new = np.flatnonzero((gap <= link) & ~reached)
        reached[new] = True
        frontier.extend(new.tolist())
    group_of_piece = {}
    for k in range(len(pieces)):
        if k in seeds:
            group_of_piece[k] = seeds.index(k)
            continue
        if not reached[k]:
            group_of_piece[k] = -1
            continue
        # Nearest large piece: distance from this piece's centroid to the seed's bounding box.
        c = pieces[k][3]
        gaps = [np.linalg.norm(np.clip(c, pieces[s][4][0], pieces[s][4][1]) - c) for s in seeds]
        group_of_piece[k] = int(np.argmin(gaps))
    face_groups = [np.zeros(len(m.faces), dtype=np.int16) for m in meshes]
    for k, (i, piece, *_rest) in enumerate(pieces):
        face_groups[i][labels[i] == piece] = group_of_piece[k]

    work.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(work / "groups.npz", *face_groups)
    shapes = [trimesh.util.concatenate([trimesh.Trimesh(m.vertices, m.faces[face_groups[i] == g], process=False)
                                        for i, m in enumerate(meshes) if (face_groups[i] == g).any()])
              for g in range(len(seeds))]

    def material(name: str, rgba: list[int]) -> trimesh.visual.TextureVisuals:
        return trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(
            name=name, baseColorFactor=rgba, roughnessFactor=0.8, metallicFactor=0.0, doubleSided=True,
            alphaMode="BLEND" if rgba[3] < 255 else "OPAQUE"))

    # One picture per group to name it from: that group solid red, the rest faint and see-through (so
    # inner parts show). Separate pictures, because similar colours (red, magenta) blur under lighting.
    legend = []
    for g, shape in enumerate(shapes):
        scene = trimesh.Scene()
        for h, other in enumerate(shapes):
            piece = other.copy()
            piece.visual = material(f"g{h + 1}", [230, 25, 75, 255] if h == g else [190, 196, 204, 60])
            scene.add_geometry(piece, node_name=f"group_{h + 1}", geom_name=f"group_{h + 1}")
        (work / f"group_{g + 1}.glb").write_bytes(scene.export(file_type="glb"))
        share = sum(pieces[k][2] for k in range(len(pieces)) if group_of_piece[k] == g) / total
        legend.append({"group": g + 1, "glb": str(work / f"group_{g + 1}.glb"), "surfaceShare": round(share, 3)})
    dropped = [k for k in group_of_piece if group_of_piece[k] < 0]
    print(json.dumps({"ok": True, "pieces": len(pieces), "dropped": len(dropped), "groups": legend}))


def ingest(glb: Path, work: Path, out: Path, refine: bool = False, split_regions: bool = False) -> dict:
    """split_regions: keep each segmentation region (<work>/regions-merged.npy, from segment.py) as its own
    piece under its part, instead of one piece per part. For the repair stage, which can then move a
    whole region to another part without cutting any mesh."""
    names = json.loads((work / "names.json").read_text())
    meta = json.loads((work / "meta.json").read_text())
    meshes = load_meshes(glb, refine)
    face_groups = list(np.load(work / "groups.npz").values())
    turn = trimesh.transformations.rotation_matrix(math.radians(TURN_DEG.get(names.get("bestView"), 0)), [0, 1, 0])
    for mesh in meshes:
        mesh.apply_transform(turn)
    # Size of what is kept (stray pieces dropped in prepare have group -1).
    kept = np.concatenate([m.vertices[m.faces[face_groups[i] >= 0].ravel()] for i, m in enumerate(meshes)])
    extent = float(np.max(np.ptp(kept, axis=0)))
    real = float(names.get("sizeM") or 0)
    scale_note = None
    if MIN_REAL_SIZE_M <= real <= MAX_REAL_SIZE_M:
        scale = real / extent
    elif 0 < real < MIN_REAL_SIZE_M:
        scale = MAGNIFIED_SIZE_M / extent
        scale_note = (f"Not real size: the real {names.get('title', 'object').lower()} is about {real * 1000:g} mm across; "
                      f"it is shown {MAGNIFIED_SIZE_M * 100:.0f} cm across (about {MAGNIFIED_SIZE_M / real:,.0f} times larger).")
    else:
        scale = DESK_SIZE_M / extent
        if real > 0:
            scale_note = (f"Not real size: the real {names.get('title', 'object').lower()} is about {real:,.0f} m across; "
                          f"it is shown {DESK_SIZE_M * 100:.0f} cm across (about 1:{real / DESK_SIZE_M:,.0f}).")
    for mesh in meshes:
        mesh.apply_scale(scale)

    regions = None
    if split_regions and (work / "regions-merged.npy").exists():
        regions = np.split(np.load(work / "regions-merged.npy"), np.cumsum([len(m.faces) for m in meshes])[:-1])
    # Groups with the same name are one part; each part keeps one piece per original mesh (material).
    by_name: dict[str, list[int]] = {}
    named = {int(g) - 1: re.sub(r"[_\s]+", " ", str(n)).strip().lower() for g, n in names["parts"].items()}
    group_count = int(max(groups.max() for groups in face_groups)) + 1
    for group in range(group_count):
        by_name.setdefault(named.get(group) or "other", []).append(group)  # unnamed groups are kept as "other"
    parts = []
    for n, (name, groups) in enumerate(by_name.items()):
        pieces = []
        for i, mesh in enumerate(meshes):
            mine = np.isin(face_groups[i], groups)
            if not mine.any():
                continue
            if regions is None:
                pieces.append(mesh.submesh([np.flatnonzero(mine)], append=True))
            else:
                pieces += [mesh.submesh([np.flatnonzero(mine & (regions[i] == r))], append=True) for r in np.unique(regions[i][mine])]
        if pieces:
            parts.append({"name": name, "meshes": pieces, "color": PALETTE[groups[0]], "extra": {"groups": [g + 1 for g in groups]}})

    title = names.get("title") or meta["name"]
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:40] or meta["uid"][:12]
    # meta.json may override the source description (e.g. a generated model rather than a Sketchfab one).
    notes = [meta.get("note") or f"Made by {meta['author']} and shared on Sketchfab under {meta['licence']}; found through "
             f"Objaverse 1.0 and chosen by Muse Ember from renders. Not checked by a subject expert."]
    if scale_note:
        notes.append(scale_note)
    notes.append(names.get("partsNote") or "Parts are the model's physically separate pieces, grouped by size and named by "
                 "Muse Ember from a render of each group; pieces the author modelled as one (e.g. a guitar's body and neck) stay one part.")
    return write_asset(out, {
        "id": meta.get("assetId") or f"{slug}-objaverse", "title": f"{title} (3D model by {meta['author']})", "tier": meta.get("tier", "C"),
        "kind": names.get("kind"), "concept": {"id": f"objaverse:{meta['uid']}", "name": title}, "detail": "retrieved",
        "keywords": sorted({str(k).lower() for k in names.get("keywords", [])} | {title.lower()}),
        "credit": meta.get("credit") or f"{meta['author']} (Sketchfab), \"{meta['name']}\", {meta['viewerUrl']}", "licence": meta["licence"],
        "provenance": {"source": meta["viewerUrl"], "objaverseUid": meta["uid"], "retrievedFor": meta.get("request"),
                       "dinoSimilarity": meta.get("similarity"), "pickReason": meta.get("reason"), "authorUrl": meta.get("authorUrl"),
                       "scale": round(scale, 6), "notes": notes},
    }, parts)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("step", choices=["prepare", "ingest"])
    parser.add_argument("glb", type=Path)
    parser.add_argument("work", type=Path)
    parser.add_argument("--out", type=Path, default=Path("data/library"))
    parser.add_argument("--refine", action="store_true", help="split low-poly faces first (segment.py does)")
    parser.add_argument("--split-regions", action="store_true", help="ingest: one piece per segmentation region (for the repair stage)")
    args = parser.parse_args()
    try:
        if args.step == "prepare":
            prepare(args.glb, args.work, args.refine)
        else:
            entry = ingest(args.glb, args.work, args.out, args.refine, args.split_regions)
            print(json.dumps({"ok": True, "id": entry["id"], "parts": [p["name"] for p in entry["parts"]]}))
    except Exception as err:
        print(json.dumps({"ok": False, "error": f"{type(err).__name__}: {err}"[:500]}))
        sys.exit(1)


if __name__ == "__main__":
    main()
