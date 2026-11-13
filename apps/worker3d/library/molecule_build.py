"""Ball-and-stick molecules from PubChem 3D conformers (tier B of docs/3d-architecture.md).

Usage: python library/molecule_build.py <name or CID> [--out data/library]
Prints one JSON line: {"ok": true, "id": "molecule-caffeine", ...} or {"ok": false, "error": "..."}.

Atom positions come from PubChem's computed 3D conformer (PUG REST); nothing about the geometry is
invented. Bond orders come from the same record. Trusted code: it runs on the server, not in the
sandbox, because it executes no model-written code (it only downloads data).
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
import trimesh

from common import write_asset

PUG = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"
# Jmol CPK colours (hydrogen darkened slightly so it shows on light backgrounds) and ball radii (angstrom).
ELEMENTS = {
    "H": ("hydrogen", "#e6e6e6", 0.25), "C": ("carbon", "#404040", 0.40), "N": ("nitrogen", "#3050f8", 0.38),
    "O": ("oxygen", "#ff0d0d", 0.37), "F": ("fluorine", "#90e050", 0.34), "Cl": ("chlorine", "#1ff01f", 0.45),
    "Br": ("bromine", "#a62929", 0.50), "I": ("iodine", "#940094", 0.55), "S": ("sulfur", "#ffff30", 0.50),
    "P": ("phosphorus", "#ff8000", 0.48), "Na": ("sodium", "#ab5cf2", 0.55), "K": ("potassium", "#8f40d4", 0.6),
    "Ca": ("calcium", "#3dff00", 0.55), "Mg": ("magnesium", "#8aff00", 0.5), "Fe": ("iron", "#e06633", 0.5),
}
BOND_RADIUS_A = 0.09
MAX_SIZE_M = 0.22  # the molecule's largest dimension on the desk
MAX_SCALE_M_PER_A = 0.06  # small molecules (water) don't get blown up past this
MAX_ATOM_PARTS = 40  # above this, atoms merge per element so draw calls stay low


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "spatial-genui/0.1 (education research)"})
    with urllib.request.urlopen(req, timeout=30) as res:
        return res.read()


def resolve(query: str) -> tuple[int, dict]:
    cid = int(query) if query.isdigit() else json.loads(fetch(f"{PUG}/compound/name/{urllib.parse.quote(query)}/cids/JSON"))["IdentifierList"]["CID"][0]
    props = json.loads(fetch(f"{PUG}/compound/cid/{cid}/property/Title,MolecularFormula,IUPACName/JSON"))["PropertyTable"]["Properties"][0]
    return cid, props


def parse_sdf(sdf: str) -> tuple[list[str], np.ndarray, list[tuple[int, int, int]]]:
    lines = sdf.splitlines()
    n_atoms, n_bonds = int(lines[3][0:3]), int(lines[3][3:6])
    symbols, coords = [], []
    for line in lines[4:4 + n_atoms]:
        coords.append([float(line[0:10]), float(line[10:20]), float(line[20:30])])
        symbols.append(line[31:34].strip())
    bonds = [(int(line[0:3]) - 1, int(line[3:6]) - 1, int(line[6:9])) for line in lines[4 + n_atoms:4 + n_atoms + n_bonds]]
    return symbols, np.asarray(coords), bonds


def orient(coords: np.ndarray) -> np.ndarray:
    """Principal axes: longest along x (left-right), next along y (up), flattest along z (toward the viewer)."""
    centered = coords - coords.mean(axis=0)
    _, _, axes = np.linalg.svd(centered, full_matrices=True)  # always 3 axes, even for 1- or 2-atom molecules
    if np.linalg.det(axes) < 0:
        axes[2] *= -1  # keep it a rotation, not a mirror image (chirality matters)
    return centered @ axes.T


def cylinder_between(a: np.ndarray, b: np.ndarray, radius: float) -> trimesh.Trimesh:
    return trimesh.creation.cylinder(radius=radius, segment=np.stack([a, b]), sections=12)


def build(query: str, out: Path) -> dict:
    cid, props = resolve(query)
    try:
        sdf = fetch(f"{PUG}/compound/cid/{cid}/record/SDF?record_type=3d").decode()
    except Exception as err:
        raise ValueError(f"PubChem has no 3D conformer for CID {cid} ({props.get('Title')}): {err}") from err
    symbols, coords, bonds = parse_sdf(sdf)
    coords = orient(coords)
    radii = np.array([ELEMENTS.get(s, (s.lower(), "#ff1493", 0.45))[2] for s in symbols])
    extent = float(np.max(coords.max(axis=0) - coords.min(axis=0)) + 2 * radii.max())
    scale = min(MAX_SIZE_M / extent, MAX_SCALE_M_PER_A)
    pos = coords * scale

    parts: list[dict] = []
    per_atom = len(symbols) <= MAX_ATOM_PARTS
    counts: dict[str, int] = {}
    by_element: dict[str, list[trimesh.Trimesh]] = {}
    for i, sym in enumerate(symbols):
        name, color, r = ELEMENTS.get(sym, (sym.lower(), "#ff1493", 0.45))
        ball = trimesh.creation.icosphere(subdivisions=2 if sym == "H" else 3, radius=r * scale)
        ball.apply_translation(pos[i])
        counts[sym] = counts.get(sym, 0) + 1
        if per_atom:
            parts.append({"name": f"{name} {counts[sym]}", "group": name, "color": color, "roughness": 0.35,
                          "mesh": ball, "extra": {"element": sym, "atomIndex": i + 1}})
        else:
            by_element.setdefault(sym, []).append(ball)
    for sym, balls in by_element.items():
        name, color, _r = ELEMENTS.get(sym, (sym.lower(), "#ff1493", 0.45))
        parts.append({"name": f"{name} atoms", "group": name, "color": color, "roughness": 0.35,
                      "mesh": trimesh.util.concatenate(balls), "extra": {"element": sym, "atoms": len(balls)}})

    sticks = []
    for a, b, order in bonds:
        pa, pb = pos[a], pos[b]
        axis = pb - pa
        # Offset direction for double/triple bonds: perpendicular to the bond, in the molecule's plane.
        side = np.cross(axis, [0, 0, 1])
        if np.linalg.norm(side) < 1e-9:
            side = np.cross(axis, [0, 1, 0])
        side = side / np.linalg.norm(side) * 0.13 * scale
        offsets = {1: [0], 2: [-0.5, 0.5], 3: [-1, 0, 1]}.get(order, [0])
        for k in offsets:
            sticks.append(cylinder_between(pa + side * k, pb + side * k, BOND_RADIUS_A * scale))
    if sticks:
        parts.append({"name": "bonds", "group": "bonds", "color": "#c9ced6", "roughness": 0.5, "mesh": trimesh.util.concatenate(sticks)})

    title = props.get("Title") or query
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:40] or str(cid)
    formula = props.get("MolecularFormula", "")
    entry = write_asset(out, {
        "id": f"molecule-{slug}", "title": f"{title} molecule ({formula}), ball-and-stick", "tier": "B", "kind": "chemistry",
        "concept": {"id": f"pubchem:{cid}", "name": title}, "detail": "ball-and-stick",
        "keywords": sorted({query.lower(), title.lower(), formula.lower(), (props.get("IUPACName") or "").lower()} - {""}),
        "credit": f"PubChem (NCBI/NLM), CID {cid}", "licence": "public domain data",
        "provenance": {"source": f"{PUG}/compound/cid/{cid}/record/SDF?record_type=3d", "formula": formula,
                       "iupacName": props.get("IUPACName"), "atoms": len(symbols), "bonds": len(bonds), "scaleMPerAngstrom": round(scale, 4),
                       "notes": ["Atom positions are PubChem's computed 3D conformer: one low-energy shape; real molecules flex and rotate about single bonds.",
                                 "Ball sizes are a fraction of each element's radius so bonds stay visible (ball-and-stick, not space-filling).",
                                 f"Scale: 1 angstrom (0.1 nm) is shown as {scale * 100:.1f} cm. Each molecule is sized to fit the desk on its own, so molecules shown together may be at different scales."]},
    }, parts)
    return entry


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("query")
    parser.add_argument("--out", type=Path, default=Path("data/library"))
    args = parser.parse_args()
    try:
        entry = build(args.query, args.out)
        print(json.dumps({"ok": True, "id": entry["id"], "title": entry["title"], "parts": len(entry["parts"])}))
    except Exception as err:
        print(json.dumps({"ok": False, "error": f"{type(err).__name__}: {err}"[:500]}))
        sys.exit(1)


if __name__ == "__main__":
    main()
