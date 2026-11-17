"""Lesson and game prompts. SYSTEM_PROMPT is the benchmark's published text.

The long strings live in prompt_text.json; tests/test_prompts.py checks them against recorded fingerprints, so a
change to the published prompt fails a test. GAME_SYSTEM_PROMPT is built from SYSTEM_PROMPT by the same passage swaps.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

_TEXT = json.loads((Path(__file__).with_name("prompt_text.json")).read_text(encoding="utf-8"))

EXAMPLE_PATH = Path(__file__).resolve().parents[3] / "apps" / "gate" / "src" / "example-module.js"


def _example_module() -> str:
    # As the TS prompt module did: strip a leading run of // lines, then trim.
    text = EXAMPLE_PATH.read_text(encoding="utf-8")
    return re.sub(r"^(//.*\n)+", "", text).strip()


EXAMPLE_MODULE = _example_module()
SYSTEM_PROMPT: str = _TEXT["SYSTEM_PROMPT"]
REVIEW_MESSAGE: str = _TEXT["REVIEW_MESSAGE"]


def repair_message(error: str) -> str:
    return (
        "Your module failed the host checks:\n\n"
        f"{error}\n\n"
        "Fix the problem and reply with the complete corrected module in one ```js code block."
    )


def _swap(text: str, start: str, end: str, by: str) -> str:
    frm = text.find(start)
    to = -1 if frm < 0 else text.find(end, frm)
    if to < 0:
        raise RuntimeError(f'GAME_SYSTEM_PROMPT: the lesson prompt no longer contains "{start[:50]}"')
    return text[:frm] + by + text[to + len(end):]


_GAME_SWAPS: tuple[tuple[str, str, str], ...] = (
    (
        "A seated user asks for something",
        "even when the facts are right.",
        """A seated user asks for a game ("two player ping pong", "a tower defense game"). You write the complete,
playable game as JavaScript code. The app loads your code at runtime and the user plays it using only their
hands (pinch to grab, poke or pinch to press).
What you build stands on the user's real desk, fitted into a 0.5 m box: a tabletop game, like a beautifully
made miniature arcade or board game, with a small score panel beside it. It must be fun within seconds and
look finished. A few plain boxes and spheres in flat colors is a failure, even when the game works.""",
    ),
    (
        "real.size: the largest",
        "(the water cycle).",
        "Leave out real: a game is played at desk scale and has no real-size view.",
    ),
    (
        "Users judge the look first.",
        "on the main model.",
        "Users judge the look first. Spend most of your effort on the playfield and the pieces the player touches.",
    ),
    (
        "- Grabbable objects must be still",
        "start the motion with a button.",
        """- Play with the hands themselves, not by pinching objects. The player's tool follows a hand every frame
  with no pinch needed: a paddle, bat, net or cannon moves toward hands.right.tip (clamped to the playfield,
  smoothed with lerp), so the player just moves their hand. Hits are distances from a hand or its tool to
  the ball or target. A pinch (hands.right.pinched) fires, jumps, launches or places. Use both hands for two
  tools or two players (left hand = left player). Keep traits grab only for pieces the player picks up and
  puts down (a tower, a card). Fast movers (balls, enemies, shots) are never grabbable.
- When a hand is not tracked, its tool stays where it was; nothing breaks.""",
    ),
    (
        "# Quality",
        "so they can be identified.",
        """# The game
- One goal the player understands in five seconds. The panel's first line says how to play, in one sentence.
- The game loop runs in update(time, delta): movement, collisions (distances or simple boxes in root's space)
  and scoring. Multiply speeds by delta and clamp it (Math.min(delta, 0.05)) so a slow frame doesn't jump.
- It never stands still. Before Start it plays a demo of itself, like an arcade's attract mode: the runner
  runs and jumps the obstacles on its own, the invaders march, the ball rallies. Nothing scores or hurts until
  the player starts. Besides the panel's Start button, put a big pressable START piece on the playfield.
- Score, lives or time as a stat part, and a status line for what just happened ("Hit!", "Missed", "Wave 2").
  A round ends with a clear win or lose message and Play again; a restart is always one press away. It gets
  harder as the player does well.
- Playable by hand at this size: targets at least 0.03 m, the player's tools at least 0.06 m, no fast catches.
  Every hand action gets feedback in the same frame: a flash, a pop, a bounce, a glow.
- The panel is the game's HUD, not a lesson: no explanations, facts, rule essays or notes. The how-to-play
  line, the score and state, and one to three buttons (Start or Play again, Pause, perhaps a difficulty
  segmented control).
- The game gets no room depth or room meshes: it plays on the desk. Do not tell the player what the app lacks.
- Name important meshes and groups (object.name = 'Paddle') so they can be identified.""",
    ),
    (
        "- Never overlap:",
        "0.2 to 0.25 above the desk.",
        """- The panel is the game's scoreboard: stand it behind the playfield and raised, facing the player like an
  arcade marquee (position about [0, 0.3, -0.22], rotationY 0), never in front of the playfield. Keep labels
  off the playfield.""",
    ),
    (
        "export default function build({ THREE, kit, traits, ui, isGrabbed })",
        "export default function build({ THREE, kit, traits, ui, isGrabbed })",
        "export default function build({ THREE, kit, traits, ui, isGrabbed, hands })",
    ),
    (
        "- isGrabbed(object): true while",
        "Skip animating a held object.",
        """- isGrabbed(object): true while the user holds that object. Skip animating a held object.
- hands: the player's two hands, refreshed every frame before update(): hands.left and hands.right, each
  { tracked, tip, palm, pinching, pinched }. tip (index fingertip) and palm are THREE.Vector3 in root's
  coordinates, the units you build in; pinching is true while the hand pinches, pinched only on the frame a
  pinch starts. Read them inside update().""",
    ),
    ("# Example", "# Example", "# Example (a lesson: it shows the API, not what a game looks like)"),
)


def game_system_prompt(system: str = SYSTEM_PROMPT) -> str:
    text = system
    for start, end, by in _GAME_SWAPS:
        text = _swap(text, start, end, by)
    return text


GAME_SYSTEM_PROMPT = game_system_prompt()
