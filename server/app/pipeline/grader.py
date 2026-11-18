"""The coder's grading loop (deepagents RubricMiddleware).

When the coder would finish, a grader agent checks the module against a learning-game rubric, with two tools that look
at the real thing in the run's sandbox (the play check, and the game's own code), and sends every failed criterion
back to the coder to revise. The gate and dry run check that a module runs; this checks that it teaches by play.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import shlex
from typing import Any, Callable

from deepagents import RubricMiddleware
from deepagents.middleware.rubric import GRADER_SYSTEM_PROMPT
from langchain.agents.middleware import ModelCallLimitMiddleware
from langchain_core.tools import tool

from app.pipeline.coder.middleware import CostMeterMiddleware, ToolImagesAsUserMessage

logger = logging.getLogger(__name__)

# Each revision is another coder run inside the same 15-minute sandbox, so two grader passes at most.
RUBRIC_ITERATIONS = 2
# A look at the game and the check take a few calls; trying moves in the app (game_state, a move, game_state) takes
# three more each, so 12 was too few.
GRADER_CALLS = 20
GRADER_BUDGET_USD = 0.5
CHECK = "node /skills/play/learning-game/scripts/check.mjs /work/module.js"
PLAYTEST = "node /skills/play/playtest/scripts/playtest.mjs /work/module.js"
# The headset app inside the sandbox, where `npx iwsdk` runs (server/sandbox/image.py XR_ROOT).
XR_ROOT = "/opt/xr"
# Runtime command groups the grader may use: playing and reading the scene, never starting or stopping the server.
# Not `ecs`: those commands read the host's world, and a game runs its own.
IWSDK_GROUPS = {"xr", "scene", "browser"}
STATE = "node /skills/play/playtest/scripts/playtest.mjs --state"

# The learning-game loop (agent_skills/play/learning-game) as checkable statements, plus the request's own idea.
RUBRIC = """- run_play_check prints "game ok" for /work/module.js.
- The game is about the request's own idea ({request}), and its goal says that idea in one sentence a player could repeat.
- The player does the main action with their hands on the scene (grab, steer by following the hand, slice, fold, pour, place), not only by pressing panel buttons, and the thing they act on is the biggest interactive object and stands out from the set.
- Every move has a why of one short line that says why it matters for the idea, in plain words a 10-year-old knows (no caveats, no jargon, no formulas without words).
- The challenge ends with a measured number that depends on the idea (not on clicking speed), with 1 to 3 stars and a Try again.
- The game has levels inside it (LEVELS, three or more, `levels` in the play block): each is the same round with one setting changed, a round that earns a star shows the level and a Next level button, Try again replays the same level, and the check's "levels:" line shows every level earning a star.
- Nothing scores, counts down or hurts before Start, and a wrong try costs nothing while learning.
- In the playtest screenshot, a first-time player knows within five seconds what to do: the panel's first line says the whole game in one sentence, there is one main action with one hand (at most two controls, no modes or bonus rules), and the scene itself shows the first move before the player tries.
- The game has its own look in the playtest screenshot: the panel wears a skin in colours that suit this game (kit.panel skin). The app shows the game's name as a title card when it opens, so no title sign stays in the scene.
- The panel stands beside the scene in reach, with at most about 8 parts and no text over two short sentences.
- The play block is honest: each gesture is what a first-time player's hand would do for that move or for the round (the same object, the same direction, about the same distance), none exists only to satisfy a counter, and no place, until or pose function changes the game."""

GRADER_PROMPT = GRADER_SYSTEM_PROMPT + """

You are grading a mixed-reality learning game the coder wrote at /work/module.js. Gather evidence with your tools
before you decide: playtest to see the game as a first-time player sees it in the real headset app (judge the
five-second criterion on that picture, not on the code), run_play_check for the gate, the dry run, the play rules
and the play-through (a simulated hand plays the game by its own play block: its "played through:" line gives the stars
and the result that play earned, and a "Play:" line says where a player would be stuck), and read_game_code for what
the game does (moves, whys, challenge, panel, hand wiring, the play block). When the plan was drawn
(plan_pictures returns pictures), put the playtest screenshot beside the first view and the built main thing beside
the sheet, and name what is missing or different. For every failed criterion, name the exact code (a line or a value)
and say what to change, so the coder can fix it in one pass.

play_in_app plays the game by its own play block in the real headset app, with the emulated hand: every move, Start and
one round, in one call. A move that registers in the gate's play-through and not in the app is a failure of the hand
wiring. For a closer look, after playtest: game_state, then iwsdk with `xr run-sequence` on the thing the game says to
touch first (its `center` is in the playtest report, or name it as the step's target), then game_state again. The piece
should have moved where the game says, and the values in `game` should change as the moves say. A game whose main action
does nothing when a hand does it fails, however it looks. A game whose `game` is null has no `play` block: say so."""


def rubric_for(request: str) -> str:
    """The rubric for one lesson or game: the learning-game loop, about this request's idea."""
    first = " ".join(str(request or "").split())[:300]
    return RUBRIC.format(request=first or "the request")


def grader_tools(backend: Any, kind: str = "lesson") -> list[Any]:
    """Tools that look at the module in the run's sandbox (the coder's backend)."""

    @tool
    async def playtest() -> list[dict[str, Any]]:
        """Open /work/module.js in the real headset app (Meta's IWSDK runtime, headless, emulated headset and hands)
        and return what the app found (hand targets, panel buttons, console errors) and a screenshot of what a
        first-time player sees."""
        result = await backend.aexecute(PLAYTEST + (" --game" if kind == "game" else ""), timeout=300)
        text = result.output or "no output"
        blocks: list[dict[str, Any]] = [{"type": "text", "text": text[-3000:]}]
        try:
            path = json.loads(text[text.index("{"):]).get("screenshot")
        except ValueError:
            path = None
        if path:
            downloaded = await backend.adownload_files([path])
            data = getattr(downloaded[0], "content", None) if downloaded else None
            if data:
                blocks.append({"type": "image", "base64": base64.b64encode(data).decode(), "mime_type": "image/png"})
        return blocks

    @tool
    async def run_play_check() -> str:
        """Run the learning-game check on /work/module.js: the app's gate and dry run, the hand and look rules, the
        play rules and the play-through. Prints FIX lines (must change), NOTE lines, and "game ok" when it passes."""
        result = await backend.aexecute(CHECK, timeout=120)
        return (result.output or "no output")[-4000:]

    @tool
    async def read_game_code(offset: int = 0) -> str:
        """Read the game's own code (/work/game.js, else /work/module.js, from `export default` on; the shared kits
        are not part of the game), 300 lines starting at line `offset` of that part."""
        start = max(0, int(offset)) + 1
        command = (f"f=/work/game.js; [ -f $f ] || f=/work/module.js; "
                   f"awk '/^export default function/{{f=1}} f' $f | sed -n '{start},{start + 299}p'")
        result = await backend.aexecute(command, timeout=60)
        return (result.output or "no game code found")[:30000]

    @tool
    async def plan_pictures() -> list[dict[str, Any]]:
        """The plan's reference pictures, when the design step drew them (/work/plan): first-view (what the player
        should see the moment the game opens) and hero (the main thing from the front, side and top)."""
        listing = await backend.aexecute("ls /work/plan 2>/dev/null", timeout=30)
        names = [n for n in (listing.output or "").split() if n.rsplit(".", 1)[-1].lower() in ("png", "jpg", "jpeg", "webp")]
        if not names:
            return [{"type": "text", "text": "No plan pictures for this game."}]
        downloaded = await backend.adownload_files([f"/work/plan/{n}" for n in names])
        blocks: list[dict[str, Any]] = []
        for name, file in zip(names, downloaded):
            data = getattr(file, "content", None)
            if data:
                ext = name.rsplit(".", 1)[-1].lower()
                blocks.append({"type": "text", "text": name})
                blocks.append({"type": "image", "base64": base64.b64encode(data).decode(), "mime_type": f"image/{'jpeg' if ext == 'jpg' else ext}"})
        return blocks or [{"type": "text", "text": "The plan pictures could not be read."}]

    @tool
    async def iwsdk(command: str) -> str:
        """Run one IWSDK runtime command on the game the last `playtest` opened, and return its output.
        Only the xr, scene and browser groups are allowed. Examples:
        `xr list-targets` (the things a hand can be sent to, by name);
        `xr run-sequence --input-json '{"device":"hand-right","steps":[{"label":"grab","target":"Coin 2","approach":{"distance":0.06},"pinch":{"value":1,"at":"arrival"}},{"label":"carry","position":{"x":0,"y":1.2,"z":-0.45}},{"label":"let go","pinch":0,"duration":0.15}]}'`
        (grab, carry and let go as a player would; a press is {"target": ..., "press": {}});
        a tipped hand (a jug pours) is a step with "orientation": {"fingers": [0, -0.7, -0.7], "palm": [0, -0.7, 0.7]}.
        Run `playtest` first: it starts the runtime and opens the game. Check what a move did with `game_state`."""
        try:
            parts = shlex.split(command)
        except ValueError as exc:
            return f"Could not read the command: {exc}"
        if parts and parts[0] == "iwsdk":
            parts = parts[1:]
        if not parts or parts[0] not in IWSDK_GROUPS:
            return "Only xr, scene and browser commands are allowed, e.g. `xr list-targets`."
        # shlex.join quotes every argument, so a command cannot add a second shell command.
        result = await backend.aexecute(f"cd {XR_ROOT} && npx iwsdk {shlex.join(parts)}", timeout=120)
        return (result.output or "no output")[-4000:]

    @tool
    async def game_state() -> str:
        """What the open game is doing now, as text: each piece the hands can pick up with its centre (metres) and
        whether it is held, what glows, how many presses the game answered, and `game`, the values its play block's
        state() reports. Call it before and after an `iwsdk` move to see what the move changed."""
        result = await backend.aexecute(STATE, timeout=90)
        return (result.output or "no output")[-4000:]

    @tool
    async def play_in_app() -> str:
        """Play /work/module.js by its own play block in the real headset app, with the emulated hand: every move,
        Start, then one round. Returns JSON: for each move whether it registered, whether Start began a round, how the
        round ended (phase, result, stars), and what went wrong."""
        result = await backend.aexecute(PLAYTEST + (" --game" if kind == "game" else "") + " --play", timeout=420)
        return (result.output or "no output")[-4000:]

    return [playtest, run_play_check, read_game_code, plan_pictures, iwsdk, game_state, play_in_app]


def enabled() -> bool:
    """CODER_RUBRIC=0 turns the grading loop off (to compare runs with and without it)."""
    return os.environ.get("CODER_RUBRIC", "1") != "0"


class BudgetAwareRubric(RubricMiddleware):
    """The grading loop, skipped once the coder's run has spent its budget: a revision then could not run anyway."""

    def __init__(self, *args: Any, budget_usd: float, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.budget_usd = budget_usd

    def _spent(self, state: Any) -> bool:
        return float((state or {}).get("cost_usd") or 0) >= self.budget_usd

    def after_agent(self, state: Any, runtime: Any) -> Any:
        return None if self._spent(state) else super().after_agent(state, runtime)

    async def aafter_agent(self, state: Any, runtime: Any) -> Any:
        return None if self._spent(state) else await super().aafter_agent(state, runtime)


def rubric_middleware(model: Any, backend: Any, kind: str = "lesson", on_evaluation: Callable[[dict[str, Any]], None] | None = None, *, budget_usd: float) -> RubricMiddleware:
    model_id = getattr(model, "model_name", None) or "unknown"
    return BudgetAwareRubric(
        budget_usd=budget_usd,
        model=model,
        system_prompt=GRADER_PROMPT,
        tools=grader_tools(backend, kind),
        grader_middleware=[
            ToolImagesAsUserMessage(),
            ModelCallLimitMiddleware(run_limit=GRADER_CALLS),
            CostMeterMiddleware(budget_usd=GRADER_BUDGET_USD, model_id=model_id, key="grader_cost_usd"),
        ],
        max_iterations=RUBRIC_ITERATIONS,
        on_evaluation=on_evaluation,
    )
