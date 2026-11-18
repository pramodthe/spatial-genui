"""Build the sound library: sounds every game can use by id, made once with the media provider (app/services/media.py) and
committed with the 3D models in server/library/sounds. Writes each sound and its record there, server/library/sounds/
catalog.json, and the table the agents read (agent_skills/common/sound/references/library.md). A name already in the
catalogue is kept, so running it again only makes what is new.

Usage (from server, with MEDIA_BASE_URL and MEDIA_API_KEY set): .venv/bin/python scripts/build_sound_library.py
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import media  # noqa: E402
from app.core.config import SKILLS_DIR  # noqa: E402

TABLE = SKILLS_DIR / "common" / "sound" / "references" / "library.md"

# name, kind, seconds, what it is (for the table), prompt
SOUNDS: list[tuple[str, str, int, str, str]] = [
    ("wood-knock", "effect", 1, "a knock on wood: a block set down, a door tap", "one dry knock of a knuckle on a wooden block, close, no room"),
    ("block-snap", "effect", 1, "a wooden piece clicking into place", "a small wooden building block snapping firmly into a slot, one crisp click"),
    ("stone-thud", "effect", 1, "a stone or heavy block set down", "a small stone set down on a wooden table, one soft heavy thud"),
    ("glass-clink", "effect", 1, "glass touching glass", "two small glass marbles clinking together once, bright"),
    ("metal-clang", "effect", 1, "a small metal hit", "a spoon tapping a small metal pot once, short ring"),
    ("paper-rustle", "effect", 1, "paper being folded or turned", "a sheet of paper folded and creased by hand, quick"),
    ("paper-throw", "effect", 1, "a paper plane or light thing thrown", "a paper airplane thrown, a quick airy swish"),
    ("splash-small", "effect", 1, "something small drops into water", "a pebble dropping into a bowl of water, one small splash"),
    ("splash-big", "effect", 2, "something big lands in water", "a large stone falling into a pond, a deep splash and ripple"),
    ("bubble-pop", "effect", 1, "a bubble popping", "one soap bubble popping, tiny and wet"),
    ("whoosh", "effect", 1, "something fast passing", "a quick airy whoosh of a ball flying past"),
    ("rope-creak", "effect", 1, "a rope or wood under strain", "a rope tightening on a wooden post, a short creak"),
    ("spring-boing", "effect", 1, "a spring or bounce", "a cartoon spring boing, short and playful"),
    ("ball-bounce", "effect", 1, "a ball bouncing once", "a rubber ball bouncing once on a wooden floor"),
    ("cloth-flutter", "effect", 2, "a kite, flag or sail in wind", "a kite's fabric fluttering and snapping in a gust of wind"),
    ("bird-chirp", "effect", 1, "a small bird", "one small songbird chirp, two quick notes, outdoors"),
    ("bat-chirp", "effect", 1, "a bat's echolocation call, slowed to be heard", "a single short high bat squeak, slowed down so it is audible, dry"),
    ("wing-flap", "effect", 1, "wings beating", "a small bird's wings flapping three times as it takes off"),
    ("coin", "effect", 1, "a reward: a coin or gem collected", "a bright coin pickup chime, two rising notes, video game"),
    ("chime-good", "effect", 1, "a right answer", "a warm bright bell chime for a correct answer, short"),
    ("knock-soft-miss", "effect", 1, "a gentle wrong answer", "a soft low wooden double knock for a gentle wrong answer"),
    ("footstep-grass", "effect", 1, "a step on grass", "two footsteps on soft grass"),
    ("cork-pop", "effect", 1, "a cork or a launch", "a cork popping out of a bottle, one pop"),
    ("cheer-small", "effect", 2, "a small crowd cheering", "a small happy group of kids cheering briefly"),
    ("wind-hill", "ambience", 10, "steady wind on an open hill", "steady gentle wind blowing over an open grassy hilltop, no music"),
    ("forest-birds", "ambience", 10, "a forest with birds", "a calm forest with distant birdsong and leaves rustling, no music"),
    ("river-flow", "ambience", 10, "a flowing river or stream", "a small river flowing over stones, steady water, no music"),
    ("cave-drips", "ambience", 10, "a cave with water drips", "a quiet echoing cave with slow water drips, no music"),
    ("night-crickets", "ambience", 10, "a night outdoors", "a calm summer night with crickets chirping, no music"),
    ("ocean-waves", "ambience", 10, "waves on a beach", "gentle ocean waves rolling onto a sandy beach, no music"),
]


def catalog_path() -> Path:
    return media.SOUND_LIBRARY / "catalog.json"


async def build(concurrency: int = 6) -> list[dict]:
    catalog = json.loads(catalog_path().read_text()) if catalog_path().exists() else []
    have = {entry["name"] for entry in catalog}
    gate = asyncio.Semaphore(concurrency)

    async def one(name: str, kind: str, seconds: int, what: str, prompt: str) -> dict | None:
        async with gate:
            try:
                record = await media.make_sound(prompt, seconds=seconds, loop=kind == "ambience", root=media.SOUND_LIBRARY,
                                                extra={"name": name, "library": True})
            except Exception as exc:
                print(f"  {name}: not made ({exc})", flush=True)
                return None
        print(f"  {name}: {record['id']} ({record['seconds']} s)", flush=True)
        return {"name": name, "id": record["id"], "kind": kind, "seconds": seconds, "what": what}

    made = await asyncio.gather(*(one(*sound) for sound in SOUNDS if sound[0] not in have))
    catalog += [entry for entry in made if entry]
    order = {sound[0]: i for i, sound in enumerate(SOUNDS)}
    catalog.sort(key=lambda entry: order.get(entry["name"], 999))
    catalog_path().write_text(json.dumps(catalog, indent=1))
    return catalog


def write_table(catalog: list[dict]) -> None:
    rows = [
        "# The sound library",
        "",
        "Sounds every game can use, by id, with no wait and no cost: `{ clip: 'snd-…', volume }` in SOUNDS, or",
        "`sound.clip(id, { volume, loop })` in code. Use one when it fits; make a sound with `make_sound` only for what",
        "the library does not have. An ambience loops: start it on Start with `{ clip: id, loop: true, volume: 0.2 }`.",
        "",
        "| Name | Id | Kind | Seconds | What it is |",
        "|---|---|---|---|---|",
        *[f"| {e['name']} | `{e['id']}` | {e['kind']} | {e['seconds']} | {e['what']} |" for e in catalog],
        "",
    ]
    TABLE.parent.mkdir(parents=True, exist_ok=True)
    TABLE.write_text("\n".join(rows))


if __name__ == "__main__":
    if not media.enabled():
        sys.exit("Set MEDIA_BASE_URL and MEDIA_API_KEY first.")
    built = asyncio.run(build())
    write_table(built)
    print(f"{len(built)} sounds in {catalog_path()}; table in {TABLE}")
