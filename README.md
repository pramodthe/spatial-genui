# Spatial Generative UI (Meta VR Start Developer Competition 2026)

An AI agent writes spatial UI components as code at runtime; a small host runs them in a
WebXR passthrough scene on Meta Quest, with hand interaction. See `SPEC.md` for the plan and
`docs/paper/prior-art.md` for related work.

## Layout

```
apps/server/   agent server: OpenAI-compatible LLM client, safety check, dry run, repair loop
apps/xr/       IWSDK WebXR app: GenUI host (src/genui/), desktop prompt box, test scripts (tests/)
docs/paper/    research notes
```

## Setup

1. Node 22.12+ (or 20.19+). Copy `.env.example` to `.env` and set `LLM_API_KEY`.
   Any OpenAI-compatible endpoint works: change `LLM_BASE_URL` and `LLM_MODEL` to switch provider.
2. `cd apps/server && npm install` and `cd apps/xr && npm install`.

## Run

```bash
# Terminal 1: agent server on :8787 (restarts on code changes; restart manually after editing .env)
cd apps/server && npm run dev

# Terminal 2: IWSDK dev server + emulator browser on https://localhost:8081
cd apps/xr && npx @iwsdk/cli dev up --allow-browser-automation
```

Type a request in the "Generative UI" box at the bottom left (e.g. "Teach me the solar system with a
short quiz"). `/example` mounts the system prompt's built-in example without calling the model.

## Useful commands

```bash
# Generate from the command line (no browser time limit); every run is logged to apps/server/runs/
cd apps/server && npm run gen -- "a quiz about the human heart"

# Mount the latest successful run in the emulator
cd apps/xr && npx @iwsdk/cli browser run tests/mount-last-run.mjs

# Grab a generated object with an emulated hand
npx @iwsdk/cli xr set-input-mode --input-json '{"mode":"hand"}'
npx @iwsdk/cli xr run-sequence --input-json '{"device":"hand-right","steps":[{"pinch":0,"duration":0.2},{"target":"Mars","approach":{"distance":0.1},"pinch":{"value":1,"at":"arrival"}}]}'
```

On a Quest on the same Wi-Fi, open the `network` URL from `npx @iwsdk/cli dev status` and accept the
local certificate warning. The desktop prompt box is not visible inside an immersive session yet
(in-headset input is Phase 4).
