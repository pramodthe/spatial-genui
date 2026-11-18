# Benchmark summary

Source: `bench/results/rq4-parallel-v3-sonnet` · 24 generations · 23 of 23 mounted in the emulator · 23 judge scores

Success and pass@1 count a scene only if it passed the checks **and** ran in the emulator without errors. Quality is averaged per scene: a failed scene counts once as 1/5, a working scene as the mean of its judges, so each model's average covers all its scenes.

| Model | n | pass@1 | Success (≤2 repairs) | Failed scenes | Mounted clean | Grab works | Press works | Panel buttons work | Quality: claude-opus-5-5 (1–5) | Panel quality (all) | Panel, other-provider judges | Panel, adjusted for strictness | Median first try | Median total | Output tokens | Cost | Cost / success |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | 24 | 58% | 96% | 1 | 100% | 88% | 100% | 83% | 3.51 | – | – | – | 6.1 s | 50.3 s | 12237 | $3.411 | $0.1483 |

## Mean score each judge gave each model (rows = judge; judges grade on different curves)

| Judge | claude-sonnet-5-5 |
|---|---|
| claude-opus-5-5 (independent) | 3.62 (same company) |

## Success by tier (T1 single component · T2 composed scene · T3 interactive with state)

| Model | T1 | T2 | T3 |
|---|---|---|---|
| claude-sonnet-5-5 | 8/8 | 8/8 | 7/8 |

## Failed attempts by kind (before repair)

| Model | schema |
|---|---|
| claude-sonnet-5-5 | 12 |
