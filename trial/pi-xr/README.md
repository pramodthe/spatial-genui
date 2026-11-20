# Trial: OhMyGame's way of making a game, for WebXR (pi + IWSDK + Muse)

A headless port of how [OhMyGame](https://github.com/WhiteTowerAI/ohmygame) makes a game, with one thing changed:
the game is a VR learning game on Meta's [IWSDK](https://iwsdk.dev), not a web game. It is separate from the app:
nothing here is used by `server/`, `gate/` or `headset/`, and nothing in the app changes.

| OhMyGame | Here |
|---|---|
| One continuous [pi](https://github.com/earendil-works/pi) session in a real project folder, no step cap | The same: pi 1.5.2, one session per game, a repair continues it; limits are 45 minutes and $2 |
| Short always-on instructions; skills read on demand | `instructions/APPEND_SYSTEM.md` (from its agent prompts) and IWSDK's `AGENTS.md` |
| The `web-game-studio` skills: studio, foundations, play-test, UI, 3D asset pipeline | `skills/`, adapted to VR on IWSDK (`skills/NOTICE.md`, Apache-2.0) |
| The canvas: design document, mockups, asset list, generation nodes | The same files in the same layout (`canvas/`), with `canvas_initialize`, `canvas_check`, `generate_canvas_media` |
| Media tools: pictures, 3D models, sound | `generate_image` (Meta's Muse Image), `generate_3d_asset` (TRELLIS.2 on the project's Modal), the repo's sound library |
| `update_plan` | The same |
| A follow-up message continues the conversation | `run.mjs <name> --continue "<message>"` continues the game's session |
| The daemon owns the dev server | The runner owns the IWSDK runtime (the emulator window, port 8091) |
| `game_use`: play the game, read its state and errors | IWSDK's MCP tools: emulated hands, console, screenshots, and the game's `GameState` component |
| The workspace starts empty | It starts as IWSDK's own starter project, which the model has not seen before |

Not ported: the desktop app (design view, tune panel, undo checkpoints, publishing), video, speech and music
generation, multiplayer, and the 2D sprite tools.

The model is Muse Ember through pi's built-in `meta` provider (`META_API_KEY`, Meta's Responses API).

## Layout

```
package.json                  pi, pinned, as a local dependency
pi-home/settings.json         pi's settings: no project trust, compaction under Ember's 200K price tier, no keys in the agent's shell
pi-home/models.json           a model newer than pi's own list (GPT-6.2 Astra, for reference runs)
instructions/APPEND_SYSTEM.md the always-on text
instructions/BENCHMARK.md     added for a quality reference run (PI_XR_BENCHMARK=1): no cost limit, finish and polish first
instructions/FREEFORM.md      added when the request specifies a whole app (PI_XR_FREEFORM=1): build that, not a lesson
skills/                       the studio skills, and where they come from (NOTICE.md, LICENSE-APACHE-2.0)
  xr-game-studio/             the order of work; references: design template, hand actions, playtest.json, sounds
  xr-game-foundations/        who owns the state, input mapping, assets, levels
  xr-game-playtest/           playing by hand in the emulated headset
  xr-game-ui/                 visual direction, the first-view mockup, panels and signs
  xr-3d-asset-pipeline/       a model from a picture, textures, sounds, into the game
runner/make-template.mjs      makes the starter every game is cloned from, and smoke-tests it
runner/run.mjs                builds one game: project, runtime, studio service, agent, limits, check, follow-ups, results
runner/agent.mjs              starts pi for one prompt: its folder, IWSDK's MCP servers, the sandbox
runner/studio-server.mjs      the studio service: pictures, 3D models, the canvas, the plan, the art budget
runner/studio-tools.ts        a pi extension: the agent's studio tools, each a call to the service
runner/canvas.mjs             the canvas file contract (OhMyGame's layout): initialize, check
runner/trellis_client.py      one picture in, one GLB out, by TRELLIS.2 on Modal
runner/sound-library.mjs      the repo's 30 sounds as files and a catalogue
runner/guard.ts               a pi extension that keeps the agent inside its project
runner/check.mjs              the independent check of a finished game
runner/first-view.mjs         measures what the player sees first: panels and the things to touch, from the headset's start
runner/playtest.mjs           the agent's play-test tools: record a hand step that worked, replay the file as the check does
runner/iwsdk.mjs              IWSDK's command line: runtime, hands, ECS state, console, screenshots
runner/events.mjs             counts turns, tool calls, tokens and dollars from pi's event stream
runner/preflight.mjs          a few cents of checks that pi, the model and the tools work together
runner/test-guard.mjs, test-studio.mjs   the guard's rules; the studio service (with --paid: one picture, one model)
runner/report.mjs             the results beside the Nov 19 baseline
runner/show.mjs               puts a built game in the emulator window
runner/shelf.mjs              serves every built game's production build at one address, for a headset
runner/snapshot.mjs           keeps a built game as it is under another name, before a follow-up changes it
runner/usb.mjs                keeps a Quest's USB forward to the shelf in place across reconnects
runner/scores.mjs             a benchmark prompt's requirement-by-requirement scores, side by side
```

Outside git, in `~/Desktop/meta-AR-local-archive/pi-xr-trial/`: `template/` (the starter, about 760 MB), `games/<name>/`
(one IWSDK project per game, with its `canvas/` and `assets/generated/`), `runs/<name>-<time>/` (pi's events, the
session, the media ledger, the check's pictures and report), `pi-home/` and `results.jsonl`. Games live outside the
repo so results stay out of git, and because pi reads `AGENTS.md` and `CLAUDE.md` from every parent folder of the
folder it works in.

## Run

```bash
npm install                                  # pi, in this folder
node runner/make-template.mjs                # once: IWSDK's starter (VR, hands, grabbing, walking), sounds, a smoke test
node runner/run.mjs preflight --prepare-only # a project and its runtime, no agent
node --experimental-strip-types runner/test-guard.mjs
node runner/preflight.mjs preflight          # paid, about 2 cents: answer, tool loop, image, IWSDK tools, guard, studio tools
node runner/test-studio.mjs <project> --paid # paid: one picture ($0.01) and one 3D model (Modal GPU time)
node runner/run.mjs river-dam "A forest river I can walk along, where I build a little dam and learn why water pushes harder the deeper it gets."
node runner/run.mjs river-dam --continue "Make the panel smaller and put the beaver where I can see it."
node runner/report.mjs
```

`run.mjs` leaves the game running in the emulator window; `node runner/show.mjs <name>` puts another built game
there. One game at a time: the next run takes the last game's runtime down.

## In the app

With `GAME_MODE=pi` in `.env`, a game asked for in Muse's Lab is built by this runner instead of the app's own
pipeline (`server/app/services/pi_build.py`), one at a time on the app's game queue, with the app's model and
reasoning level. Its files go under `server/data/pi/` (`PI_XR_ARCHIVE`), so make the starter there once:

```bash
PI_XR_ARCHIVE=server/data/pi node trial/pi-xr/runner/make-template.mjs
```

A finished game is served at `/api/play/<id>/` and opens as a page of its own from the Play shelf. A failed or
interrupted build stays failed until it is asked for again. Unset, the app builds as before.

## On a headset

```bash
node runner/shelf.mjs                        # every built game's production build, and a page that lists them
adb reverse tcp:8092 tcp:8092                # Quest over USB: then open http://localhost:8092/ in its browser
```

Over Wi-Fi the shelf is at `https://<this Mac>:8093/` (accept the certificate warning once). The shelf serves the
`dist/` folder the check builds, with no emulator and no dev server, so several games can be tried one after
another without the runner. `node runner/snapshot.mjs <name> <new name> "<note>"` keeps a game as it is before a
follow-up changes it.

## Scoring a build against its prompt

The independent check proves a game runs and its recorded hand steps work; it does not say how much of the request
was met. For a benchmark prompt, `benchmarks/<name>.rubric.json` in the archive lists the prompt's requirements one
sentence each, and `benchmarks/scores/<game>.json` holds a reviewer's verdict for each (met, partly, not met) with
the source line that backs it. `node runner/scores.mjs <name>` prints the builds side by side, and the shelf shows
each build's count.

## Reference runs with another model

The app's model is Muse; these are for comparison only. The keys never reach the agent's shell or a log.

```bash
# GPT-6.2 Astra builds the game and OpenAI's image model draws its pictures (key: OPENAI_API_KEY, or openai-temp.key in the archive)
PI_XR_MODEL=openai/gpt-6.2-astra PI_XR_THINKING=max PI_XR_IMAGE_PROVIDER=openai PI_XR_IMAGE_QUALITY=max \
  PI_XR_BENCHMARK=1 node runner/run.mjs <name> "<request>" --minutes 120 --usd 150
# a published benchmark prompt that specifies a whole app, word for word from a file
PI_XR_FREEFORM=1 node runner/run.mjs <name> --request-file <file>
```

`PI_XR_IMAGE_LARGE=1` draws pictures at about 3.7 megapixels; `PI_XR_IMAGES`, `PI_XR_MODELS` and `PI_XR_MEDIA_USD`
set the art allowance; `PI_XR_IDLE_S`, `PI_XR_TURNS` and `PI_XR_STEER_MIN` set the stuck-run stop, the turn stop
and the agent's two time nudges.

## What a game costs

- The model: Muse Ember, $0.10 per million input tokens ($0.004 cached) and $0.50 output. The river dam without art
  took 9.7 minutes and $0.07.
- A picture: $0.01 and about 30 s (Muse Image). A 3D model: the time of an RTX PRO 6000 on Modal: 20 to 40 s and
  2 to 4 cents when the generator is running, about 5 minutes and 28 cents for the first one after it has been idle
  (it scales to zero after 2 minutes). Keeping it warm for a whole build would cost more than the build, so the
  agent starts its production art in the background early (`generate_canvas_media` with `background: true`) and
  builds the playable slice meanwhile.
- A game's art budget (`MEDIA` in `runner/paths.mjs`): 8 pictures, 3 models, $1. The studio service refuses more.

## The independent check

After the agent stops, `check.mjs` judges the game by IWSDK's command line, from a fresh reload:

1. The design is the canvas main document with its 12 sections; the canvas files and references are valid;
   `package.json` and `vite.config.ts` are as the template left them.
2. `npm run typecheck` and `npm run build` pass.
3. The app loads with no console error of its own and enters XR with hands.
4. The first view is measured from where the headset starts (`first-view.mjs`): every panel is wholly within 45
   degrees of straight ahead, at most 0.7 m wide, 0.6 to 2.5 m away, turned to the player, with no cut-off text;
   every thing the play-test touches is within 50 degrees to the side and between 40 degrees down and 20 up;
   every control it presses has panel text (what the control does) within 0.2 m of it.
5. `playtest.json` (the hand steps the agent recorded with `playtest_record` as they worked) is replayed: every sequence completes,
   `GameState` changes at every step, there is a step for each move of the design, and the last state is a result
   with at least one star.

Generated art the game does not load is reported as a note. When the check fails, the same pi session gets the
failures as its next message, up to twice. The agent can run the same replay itself with `playtest_replay`.

## Safety

pi runs shell commands with the user's own permissions, as OhMyGame's does. Three things limit that here:

- `guard.ts` refuses commands that stop processes or the dev runtime, install, use git, download, name `.env`, or
  leave the project folder; it refuses writes outside the project and to the files the template fixes; and it caps
  images read at 16 (more than 30 images in one request fails).
- A `sandbox-exec` profile round pi: writes only in the game and the run folder; the rest of the home folder cannot
  be read (`.env`, `~/.npmrc`, `~/.ssh`); no signals to processes outside it.
- The studio service runs outside that sandbox, so the Modal login never reaches the agent; pi starts with a minimal
  environment, its shell has no keys, and the run's logs are scanned for the key.

Known limit: the sandbox does not block the network, because pi itself calls the model's API from inside it. The
guard's refusals (no `curl`, no installs, no git) stop the usual ways out, but a command such as `node -e` with
`fetch` is not refused. What the agent could send is limited to the project folder and the studio token, which its
shell does not have. Ids that the agent writes into the canvas files are checked before they become file paths.

The runner also records the processes on ports 8081 (the Quest preview) and 8787 (the app) before and after.
