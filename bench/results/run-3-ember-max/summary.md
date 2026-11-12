# Benchmark summary

Source: `bench/results/run-3-ember-max` · 24 generations · 24 of 24 mounted in the emulator · 24 judge scores

Success and pass@1 count a scene only if it passed the checks **and** ran in the emulator without errors. Failed scenes score 1/5 in every quality column, so each model's average covers all its scenes.

| Model | n | pass@1 | Success (≤2 repairs) | Failed scenes | Mounted clean | Grab works | Press works | Quality: claude-opus-5-5 (1–5) | Panel quality (all) | Panel, other-provider judges | Panel, adjusted for strictness | Median first try | Median total | Output tokens | Cost | Cost / success |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| muse-ember-1.0-max | 24 | 100% | 100% | 0 | 100% | 100% | 100% | 4.3 | – | – | – | 27.6 s | 27.6 s | 17063 | – | – |

## Mean score each judge gave each model (rows = judge; judges grade on different curves)

| Judge | muse-ember-1.0-max |
|---|---|
| claude-opus-5-5 (independent) | 4.3 |

## Success by tier (T1 single component · T2 composed scene · T3 interactive with state)

| Model | T1 | T2 | T3 |
|---|---|---|---|
| muse-ember-1.0-max | 8/8 | 8/8 | 8/8 |

## Failed attempts by kind (before repair)

_No failed attempts._
