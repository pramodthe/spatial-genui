# Server

The server the headset app talks to: FastAPI, with LangGraph for the flows and Deep Agents for the coder.

```
app/
  main.py        the routes (/api/...), the Studio page, and the built headset app when STATIC_DIR is set
  core/          settings (config.py), SQLite (db.py), model calls and prices (llm.py), spending and rate
                 limits (guard.py), background tasks, timestamps, panel glyphs, JSON from model replies
  pipeline/      how lessons and games are made: design, the coder agent, the grader, the gate, the graphs
                 (see pipeline/README.md)
  library/       the 3D model library: the catalogue, picking models for a lesson, real-world sizes
  services/      courses, saved games, live previews, voice, generated media and the Studio
library/         the 3D model and sound library: GLB models, their catalogue, sounds, CREDITS.md
data/            runtime files: database, checkpoints, saved courses, Studio runs, media (not tracked)
sandbox/image.py the coder's Modal image (Node, the gate, the headset app, the skills, the model library)
scripts/         build_sound_library.py: builds server/library/sounds once with the media provider
models.json      the models the API can call, with their prices (the cost meter reads them)
tests/           pytest: routes, graphs, the coder with a fake sandbox, the grader, prompts, skills' scripts
```

```bash
uv sync
uv run uvicorn app.main:app --host 0.0.0.0 --port 8787
uv run pytest
```

The coder needs a Modal account (`uv run modal setup`); it creates the `genui-coder` app and its image on first
use.
