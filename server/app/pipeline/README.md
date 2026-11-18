# The pipeline

How a request becomes a lesson or a game that the headset can run. Each flow is a LangGraph graph whose state is
checkpointed (`CHECKPOINT_DB`), so a restart picks up where it stopped.

```
game:    design ──▶ write (lesson.py, kind "game")
lesson:  prepare ──▶ write ──▶ gate ──▶ done
                       ▲         │
                       └ repair ◀┘  (up to 2 repairs, each with the gate's error)
course:  plan ──▶ the first lesson; each later lesson is written when the one before it is opened
```

## Stages

| Module | Stage | In | Out |
|---|---|---|---|
| `design.py` | Design a game in one call: its title, the idea it teaches, the rules, the controls, and whether it plays on the desk or as a world. Then draw two planning pictures from it. | the request | the design (`DESIGN_KEYS`), the brief for the writer, and up to two pictures |
| `game.py` | The game graph: design, then write. Keeps the design and the pictures in the run's Studio record. | the request | the written game |
| `lesson.py` | The lesson graph: pick library models (`library/router.py`), write, check with the gate, repair. With pictures from the headset it revises a lesson once (look-and-fix). `mode="agent"` writes with the coder; `mode="classic"` with one call. | the request, or the code and pictures to revise | `{ok, code, attempts, ...}`, the JSON the headset reads |
| `course.py` | The course graph: plan the levels, then start the first lesson. | a course | the planned course |
| `coder/` | The coder agent (below). | the brief and the planning pictures | `/work/module.js` |
| `grader.py` | Grades the coder's game against a rubric for the request, comparing it with the planning pictures; it can send the game back once. | the sandbox | a verdict |
| `gate.py` | Runs the gate (`gate`): static checks, the sandboxed dry run, and the layout check. | the module | ok, or the error to repair |
| `prompts.py` | The system prompts for one-call writing. The published text is frozen in `prompt_text.json`; `tests/test_prompts.py` checks its fingerprints. | | |

## The coder

`coder/agent.py` runs a Deep Agent in a Modal sandbox (one per run, network blocked, no secrets). The sandbox image
(`server/sandbox/image.py`) holds the gate, the headset app, the [skills](../../../agent_skills) at `/skills` and the
model library at `/data/library`.

1. `new-game.mjs` starts the game: `/work/game.js` (the game's own code, the only file the agent edits) and
   `/work/kits.js` (the look's kit, the play kit and the ECS kit).
2. The agent reads the planning pictures in `/work/plan/` and builds to match them.
3. `check.mjs` builds `/work/module.js` from the two files and runs the gate and the learning-game rules.
4. `playtest.mjs` opens the module in the real headset app, run headless, and takes screenshots.
5. When the agent stops, the grader (`grader.py`) reviews the game, and the agent revises it if needed.
6. The final view is saved to the Studio, and the module is downloaded and checked again on the host.

Its limits: 40 model calls, 80 tool calls, 15 minutes (`AGENT_WALL_S`), and `CODER_BUDGET_USD` per attempt
(`coder/middleware.py`). Its tools: library lookup and real size (`coder/tools.py`), sounds and music
(`coder/sound_tools.py`), and the model-maker subagent for one realistic object (`coder/model_maker.py`).

## Where things are kept

- The Studio (`services/studio.py`, at `/studio`): each run's design, plan, parts, play-test screenshots, the
  grader's verdicts and its media.
- Generated media (`services/media.py`): the planning pictures and sounds, under `data/media`.
- Saved courses and games (`core/db.py`): SQLite at `APP_DB`.
