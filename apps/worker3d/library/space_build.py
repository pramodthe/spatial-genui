"""Space assets built from NASA data (tier B of docs/3d-architecture.md: authoritative numbers + code).

Usage: python library/space_build.py [--out data/library]

Numbers come from NASA's Planetary Fact Sheets (NSSDCA, nssdc.gsfc.nasa.gov/planetary/factsheet),
checked on 2026-11-13. Whatever a model compresses or enlarges to fit a desk is recorded in its
provenance notes, so lessons can say "not to scale" where it isn't.
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import numpy as np
import trimesh
from trimesh.transformations import rotation_matrix

from common import write_asset

# NASA Planetary Fact Sheet: diameter (km), distance from Sun (10^6 km), obliquity to orbit (deg).
PLANETS = [
    ("Mercury", 4879, 57.9, 0.034, "#8a8784"),
    ("Venus", 12104, 108.2, 177.4, "#d6a957"),
    ("Earth", 12756, 149.6, 23.4, "#2667d4"),
    ("Mars", 6792, 228.0, 25.2, "#b23f1c"),
    ("Jupiter", 142984, 778.5, 3.1, "#b07a4a"),
    ("Saturn", 120536, 1432.0, 26.7, "#cfaa5e"),
    ("Uranus", 51118, 2867.0, 97.8, "#5fbccd"),
    ("Neptune", 49528, 4515.0, 28.3, "#2747b8"),
]
SUN_RADIUS_KM = 695_700  # Sun fact sheet, volumetric mean radius
# Saturn: equatorial and polar radius (km), main rings (inner, outer km), Titan (radius km, orbit km).
SATURN_EQ_KM, SATURN_POLAR_KM = 60_268, 54_364
RINGS = [("C ring", 74_658, 91_975, "#8d7b66"), ("B ring", 91_975, 117_507, "#e6d6b3"), ("A ring", 122_340, 136_780, "#c9b897")]
TITAN_RADIUS_KM, TITAN_ORBIT_KM = 2_575, 1_221_870

SOURCE = "NASA Planetary Fact Sheets (NSSDCA): planets, Sun, Saturn's rings, Saturnian satellites"
CREDIT = "NASA Planetary Fact Sheets (NSSDCA)"
LICENCE = "public domain data"


def sphere(radius: float, detail: int = 32) -> trimesh.Trimesh:
    return trimesh.creation.uv_sphere(radius=radius, count=[detail, max(8, detail // 2)])


def ring(inner: float, outer: float) -> trimesh.Trimesh:
    """A flat, slightly thick ring in the x/z plane (y up)."""
    mesh = trimesh.creation.annulus(r_min=inner, r_max=outer, height=max(outer * 0.004, 0.0005), sections=128)
    mesh.apply_transform(rotation_matrix(math.pi / 2, [1, 0, 0]))  # annulus is built around z; lay it flat
    return mesh


def tilt(mesh: trimesh.Trimesh, degrees: float) -> trimesh.Trimesh:
    """Axial tilt toward the viewer (about x), so a tilted ring plane is visible from the front."""
    mesh.apply_transform(rotation_matrix(math.radians(degrees), [1, 0, 0]))
    return mesh


def saturn(out: Path) -> None:
    radius_m = 0.06
    s = radius_m / SATURN_EQ_KM
    planet = sphere(radius_m, 48)
    planet.apply_scale([1, SATURN_POLAR_KM / SATURN_EQ_KM, 1])  # Saturn is visibly flattened at the poles
    parts = [{"name": "Saturn", "group": "planet", "color": "#cfaa5e", "mesh": tilt(planet, 26.7)}]
    for name, inner, outer, color in RINGS:
        parts.append({"name": name, "group": "rings", "color": color, "roughness": 0.8, "sharp": True, "mesh": tilt(ring(inner * s, outer * s), 26.7)})
    titan_m = TITAN_RADIUS_KM * s * 2.5  # enlarged 2.5x so it can be seen and grabbed
    titan = sphere(titan_m, 24)
    titan.apply_translation([0.24, 0, 0])  # true distance would be 1.22 m at this scale
    parts.append({"name": "Titan", "group": "moon", "color": "#d9a54a", "mesh": titan})
    write_asset(out, {
        "id": "saturn-nasa", "title": "Saturn with its main rings and Titan", "tier": "B", "kind": "astronomy",
        "concept": {"id": "Q193", "name": "Saturn"}, "detail": "planet-rings-largest-moon",
        "keywords": ["saturn", "rings", "ring system", "cassini division", "titan", "gas giant"],
        "credit": CREDIT, "licence": LICENCE,
        "provenance": {"source": SOURCE, "notes": [
            "Saturn and its rings are to scale with each other (equatorial radius 60,268 km shown as 6 cm), including the polar flattening (54,364 km) and the 26.7 degree axial tilt.",
            "Ring edges: C 74,658-91,975 km, B 91,975-117,507 km, A 122,340-136,780 km; the gap between B and A is the Cassini Division.",
            "Titan is enlarged 2.5x and placed 24 cm away instead of its true 1.22 m at this scale.",
        ]},
    }, parts)


def planets_to_scale(out: Path) -> None:
    earth_radius_m = 0.006
    s = earth_radius_m / (12756 / 2)
    parts, x = [], 0.0
    jupiter_r = 142984 / 2 * s
    gap = 0.02
    for name, diameter, _dist, obliquity, color in PLANETS:
        r = diameter / 2 * s
        reach = r * (136_780 / SATURN_EQ_KM if name == "Saturn" else 1)  # Saturn's rings stick out
        x += reach
        body = sphere(r, 48 if r > 0.02 else 24)
        if name == "Saturn":
            body.apply_scale([1, SATURN_POLAR_KM / SATURN_EQ_KM, 1])
        body = tilt(body, obliquity)
        body.apply_translation([x, jupiter_r, 0])
        parts.append({"name": name, "group": "planets", "color": color, "mesh": body})
        if name == "Saturn":
            rings = trimesh.util.concatenate([ring(inner * s, outer * s) for _, inner, outer, _c in RINGS])
            rings = tilt(rings, obliquity)
            rings.apply_translation([x, jupiter_r, 0])
            parts.append({"name": "Saturn's rings", "group": "rings", "color": "#d8c7a2", "roughness": 0.8, "sharp": True, "mesh": rings})
        x += reach + gap
    write_asset(out, {
        "id": "planets-to-scale", "title": "The eight planets at their true relative sizes", "tier": "B", "kind": "astronomy",
        "concept": {"id": "Q634", "name": "planets of the Solar System"}, "detail": "relative-sizes",
        "keywords": ["planets", "planet sizes", "compare planets", "how big", "relative size", "mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"],
        "credit": CREDIT, "licence": LICENCE,
        "provenance": {"source": SOURCE, "notes": [
            "Planet diameters are to scale with each other (Earth's 12,756 km shown as 1.2 cm); axial tilts are true (Uranus lies on its side at 97.8 degrees, Venus is upside down at 177.4 degrees).",
            "Distances are not to scale: the planets sit in a row in order from the Sun. The Sun is left out; at this scale it would be 1.31 m across.",
        ]},
    }, parts)


def solar_system(out: Path) -> None:
    max_orbit = 0.3  # Neptune's orbit radius on the desk
    max_dist = max(p[2] for p in PLANETS)
    jupiter_d = max(p[1] for p in PLANETS)
    parts = [{"name": "Sun", "group": "star", "color": "#ffa31a", "glow": 0.8, "mesh": sphere(0.035, 48)}]
    for i, (name, diameter, dist, obliquity, color) in enumerate(PLANETS):
        orbit = max_orbit * math.sqrt(dist / max_dist)  # square-root spacing keeps the inner planets apart
        r = 0.016 * math.sqrt(diameter / jupiter_d)  # square-root sizes keep the small planets visible
        angle = math.radians(35 + i * 47)  # spread around the Sun instead of lined up
        body = tilt(sphere(r, 32), obliquity)
        body.apply_translation([orbit * math.cos(angle), 0.04, orbit * math.sin(angle)])
        parts.append({"name": name, "group": "planets", "color": color, "mesh": body})
        if name == "Saturn":
            rings = tilt(ring(r * 74_658 / SATURN_EQ_KM, r * 136_780 / SATURN_EQ_KM), obliquity)
            rings.apply_translation([orbit * math.cos(angle), 0.04, orbit * math.sin(angle)])
            parts.append({"name": "Saturn's rings", "group": "rings", "color": "#d8c7a2", "roughness": 0.8, "sharp": True, "mesh": rings})
        path = trimesh.creation.torus(major_radius=orbit, minor_radius=0.0012, major_sections=160, minor_sections=6)
        path.apply_transform(rotation_matrix(math.pi / 2, [1, 0, 0]))
        path.apply_translation([0, 0.04, 0])
        parts.append({"name": f"orbit of {name}", "group": "orbits", "color": "#aab4c2", "roughness": 0.9, "mesh": path})
    parts[0]["mesh"].apply_translation([0, 0.04, 0])
    write_asset(out, {
        "id": "solar-system", "title": "The Solar System: the Sun, eight planets and their orbits", "tier": "B", "kind": "astronomy",
        "concept": {"id": "Q544", "name": "Solar System"}, "detail": "orbits-compressed",
        "keywords": ["solar system", "planets", "sun", "orbits", "order of the planets", "inner planets", "outer planets"],
        "credit": CREDIT, "licence": LICENCE,
        "provenance": {"source": SOURCE, "notes": [
            "Not to scale. Orbit radii follow the square root of the true distances (Neptune at 30 cm), and planet sizes follow the square root of the true diameters, so the order and the rough proportions are right but small planets stay visible.",
            "The Sun is shown much smaller than it would be at any planet scale. Orbits are drawn as circles in one plane; real orbits are slightly elliptical and tilted.",
            "Axial tilts are true, so Uranus and Saturn's rings are tipped as in reality.",
        ]},
    }, parts)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=Path("data/library"))
    args = parser.parse_args()
    saturn(args.out)
    planets_to_scale(args.out)
    solar_system(args.out)


if __name__ == "__main__":
    main()
