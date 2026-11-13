"""Build a teaching asset from BodyParts3D (tier A of docs/3d-architecture.md).

Usage: python library/bp3d_build.py <recipe.json> [--data data/bodyparts3d] [--out data/library]

A recipe lists the teaching parts of one asset. Each part takes mesh pieces by FMA concept:
  "concepts": every piece of these (compound) concepts, e.g. all branches of the right coronary artery;
  "own":      only pieces whose own concept is one of these, e.g. the trunk of a pulmonary vein but
              not its branches inside the lung.
A piece goes to the first part that claims it. "clip" keeps only triangles within that many mm of the
bounding box of the unclipped parts (for long vessels such as the inferior vena cava).

Output: <out>/assets/<id>.glb (one named node per part, metres, Y up, front +Z, base at y = 0, part
colours, simplified to the recipe's triangle budget) and a catalogue entry <out>/catalog/<id>.json
with FMA IDs, licence, credit, provenance, per-part triangle counts, label anchors and explode
directions. BodyParts3D coordinates are millimetres with +Z up, -Y anterior and +X the body's left.
"""

from __future__ import annotations

import argparse
import collections
import json
import sys
from pathlib import Path

import fast_simplification
import numpy as np
import trimesh

from common import write_asset

LICENCE = "CC BY 4.0"
CREDIT = "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International"
LICENCE_NOTE = ("The database licence page (updated 2025-02-27) states CC BY 4.0; the OBJ file headers still "
                "carry the earlier CC BY-SA 2.1 JP notice. We follow the current licence page.")


def load_tables(data: Path) -> tuple[dict[str, str], dict[str, set[str]]]:
    names: dict[str, str] = {}
    for line in (data / "partof_parts_list_e.txt").read_text(encoding="utf-8").splitlines()[1:]:
        concept, _rep, name = line.split("\t")
        names[concept] = name
    pieces: dict[str, set[str]] = collections.defaultdict(set)
    for line in (data / "partof_element_parts.txt").read_text(encoding="utf-8").splitlines()[1:]:
        concept, name, fj = line.split("\t")
        pieces[concept].add(fj)
        names.setdefault(concept, name)
    return names, pieces


def read_obj(path: Path) -> tuple[str, str, np.ndarray, np.ndarray]:
    """(own concept, own name, vertices in mm, triangle indices) of one BodyParts3D piece."""
    concept = name = ""
    verts: list[list[float]] = []
    faces: list[list[int]] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if line.startswith("v "):
            verts.append([float(x) for x in line.split()[1:4]])
        elif line.startswith("f "):
            idx = [int(tok.split("/")[0]) - 1 for tok in line.split()[1:]]
            faces.extend([idx[0], idx[i], idx[i + 1]] for i in range(1, len(idx) - 1))
        elif line.startswith("# Concept ID"):
            concept = line.split(":", 1)[1].strip()
        elif line.startswith("# English name"):
            name = line.split(":", 1)[1].strip()
    return concept, name, np.asarray(verts, dtype=np.float64), np.asarray(faces, dtype=np.int64)


def to_gltf(v_mm: np.ndarray) -> np.ndarray:
    """BodyParts3D (mm; +Z up, -Y anterior, +X body's left) to glTF (m; +Y up, +Z toward the viewer
    facing the body's front, +X to the viewer's right = body's left). A proper rotation, so faces keep
    their winding."""
    x, y, z = v_mm[:, 0], v_mm[:, 1], v_mm[:, 2]
    return np.stack([x, z, -y], axis=1) / 1000.0


def clip(verts: np.ndarray, faces: np.ndarray, lo: np.ndarray, hi: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Keep triangles whose three vertices are all inside [lo, hi], and only the vertices they use
    (stray vertices would still count in the asset's bounding box)."""
    inside = np.all((verts >= lo) & (verts <= hi), axis=1)
    kept = faces[np.all(inside[faces], axis=1)]
    used, remap = np.unique(kept, return_inverse=True)
    return verts[used], remap.reshape(kept.shape)


def reconstruct_wall(merged: dict, spec: dict, recipe: dict) -> None:
    """Rebuild a wall that BodyParts3D lacks (the ventricles are cavity casts with no myocardium).

    Each cavity is grown outward by its wall thickness on a voxel grid; the union is morphologically
    closed so neighbouring walls fuse (forming the septum between them); marching cubes gives a
    smooth outer surface. Each wall triangle joins the part whose cavity is nearest, so the part
    becomes cavity + wall and labels, explode and cut-away keep working. Recorded as reconstructed.
    """
    from scipy import ndimage
    from scipy.spatial import cKDTree
    from skimage import measure

    names = [n for n in spec["thickness_mm"] if n in merged]
    pitch = spec.get("voxel_mm", 1.0) / 1000.0
    thickest = max(spec["thickness_mm"][n] for n in names) / 1000.0
    close = spec.get("close_mm", 6) / 1000.0
    all_v = np.concatenate([merged[n][0] for n in names])
    lo = all_v.min(axis=0) - (thickest + close + 3 * pitch)
    hi = all_v.max(axis=0) + (thickest + close + 3 * pitch)
    shape = tuple(int(x) for x in np.ceil((hi - lo) / pitch) + 1)
    solid = np.zeros(shape, dtype=bool)
    for name in names:
        v, f = merged[name]
        filled = trimesh.Trimesh(vertices=v, faces=f, process=True).voxelized(pitch).fill()
        idx = np.round((np.asarray(filled.points) - lo) / pitch).astype(int)
        idx = idx[np.all((idx >= 0) & (idx < np.array(shape)), axis=1)]
        cavity = np.zeros(shape, dtype=bool)
        cavity[tuple(idx.T)] = True
        solid |= ndimage.distance_transform_edt(~cavity) * pitch <= spec["thickness_mm"][name] / 1000.0
    r = max(1, int(round(close / pitch)))
    zz, yy, xx = np.ogrid[-r:r + 1, -r:r + 1, -r:r + 1]
    solid = ndimage.binary_fill_holes(ndimage.binary_closing(solid, structure=(xx**2 + yy**2 + zz**2) <= r * r, iterations=1))
    verts, faces, _normals, _values = measure.marching_cubes(solid.astype(np.float32), level=0.5)
    wall = trimesh.Trimesh(vertices=verts * pitch + lo, faces=faces, process=True)
    trimesh.smoothing.filter_taubin(wall, lamb=0.5, nu=-0.53, iterations=12)  # voxel steps, not anatomy
    wall.fix_normals()
    if wall.volume < 0:  # outward-facing, or the renderer culls the near side and the wall looks see-through
        wall.invert()

    # Each wall triangle joins the nearest cavity's part.
    trees = [cKDTree(merged[n][0]) for n in names]
    owner = np.argmin(np.stack([t.query(wall.triangles_center)[0] for t in trees]), axis=0)
    for i, name in enumerate(names):
        face_ids = np.where(owner == i)[0]
        if len(face_ids) == 0:
            continue
        sub = wall.submesh([face_ids], append=True)
        v, f = merged[name]
        merged[name] = (np.concatenate([v, np.asarray(sub.vertices)]), np.concatenate([f, np.asarray(sub.faces) + len(v)]))

    # How well the rebuilt surface carries the vessels that run on the real one.
    wall_tree = cKDTree(np.asarray(wall.vertices))
    for name in spec.get("check_on_surface", []):
        if name in merged:
            d = wall_tree.query(merged[name][0])[0] * 1000
            print(f"  {name}: distance to reconstructed wall surface, median {np.median(d):.1f} mm, 90th pct {np.percentile(d, 90):.1f} mm", file=sys.stderr)
    recipe.setdefault("notes", []).append(spec["note"])



def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("recipe", type=Path)
    parser.add_argument("--data", type=Path, default=Path("data/bodyparts3d"))
    parser.add_argument("--out", type=Path, default=Path("data/library"))
    args = parser.parse_args()
    recipe = json.loads(args.recipe.read_text())
    names, pieces_of = load_tables(args.data)
    obj_dir = args.data / "obj" / "partof_BP3D_4.0_obj_99"

    # The root concept's pieces, read once; "own" selection matches each piece's own concept.
    pool = set().union(*(pieces_of[c] for c in recipe.get("pool", [recipe["concept"]["id"]])))
    for part in recipe["parts"]:
        for c in part.get("concepts", []):
            pool |= pieces_of[c]
        for c in part.get("own", []):
            pool |= pieces_of[c]
    meshes = {fj: read_obj(obj_dir / f"{fj}.obj") for fj in sorted(pool)}

    claimed: dict[str, str] = {}
    part_pieces: dict[str, list[str]] = collections.defaultdict(list)
    for part in recipe["parts"]:
        wanted = set().union(*(pieces_of[c] for c in part.get("concepts", []))) if part.get("concepts") else set()
        own = set(part.get("own", []))
        for fj, (concept, _name, _v, _f) in meshes.items():
            if fj in claimed:
                continue
            if fj in wanted or concept in own:
                claimed[fj] = part["name"]
                part_pieces[part["name"]].append(fj)
    excluded = set(recipe.get("exclude_own", []))

    # Merge pieces per part, in glTF space.
    merged: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for part in recipe["parts"]:
        vs, fs, offset = [], [], 0
        for fj in part_pieces[part["name"]]:
            concept, _name, v, f = meshes[fj]
            if concept in excluded or len(f) == 0:
                continue
            vs.append(to_gltf(v))
            fs.append(f + offset)
            offset += len(v)
        if vs:
            merged[part["name"]] = (np.concatenate(vs), np.concatenate(fs))
        else:
            print(f"warning: part {part['name']!r} got no pieces", file=sys.stderr)

    # Clip long vessels to the neighbourhood of everything else.
    fixed = [merged[p["name"]][0] for p in recipe["parts"] if p["name"] in merged and "clip" not in p]
    lo, hi = np.min(np.concatenate(fixed), axis=0), np.max(np.concatenate(fixed), axis=0)
    for part in recipe["parts"]:
        if "clip" in part and part["name"] in merged:
            v, f = merged[part["name"]]
            margin = part["clip"] / 1000.0
            v, f = clip(v, f, lo - margin, hi + margin)
            # A vessel that curves out of the box and back in leaves stray fragments: keep the largest
            # connected piece, which is the stretch attached to the heart.
            pieces = trimesh.Trimesh(vertices=v, faces=f, process=True).split(only_watertight=False)
            if len(pieces) > 1:
                main_piece = max(pieces, key=lambda m: len(m.faces))
                v, f = np.asarray(main_piece.vertices), np.asarray(main_piece.faces)
            merged[part["name"]] = (v, f)

    # BodyParts3D's meshes stay unsmoothed: they are 99% reduced, and even gentle smoothing moved
    # their vertices by several millimetres, too much for an accuracy-first library.
    for spec in recipe.get("walls", []):
        reconstruct_wall(merged, spec, recipe)

    # Meet the triangle budget by capping only the densest parts ("water-filling"): BodyParts3D's
    # coarse pieces (large vessels) are already at their minimum, so they keep every triangle.
    budget = recipe.get("triangle_budget", 50_000)
    total = sum(len(f) for _v, f in merged.values())
    counts = sorted(len(f) for _v, f in merged.values())
    cap, remaining = max(counts, default=0), budget
    for i, n in enumerate(counts):
        if n * (len(counts) - i) > remaining:
            cap = remaining // (len(counts) - i)
            break
        remaining -= n
    for name, (v, f) in list(merged.items()):
        target = min(len(f), cap)
        if len(f) > target:
            v2, f2 = fast_simplification.simplify(v.astype(np.float32), f.astype(np.int32), target_reduction=1 - target / len(f))
            merged[name] = (v2.astype(np.float64), f2.astype(np.int64))

    parts = []
    for part in recipe["parts"]:
        if part["name"] not in merged:
            continue
        v, f = merged[part["name"]]
        concepts = part.get("concepts", []) + part.get("own", [])
        parts.append({
            "name": part["name"], "group": part.get("group"), "color": part["color"], "roughness": part.get("roughness", 0.55),
            "mesh": trimesh.Trimesh(vertices=v, faces=f, process=True),
            "extra": {"fma": concepts, "fmaNames": [names.get(c, "") for c in concepts], "pieces": len(part_pieces[part["name"]])},
        })
    write_asset(args.out, {
        "id": recipe["id"], "title": recipe["title"], "tier": "A", "kind": recipe.get("kind", "anatomy"),
        "concept": recipe["concept"], "detail": recipe.get("detail"), "keywords": recipe.get("keywords", []),
        "licence": LICENCE, "credit": CREDIT, "licenceNote": LICENCE_NOTE,
        "provenance": {
            "source": "BodyParts3D 4.0, PART-OF tree, 99% polygon reduction (dbarchive.biosciencedbc.jp)",
            "recipe": str(args.recipe), "rawTriangles": int(total), "notes": recipe.get("notes", []),
        },
    }, parts)

if __name__ == "__main__":
    main()
