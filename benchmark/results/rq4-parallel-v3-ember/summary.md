# Benchmark summary

Source: `bench/results/rq4-parallel-v3-ember` · 24 generations · 20 of 20 mounted in the emulator · 20 judge scores

Success and pass@1 count a scene only if it passed the checks **and** ran in the emulator without errors. Quality is averaged per scene: a failed scene counts once as 1/5, a working scene as the mean of its judges, so each model's average covers all its scenes.

| Model | n | pass@1 | Success (≤2 repairs) | Failed scenes | Mounted clean | Grab works | Press works | Panel buttons work | Quality: claude-opus-5-5 (1–5) | Panel quality (all) | Panel, other-provider judges | Panel, adjusted for strictness | Median first try | Median total | Output tokens | Cost | Cost / success |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| muse-ember-1.0-max | 24 | 50% | 83% | 4 | 100% | 75% | 100% | 81% | 3.15 | – | – | – | 4.9 s | 41 s | 33481 | $0.446 | $0.0223 |

## Mean score each judge gave each model (rows = judge; judges grade on different curves)

| Judge | muse-ember-1.0-max |
|---|---|
| claude-opus-5-5 (independent) | 3.58 |

## Success by tier (T1 single component · T2 composed scene · T3 interactive with state)

| Model | T1 | T2 | T3 |
|---|---|---|---|
| muse-ember-1.0-max | 6/8 | 8/8 | 6/8 |

## Failed attempts by kind (before repair)

| Model | schema | unsupported-glyph |
|---|---|---|
| muse-ember-1.0-max | 46 | 7 |
