"""Part segmentation from SAM 3.1 masks on renders (M5 of docs/3d-architecture.md, section 4.6).

Step 1  python library/segment.py idglb <model.glb> <work dir>
        Writes <work>/ids.glb: the model's faces (low-poly models split finer first, see load_meshes), each in its own flat vertex colour encoding its number
        (face k of the model is colour k + 1 as 24-bit RGB; black is background). Rendered unlit, every
        pixel then says which face of the model it shows.
Step 2  apps/server/src/three-d/segment-parts.ts renders the model and ids.glb from the same angles,
        asks SAM 3.1 for every part name in every view, and saves the replies.
Step 3  python library/segment.py assign <model.glb> <work dir>
        Each pixel inside a part's mask votes for the face it shows; where masks overlap, the smallest
        (most specific) wins, so "sound hole" beats "guitar body". A mask covering most of the object
        for a part other than the main body is ignored (SAM didn't find the part). A face takes the
        part with most votes if they are at least a quarter of its visible pixels; unclaimed faces
        next to a part join it, and the rest (hidden insides, things nobody asked for) join the main body. Writes
        <work>/groups.npz (one group per part, in the form retrieved.py ingest reads), adds the part
        names to <work>/names.json, and writes <work>/parts.glb (each part one flat colour) and
        <work>/check_<n>.glb (part n solid red, the rest faint) to check it. Faces retrieved.py prepare dropped as strays stay dropped.

Trusted code: it reads renders, SAM replies and downloaded model files; no code in them runs.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import numpy as np
import trimesh
from meta_sam_parser import CompletedOutcome, decode_mask_to_raster, image_segmentation_format
from PIL import Image
from scipy.spatial import cKDTree

from retrieved import PALETTE, load_meshes

MIN_CONFIDENCE = 0.35
CLAIM_SHARE = 0.25
WHOLE_SHARE = 0.6  # a mask covering more of the object than this, for a part other than the main body, is SAM giving up
GAP_RINGS = 3  # unclaimed faces this close (in faces) to a part join it; the rest join the main body


def idglb(glb: Path, work: Path) -> None:
    meshes = load_meshes(glb, refine=True)
    vertices = np.concatenate([m.vertices[m.faces].reshape(-1, 3) for m in meshes])
    ids = np.arange(1, len(vertices) // 3 + 1, dtype=np.uint32).repeat(3)
    colours = np.stack([ids & 255, (ids >> 8) & 255, (ids >> 16) & 255, np.full_like(ids, 255)], axis=1).astype(np.uint8)
    mesh = trimesh.Trimesh(vertices, np.arange(len(vertices)).reshape(-1, 3), vertex_colors=colours, process=False)
    work.mkdir(parents=True, exist_ok=True)
    (work / "ids.glb").write_bytes(mesh.export(file_type="glb"))
    print(json.dumps({"ok": True, "faces": int(len(ids) // 3), "meshes": [int(len(m.faces)) for m in meshes]}))


def masks_of(reply: str) -> list[tuple[np.ndarray, tuple[int, int], float]]:
    """(mask raster, (left, top), confidence) for every match in one SAM 3.1 reply."""
    parser = image_segmentation_format().create_parser()
    parser.push(reply)
    result = parser.finish(CompletedOutcome())
    result = getattr(result, "result", result)
    out = []
    for record in result.records:
        if record.kind != "mask" or (record.confidence is not None and record.confidence < MIN_CONFIDENCE):
            continue
        raster = np.frombuffer(decode_mask_to_raster(record.mask), dtype=np.uint8).reshape(record.mask.height, record.mask.width)
        out.append((raster, (record.bounds.left, record.bounds.top), record.confidence or 1.0))
    return out


def assign(glb: Path, work: Path) -> None:
    meshes = load_meshes(glb, refine=True)
    counts = [len(m.faces) for m in meshes]
    total = sum(counts)
    plan = json.loads((work / "parts.json").read_text())  # {"parts": [label names], "views": n, "main"?}; SAM looked for plan["find"]
    parts: list[str] = plan["parts"]
    views = []
    for v in range(plan["views"]):
        ids = np.asarray(Image.open(work / "views" / f"v{v}-id.png").convert("RGB"), dtype=np.uint32)
        face = ids[..., 0] | (ids[..., 1] << 8) | (ids[..., 2] << 16)  # 0 = background
        face = np.where(face > total, 0, face)
        layers = []
        for p in range(len(parts)):
            reply = work / "sam" / f"v{v}__p{p}.txt"
            if reply.exists():
                layers += [(int(raster.sum()), p, raster, at) for raster, at, _c in masks_of(reply.read_text())]
        views.append((face, layers))
    # The main body owns whatever no other part claims. The plan marks it (older plans: a part named
    # "... body" or "... frame"). If SAM didn't find it, the leftovers become a part named after the
    # object itself ("lunar lander": the rest of the lander), never some other part.
    found = np.zeros(len(parts))
    for _face, layers in views:
        for area_px, p, _r, _at in layers:
            found[p] += area_px
    main = plan.get("main")
    if main is None:
        main = next((p for p, n in enumerate(parts) if re.search(r"\b(body|frame)\b", n)), None)
    if main is None or not found[main]:
        names_path = work / "names.json"
        title = json.loads(names_path.read_text()).get("title") if names_path.exists() else None
        name = re.sub(r"[^a-z0-9 '-]+", "", str(title or "body").lower()).strip() or "body"
        if name not in parts:
            parts = parts + [name]
        main = parts.index(name)

    votes = np.zeros((total + 1, len(parts)), dtype=np.float64)
    seen = np.zeros(total + 1, dtype=np.float64)
    for face, layers in views:
        np.add.at(seen, face.ravel(), 1)
        object_px = max(1, int((face > 0).sum()))
        owner = np.full(face.shape, -1, dtype=np.int32)
        # Paint masks largest first, so the smallest (most specific) one covering a pixel wins it.
        for _area, p, raster, (left, top) in sorted(layers, key=lambda l: -l[0]):
            h, w = raster.shape
            h, w = min(h, face.shape[0] - top), min(w, face.shape[1] - left)
            inside = (raster[:h, :w] > 0) & (face[top:top + h, left:left + w] > 0)
            if p != main and inside.sum() > WHOLE_SHARE * object_px:
                continue  # SAM marked (nearly) the whole object: it didn't find this part here
            region = owner[top:top + h, left:left + w]
            region[raster[:h, :w] > 0] = p
        hit = (owner >= 0) & (face > 0)
        np.add.at(votes, (face[hit], owner[hit]), 1)
    votes, seen = votes[1:], seen[1:]
    best = votes.argmax(axis=1)
    claimed = votes.max(axis=1) >= np.maximum(1, CLAIM_SHARE * seen)
    label = np.where(claimed, best, -1)

    # Unclaimed faces close to a part (gaps along its edge) join it across the surface; the rest join
    # the main body. Spreading further would let one part flood over things nobody asked for (a seat
    # taking the chair's whole base) or through hidden insides (a sound hole running through the body).
    all_v = np.concatenate([m.vertices for m in meshes])
    offsets = np.cumsum([0] + [len(m.vertices) for m in meshes])
    all_f = np.concatenate([m.faces + offsets[i] for i, m in enumerate(meshes)])
    shape = trimesh.Trimesh(all_v, all_f, process=False)
    shape.merge_vertices(merge_tex=True, merge_norm=True)
    adjacency = shape.face_adjacency
    for _ in range(GAP_RINGS if main >= 0 else 200):
        open_ = label < 0
        if not open_.any():
            break
        a, b = adjacency[:, 0], adjacency[:, 1]
        take_a = open_[a] & (label[b] >= 0)
        take_b = open_[b] & (label[a] >= 0)
        if not (take_a.any() or take_b.any()):
            break
        label[a[take_a]] = label[b[take_a]]
        label[b[take_b]] = label[a[take_b]]
    centres = shape.triangles_center

    def fill_from_nearest(label: np.ndarray) -> None:
        known, missing = np.flatnonzero(label >= 0), np.flatnonzero(label < 0)
        if len(known) and len(missing):
            label[missing] = label[known[cKDTree(centres[known]).query(centres[missing])[1]]]

    if main >= 0:
        label[label < 0] = main
    fill_from_nearest(label)

    # Parts that won (almost) nothing are dropped and renumbered; strays from prepare stay at -1.
    area = shape.area_faces
    used = [p for p in range(len(parts)) if area[label == p].sum() >= 0.002 * area.sum()]
    if not used:
        raise ValueError("SAM 3.1 found none of the parts on any view")
    remap = {p: i for i, p in enumerate(used)}
    label = np.array([remap.get(int(p), -1) for p in label], dtype=np.int16)
    if main in remap:
        label[label < 0] = remap[main]  # faces of dropped tiny parts join the main body
    fill_from_nearest(label)
    split = np.split(label, np.cumsum(counts)[:-1])
    previous = work / "groups.npz"
    if previous.exists():  # strays from prepare stay dropped
        for i, old in enumerate(np.load(previous).values()):
            split[i] = np.where(old < 0, -1, split[i]).astype(np.int16)
    np.savez_compressed(work / "groups.npz", *split)
    # A preview with each part in its own flat colour, to check the result on a render.
    preview = trimesh.Scene()
    for i, p in enumerate(used):
        faces = np.flatnonzero(label == i)
        piece = trimesh.Trimesh(all_v, all_f[faces], process=False)
        piece.remove_unreferenced_vertices()
        rgb = [int(PALETTE[i % len(PALETTE)][j:j + 2], 16) for j in (1, 3, 5)]
        piece.visual = trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(
            name=parts[p], baseColorFactor=[*rgb, 255], roughnessFactor=0.8, doubleSided=True))
        preview.add_geometry(piece, node_name=parts[p].replace(" ", "_"), geom_name=parts[p].replace(" ", "_"))
    (work / "parts.glb").write_bytes(preview.export(file_type="glb"))
    # One picture-ready model per part (that part solid red, the rest faint) for checking it.
    for i, p in enumerate(used):
        check = trimesh.Scene()
        for j in range(len(used)):
            faces = np.flatnonzero(label == j)
            piece = trimesh.Trimesh(all_v, all_f[faces], process=False)
            piece.remove_unreferenced_vertices()
            rgba = [230, 25, 75, 255] if j == i else [190, 196, 204, 60]
            piece.visual = trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(
                name=f"p{j}", baseColorFactor=rgba, roughnessFactor=0.8, doubleSided=True, alphaMode="BLEND" if rgba[3] < 255 else "OPAQUE"))
            check.add_geometry(piece, node_name=f"p{j}", geom_name=f"p{j}")
        (work / f"check_{i + 1}.glb").write_bytes(check.export(file_type="glb"))
    names_path = work / "names.json"
    names = json.loads(names_path.read_text()) if names_path.exists() else {}
    names["parts"] = {str(i + 1): parts[p] for p, i in remap.items()}
    names_path.write_text(json.dumps(names, indent=2))
    claimed_share = float(area[claimed].sum() / area.sum())
    print(json.dumps({"ok": True, "parts": [parts[p] for p in used], "dropped": [n for p, n in enumerate(parts) if p not in remap],
                      "claimedShare": round(claimed_share, 3), "faces": int(total)}))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("step", choices=["idglb", "assign"])
    parser.add_argument("glb", type=Path)
    parser.add_argument("work", type=Path)
    args = parser.parse_args()
    try:
        (idglb if args.step == "idglb" else assign)(args.glb, args.work)
    except Exception as err:
        print(json.dumps({"ok": False, "error": f"{type(err).__name__}: {err}"[:500]}))
        sys.exit(1)


if __name__ == "__main__":
    main()
