# Benchmark summary

Source: `bench/results/rq1-a2ui-v3-sonnet` · 24 generations · 24 of 24 mounted in the emulator · 24 judge scores

Success and pass@1 count a scene only if it passed the checks **and** ran in the emulator without errors. Quality is averaged per scene: a failed scene counts once as 1/5, a working scene as the mean of its judges, so each model's average covers all its scenes.

| Model | n | pass@1 | Success (≤2 repairs) | Failed scenes | Mounted clean | Grab works | Press works | Panel buttons work | Quality: claude-opus-5-5 (1–5) | Panel quality (all) | Panel, other-provider judges | Panel, adjusted for strictness | Median first try | Median total | Output tokens | Cost | Cost / success |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | 24 | 71% | 100% | 0 | 100% | 90% | 100% | 96% | 3.88 | – | – | – | 34.2 s | 39.8 s | 7653 | $2.097 | $0.0874 |

## Mean score each judge gave each model (rows = judge; judges grade on different curves)

| Judge | claude-sonnet-5-5 |
|---|---|
| claude-opus-5-5 (independent) | 3.88 (same company) |

## Success by tier (T1 single component · T2 composed scene · T3 interactive with state)

| Model | T1 | T2 | T3 |
|---|---|---|---|
| claude-sonnet-5-5 | 8/8 | 8/8 | 8/8 |

## Failed attempts by kind (before repair)

| Model | panel-text-size |
|---|---|
| claude-sonnet-5-5 | 7 |
