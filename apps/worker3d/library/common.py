"""Shared output step for every library builder: place the asset, compute its teaching rig, and write
the GLB plus its catalogue entry (the format the agent server and the browser host read).

Conventions: metres, +Y up, front toward +Z, centred on x/z, standing on y = 0. One named node per part.
"""

from __future__ import annotations

import json
import os
import re
from datetime import date
from pathlib import Path

import numpy as np
import trimesh


def snake(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")


def write_atomic(path: Path, data: bytes) -> None:
    """Readers (the agent server, other builds) never see a half-written file."""
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def write_asset(out: Path, meta: dict, parts: list[dict]) -> dict:
    """Write <out>/assets/<id>.glb and <out>/catalog/<id>.json; returns the catalogue entry.

    meta:  id, title, tier, concept, credit, licence, provenance (dict), and optionally detail, kind,
           keywords (words a request may use for it), licenceNote.
    parts: [{name, mesh: trimesh.Trimesh (metres, final arrangement), color: '#rrggbb', group?,
             roughness?, metalness?, glow? (0-1 emissive), sharp? (keep edges over 30 degrees sharp, e.g. a
             flat ring, which smooth shading would round into a tube), extra?: dict merged into the part's
             catalogue record}]
           A part from an existing model (retrieval) gives `meshes` (a list, each keeping its own textured
           material) instead of `mesh`; `color` is then only its colour in catalogue listings.
    """
    def meshes_of(part: dict) -> list[trimesh.Trimesh]:
        return part["meshes"] if "meshes" in part else [part["mesh"]]

    all_v = np.concatenate([np.asarray(m.vertices) for p in parts for m in meshes_of(p)])
    lo, hi = all_v.min(axis=0), all_v.max(axis=0)
    shift = np.array([-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2])
    center = np.array([0.0, (hi[1] - lo[1]) / 2, 0.0])  # the asset's centre after the shift

    scene = trimesh.Scene()
    records = []
    for part in parts:
        node = snake(part["name"])
        if "meshes" in part:
            # Existing materials and normals stay as the author made them; children of one part node.
            scene.graph.update(frame_from=scene.graph.base_frame, frame_to=node)
            pieces = []
            for i, source in enumerate(part["meshes"]):
                piece = source.copy()
                piece.apply_translation(shift)
                scene.add_geometry(piece, node_name=f"{node}_{i}", geom_name=f"{node}_{i}", parent_node_name=node)
                pieces.append(piece)
            vertices = np.concatenate([m.vertices for m in pieces])
            triangles = sum(len(m.faces) for m in pieces)
        else:
            mesh = part["mesh"].copy()
            mesh.apply_translation(shift)
            mesh.fix_normals(multibody=True)  # each piece on its own (a part can be several bodies)
            if part.get("sharp"):
                mesh = trimesh.graph.smooth_shade(mesh, angle=np.radians(30), facet_minarea=None)
            rgb = [int(part["color"][i:i + 2], 16) for i in (1, 3, 5)]
            mesh.visual = trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(
                name=node, baseColorFactor=[*rgb, 255], roughnessFactor=part.get("roughness", 0.55),
                metallicFactor=part.get("metalness", 0.0), doubleSided=False,
                emissiveFactor=[c / 255 * part.get("glow", 0.0) for c in rgb]))  # e.g. the Sun
            scene.add_geometry(mesh, node_name=node, geom_name=node)
            vertices, triangles = mesh.vertices, len(mesh.faces)
        # Teaching rig: explode direction from the asset's centre through the part's centroid; label
        # anchor = the part's vertex farthest along that direction (a point on its outside).
        centroid = vertices.mean(axis=0)
        direction = centroid - center
        norm = float(np.linalg.norm(direction))
        direction = direction / norm if norm > 1e-6 else np.array([0.0, 1.0, 0.0])
        anchor = vertices[int(np.argmax(vertices @ direction))]
        records.append({
            "node": node, "name": part["name"], "group": part.get("group"), "color": part["color"],
            "triangles": int(triangles),
            "centroid": [round(float(x), 4) for x in centroid], "labelAnchor": [round(float(x), 4) for x in anchor],
            "explodeDir": [round(float(x), 4) for x in direction],
            **part.get("extra", {}),
        })

    (out / "assets").mkdir(parents=True, exist_ok=True)
    (out / "catalog").mkdir(parents=True, exist_ok=True)
    glb_path = out / "assets" / f"{meta['id']}.glb"
    write_atomic(glb_path, scene.export(file_type="glb", include_normals=True))  # normals: smooth shading
    entry = {
        "id": meta["id"], "title": meta["title"], "tier": meta["tier"], "kind": meta.get("kind"),
        "concept": meta["concept"], "detail": meta.get("detail"), "keywords": meta.get("keywords", []),
        "glb": f"assets/{meta['id']}.glb", "sizeM": [round(float(x), 4) for x in hi - lo],
        "triangles": int(sum(r["triangles"] for r in records)), "parts": records,
        "licence": meta["licence"], "credit": meta["credit"],
        **({"licenceNote": meta["licenceNote"]} if meta.get("licenceNote") else {}),
        "provenance": {"built": str(date.today()), **meta["provenance"]},
    }
    write_atomic(out / "catalog" / f"{meta['id']}.json", json.dumps(entry, indent=2).encode())
    print(f"{meta['id']}: {len(records)} parts, {entry['triangles']:,} triangles, "
          f"{glb_path.stat().st_size / 1e6:.2f} MB, size {entry['sizeM']} m")
    return entry
