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
import re
import sys
from datetime import date
from pathlib import Path

import fast_simplification
import numpy as np
import trimesh

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


def snake(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")


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

    # BodyParts3D's meshes are 99% reduced and look faceted up close: Taubin-smooth each part (no
    # shrinking), but keep the original if any vertex would move more than 1 mm (merged, non-manifold
    # pieces can make smoothing spike). Loop subdivision is avoided for the same reason.
    for name, (v, f) in list(merged.items()):
        mesh = trimesh.Trimesh(vertices=v, faces=f, process=True)
        before = np.asarray(mesh.vertices).copy()
        trimesh.smoothing.filter_taubin(mesh, lamb=0.5, nu=-0.53, iterations=recipe.get("smooth_iterations", 6))
        moved = float(np.max(np.linalg.norm(np.asarray(mesh.vertices) - before, axis=1))) if len(before) else 0.0
        if moved <= 0.001:
            merged[name] = (np.asarray(mesh.vertices), np.asarray(mesh.faces))
        else:
            print(f"  {name}: smoothing would move vertices {moved * 1000:.1f} mm; kept unsmoothed", file=sys.stderr)

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

    # Place: centred on x/z, standing on y = 0.
    all_v = np.concatenate([v for v, _f in merged.values()])
    lo, hi = all_v.min(axis=0), all_v.max(axis=0)
    shift = np.array([-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2])
    center = np.array([0.0, (hi[1] - lo[1]) / 2, 0.0])  # the object's centre after the shift

    scene = trimesh.Scene()
    entries = []
    for part in recipe["parts"]:
        if part["name"] not in merged:
            continue
        v, f = merged[part["name"]]
        v = v + shift
        mesh = trimesh.Trimesh(vertices=v, faces=f, process=True)
        mesh.fix_normals()
        rgb = [int(part["color"][i:i + 2], 16) for i in (1, 3, 5)]
        mesh.visual = trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(
            name=snake(part["name"]), baseColorFactor=[*rgb, 255], roughnessFactor=part.get("roughness", 0.55),
            metallicFactor=0.0, doubleSided=False))
        node = snake(part["name"])
        scene.add_geometry(mesh, node_name=node, geom_name=node)
        # Teaching rig (first version): explode direction from the object's centre through the part's
        # centroid; label anchor = the part's vertex farthest along that direction (on its outside).
        centroid = mesh.vertices.mean(axis=0)
        direction = centroid - center
        norm = float(np.linalg.norm(direction))
        direction = direction / norm if norm > 1e-6 else np.array([0.0, 1.0, 0.0])
        anchor = mesh.vertices[int(np.argmax(mesh.vertices @ direction))]
        concepts = part.get("concepts", []) + part.get("own", [])
        entries.append({
            "node": node, "name": part["name"], "fma": concepts, "fmaNames": [names.get(c, "") for c in concepts],
            "group": part.get("group"), "color": part["color"], "triangles": int(len(mesh.faces)),
            "pieces": len(part_pieces[part["name"]]),
            "centroid": [round(float(x), 4) for x in centroid], "labelAnchor": [round(float(x), 4) for x in anchor],
            "explodeDir": [round(float(x), 4) for x in direction],
        })

    out_assets, out_catalog = args.out / "assets", args.out / "catalog"
    out_assets.mkdir(parents=True, exist_ok=True)
    out_catalog.mkdir(parents=True, exist_ok=True)
    glb_path = out_assets / f"{recipe['id']}.glb"
    glb_path.write_bytes(scene.export(file_type="glb", include_normals=True))  # smooth shading
    size = (hi - lo)
    entry = {
        "id": recipe["id"], "title": recipe["title"], "tier": "A",
        "concept": recipe["concept"], "detail": recipe.get("detail"),
        "glb": f"assets/{recipe['id']}.glb", "sizeM": [round(float(x), 4) for x in size],
        "triangles": int(sum(e["triangles"] for e in entries)), "parts": entries,
        "licence": LICENCE, "credit": CREDIT, "licenceNote": LICENCE_NOTE,
        "provenance": {
            "source": "BodyParts3D 4.0, PART-OF tree, 99% polygon reduction (dbarchive.biosciencedbc.jp)",
            "built": str(date.today()), "recipe": str(args.recipe), "rawTriangles": int(total),
            "notes": recipe.get("notes", []),
        },
    }
    (out_catalog / f"{recipe['id']}.json").write_text(json.dumps(entry, indent=2))
    print(f"{recipe['id']}: {len(entries)} parts, {entry['triangles']:,} triangles (from {total:,}), "
          f"{glb_path.stat().st_size / 1e6:.1f} MB, size {entry['sizeM']} m")
    for e in entries:
        print(f"  {e['node']:<28} {e['pieces']:>3} pieces {e['triangles']:>6} tris")


if __name__ == "__main__":
    main()
