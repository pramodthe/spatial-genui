# Migrating the backend to Python: Deep Agents on LangGraph

Status: planned (Nov 15, 2026), revised after reading the 36 Python Deep Agents pages in full (raw Markdown from
docs.langchain.com, Nov 15). Nothing below is started. Tick boxes as work lands. `(doc: file.md)` points at the page a
fact comes from; **[verify]** marks something the Deep Agents docs do not cover and that needs checking elsewhere before
it is built.

## For the implementing agent (read this first)

This file is the whole brief. Work through the phases in order; do not start a phase before the previous one's checks
pass. Tick a box only when its check has actually run and passed, and write the result (numbers, file paths) next
to it. If something marked **[verify]** turns out different from what is written here, change this file first, then
build.

**Rules**

- Do not commit, push or open PRs unless the user asks. Work on a new branch off `feat/play-section`
  (e.g. `feat/python-api`).
- Do not change `apps/xr` except the `/api` proxy switch in Phase 1. (`apps/server` was removed on Nov 15: see
  Phase 5. Its shared code is in `apps/gate`; the rest is in git history.)
- App agents use OpenAI (gpt-6.1-sol) and Meta Muse only. Never default an agent to an Anthropic model, even where
  the Deep Agents docs' examples do.
- Compare methods on the app's own models (gpt-6.1-sol first, then Muse Spark), not on stronger ones.
- Never put an API key, token or `.env` value into a sandbox image, upload or environment.
- Benchmark and scratch output goes in `bench/results/_<name>/` (folders starting with `_` are gitignored).
- Python: 3.12 with `uv` (as in `apps/worker3d`). Node: 22.12+ for `apps/gate`.
- Keep comments and names in the style of the surrounding code; match the existing TypeScript behaviour exactly in
  Phase 1 (the contract tests decide).

**Documentation**

- Deep Agents (Python), all 36 pages as raw Markdown, saved Nov 15:
  `~/Desktop/meta-AR-local-archive/docs/deepagents-python-2026-11-15/` (same pages online at
  `https://docs.langchain.com/oss/python/deepagents/<page>.md`; the index of every page is
  `https://docs.langchain.com/_llms/agent-development-lifecycle/build/python.txt`). The `(doc: page.md)` references
  in this file name those pages. Most used: `customization.md` (full `create_deep_agent` signature and middleware
  stack), `skills.md`, `sandboxes.md`, `backends.md`, `subagents.md`, `models.md`, `profiles.md`,
  `fault-tolerance.md`, `streaming.md`, `multimodal.md`, `going-to-production.md`.
- Not in those pages, needed for the **[verify]** items: LangGraph persistence (durable checkpointers, resuming a
  thread), langchain-openai (`ChatOpenAI` with `base_url` / `api_key`, Responses vs Chat Completions), Modal
  (`modal.Sandbox.create` arguments: image, network blocking, timeouts, naming; `modal.Image` with Node).

**The TypeScript server, file by file** (it was `apps/server/src`; removed Nov 15. The files marked `apps/gate`
in the last column moved there unchanged; the others are in git history)

| File | What it does | Becomes |
|---|---|---|
| `server.ts` | HTTP routes (list in Phase 0), static serving for the deploy | `app/main.py` |
| `config.ts` | Reads the repo-root `.env`; `maxRepairs` 2, `maxCompletionTokens` 64000, port 8787 | `app/config.py` |
| `llm.ts`, `models.ts` | OpenAI-compatible chat calls; model entries from `bench/models.json` | `app/llm.py` |
| `agent.ts` | `generate()`: one call, extract code, validate, dry run, repair; look-and-fix with pictures; formats `code`/`a2ui`/`template`/`a2ui-parallel`; `kind: 'lesson' \| 'game'` | classic writer in `graphs/lesson.py`, `graphs/game.py` |
| `prompt.ts` | `SYSTEM_PROMPT` (lessons, the benchmark's published prompt), `GAME_SYSTEM_PROMPT` (built from it by checked passage swaps), `repairMessage`, `REVIEW_MESSAGE` | ported byte for byte; later split into skills |
| `validate.ts`, `dryrun.ts`, `sandbox.ts`, `sandbox-child.ts`, `glyphs.ts`, `kit/kit.js` | Static checks, the dry run (real three.js + `kit.js` in a locked-down Node child process, 10 frames, a simulated moving hand) | `apps/gate` (stays Node) |
| `courses.ts` | Course planner prompt, background lesson queue (one at a time), course 3D models, look-and-fix polish | `graphs/course.py` |
| `games.ts` | Play: background game writing, panel-title extraction | `graphs/game.py` |
| `db.ts` | SQLite `data/app.db`: courses, lessons, games, models | `app/db.py` |
| `guard.ts` | Rate limits, daily budget, content screen (`SCREEN_PROMPT`) | `app/guard.py` |
| `router.ts`, `library.ts` | Asset router and the model library (`data/library/`) | `app/library.py` |
| `real-size.ts`, `voice.ts` | Size agent; speech to text and Deepgram voice-agent tokens | `app/real_size.py`, `app/voice.py` |
| `three-d/*` | Course model pipeline: starts `apps/worker3d` Python programs (TRELLIS.2, Blender split on Modal) | `app/assets.py`, importing `apps/worker3d` |
| `a2ui/*` | RQ1/RQ4 research formats (A2UI, templates, parallel) | Phase 4, research only |
| `../research/*` | Benchmark, judge, reports, RQ4, 3D benchmarks | Phase 4 |

**Environment** (repo-root `.env`; never copy into a sandbox)

- `LLM_BASE_URL` (default `https://api.openai.com/v1/`), `LLM_API_KEY`, `LLM_MODEL` (default `gpt-6.1-sol`),
  `OPENAI_API_KEY`: the app's agents.
- `COURSE_PLANNER`, `MODERATION_MODEL`, `PARALLEL_PLANNER`: model ids from `bench/models.json`.
- `META_API_KEY`: Muse models at `https://api.meta.ai/v1` (`muse-spark-1.3-contributor`, and `muse-ember-1.0`, which
  needs `reasoning_effort` passed as an extra body field; see `bench/models.json`), reference pictures, and the voice
  fallback.
- `DEEPGRAM_API_KEY`: the voice tutor. `GENUI_PORT` (8787), `STATIC_DIR` (deploy), `APP_DB` (database path),
  `COURSE_MODELS=0` (no course 3D models), `ASSETS_ON_DEMAND=1`, `WORKER3D_URL`, `WORKER3D_TOKEN`.

**Commands**

```bash
# Python API on :8787
cd apps/api && uv run uvicorn app.main:app --host 0.0.0.0 --port 8787
# Headset app + emulator browser on https://localhost:8081 (proxies /api to :8787)
cd apps/xr && npx @iwsdk/cli dev up --allow-browser-automation
# Emulator tests (run from apps/xr; the dev server must be up)
npx @iwsdk/cli browser run tests/picker-smoke.mjs --timeout 105000
npx @iwsdk/cli browser run tests/play-smoke.mjs --timeout 100000        # PLAY_STEP=inspect|game|learn
npx @iwsdk/cli browser run tests/frame-smoke.mjs --timeout 100000       # FRAME_GAME=1 for a game
npx @iwsdk/cli browser run tests/hands-smoke.mjs --timeout 100000       # run with the picker on Learn
npx @iwsdk/cli browser run tests/view-smoke.mjs --timeout 100000
# Benchmark (the research harness in apps/gate), then emulator probes and the judge
cd apps/gate && npm run bench -- --prompts ../../bench/prompts/test-12.json --only gpt-6.1-sol --out ../../bench/results/_baseline-ts
cd apps/xr && node scripts/bench-browser.mjs "$PWD/../../bench/results/_baseline-ts"
cd apps/gate && npm run bench:judge -- ../../bench/results/_baseline-ts
# Typecheck both TS apps, test the gate, run the Python tests
(cd apps/gate && npx tsc --noEmit -p . && npm test) && (cd apps/xr && npx tsc --noEmit -p .) && (cd apps/api && uv run pytest -q)
```

## Decision: Deep Agents for the coding agent, LangGraph for the workflows

They are not alternatives. `create_deep_agent(...)` "pre-assembles a middleware stack on top of `create_agent`" and
returns a compiled LangGraph graph (`CompiledStateGraph`) (doc: customization.md). So the backend uses both.

- **Deep Agents writes the code.** It is a harness, like Claude Code: the model works in an environment with a
  filesystem (`ls`, `read_file`, `write_file`, `edit_file`, `delete`, `glob`, `grep`), a shell (`execute`, only on a
  sandbox backend), subagents (`task`), skills with progressive disclosure, summarization of long contexts, and
  optional planning (`write_todos`, opt-in since v0.7 through `TodoListMiddleware`) and human approval (`interrupt_on`)
  (doc: overview.md, tools.md). The lesson and game agent becomes one that writes a module, runs the dry run itself,
  reads the errors and fixes them, instead of one model call.
- **LangGraph runs the app's flows.** What must happen in a fixed order and be checked by code, not by the model:
  plan a course, build its 3D model, write lessons one at a time, gate every module, look-and-fix. A deterministic
  graph is cheaper, faster and testable where no judgement is needed.
- **Why not plain LangGraph or `create_agent` with hand-picked middleware:** we would rebuild the file tools, the
  shell, skills loading and subagents. That middle option stays as the fallback if the default stack gets in the way
  (doc: customization.md, "Advanced").
- **Self-hosted, not Agent Server.** We run FastAPI in our own container. The docs push LangSmith Agent Server /
  Managed Deep Agents, which bring threads, runs, a persistent checkpointer, run pickup after a crash, auth, cron and
  async subagents (doc: going-to-production.md, comparison.md). Self-hosting means we own persistence, resuming
  unfinished runs after a restart, and auth. The plan below does that.

### How skills work (what we build on)

(doc: skills.md, context-engineering.md)

1. At startup `SkillsMiddleware` puts each skill's `name` and `description` in the system prompt.
2. When a request matches, the agent reads that skill's full `SKILL.md` with `read_file`.
3. Supporting files (`scripts/`, `references/`, `assets/`) are read or run only when `SKILL.md` says to. A script's
   source stays out of context unless the agent reads it; its output comes back through `execute`. Running scripts
   needs a sandbox backend with the skill files inside the sandbox.

Rules:
- `skills=[...]` takes container folders whose subfolders are skills. A path pointing straight at one skill loads
  nothing, with no error.
- Frontmatter `name` (lowercase, digits, hyphens, at most 64 characters, equal to the folder name) and `description`
  (at most 1,024 characters) are required. Keep the body under about 5,000 tokens and 500 lines.
- `pinned_skills` is a per-run input (`agent.invoke({"messages": [...], "pinned_skills": [...]})`, `deepagents>=0.7.23`),
  not a `create_deep_agent` argument. Each pinned `SKILL.md` is appended as a `HumanMessage`, and pinning again appends
  another copy.
- With a checkpointer, skills load once per thread. Reset with `"skills_metadata": None` in the run input.
- `metadata.include_tools` (a space-separated string, `>=0.7.22`) keeps a skill's tools hidden until the skill is read.
  It needs a hand-built `SkillsMiddleware(backend=..., sources=[...], tools=...)` instead of `skills=`.
- The general-purpose subagent inherits the main agent's skills; custom subagents do not, and skill state is isolated
  between agents.
- Memory (`AGENTS.md`) is the opposite: always injected, no progressive disclosure, so keep it minimal.

## Ground rules

- **Same API, same data.** Every `/api/*` route keeps its request and response shape, so `apps/xr` does not change.
  Same `data/app.db` schema (courses, lessons, games, models). Same `bench/models.json`.
- **App agents use OpenAI and Muse only.** gpt-6.1-sol by default; Muse Spark / Ember through Meta's
  OpenAI-compatible endpoint. Compare methods on these models, not on stronger ones. Examples in the docs use Anthropic
  models (including the rubric grader); replace them.
- **Secrets never enter a sandbox** (doc: sandboxes.md, going-to-production.md: "Never put secrets inside a sandbox").
  API keys stay in host-side tools. Network access is blocked explicitly when the sandbox is created; it is not
  blocked by default.
- **The host gate is final.** Everything produced in a sandbox is untrusted (doc: sandboxes.md). Every module is checked
  again on the host before it reaches a headset. The agent can edit or replace `check.mjs` inside its sandbox through
  `execute`, and filesystem permissions do not apply to sandbox backends (doc: permissions.md), so a "pass" inside the
  sandbox never counts on its own.
- **The published benchmark prompt stays reproducible.** The current one-call writer is kept as `mode="classic"`; the
  Deep Agent is `mode="agent"`. The app switches per kind (lesson, game) only after the agent wins on the benchmark.
- **The dry run stays JavaScript.** It must run the exact three.js and `kit.js` the headset runs. It becomes a small
  Node program (`apps/gate`, built from the existing `validate.ts`, `dryrun.ts`, `sandbox.ts`, `kit/kit.js`), used as
  the host gate and as the `dry-run` skill script in the sandbox. Deep Agents' code interpreter is QuickJS in the host
  process with no filesystem, a 5 s / 64 MB limit per eval (doc: interpreters.md), so it cannot run it.

## Target layout

```
apps/api/                       Python 3.12, uv
  app/main.py                   FastAPI: the /api routes, NDJSON streaming, static serving of apps/xr/dist (deploy)
  app/config.py                 repo-root .env, bench/models.json
  app/db.py                     same SQLite schema as the TS server's db.ts
  app/guard.py                  per-visitor rate limit, daily budget, content screen
  app/llm.py                    chat models: "openai:gpt-6.1-sol" and a ChatOpenAI instance for Muse
  app/gate.py                   calls apps/gate (static check + dry run) and returns stats or the error
  app/state.py                  RunContext (context_schema) and CoderState (DeepAgentState subclass)
  app/graphs/lesson.py          write -> gate -> repair (loop) -> look-and-fix   (classic or agent writer)
  app/graphs/game.py            design (structured output) -> write -> gate -> repair -> look-and-fix
  app/graphs/course.py          plan -> build model -> lessons one at a time, checkpointed
  app/agents/coder.py           create_deep_agent(...) for lessons and games
  app/agents/model_maker.py     the model-maker subagent spec
  app/agents/middleware.py      limits, cost meter, wall-time guard
  app/tools/                    host-side tools: library lookup, asset jobs, real size (hold the secrets)
  app/voice.py, real_size.py, library.py, assets.py   (assets imports apps/worker3d directly)
  skills/common/{kit,panels,dry-run}/SKILL.md          containers grouped by who gets them
  skills/lesson/{lesson-craft,library-models}/SKILL.md
  skills/game/{game-loop,hand-play,tabletop-physics,board-rules}/SKILL.md
  skills/model/{lesson-craft}/SKILL.md                 (model-maker's own copy)
  sandbox/image.py              the Modal image: Node 22, three.js r185, kit.js, /skills, /work
  tests/                        contract, unit, graph tests
apps/gate/                      Node CLI: JSON in (module code) -> JSON out (ok, stats, error); reuses the TS code
```

## Phase 0: freeze what we are matching

- [ ] Record the API contract from the running TS server: for each route, a request and the response JSON saved as
      fixtures in `apps/api/tests/contract/`.
  - [ ] `GET /api/health`, `GET /api/kit.js`, `GET /api/library/catalog`, `GET /api/library/assets/:id`
  - [ ] `POST /api/generate` (with `kind`, `previousCode`, `clientError`), `POST /api/generate-stream` (NDJSON)
  - [ ] `POST /api/transcribe`, `POST /api/voice-agent/token`, `POST /api/real-size`
  - [ ] `POST /api/courses`, `GET /api/courses`, `GET /api/courses/:id`, `GET /api/courses/:id/lessons/:n`,
        `POST /api/courses/:id/lessons/:n/polish`
  - [ ] `POST /api/games`, `GET /api/games`, `GET /api/games/:id`
  - [ ] `GET /api/assets/jobs`, `GET /api/assets/jobs/:id`
  - [ ] Error shapes: 400 bad body, 404 unknown id, refusals `{ ok: false, error, reason }` with 429 (rate),
        503 (daily budget), 422 (content)
- [ ] Baselines on gpt-6.1-sol, saved under `bench/results/_baseline-ts/` (gitignored):
  - [ ] lessons: `bench/prompts/test-12.json` (pass, first-try pass, seconds, cost) + `npm run bench:judge`
  - [ ] games: the 10 VCXR60 game prompts (`bench/results/_games-vcxr/prompts.json`) + emulator probes
        (`apps/xr/scripts/bench-browser.mjs`)
  - [ ] one course end to end (plan, model, 4 lessons): time and cost
- [x] Pin versions in `apps/api/pyproject.toml` (uv sync; pytest imports them):
  - [x] `deepagents>=0.7.33`: refusals raise by default (0.7.33), `summarizer=` (0.7.26), `pinned_skills` (0.7.23),
        `include_tools` (0.7.22), skill reload (0.7.16), `response_format` on subagents (0.5.3)
  - [x] `langchain[openai]` (the documented install for the OpenAI integration), `langchain>=1.3.14` for
        `ToolErrorMiddleware`
  - [x] `langchain-modal`, `modal`, `langgraph`, `fastapi`, `uvicorn`, `httpx`
        (PyPI on Nov 15, 2026: newest `langchain-modal` is 0.0.8, so the pin is `>=0.0.8`, not 0.1)
  - [x] A durable checkpointer **[verified]**: `langgraph.checkpoint.sqlite.aio.AsyncSqliteSaver`.
        `from_conn_string` is an async context manager. `app.main` lifespan opens it; TestClient startup succeeded.
        `modal.Sandbox.create` `block_network` defaults to False, so the coder passes `block_network=True`.
- [ ] **Model smoke test through a bare Deep Agent**, before any building. Docs: "Deep Agents require a model that
      supports tool calling" (models.md), and neither gpt-6.1-sol nor Muse is on its suggested or evaluated list. Run
      `create_deep_agent(model=...)` with a sandbox on 3 small tasks (write a file, run a command, fix an error) on
      each model and record whether tool calls, `read_file` of images and multi-step loops work.

## Phase 1: Python API with the same behaviour (no new agent yet)

- [x] `apps/gate`: Node CLI wrapping `validate.ts`, `sandbox.ts` (locked-down child process) and `kit/kit.js`;
      `node gate.mjs < {code, assets}` prints `{ok, stats, warnings, error}`. Unit test with the example module.
      Keep the error output short: long `execute` output is saved to a file instead of returned (doc: sandboxes.md).
      Passed: `pytest tests/test_gate.py` (example module ok, two runs agree, `fetch` rejected).
- [x] `app/config.py`, `app/db.py` (opens the existing `data/app.db`; same tables; restart rules from `courses.ts`:
      `generating` -> `pending`, `planning` -> failed, `writing` games re-queued).
      Passed: `pytest tests/test_restart.py` (planning fails with the restart message; a generating lesson and a
      writing game are queued again).
- [x] `app/llm.py`:
  - [x] gpt-6.1-sol via `ChatOpenAI(..., use_responses_api=False)` (Chat Completions, matching `llm.ts`).
        Not the Responses API. No live model call in this session.
  - [x] Muse as a `ChatOpenAI` instance (`base_url` `https://api.meta.ai/v1`, `META_API_KEY`,
        `use_responses_api=False`). Harness profile key `openai` applies to that instance (provider fallback)
        and does not add an OpenAI suffix in deepagents 0.7.38.
  - [x] Muse profile `max_input_tokens` 200000 (`MUSE_MAX_INPUT_TOKENS`), from the Ember "up to 200K" price tier.
  - [x] Spend recording as in `guard.ts` (`record_spend`, compact JSON under `RUNS_DIR`).
- [x] `app/guard.py`: rate limit, daily budget, content screen (same `SCREEN_PROMPT`).
      Passed: `pytest tests/test_guard.py` (429 after the window fills). Content screen not called (`MODERATION=off`).
- [x] Classic writer: port `agent.ts`'s loop (system prompt, extract code, gate, repair up to `maxRepairs` = 2,
      look-and-fix with pictures) and `prompt.ts` (`SYSTEM_PROMPT`, `GAME_SYSTEM_PROMPT`, `repairMessage`,
      `REVIEW_MESSAGE`) byte for byte; assert the prompt strings match the TS ones in a test.
      Passed: `pytest tests/test_prompts.py` against live `tsx` (prompts and the full `librarySection`).
- [x] Asset router (`router.ts`), library (`library.ts`), real size (`real-size.ts`), voice (`voice.ts`).
      `library_section` matches live TypeScript for the whole catalogue. Router, real size and voice are ported;
      they were not called against a live model.
- [x] Courses (`courses.ts`) and games (`games.ts`) with their background queues.
      Passed: `pytest tests/test_restart.py`.
- [x] Static serving for the deploy (`STATIC_DIR`), same port setting (`GENUI_PORT`, default 8787).
      Passed: `pytest tests/test_contract.py::test_static_files_stay_inside_the_directory`.
- [ ] Contract tests: every Phase 0 fixture passes against the Python API.
      Python route checks passed (`tests/test_contract.py`: health, kit.js, catalog, asset bytes, `/example`,
      400, 404, empty shelves). Fixtures were not recorded from a running TypeScript server, so this stays open.
- [x] Switch `apps/xr/vite.config.ts`'s `/api` proxy during the overlap: it goes to whichever server listens on
      8787 (the Python API by default); `GENUI_API_URL` overrides the target.
- [ ] Emulator tests pass against the Python API: `picker-smoke`, `play-smoke`, `frame-smoke` (lesson and
      `FRAME_GAME=1`), `hands-smoke`, `view-smoke`.
- [ ] Benchmark parity (classic mode, gpt-6.1-sol): pass rate within one prompt of the TS baseline on both sets.

## Phase 2: the flows as LangGraph graphs

- [x] `graphs/lesson.py`: `write` -> `gate` -> (`repair` back to `gate`, at most `maxRepairs`) -> `done`;
      `look_and_fix` as its own node fed by headset pictures. State: request, kind, code, attempts, stats, errors, cost.
- [x] `graphs/game.py`: a `design` node first (one structured-output call: rules, controls, scoring, win/lose,
      difficulty), stored with the game and passed to the writer. It is a node, not a subagent: a subagent's
      `response_format` JSON only reaches the parent model's ToolMessage, not our code (doc: subagents.md).
      The design is checkpoint state, not a new database column. A bad design falls back to the raw request.
      Compiles (`test_course_and_game_graphs_compile`). The design call was not executed (it would spend a model call).
- [x] `graphs/course.py`: `plan` -> `build_model` (calls `apps/worker3d` in process: TRELLIS.2, Blender split) ->
      `queue_lessons` -> `write_lesson` (one at a time, the next when the previous is opened) -> `done`.
      Compiles. A course model build still goes through `apps/gate/acquire-bridge.ts` so the vision and render
      stages stay the TypeScript pipeline; molecule builds call `apps/worker3d` in process.
- [x] Checkpointer: the durable saver from Phase 0, async (the server is async; doc: going-to-production.md). Every
      call carries `config={"configurable": {"thread_id": ...}}`. Thread id = course id / game id / lesson run id.
- [x] **Resume after a restart is ours to build** (Agent Server does it, we don't run one): on startup find unfinished
      threads in `data/app.db` and re-invoke each with its `thread_id` **[verified]**.
      `pytest tests/test_graph.py::test_resume_retries_the_gate`: the gate crashed once, resume called `complete`
      once and the gate twice. `ainvoke(None, config)` when `snapshot.next` is set.
- [x] Streaming to the headset: progress events from `get_stream_writer()` inside nodes ("gate passed", "repair 2",
      "building model") and graph updates, written as NDJSON by FastAPI (no FastAPI example in the docs; we wrap
      `astream` ourselves). Pin the stream `version` and test the chunk shape: streaming.md mixes the v2 dict format
      and the tuple format.
      Pinned `version="v2"`. Passed: `test_stream_chunks_are_v2_dicts` (each line is a dict with `type` `updates` or `custom`).
- [x] Graph tests with a fake model (scripted replies): repair path, give-up path, restart-resume path.
      Passed: `pytest tests/test_graph.py` (repair, three failures then give up, resume).
- [ ] Parity again on the benchmark (classic writer inside the graph).

## Phase 3: the Deep Agent coder

### Sandbox (Modal)

- [x] Documented usage (doc: sandboxes.md): `modal_sandbox = modal.Sandbox.create(app=modal.App.lookup("..."))`,
      `backend = ModalSandbox(sandbox=modal_sandbox)`, `modal_sandbox.terminate()` in `finally`;
      `backend.upload_files([(abs_path, bytes)])` and `backend.download_files([...])` (results have `.path`,
      `.content` bytes or None, `.error`); `backend.execute(cmd).output`.
      **[verified]** fake sandbox: upload, download, terminate in `finally`. `execute` is `ModalSandbox.execute` (the agent calls it). No live Modal sandbox.
- [x] **[verify in Modal's docs; not in the Deep Agents docs]** the `Sandbox.create` arguments for: the image (Node 22,
      three.js r185, `kit.js`, `/skills`, `/work`), blocking network, timeouts, and naming.
      **[verified]** installed `modal.Sandbox.create` accepts `image`, `block_network` (default False), `timeout`, `name`, `workdir`. The coder passes `block_network=True`. Image was not built.
- [x] Lifecycle: **one sandbox per agent run**, created in the `write` node and terminated in `finally`. The write,
      dry-run and repair loop all happen inside that one run. Look-and-fix is a later run: it gets a new sandbox and
      the module is uploaded again. (A sandbox's files are not in the checkpoint, and a thread-scoped sandbox found by
      name with an idle TTL is only documented for LangSmith sandboxes.)
      **[verified]** a repair uploads `/work/module.js` and does not open a second sandbox in that run. Look-and-fix is a new run. Fake sandbox, not Modal.
- [ ] Skills inside the sandbox: bake `skills/` into the image at `/skills` and the gate at `/opt/gate`, rebuilt from
      `apps/gate` on each deploy so the in-sandbox check is the same code as the host gate.
      The image layout is in `sandbox/image.py` (`/skills`, `/opt/gate`, `/opt/server`) and `check.mjs` calls `/opt/gate/gate.ts`. The image was not built.
      **Spike first:** confirm
      that `skills=["/skills/common/", ...]` discovers skills through `ModalSandbox` (BaseSandbox reads files via
      `execute`, doc: sandboxes.md). The docs' `SkillSandboxSyncMiddleware` example uploads through a
      `CompositeBackend` that routes `/skills/` to a StoreBackend, so its files would not reach the sandbox's own disk;
      if we sync instead of baking, upload through the `ModalSandbox` backend directly.
- [x] Internal files: with the sandbox as the default backend, `/large_tool_results/` and `/conversation_history/`
      are written inside the sandbox (doc: backends.md). Harmless; keep `/work` separate.
      **[verified]** `create_deep_agent(..., backend=ModalSandbox)` and the module path is `/work/module.js`. Not observed in a live sandbox.

### The coder agent

- [x] `agents/coder.py`:
  ```python
  from langchain.agents.middleware import TodoListMiddleware, ModelCallLimitMiddleware, ToolCallLimitMiddleware
  coder = create_deep_agent(
      model=<gpt-6.1-sol or the Muse instance>,
      backend=ModalSandbox(sandbox=...),
      skills=["/skills/common/", "/skills/lesson/"],          # or /skills/game/ for games
      subagents=[model_maker],
      middleware=[TodoListMiddleware(), ModelCallLimitMiddleware(run_limit=...),
                  ToolCallLimitMiddleware(run_limit=...), cost_meter, ModelRetryMiddleware(...), ToolErrorMiddleware(...)],
      tools=[library_lookup, start_asset_job, asset_job_status, real_size],   # host-side, hold the secrets
      system_prompt=<role + output contract + "delegate the main 3D model to model-maker with task()">,
      context_schema=RunContext,                              # visitor id, run id, kind, budget; reaches subagents
      state_schema=CoderState,                                # attempts, stats, cost; must subclass DeepAgentState
      checkpointer=<the durable saver>,
  )
  coder.astream_events({"messages": [...], "pinned_skills": [...]}, context=RunContext(...),
                       config={"configurable": {"thread_id": ...}}, version="v3")
  ```
  **[verified]** `tests/test_coder.py` with a fake sandbox and a fake agent (`version="v3"`, durable checkpointer when one is set).
- [x] Output contract: the finished module at `/work/module.js`; the host downloads it and runs the host gate.
      **[verified]** agent mode still goes through the host gate (`test_agent_mode_checks_the_module_on_the_host`).
- [ ] The default stack adds things we must decide on (doc: customization.md, "Bare stack"):
  - [x] **The general-purpose subagent** is added automatically, with all the main agent's tools and skills. Disable
        it with `register_harness_profile(<key>, HarnessProfile(general_purpose_subagent=
        GeneralPurposeSubagentProfile(enabled=False)))` (doc: profiles.md, subagents.md). Not through
        `excluded_middleware`, which raises `ValueError`. **[verify]** which profile key matches the Muse
        `ChatOpenAI` instance (probably `openai`, which would also apply OpenAI's built-in prompt suffix to Muse).
        **[verified]** `ChatOpenAI` resolves to the `openai` profile. That profile disables the general-purpose subagent and sets no prompt suffix.
  - [x] **SummarizationMiddleware** is always on (triggers at 85% of the model's `max_input_tokens`). Keep it; set
        Muse's profile (Phase 1). `muse_chat` sets `profile={"max_input_tokens": ...}`.
  - [x] **ModelRefusalMiddleware** raises `ModelRefusalError` when the main model refuses: catch it in the graph and
        return the existing 422 refusal shape. A subagent's refusal comes back to the parent as text.
        **[verified]** a refusal sets `refused` and the lesson graph stops (`_after_write`).
  - [ ] **UnsupportedContentMiddleware** replaces content the model can't take (e.g. images) with text placeholders:
        confirm both models accept images before relying on them.
  - [x] Use `excluded_tools` in the harness profile to drop built-ins we don't need, e.g. `delete` (doc: profiles.md).
        **[verified]** `delete` is in the `openai` profile's `excluded_tools`.
- [x] `pinned_skills`: pin once, on the first run of a thread (lessons: `kit`, `panels`, `lesson-craft`, `dry-run`;
      games: `kit`, `panels`, `game-loop`, `hand-play`, `dry-run`). Do not re-pin on repair turns; each pin appends
      another copy (about 5k tokens per skill). **[verified]** a repair turn omits `pinned_skills`.
- [x] After a deploy that changes skills, reset `skills_metadata` on threads that continue (skills are frozen per
      thread with a checkpointer). **[verified]** a changed skills hash sends `skills_metadata: None`.

### Skills

Each `SKILL.md` names its scripts with absolute commands (the `execute` working directory is not documented), e.g.
`node /skills/common/dry-run/scripts/check.mjs /work/module.js`.

- [x] `common/dry-run`: runs the gate inside the sandbox and prints stats or a short error.
      Command is `node /skills/common/dry-run/scripts/check.mjs /work/module.js`.
- [x] `common/kit`: the kit API (materials, textures, shapes, instances, effects, cards) as `references/kit-api.md`,
      with the worked example module.
- [x] `common/panels`: `kit.panel` parts, `set` / `show`, the font rules, placement rules.
- [x] `lesson/lesson-craft` (and a copy in `model/` for the model-maker): real proportions, three layers of detail,
      ground it, triangle budget.
- [x] `lesson/library-models`: `assets.get(id)` models and their named parts. Candidate for `include_tools` with
      `library_lookup`.
- [x] `game/game-loop`: attract mode, start, score / lives / restart, difficulty, scoreboard behind the board.
- [x] `game/hand-play`: the `hands` API, tools that follow a hand, pinch to act, both hands, tracking loss.
- [x] `game/tabletop-physics`: tested ball, bounce, paddle and collision snippets in `scripts/`, plus a script that
      runs a game's `update()` for a few seconds with a simulated hand and reports what moved.
- [x] `game/board-rules`: move generation for chess-like and grid games.

### Subagents

- [x] `model-maker`: a synchronous, isolated subagent (doc: subagents.md). Custom subagents inherit nothing from the
      main agent's customization, so its spec sets everything:
      `{"name", "description", "system_prompt" (required in isolated mode; tells it to read lesson-craft and kit first),
      "skills": ["/skills/common/", "/skills/model/"], "tools": [library_lookup, real_size] (otherwise it inherits all
      tools), "middleware": [TodoListMiddleware(), call limits, cost meter], "model": <instance for Muse>,
      "response_format": {path, function_name, dry_run_ok, triangles}}`. It is stateless between calls: a repair must
      pass the path and the error again. **[verified]** spec is isolated, skills are `/skills/common/` and `/skills/model/`, tools are `library_lookup` and `real_size`.
- [x] `reviewer`: not a subagent at first. The `look_and_fix` graph node calls a vision model directly with the
      pictures as `{"type": "image", "base64": ..., "mime_type": "image/jpeg"}` blocks (doc: multimodal.md; whether
      data URLs work in `url` is not documented), and keeps them in the latest turn only: summarization drops image
      blocks. A later option is `RubricMiddleware` (`deepagents>=0.6.5`) as a self-check with a gpt-6.1-sol or Muse
      grader whose tool renders or gates the module (doc: rubric.md).
      **[verified]** agent mode calls the vision model in `look_and_fix` and, unless it says LOOKS GOOD, uploads the module into a new coder run. The HTTP client sends `image_url` blocks (Chat Completions), not the LangChain `image`/`base64` block.
- [x] Not adopted: fork mode (rejects `skills`), async subagents (need Agent Protocol / Agent Server and
      `langgraph.json`), dynamic subagents (beta; `CodeInterpreterMiddleware` turns dispatch on by default, and the word
      "workflow" in a request can trigger fan-out).

### Limits, errors, cost

- [x] Step caps on the main agent and on every subagent's own `middleware`:
      `ModelCallLimitMiddleware(run_limit=...)`, `ToolCallLimitMiddleware(run_limit=...)` (doc: fault-tolerance.md).
      The default recursion limit is 10,000, so these caps are what actually stop a run.
      **[verified]** coder middleware is built with `run_limit` 40 model calls and 80 tool calls. Model-maker uses its own limits.
- [x] **Wall time and cost caps are not in the docs**; build them: `asyncio.wait_for` around the run (a cancelled run's
      message history is repaired by `PatchToolCallsMiddleware`, doc: human-in-the-loop.md) and a middleware that adds
      up token usage per run and stops at the budget. Attribute cost per agent with the `lc_agent_name` metadata.
      Keep counters in graph state, not on middleware instances (doc: customization.md).
      **[verified]** the run is wrapped in `wait_for` (8 minutes). `CostMeterMiddleware` adds `cost_usd` on agent state. `lc_agent_name` is `coder`. Not timed against a live model.
- [x] Retries and fallbacks: `ModelRetryMiddleware(max_retries=3, ...)`, `ToolErrorMiddleware` (turns gate and tool
      exceptions into ToolMessages the agent can fix), `ModelFallbackMiddleware` (e.g. Muse -> gpt-6.1-sol).
      **[verified]** Muse gets a gpt fallback. `ToolErrorMiddleware` needs an `on_error` handler in this library version; it returns the tool name and exception type, not the raw message.
- [ ] Evaluation on gpt-6.1-sol, classic vs agent, same prompts: pass rate, first-try pass, emulator interaction
      probes (grab, press, panel buttons), judge score, seconds, cost. Then on Muse Spark. The benchmark judge stays
      as it is (RubricMiddleware changes what the agent produces, so it would be a separate arm, not a judge).
- [ ] Adopt per kind only where the agent wins; keep `mode="classic"` for the paper's benchmark.

## Phase 4: research and benchmark scripts

- [x] The TS research scripts (bench, judge, report, gallery, combine, rq4, review, three-d/*; now `apps/gate/research`): port to
      `apps/api/research/` or drive the Python API over HTTP. Keep `apps/xr/tests/bench-browser.mjs` as is (it
      drives the headset app).
      **[verified]** `research/report.py`, `research/rq4.py` and `research/combine.py` are the scoring path.
      `research/bench.py` turns a `POST /api/generate` body into the same `results.jsonl` row (failure labels included).
      `research/drive.py` is the HTTP client. Judge, gallery and `three-d/*` stay the TypeScript scripts: they read
      emulator screenshots or the 3D worker. `bench-browser.mjs` was not changed.
- [x] Re-run one RQ1 cell and one RQ4 cell through the Python path and check the numbers match the committed ones.
      **[verified]** `rq1-a2ui-v3-sonnet` summary.json matches `summarize(directory, judge="claude-opus-5-5")` (the published judge on those rows). A new run's default judge is `gpt-6.1-sol`. The Sonnet RQ4 table
      (one-shot 24/24, first content 39.8 s, quality 3.88; parallel 23/24, first content 18.5 s, quality 3.62)
      matches `research.rq4`. No new model calls.

## Phase 5: deploy and retire the TypeScript server

- [x] Deploy image (removed Nov 16): a `python:3.12-slim` image with Node 22 (for `apps/gate`), `uv sync`,
      `apps/xr/dist`, `data/library`, and `bench/models.json` was built and checked, then deleted. Nothing in the
      app, scripts, or CI builds or runs it. Local run and Modal stay as they are. The Modal token stays a host
      secret.
      **[verified, then removed]** `docker build -t spatial-genui .` succeeded. The image had Node v22.23.5, no
      `.env`, and `gpt-6.1-sol` via `api.openai.com`. A container on port 8080 served `/api/health`, the built-in
      `/example` module, `/api/kit.js`, an empty course list, and `index.html`.
- [ ] Headset test on the Quest 3S: courses, lessons, Play, voice tutor, look-and-fix, frame handles.
- [x] Switch the default proxy to Python; delete `apps/server`.
      **Done Nov 15, at the user's request, before the week of parity** (the contract, emulator and Python tests
      pass). What still runs moved to `apps/gate` unchanged (`git mv`, history kept), with its own `package.json`:
      `src/` the gate's code (validate, dry run, sandbox, kit.js, library, glyphs, example module), the course 3D
      pipeline (`three-d/` with config, llm, models), and the research harness (the published one-call agent loop
      `agent.ts`, `prompt.ts`, `router.ts`, `a2ui/`); `research/` the benchmark, report, combine, rq4, judge,
      gallery, batch, review and 3D scripts (`npm run bench*` in `apps/gate`). The Python API and the
      Modal coder image point at `apps/gate`; run logs are in `apps/api/runs/` for both. Removed (replaced by
      `apps/api/app`, kept in git history): `server.ts`, `courses.ts`, `games.ts`, `db.ts`, `guard.ts`, `voice.ts`,
      `real-size.ts`, `cli.ts` (use `POST /api/generate`).
- [x] Update `README.md`, `SPEC.md`, `docs/3d-architecture.md` (the backend is Python plus `apps/gate`; SPEC.md
      keeps its dated `apps/server` paths with a map at the top).

## Review, Nov 15 (Claude): what was wrong and is now fixed

Checked with the emulator tests (`frame-smoke` for a lesson and with `FRAME_GAME=1`, `play-smoke`, `hands-smoke`,
`view-smoke`, `picker-smoke`: all pass) and `uv run pytest` in `apps/api` (37 pass, two new tests).

Hand interaction (`apps/xr`; the agent server was not involved):
- `bounds.ts`: the touch-only change made the lesson frame unusable. A fingertip on a bottom rod also touches the
  model's base, so the pinch grabbed the base and the frame stood aside; pointing still lit a handle blue but a
  pinch did nothing. Now the handles stand 3.5 cm outside a lesson's box (beyond the 3 cm part-grab reach and out of
  a ray aimed at the model), lessons take a handle by fingertip or by pointing (200 ms grace for a ray that slips
  as the pinch closes), games take it by fingertip only and their handles catch no rays (play pinches never grab
  the board), the fingertip is measured where it was 120 ms before the pinch (closing a pinch pulls the index tip
  toward the thumb), touch reach 4 cm, and blue means "a pinch now would take it".
- `host.ts`: a game ignored every pinch more than 2 cm off its board, so "pinch to jump" with the hand in front of
  the board did nothing. A pinch now counts within 25 cm of the playfield (not out at the picker). The `hand-play`
  skill and `game-hands.ts` say the same.
- `host.ts`: some course lessons opened tiny (the water-cycle course at 22%). The fit measured hidden meshes too,
  and that lesson keeps six splash rings hidden at their 2 m build size until a splash scales them down. Lessons now
  fit and place by what is visible, as games and the frame already did (the same lesson now fits at 1.34).

Agent server (`apps/api`):
- Live path: a retried course lesson kept the failed run's error, id and timing (the checkpoint merged the new input
  into the old state; every per-run field is now set on a new run, and timing uses the wall clock); model calls
  gave up after about 3.5 s on 429/5xx (now any 5xx retries and `Retry-After` is honoured, as the OpenAI SDK did);
  request bodies were read in full before the size check (now streamed and cut off at the limit); a non-finite
  size answer could break a subject for good; the router ignored a valid object after an invalid first one; the
  asset bridge never read its stderr (could hang a course's model and the asset queue; now drained, 90 min cap);
  background tasks lost their errors and kept running while the database closed at shutdown (`app/background.py`
  tracks them, a failed plan saves the course as failed, shutdown cancels them first); look-and-fix ran without
  the previous code (now as agent.ts: previous code needed, a client error takes priority).
- Agent mode (not used by any route yet): `astream_events(version="v3")` cannot be iterated (now `v2`); the Modal
  image could not build (`add_local_*` before `run_commands` needs `copy=True`); `refused` was dropped from the graph
  state (no 422); the in-sandbox dry run had no model library (now baked at `/data/library`); the Muse fallback was
  Muse again (now gpt-6.1-sol on OpenAI); agent runs recorded 0 tokens (now summed from the messages' usage);
  file transfers blocked the event loop (now `aupload_files` / `adownload_files`); the wall-time limit ignored set-up
  time; the model-maker's $1 cap counted the parent's spending (own state key now); `play.mjs` pointed at a gate
  path that is not in the image; a timed-out gate process was not reaped.
- Still open: progress events written with `get_stream_writer` never reach the headset (`graphs/stream.py` is only
  used by tests); a no-code attempt drops the last extracted code (TS keeps it); with several `X-Forwarded-For`
  headers the last one wins (TS: the first); sandbox names cut at 24 characters can collide within one millisecond.

## Risks to watch

- **The models.** gpt-6.1-sol and Muse are not on Deep Agents' suggested list; on its own evals gpt-5.4 scored 18%
  overall (18% on tool use) while gpt-5.5 scored 80% overall (84% on tool use) (doc: models.md). The Phase 0 smoke test decides whether Phase 3
  is worth building on these models.
- **Latency.** An agent that writes, runs and fixes takes more calls than today's one call (a game is about 80 s now).
  Measure it; cap steps; stream progress to the headset.
- **Cost and caching.** Deep Agents' caching middleware only acts on Anthropic and Bedrock models (doc: overview.md,
  customization.md). Whether OpenAI or Meta cache our prompt prefix on their side is **[verify]**. Keep the system
  prompt and the skill catalog (names and descriptions) byte-stable. Pinned skills are appended as messages; a skill
  reload that changes the set invalidates the cached prefix (doc: skills.md).
- **Sandbox start time.** A new Modal sandbox per run adds seconds; measure it in the Phase 0 smoke test.
- **Context injection.** A request can try to steer the agent; the sandbox has no secrets and its network is blocked
  explicitly, and the host gate re-checks everything.
- **Two dry runs drifting.** The sandbox's `check.mjs` and `apps/gate` are built from the same code on every deploy,
  and a test checks they agree on the same modules.
