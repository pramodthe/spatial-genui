# Benchmark summary

Source: `bench/results/run-4-fair` · 96 generations · 96 of 96 mounted in the emulator · 96 judge scores

Success and pass@1 count a scene only if it passed the checks **and** ran in the emulator without errors. Failed scenes score 1/5 in every quality column, so each model's average covers all its scenes.

| Model | n | pass@1 | Success (≤2 repairs) | Failed scenes | Mounted clean | Grab works | Press works | Panel buttons work | Quality: claude-opus-5-5 (1–5) | Panel quality (all) | Panel, other-provider judges | Panel, adjusted for strictness | Median first try | Median total | Output tokens | Cost | Cost / success |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| kimi-k3.1-pro-fw | 24 | 96% | 100% | 0 | 100% | 92% | 91% | 89% | 4.3 | – | – | – | 159.3 s | 159.3 s | 9983 | $2.504 | $0.1043 |
| claude-sonnet-5-5 | 24 | 100% | 100% | 0 | 100% | 100% | 100% | 92% | 4.29 | – | – | – | 41.7 s | 41.7 s | 6399 | $1.682 | $0.0701 |
| muse-spark-1.3 | 24 | 79% | 100% | 0 | 100% | 96% | 100% | 71% | 4.29 | – | – | – | 119.3 s | 119.4 s | 12264 | – | – |
| deepseek-v4.1-flash | 24 | 100% | 100% | 0 | 100% | 92% | 100% | 95% | 4.22 | – | – | – | 48.6 s | 48.6 s | 16816 | $0.25 | $0.0104 |

## Mean score each judge gave each model (rows = judge; judges grade on different curves)

| Judge | claude-sonnet-5-5 | muse-spark-1.3 | deepseek-v4.1-flash | kimi-k3.1-pro-fw |
|---|---|---|---|---|
| claude-opus-5-5 (independent) | 4.29 (same company) | 4.29 | 4.22 | 4.3 |

## Success by tier (T1 single component · T2 composed scene · T3 interactive with state)

| Model | T1 | T2 | T3 |
|---|---|---|---|
| claude-sonnet-5-5 | 8/8 | 8/8 | 8/8 |
| muse-spark-1.3 | 8/8 | 8/8 | 8/8 |
| deepseek-v4.1-flash | 8/8 | 8/8 | 8/8 |
| kimi-k3.1-pro-fw | 8/8 | 8/8 | 8/8 |

## Failed attempts by kind (before repair)

| Model | panel-markup | panel-text-size | syntax |
|---|---|---|---|
| claude-sonnet-5-5 | 0 | 0 | 0 |
| muse-spark-1.3 | 1 | 4 | 0 |
| deepseek-v4.1-flash | 0 | 0 | 0 |
| kimi-k3.1-pro-fw | 0 | 0 | 1 |
