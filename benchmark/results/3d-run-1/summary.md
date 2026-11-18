# Phase 3 benchmark: 3D generation pipelines

Source: `bench/results/3d-run-1` · 72 jobs (12 objects × 3 pipelines × 2 variants) · generator `muse-ember-1.0-max` · critic `muse-ember-1.0-max` (≤3 rounds, stops at 8/10 with all parts named) · judge `claude-opus-5-5` on four-view renders

A job that produced no model counts as 1/5 in the judge average and 0 in the parts columns, so every average covers all jobs. "Parts named" is checked in the GLB file (required parts present as separately named nodes); "parts visible" is the judge's call from the renders. With the critic, the delivered model is the round the critic scored highest; time and cost include the whole loop.

| Pipeline | Add-ons | Works | Judge overall (1–5) | Recognizable | Accuracy | Craft | Parts named | Parts visible | Triangles (median) | Meshes (median) | GLB (median) | Time to model (median) | Cost / model |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| p1-threejs | none | 12/12 | **3.75** | 4.58 | 3.58 | 3.75 | 100% | 100% | 6072 | 37 | 280 KB | 28 s | $0.009 |
| p1-threejs | critic (M2) | 12/12 | **3.75** | 4.67 | 3.58 | 3.92 | 100% | 100% | 6072 | 42 | 323 KB | 53 s | $0.022 |
| p1-threejs | reference image (M1) | 12/12 | **3.75** | 4.58 | 3.58 | 3.67 | 100% | 99% | 7646 | 51 | 306 KB | 53 s | $0.020 |
| p1-threejs | reference + critic | 12/12 | **3.92** | 4.67 | 3.75 | 3.67 | 100% | 100% | 8254 | 50 | 399 KB | 72 s | $0.035 |
| p2-cadquery | none | 12/12 | **3.42** | 4.33 | 3.33 | 3.50 | 100% | 99% | 21640 | 12 | 475 KB | 55 s | $0.013 |
| p2-cadquery | critic (M2) | 12/12 | **3.67** | 4.42 | 3.42 | 3.42 | 100% | 99% | 24078 | 14 | 552 KB | 112 s | $0.038 |
| p2-cadquery | reference image (M1) | 12/12 | **3.25** | 4.17 | 3.17 | 3.08 | 100% | 96% | 21696 | 15 | 516 KB | 63 s | $0.024 |
| p2-cadquery | reference + critic | 12/12 | **3.50** | 4.42 | 3.42 | 3.33 | 100% | 100% | 19098 | 13 | 458 KB | 159 s | $0.048 |
| p3-blender | none | 12/12 | **3.58** | 4.33 | 3.58 | 3.58 | 100% | 97% | 6410 | 18 | 191 KB | 39 s | $0.013 |
| p3-blender | critic (M2) | 12/12 | **3.67** | 4.50 | 3.67 | 3.58 | 100% | 100% | 6540 | 18 | 191 KB | 71 s | $0.054 |
| p3-blender | reference image (M1) | 12/12 | **3.42** | 4.17 | 3.33 | 3.17 | 100% | 97% | 7880 | 30 | 265 KB | 67 s | $0.037 |
| p3-blender | reference + critic | 12/12 | **3.67** | 4.33 | 3.58 | 3.50 | 100% | 99% | 7946 | 30 | 228 KB | 126 s | $0.132 |

## Critic effect (same starting model, judge overall after − before)

| Pipeline | Variant | Jobs | Improved | Worse | Mean change | Revision rounds (mean) | Jobs with a failed revision |
|---|---|---|---|---|---|---|---|
| p1-threejs | base | 12 | 0 | 0 | +0.00 | 0.9 | 0 |
| p1-threejs | ref | 12 | 2 | 0 | +0.17 | 0.9 | 0 |
| p2-cadquery | base | 12 | 3 | 0 | +0.25 | 1.3 | 0 |
| p2-cadquery | ref | 12 | 3 | 0 | +0.25 | 1.7 | 0 |
| p3-blender | base | 12 | 1 | 0 | +0.08 | 1.2 | 0 |
| p3-blender | ref | 12 | 4 | 1 | +0.25 | 1.6 | 0 |

Critic vs judge on the same renders: Pearson r = 0.54 (n = 110).

## By category (judge overall, all four conditions pooled)

| Category | Objects | p1-threejs | p2-cadquery | p3-blender |
|---|---|---|---|---|
| astronomy | saturn, lunar-lander | 3.75 | 3.63 | 3.75 |
| biology | heart, plant-cell, flower | 3.58 | 3.08 | 3.33 |
| mechanical | gear-train, bicycle, engine-cylinder | 3.92 | 3.67 | 3.92 |
| everyday | guitar, office-chair | 3.75 | 3.50 | 3.25 |
| architecture | greek-temple | 4.00 | 4.00 | 4.00 |
| earth-science | volcano | 4.00 | 3.00 | 3.25 |

## Failures (0)

None.

Gallery: [gallery.md](gallery.md) · [gallery.html](gallery.html). The per-job folders (`jobs/`: every code version, GLB and four-view render) and full-size reference images (`refs/`) are not committed; `npm run bench3d` regenerates them.
