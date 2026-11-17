# Spatial GenUI

Hands-on learning games, generated live for mixed reality on Meta Quest.

Ask for a subject or a game, by voice or by typing, and an AI agent designs and writes it while you wait. You
play it with your hands, on your real desk or as a place you walk around. Every lesson, course level and game
teaches one real idea by doing it: folding a paper plane that flies farther, building a dam that holds deeper
water, tilting a kite into the wind. The agent writes each one as code at runtime; a checker tests it before the
headset loads it.

Built for the Meta VR Start Developer Competition 2026 ([docs/competition.md](docs/competition.md)).

## Features

- **Play.** Ask for any game and get one that teaches by playing. Desk games are toy-sized on your real desk in
  passthrough; world games are a place you stand in and walk around. Four ready-made games open at once.
- **Learn.** A subject becomes a course of 3 to 5 hands-on levels, written in the background and saved, so you
  can leave and come back. Lessons can use accurate 3D models from the library (a heart, a microscope, planets,
  molecules), with named parts you can pick up and take apart.
- **Voice tutor.** A spoken conversation (Deepgram Voice Agent) that answers questions about what is on the
  desk, tests you aloud when you ask, and can plan a course or open a lesson.
- **Look-and-fix.** The first time a course lesson opens, the headset sends three pictures of it to the agent,
  which revises it once from what it sees.
- **Hands-first.** Pinch, poke and grab. Lessons and games move, turn and scale by handles on their frame; the
  game's own code reads the live hands.
- **Studio.** Every game run is kept at `/studio`: the design, the planning pictures, the coder's steps,
  play-test screenshots and the grader's verdicts.

## How a game is made

```
request ─▶ design ─────────────▶ coder ──────────────────────────────▶ gate ──────────▶ headset
           one model call:        a Deep Agent in a Modal sandbox:       static check,     mounts the
           the rules, the idea,   writes game.js with the skills,        locked-down dry   module and
           desk or world, and     checks it, play-tests it in the        run and layout    shows its
           two planning pictures  headless headset app; a grader         check, on the     name as a
                                  sends it back once if it falls short   host              title card
```

| Stage | Code | What it does |
|---|---|---|
| Design | [`apps/api/app/pipeline/design.py`](apps/api/app/pipeline/design.py) | One call designs the game; two reference pictures (the first view, and a front/side/top sheet of the main thing) guide the coder and are never shown in the game. |
| Code | [`apps/api/app/pipeline/coder/`](apps/api/app/pipeline/coder) | The coder agent edits `/work/game.js` with the [skills](skills), runs the check, and play-tests the game in the real headset app run headless in its sandbox. |
| Grade | [`apps/api/app/pipeline/grader.py`](apps/api/app/pipeline/grader.py) | Grades the game against a rubric made for the request and the planning pictures. |
| Check | [`apps/gate`](apps/gate) | Static validation, a dry run with the headset's own three.js and kit, and a layout check (nothing hidden, out of reach, or in the player's face). |

Lessons follow the same path: the router picks library models, then the writer, the gate and repairs
([`apps/api/app/pipeline/lesson.py`](apps/api/app/pipeline/lesson.py)). See
[`apps/api/app/pipeline/README.md`](apps/api/app/pipeline/README.md) for the details.

## Repository layout

```
apps/
  xr/          the headset app: WebXR on Meta's IWSDK. Start page, picker, voice tutor, and the GenUI host that
               mounts generated modules (src/genui/)
  api/         the server (Python, FastAPI, LangGraph, Deep Agents)
    app/core/       settings, database, model calls, spending limits
    app/pipeline/   design, the coder agent, the grader, the lesson, game and course graphs
    app/library/    the 3D model library: catalogue, model routing, real sizes
    app/services/   courses, saved games, live previews, voice, generated media, the Studio
  gate/        the module checker (TypeScript): validation, sandboxed dry run, layout check, the kit
skills/        the agent's skills: the learning game, looks, game patterns, sound, panels (mounted at /skills)
data/library/  the 3D model library and the sound library (credits in data/library/CREDITS.md)
bench/         benchmark prompts and results
docs/          the project spec, the competition brief, related work
```

## Getting started

Requirements: Node 22.12+, Python 3.12 with [uv](https://docs.astral.sh/uv/), a [Modal](https://modal.com)
account (the coder's sandbox), and an OpenAI-compatible API key.

```bash
cp .env.example .env                  # then fill in LLM_API_KEY and the keys you use (see Configuration)
cd apps/api && uv sync && uv run modal setup
cd ../gate && npm install
cd ../xr && npm install
```

Run the server and the headset app:

```bash
# Terminal 1: the API on :8787
cd apps/api && uv run uvicorn app.main:app --host 0.0.0.0 --port 8787

# Terminal 2: the headset app and the emulator browser on https://localhost:8081
cd apps/xr && npm run dev
```

On a Quest, connect it by USB, run `adb reverse tcp:8081 tcp:8081` and open `https://localhost:8081` in the
headset browser (accept the local certificate warning). On the start page, tap **Allow microphone** first, then
**Enter mixed reality**.

## Tests

```bash
cd apps/api && uv run pytest                      # the server, the pipeline and the skills' scripts
cd apps/gate && npm test && npm run typecheck     # the checker
cd apps/xr && npm run typecheck && npm run build  # the headset app
```

The headset app's smoke tests run in the IWSDK emulator while the dev server is up, for example
`cd apps/xr && npx @iwsdk/cli browser run tests/hands-smoke.mjs`.

## Configuration

Settings come from `.env` at the repo root ([`.env.example`](.env.example)).

| Setting | Default | What it does |
|---|---|---|
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | OpenAI, `gpt-6.1-sol` | The model for design, coding and lessons. Any OpenAI-compatible endpoint; models and prices are in [`apps/api/models.json`](apps/api/models.json). |
| `META_API_KEY` | | Meta's Muse models, and speech to text when there is no Deepgram key. |
| `DEEPGRAM_API_KEY` | | The voice tutor. |
| `MEDIA_BASE_URL`, `MEDIA_API_KEY` | | Planning pictures and generated sounds. Without them, games use the sound library and no pictures. |
| `PLAN_PICTURES` | on | `0` turns the planning pictures off. |
| `CODER_BUDGET_USD` | 3 | The most one coder attempt may spend. |
| `DAILY_BUDGET_USD`, `RATE_LIMIT_PER_10_MIN` | 15, 6 | Per-day spending cap and per-visitor rate limit. |
| `COURSE_PLANNER`, `MODERATION_MODEL` | `LLM_MODEL` | The course planner's and the request screen's model. |

## Results

[`bench/results/play-factors`](bench/results/play-factors) measures what made the games good: 35 games from 11
setups, judged blind from the same opening view, with a layout check and a hands probe. The model was the largest
factor, then the pipeline and the layout checker; the games built with planning pictures were the ones preferred in
headset play. Earlier results (model comparisons, 3D pipelines, the paper's research questions) are in
[`bench/`](bench).

## Documentation

- [docs/spec.md](docs/spec.md): the project spec and its phases
- [docs/paper/prior-art.md](docs/paper/prior-art.md): related work
- [apps/api/app/pipeline/README.md](apps/api/app/pipeline/README.md): how lessons and games are made
- [skills/README.md](skills/README.md): the agent's skills
- [apps/gate/README.md](apps/gate/README.md): what the checker tests
