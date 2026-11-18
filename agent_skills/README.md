# Skills

What the coder agent knows: instructions, references, kits and scripts. Each skill is a folder with a `SKILL.md`
(its name and description, then the instructions) and `references/`, `assets/` and `scripts/` beside it. The sandbox
mounts this folder at `/skills`; the coder loads the skills its task needs
([`server/app/pipeline/coder/agent.py`](../server/app/pipeline/coder/agent.py)).

| Folder | Skill | What it is for |
|---|---|---|
| `play/` | `learning-game` | How every lesson, course level and game is built: one idea learned by doing it, the moves, the challenge. Its scripts start a game (`new-game.mjs`), check it (`check.mjs`, which also plays it through by its `play` block) and build the module. |
| | `playtest` | Play the module in the real headset app, run headless in the sandbox: look at the screenshots, read the game's state as text (`--state`), and play its own `play` block with the emulated hand (`--play`). `PLAYTEST_HEADED=1` shows the emulator's window when it runs on a desktop. |
| `looks/` | `circuit-city`, `exploded-view`, `ink-toon`, `low-poly`, `painted`, `paper-pop-up`, `soft-clay`, `voxel` | One visual style each, with its kit (`assets/`) and recipes. `looks/shared/` is their common code. |
| `game/` | `game-loop`, `hand-play`, `motion`, `tabletop-physics`, `board-rules` | Start, score and restart; the hands API; the motion kit (tested helpers for what is thrown, falls, bounces, glides, swings, balances or floats); balls, bounces and collisions; moves on a board. |
| `common/` | `kit`, `panels`, `sound`, `ecs`, `dry-run` | The paintbox (materials, shapes, cards), panels, sound and the sound library, the ECS kit, and the gate check. |
| `lesson/` | `lesson-craft`, `library-models` | Real proportions and detail for lesson models; using library models with `assets.get(id)`. |
| `model/` | `lesson-craft` | The model-maker subagent's own copy. |

A skill's scripts run inside the sandbox and find the gate and the headset app at `/opt/gate` and `/opt/xr`
(or `GATE_ENTRY`, `PLAYTEST_XR` and the like, to run them locally).

To add a look, copy one of `looks/*` and give it its own `SKILL.md` and kit, then list it where looks are chosen:
`play/learning-game/scripts/new-game.mjs` (its kit), `server/app/pipeline/design.py` (`LOOKS` and the pictures
prompt) and `server/app/services/courses.py` (`STYLES`).
