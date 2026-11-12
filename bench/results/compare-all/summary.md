# Benchmark summary

Source: `bench/results/compare-all` · 120 generations · 119 of 120 mounted in the emulator · 332 judge scores

Success and pass@1 count a scene only if it passed the checks **and** ran in the emulator without errors. Failed scenes score 1/5 in every quality column, so each model's average covers all its scenes.

| Model | n | pass@1 | Success (≤2 repairs) | Failed scenes | Mounted clean | Grab works | Press works | Quality: claude-opus-5-5 (1–5) | Panel quality (all) | Panel, other-provider judges | Panel, adjusted for strictness | Median first try | Median total | Output tokens | Cost | Cost / success |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| muse-ember-1.0-max (improved system) | 24 | 100% | 100% | 0 | 100% | 100% | 100% | 4.3 | – | – | – | 27.6 s | 27.6 s | 17063 | – | – |
| claude-sonnet-5-5 | 24 | 100% | 100% | 0 | 100% | 82% | 100% | 4.18 | 4.33 | 4.53 | 4.32 | 39.7 s | 39.8 s | 6946 | $1.79 | $0.0746 |
| muse-spark-1.3 | 24 | 100% | 100% | 0 | 100% | 96% | 100% | 4.13 | 4.25 | 4.01 | 4.25 | 98.2 s | 98.2 s | 11400 | – | – |
| kimi-k3.1-pro-fw | 24 | 100% | 100% | 0 | 100% | 83% | 100% | 4.05 | – | – | – | 148.8 s | 148.9 s | 9378 | $2.337 | $0.0974 |
| deepseek-v4.1-flash | 24 | 88% | 96% | 1 | 96% | 100% | 100% | 3.84 | 4.05 | 4.02 | 3.98 | 46.7 s | 46.7 s | 16934 | $0.251 | $0.0109 |

## Mean score each judge gave each model (rows = judge; judges grade on different curves)

| Judge | claude-sonnet-5-5 | muse-spark-1.3 | deepseek-v4.1-flash | kimi-k3.1-pro-fw | muse-ember-1.0-max (improved system) |
|---|---|---|---|---|---|
| claude-opus-5-5 (independent) | 4.18 (same company) | 4.13 | 3.97 | 4.05 | 4.3 |
| claude-sonnet-5-5 | 3.94 (own model) | 3.89 | 3.6 | – | – |
| muse-spark-1.3 | 4.83 | 4.72 (own model) | 4.57 | – | – |
| deepseek-v4.1-flash | 4.23 | 4.14 | 4.11 (own model) | – | – |

## Success by tier (T1 single component · T2 composed scene · T3 interactive with state)

| Model | T1 | T2 | T3 |
|---|---|---|---|
| claude-sonnet-5-5 | 8/8 | 8/8 | 8/8 |
| muse-spark-1.3 | 8/8 | 8/8 | 8/8 |
| deepseek-v4.1-flash | 8/8 | 7/8 | 8/8 |
| kimi-k3.1-pro-fw | 8/8 | 8/8 | 8/8 |
| muse-ember-1.0-max (improved system) | 8/8 | 8/8 | 8/8 |

## Failed attempts by kind (before repair)

| Model | syntax | truncated |
|---|---|---|
| claude-sonnet-5-5 | 0 | 0 |
| muse-spark-1.3 | 0 | 0 |
| deepseek-v4.1-flash | 1 | 1 |
| kimi-k3.1-pro-fw | 0 | 0 |
| muse-ember-1.0-max (improved system) | 0 | 0 |
