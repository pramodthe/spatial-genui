# Spatial Generative UI (Meta VR Start Developer Competition 2026)

Ask for any subject, by voice or by typing, and an AI agent builds a hands-on course in mixed reality on
Meta Quest. Each lesson is a 3D model on your desk that you pick up, turn and take apart with your hands,
with a panel to step through it. The agent writes every lesson as code at runtime, and a small host runs it
in a WebXR passthrough scene. See `SPEC.md` for the plan and results, and `docs/paper/prior-art.md` for
related work.

## What it does

- **Courses.** A subject becomes a planned course of three or four hands-on lessons. Lessons are written in
  the background and saved, so you can leave and come back.
- **A 3D model per course.** A course about one physical object first gets its own model: a reference
  picture (Muse Image, checked by Muse Ember), a textured body from TRELLIS.2, then an agent in Blender
  (Muse Spark) cuts it into named parts that lessons can move, highlight and pull apart. Models are kept and
  reused; the library is in `data/library/` (credits in `data/library/CREDITS.md`).
- **Voice tutor.** A spoken conversation through Deepgram's Voice Agent API. It answers questions about the
  subject and the lesson on the desk, quizzes you aloud when you ask, and can plan a course or open a lesson.
- **Look-and-fix.** The first time a course lesson opens, the headset sends three pictures of it to the
  agent, which revises it once from what it sees.
- **Hands-first.** Pinch or poke panels, pick up parts, drag a lesson or the picker by its move bar. Every
  panel is built from one set of parts in the style of the Meta Horizon OS UI Set (`kit.panel`).

## How it works

```
headset browser (apps/xr)                agent server (apps/server)               3D backend (apps/worker3d, Modal)
start page, picker, voice tutor  --->   courses (SQLite), lesson agent,     --->  TRELLIS.2, Blender sandbox,
GenUI host: runs lesson modules         safety check, dry run, repair,            P3-SAM parts
                                        model library, Deepgram tokens
```

The lesson agent and the course planner use OpenAI `gpt-6.1-sol` (any OpenAI-compatible endpoint works; the
benchmark compares others). Generated code is checked statically and in a sandboxed dry run before it reaches
the headset, and failures go back to the agent for repair.

## Layout

```
apps/server/   agent server: LLM client, courses and database, safety check, dry run, repair loop, voice
apps/xr/       IWSDK WebXR app: GenUI host and in-headset UI (src/genui/), start page, test scripts (tests/)
apps/worker3d/ Python 3D backend: Blender agent (blender_build/), TRELLIS.2, part segmentation, Modal apps
data/library/  the 3D model library (in git); the rest of data/ is local only (downloads, work files, app.db)
bench/         benchmark prompts, model catalogue (models.json) and results
docs/          architecture notes and the paper's related work
```

## Setup

1. Node 22.12+ and, for 3D models, Python 3.12 with [uv](https://docs.astral.sh/uv/).
2. Copy `.env.example` to `.env` and fill in:
   - `LLM_API_KEY` (and `OPENAI_API_KEY`): the lesson agent, course planner and screener (OpenAI by default).
   - `DEEPGRAM_API_KEY`: the voice tutor.
   - `META_API_KEY`: reference pictures, checks and the Blender agent for course models, and the voice
     fallback when there is no Deepgram key.
3. `cd apps/server && npm install`, `cd apps/xr && npm install`, and for 3D models `cd apps/worker3d && uv sync`.
4. For course models, deploy the Modal apps once (`uv run modal setup` first):
   `modal deploy modal_trellis.py`, `modal deploy blender_build/sandbox.py` and `modal deploy modal_parts.py`
   from `apps/worker3d` (TRELLIS.2 and P3-SAM need the Modal secret `genui-hf-v2` with `HF_TOKEN`).
   Without them, courses are written with drawn shapes (`COURSE_MODELS=0` turns model building off).

## Run

```bash
# Terminal 1: agent server on :8787 (restarts on code changes; restart it by hand after editing .env)
cd apps/server && npm run dev

# Terminal 2: IWSDK dev server and emulator browser on https://localhost:8081
cd apps/xr && npx @iwsdk/cli dev up --allow-browser-automation
```

On a desktop, the start page lets you ask for a course, preview lessons and enter the emulator's XR.

**On a Quest:** open the `network` URL from `npx @iwsdk/cli dev status` (same Wi-Fi; accept the local
certificate warning), or connect it by USB and run `adb reverse tcp:8081 tcp:8081`, then open
`https://localhost:8081`. On the start page, tap **Allow microphone** first (the headset cannot ask for it
inside XR), then **Enter mixed reality**. In XR, pinch **Talk to the tutor**, a lesson tile, or a course.

## Useful commands

```bash
# Write one lesson from the command line; every run is logged to apps/server/runs/
cd apps/server && npm run gen -- "how blood flows through the human heart"

# Look-and-fix by hand: revise a lesson from pictures of it
npm run review -- --code lesson.js --prompt "..." --out revised.js pic1.jpg pic2.jpg

# Mount the latest successful run in the emulator
cd apps/xr && npx @iwsdk/cli browser run tests/mount-last-run.mjs

# Grab a generated object with an emulated hand
npx @iwsdk/cli xr set-input-mode --input-json '{"mode":"hand"}'
npx @iwsdk/cli xr run-sequence --input-json '{"device":"hand-right","steps":[{"pinch":0,"duration":0.2},{"target":"Mars","approach":{"distance":0.1},"pinch":{"value":1,"at":"arrival"}}]}'
```

## Benchmark (Phase 2)

**See the results: [which model built what](bench/results/run-1/gallery.md)** (Claude Sonnet 5.5, Meta Muse Spark 1.3
and DeepSeek V4.1 Flash on 12 requests, side by side, with scores) · [numbers](bench/results/run-1/summary.md)

Compares models on the same agent loop. Candidates are in `bench/models.json`; the held-out test prompts
in `bench/prompts/test-12.json` (the dev prompts were used to tune the system prompt, so they are not used
for scoring). Add `OPENROUTER_API_KEY` to `.env` for non-Anthropic models.

```bash
cd apps/server
npm run bench -- --runs 2 --out ../../bench/results/run-1          # 1. generate (resumable)
cd ../xr && npx @iwsdk/cli xr enter                                 # 2. mount + hand probes in the emulator
node scripts/bench-browser.mjs "$PWD/../../bench/results/run-1"
cd ../server && npm run bench:judge -- ../../bench/results/run-1    # 3. vision-model quality scores
npm run bench:report -- ../../bench/results/run-1                   # 4. summary.md leaderboard
npm run bench:gallery -- ../../bench/results/run-1 --export-images # 5. gallery.md (GitHub) + gallery.html
```

Metrics: pass@1 (valid first try, comparable to XR Blocks), success with ≤2 repairs, clean mount in the
emulator, grab works and press works (emulated hand), quality 1–5 from a cross-provider judge panel
(also reported with same-provider judges excluded), latency, output tokens and estimated cost.

The benchmark used Claude Sonnet 5.5 as the app's model at the time; the app now uses OpenAI `gpt-6.1-sol`
(see `SPEC.md`).

## 3D generation (Phase 3)

**See the results: [every object from every pipeline](bench/results/3d-run-1/gallery.md)** · [numbers](bench/results/3d-run-1/summary.md)

Three ways for the agent to build a 3D learning object with named parts, compared on 12 objects: **P1** writes
Three.js code (runs in the browser), **P2** writes a CadQuery (Python CAD) script, **P3** is an agent with Blender
tools served by a Blender MCP server. Add-ons: a reference image from Muse Image (M1) and a vision critic that
reviews four rendered views and asks for fixes (M2). Every GLB is rendered the same way and judged by Opus 5.5.

Agent-written Python runs on the 3D backend in `apps/worker3d/`: on Modal, each CadQuery script and each Blender
session gets its own Modal Sandbox (network blocked, no secrets); without `WORKER3D_URL` the same workers run
locally under a macOS sandbox profile.

```bash
cd apps/worker3d && uv sync                                          # Python 3.12 env with CadQuery, MCP, Modal
uv run modal setup                                                   # log in to Modal (once per machine)
uv run modal secret create genui-worker3d WORKER3D_TOKEN=<from .env> # once per Modal workspace
uv run modal deploy modal_app.py                                     # then set WORKER3D_URL in .env
cd ../server
npm run bench3d -- --out ../../bench/results/3d-run-2                # build: 12 objects x 3 pipelines x 2 variants
npm run bench3d:judge -- ../../bench/results/3d-run-2                # Opus 5.5 scores the renders
npm run bench3d:report -- ../../bench/results/3d-run-2               # summary.md + gallery
```

Local runs need Blender at `/Applications/Blender.app` (or `BLENDER_BIN`). `--backend local|modal` overrides the default.
