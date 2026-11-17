# Benchmark

The prompts and results of the project's evaluations. The scripts that produced them were removed from the app in
November 2026 to keep the repository to what the app runs; they are in the git history up to commit `07edb30`
(`apps/gate/research`, `apps/api/research`, `apps/api/scripts/play_bench.py`).

## Results

| Folder | What it measured |
|---|---|
| [`results/play-factors`](results/play-factors) | What made the learning games good: 35 games, 11 setups (models, layout checker, planning pictures, ECS kit), judged blind from the same opening view, with a layout check and a hands probe. `games/` holds the kept games' modules. |
| [`results/run-1`](results/run-1) … [`run-5-hard`](results/run-5-hard), [`compare-fair`](results/compare-fair) | Phase 2: models compared on the same one-call lesson writer, on the held-out test requests (galleries and summaries). |
| [`results/3d-run-1`](results/3d-run-1) | Phase 3: three ways to build a 3D learning object with named parts (three.js code, CadQuery, an agent in Blender), judged from renders. |
| [`results/rq1-*`](results/rq1-compare) | RQ1: code against structured UI formats (A2UI, templates). |
| [`results/rq4-*`](results/rq4-compare) | RQ4: one writer against parallel builders. |

Each results folder has a `summary.md` or `gallery.md`, and `results.jsonl` with one generation per line.

## Prompts

| File | Requests |
|---|---|
| `prompts/play-40.json` | 40 learning-game requests: desk and world, ages 9 to adult |
| `prompts/test-12.json`, `prompts/hard-12.json` | the held-out lesson requests for model comparisons (`dev-10.json` tuned the prompt) |
| `prompts/objects-12.json`, `prompts/library-objects.json`, `prompts/trellis-lessons.json`, `prompts/retrieved-lessons.json`, `prompts/m3-lessons.json` | 3D objects and lessons built on them |
| `prompts/demo-4.json`, `prompts/lessons-3.json`, `prompts/repair-pilot.json` | small sets for demos and the repair pilot |
