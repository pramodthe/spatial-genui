# Benchmark summary

Source: `bench/results/rq1-compare` · 144 generations · 142 of 142 mounted in the emulator · 142 judge scores

Success and pass@1 count a scene only if it passed the checks **and** ran in the emulator without errors. Quality is averaged per scene: a failed scene counts once as 1/5, a working scene as the mean of its judges, so each model's average covers all its scenes.

| Model | n | pass@1 | Success (≤2 repairs) | Failed scenes | Mounted clean | Grab works | Press works | Panel buttons work | Quality: claude-opus-5-5 (1–5) | Panel quality (all) | Panel, other-provider judges | Panel, adjusted for strictness | Median first try | Median total | Output tokens | Cost | Cost / success |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Ember·A-code | 24 | 100% | 100% | 0 | 100% | 100% | 100% | 86% | 4.3 | – | – | – | 27.6 s | 27.6 s | 17063 | – | – |
| Sonnet·A-code | 24 | 100% | 100% | 0 | 100% | 100% | 100% | 92% | 4.29 | – | – | – | 41.7 s | 41.7 s | 6399 | $1.682 | $0.0701 |
| Sonnet·C-a2ui | 24 | 71% | 100% | 0 | 100% | 90% | 100% | 96% | 3.88 | – | – | – | 34.2 s | 39.8 s | 7653 | $2.097 | $0.0874 |
| Sonnet·D-template | 24 | 100% | 100% | 0 | 100% | 67% | 100% | 93% | 3.01 | – | – | – | 9.3 s | 10.7 s | 1443 | $0.414 | $0.0172 |
| Ember·D-template | 24 | 100% | 100% | 0 | 100% | 67% | 100% | 93% | 2.98 | – | – | – | 6.9 s | 8.6 s | 3796 | $0.048 | $0.002 |
| Ember·C-a2ui | 24 | 63% | 92% | 2 | 100% | 85% | 100% | 87% | 3.6 | – | – | – | 19.7 s | 30.4 s | 13610 | $0.176 | $0.008 |

## Mean score each judge gave each model (rows = judge; judges grade on different curves)

| Judge | Sonnet·A-code | Sonnet·C-a2ui | Sonnet·D-template | Ember·A-code | Ember·C-a2ui | Ember·D-template |
|---|---|---|---|---|---|---|
| claude-opus-5-5 (independent) | 4.29 (same company) | 3.88 (same company) | 3.01 (same company) | 4.3 | 3.84 | 2.98 |

## Success by tier (T1 single component · T2 composed scene · T3 interactive with state)

| Model | T1 | T2 | T3 |
|---|---|---|---|
| Sonnet·A-code | 8/8 | 8/8 | 8/8 |
| Sonnet·C-a2ui | 8/8 | 8/8 | 8/8 |
| Sonnet·D-template | 8/8 | 8/8 | 8/8 |
| Ember·A-code | 8/8 | 8/8 | 8/8 |
| Ember·C-a2ui | 6/8 | 8/8 | 8/8 |
| Ember·D-template | 8/8 | 8/8 | 8/8 |

## Failed attempts by kind (before repair)

| Model | invalid-json | other | panel-text-size |
|---|---|---|---|
| Sonnet·A-code | 0 | 0 | 0 |
| Sonnet·C-a2ui | 0 | 0 | 7 |
| Sonnet·D-template | 0 | 0 | 0 |
| Ember·A-code | 0 | 0 | 0 |
| Ember·C-a2ui | 2 | 8 | 5 |
| Ember·D-template | 0 | 0 | 0 |
