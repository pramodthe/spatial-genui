# Benchmark summary

Source: `bench/results/rq1-template-v2` · 48 generations · 48 of 48 mounted in the emulator · 48 judge scores

Success and pass@1 count a scene only if it passed the checks **and** ran in the emulator without errors. Quality is averaged per scene: a failed scene counts once as 1/5, a working scene as the mean of its judges, so each model's average covers all its scenes.

| Model | n | pass@1 | Success (≤2 repairs) | Failed scenes | Mounted clean | Grab works | Press works | Panel buttons work | Quality: claude-opus-5-5 (1–5) | Panel quality (all) | Panel, other-provider judges | Panel, adjusted for strictness | Median first try | Median total | Output tokens | Cost | Cost / success |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | 24 | 100% | 100% | 0 | 100% | 67% | 100% | 93% | 3.01 | – | – | – | 9.3 s | 10.7 s | 1443 | $0.414 | $0.0172 |
| muse-ember-1.0-max | 24 | 100% | 100% | 0 | 100% | 67% | 100% | 93% | 2.98 | – | – | – | 6.9 s | 8.6 s | 3796 | $0.048 | $0.002 |

## Mean score each judge gave each model (rows = judge; judges grade on different curves)

| Judge | claude-sonnet-5-5 | muse-ember-1.0-max |
|---|---|---|
| claude-opus-5-5 (independent) | 3.01 (same company) | 2.98 |

## Success by tier (T1 single component · T2 composed scene · T3 interactive with state)

| Model | T1 | T2 | T3 |
|---|---|---|---|
| claude-sonnet-5-5 | 8/8 | 8/8 | 8/8 |
| muse-ember-1.0-max | 8/8 | 8/8 | 8/8 |

## Failed attempts by kind (before repair)

_No failed attempts._
