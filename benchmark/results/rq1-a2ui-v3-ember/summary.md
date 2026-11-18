# Benchmark summary

Source: `bench/results/rq1-a2ui-v3-ember` · 24 generations · 22 of 22 mounted in the emulator · 22 judge scores

Success and pass@1 count a scene only if it passed the checks **and** ran in the emulator without errors. Quality is averaged per scene: a failed scene counts once as 1/5, a working scene as the mean of its judges, so each model's average covers all its scenes.

| Model | n | pass@1 | Success (≤2 repairs) | Failed scenes | Mounted clean | Grab works | Press works | Panel buttons work | Quality: claude-opus-5-5 (1–5) | Panel quality (all) | Panel, other-provider judges | Panel, adjusted for strictness | Median first try | Median total | Output tokens | Cost | Cost / success |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| muse-ember-1.0-max | 24 | 63% | 92% | 2 | 100% | 85% | 100% | 87% | 3.6 | – | – | – | 19.7 s | 30.4 s | 13610 | $0.176 | $0.008 |

## Mean score each judge gave each model (rows = judge; judges grade on different curves)

| Judge | muse-ember-1.0-max |
|---|---|
| claude-opus-5-5 (independent) | 3.84 |

## Success by tier (T1 single component · T2 composed scene · T3 interactive with state)

| Model | T1 | T2 | T3 |
|---|---|---|---|
| muse-ember-1.0-max | 6/8 | 8/8 | 8/8 |

## Failed attempts by kind (before repair)

| Model | invalid-json | other | panel-text-size |
|---|---|---|---|
| muse-ember-1.0-max | 2 | 8 | 5 |
