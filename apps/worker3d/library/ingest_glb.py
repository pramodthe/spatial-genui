"""Library asset from a finished GLB whose top-level objects are the parts (e.g. a model repaired in
Blender by bench3d:repair). Usage:
    python library/ingest_glb.py <model.glb> --like <catalog entry .json> --id <new id> --note "<what changed>" [--out data/library]

Each top-level node is one part, named after the node; its meshes keep their materials. A part whose
node carries motion custom properties (Blender: motion_type "rotate" | "slide", motion_axis [x, y, z]
in Blender's Z-up world frame, motion_range [from, to] in degrees or metres) becomes a moving part:
its node sits at the object's origin (the pivot), and the motion is converted to glTF's Y-up frame.
Title, concept, credit, licence and provenance come from the --like entry (the model before repair).

Trusted code: it reads model files (no code in them runs) and writes library files.
"""

from __future__ import annotations

import argparse
import json
import re
import struct
import sys
from pathlib import Path

import numpy as np
import trimesh

from common import write_asset

PALETTE = ["#e6194b", "#3cb44b", "#4363d8", "#ffe119", "#f58231", "#911eb4", "#42d4f4", "#f032e6", "#bfef45", "#fabed4"]


def gltf_json(glb: Path) -> dict:
    data = glb.read_bytes()
    length = struct.unpack_from("<I", data, 12)[0]
    return json.loads(data[20:20 + length])


def motion_of(extras: dict) -> dict | None:
    kind = extras.get("motion_type")
    if kind not in ("rotate", "slide"):
        return None
    x, y, z = (float(v) for v in extras.get("motion_axis", [0, 0, 1]))
    axis = np.array([x, z, -y])  # Blender Z-up to glTF Y-up
    axis = axis / (np.linalg.norm(axis) or 1)
    lo, hi = (float(v) for v in extras.get("motion_range", [0, 360 if kind == "rotate" else 0.05]))
    return {"type": kind, "axis": [round(float(v), 4) for v in axis], "range": [lo, hi], "unit": "degrees" if kind == "rotate" else "metres"}


def preview(entry: dict, out: Path, path: Path) -> None:
    """Each part of a written asset in its own flat colour (in catalogue order), to review it on a render."""
    scene = trimesh.load(out / entry["glb"], force="scene")
    parents = scene.graph.transforms.parents
    index = {p["node"]: i for i, p in enumerate(entry["parts"])}
    shown = trimesh.Scene()
    for node in scene.graph.nodes_geometry:
        top = node
        while parents.get(top) not in (None, scene.graph.base_frame):
            top = parents[top]
        transform, geometry = scene.graph[node]
        mesh = trimesh.Trimesh(scene.geometry[geometry].vertices, scene.geometry[geometry].faces, process=False)
        mesh.apply_transform(transform)
        rgb = [int(PALETTE[index.get(top, 0) % len(PALETTE)][j:j + 2], 16) for j in (1, 3, 5)]
        mesh.visual = trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(baseColorFactor=[*rgb, 255], doubleSided=True))
        shown.add_geometry(mesh, node_name=node)
    path.write_bytes(shown.export(file_type="glb"))


def ingest(glb: Path, like: dict, asset_id: str, note: str, out: Path) -> dict:
    doc = gltf_json(glb)
    roots = doc["scenes"][doc.get("scene", 0)]["nodes"]
    top_names = {doc["nodes"][i].get("name", f"node_{i}"): doc["nodes"][i] for i in roots}
    scene = trimesh.load(glb, force="scene")
    parents = scene.graph.transforms.parents

    def top_of(node: str) -> str:
        while parents.get(node) not in (None, scene.graph.base_frame):
            node = parents[node]
        return node

    pieces: dict[str, list[trimesh.Trimesh]] = {}
    for node in scene.graph.nodes_geometry:
        transform, geometry = scene.graph[node]
        mesh = scene.geometry[geometry].copy()
        mesh.apply_transform(transform)
        pieces.setdefault(top_of(node), []).append(mesh)
    parts = []
    for i, (node, meshes) in enumerate(pieces.items()):
        gltf_node = top_names.get(node, {})
        part = {"name": re.sub(r"[_.]+", " ", re.sub(r"\.\d+$", "", node)).strip().lower(), "meshes": meshes, "color": PALETTE[i % len(PALETTE)]}
        extras = gltf_node.get("extras", {})
        motion = motion_of(extras)
        if motion:
            part["pivot"] = scene.graph.get(node)[0][:3, 3].tolist()
            part["extra"] = {"motion": motion}
        if isinstance(extras.get("teeth"), (int, float)) and extras["teeth"] > 0:
            part.setdefault("extra", {})["teeth"] = int(extras["teeth"])
        parts.append(part)
    provenance = {k: v for k, v in like.get("provenance", {}).items() if k != "built"}
    provenance["notes"] = list(provenance.get("notes", [])) + [note]
    provenance["repairedFrom"] = like["id"]
    return write_asset(out, {
        "id": asset_id, "title": like["title"], "tier": like.get("tier", "D"), "kind": like.get("kind"), "concept": like["concept"],
        "detail": "repaired", "keywords": like.get("keywords", []), "credit": like["credit"], "licence": like["licence"],
        "provenance": provenance,
    }, parts)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("glb", type=Path)
    parser.add_argument("--like", type=Path, required=True)
    parser.add_argument("--id", required=True)
    parser.add_argument("--note", required=True)
    parser.add_argument("--out", type=Path, default=Path("data/library"))
    parser.add_argument("--preview", type=Path, help="also write each part in a flat colour (palette order) here")
    args = parser.parse_args()
    try:
        entry = ingest(args.glb, json.loads(args.like.read_text()), args.id, args.note, args.out)
        if args.preview:
            preview(entry, args.out, args.preview)
        print(json.dumps({"ok": True, "id": entry["id"], "parts": [p["name"] for p in entry["parts"]],
                          "colours": [PALETTE[i % len(PALETTE)] for i in range(len(entry["parts"]))],
                          "moving": [{"name": p["name"], **p["motion"]} for p in entry["parts"] if p.get("motion")]}))
    except Exception as err:
        print(json.dumps({"ok": False, "error": f"{type(err).__name__}: {err}"[:500]}))
        sys.exit(1)


if __name__ == "__main__":
    main()
