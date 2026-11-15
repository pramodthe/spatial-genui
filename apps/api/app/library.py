"""The 3D asset library. Same catalogue and prompt section as apps/gate/src/library.ts."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.clock import js_round, mtime_ms
from app.config import config

_cache: dict[str, Any] | None = None


def library_dir() -> Path:
    return config.library_dir


def library_catalog() -> dict[str, dict[str, Any]]:
    global _cache
    folder = library_dir() / "catalog"
    stamp = mtime_ms(folder) if folder.exists() else 0
    if _cache is not None and _cache["mtime"] == stamp:
        return _cache["entries"]
    entries: dict[str, dict[str, Any]] = {}
    if stamp:
        for path in sorted(folder.glob("*.json")):
            entry = json.loads(path.read_text(encoding="utf-8"))
            if (library_dir() / "assets" / f"{entry['id']}.glb").exists():
                entries[entry["id"]] = entry
    _cache = {"mtime": stamp, "entries": entries}
    return entries


def clear_catalog_cache() -> None:
    global _cache
    _cache = None


def asset_path(asset_id: str) -> Path | None:
    if not asset_id or not all(ch.islower() or ch.isdigit() or ch == "-" for ch in asset_id):
        return None
    if asset_id not in library_catalog():
        return None
    return library_dir() / "assets" / f"{asset_id}.glb"


def short_credit(entry: dict[str, Any]) -> str:
    return f"Model: {str(entry.get('credit') or '').split(',')[0]}, {entry.get('licence') or ''}"


def library_section(ids: list[str] | None = None) -> str:
    catalog = library_catalog()
    if ids is None:
        entries = list(catalog.values())
    else:
        entries = [catalog[asset_id] for asset_id in ids if asset_id in catalog]
    if not entries:
        return ""
    lines = []
    for entry in entries:
        size = " x ".join(str(js_round(metre * 100)) for metre in entry["sizeM"])
        notes = ((entry.get("provenance") or {}).get("notes")) or []
        moving = []
        for part in entry.get("parts") or []:
            motion = part.get("motion")
            if not motion:
                continue
            kind = "turns" if motion.get("type") == "rotate" else "slides"
            teeth = f", {part['teeth']} teeth" if part.get("teeth") else ""
            moving.append(f"{part['node']} ({kind}{teeth})")
        note = f" Notes: {' '.join(notes)}" if notes else ""
        move = f" Moving parts: {', '.join(moving)}." if moving else ""
        lines.append(f"- '{entry['id']}': {entry['title']}, {size} cm. Parts: {', '.join(part['node'] for part in entry['parts'])}.{move}{note}")
    several = ""
    if len(entries) > 1:
        several = (
            f"\nThis lesson has {len(entries)} models: get each one with its own call and its id written out "
            f"(`const second = assets.get('{entries[1]['id']}');`), never in a loop over ids, and set them side by side along x with a gap between them."
        )
    move_docs = ""
    if any(part.get("motion") for entry in entries for part in entry.get("parts") or []):
        move_docs = """
engine.move('piston', (1 - Math.cos(time * 2)) / 2); // moving parts only (listed above): 0..1 sweeps the motion; call it in update(time)
gears.move('drive_gear', time / 4);    // a turning part keeps turning as t grows past 1"""
    listed = "\n".join(lines)
    return f"""

## Accurate 3D models from the library
Use these models for the objects they show instead of building those from shapes: they come from real scan or measurement data, so they are scientifically accurate, and every part is a separate, named mesh. If a model's notes say it is not to scale, say so in the lesson. Everything else in the lesson (panels, extra shapes, effects) is yours to build with the kit.
{listed}{several}

How to use one (the id must be written as a string; the host loads the model before build() runs):
```js
const heart = assets.get('heart-bp3d');
root.add(heart.object3D);              // add it to root first; real size in metres, standing on y = 0, front facing the user (+Z)
heart.object3D.scale.setScalar(1.6);   // scale it 1.5-2x so its parts are easy to see and grab
heart.labelParts(['left_ventricle', 'aortic_valve']); // labels with leader lines, placed beside the model by the host so they never overlap
heart.label('mitral_valve', 'Mitral valve');           // one label, optional custom text; returns {{ object3D, set(text), setVisible(bool) }}
heart.explode(0.6);                    // 0 = assembled, 1 = parts spread apart; call it every frame in update() to animate
heart.cutaway(true);                   // slice away the half facing the user to show the inside (follows the model as it turns); cutaway(false) closes it
heart.xray(true, ['mitral_valve']);    // everything see-through except the listed parts; xray(false) makes it solid
heart.highlight('left_ventricle');     // make one part glow; highlight(null) clears it
heart.reset();                         // assembled, solid, no highlight, pulled-out parts back in place{move_docs}
traits(heart.part('aortic_valve'), {{ grab: true }}); // let the learner pull one part out by hand
heart.parts;                           // [{{ id, name, group, object3D, labelAnchor, explodeDir }}] for every part
heart.anchor('left_ventricle');        // THREE.Vector3 on the part's outside, in root's coordinates
heart.credit;                          // short attribution, e.g. "Model: BodyParts3D, CC BY 4.0"
```
Use these tools instead of building your own label panels or moving parts by hand: the host places labels and moves parts correctly. Layout: the model is already upright and facing the user, so keep it centred at x = 0 and don't rotate it. The host arranges a library lesson for you: labels go in two columns beside the model, your main panel (the one you place highest) goes centred above them, and any other panels stack beyond the labels on the side you put them. So keep it to one main panel with the lesson text and buttons, plus at most one side panel (e.g. a quiz). Wire them to panel buttons (e.g. "Explode", "Cut open", "X-ray", "Reset"). Show at most 6 labels at a time: label the parts of the current step and use setVisible() to swap labels as the learner moves through the lesson, so the model is never buried in labels. Put the asset's credit as the last line of your main panel."""
