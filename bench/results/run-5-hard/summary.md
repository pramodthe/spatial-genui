# Benchmark summary

Source: `bench/results/run-5-hard` · 60 generations · 60 of 60 mounted in the emulator · 60 judge scores

Success and pass@1 count a scene only if it passed the checks **and** ran in the emulator without errors. Failed scenes score 1/5 in every quality column, so each model's average covers all its scenes.

| Model | n | pass@1 | Success (≤2 repairs) | Failed scenes | Mounted clean | Grab works | Press works | Panel buttons work | Quality: claude-opus-5-5 (1–5) | Panel quality (all) | Panel, other-provider judges | Panel, adjusted for strictness | Median first try | Median total | Output tokens | Cost | Cost / success |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | 12 | 92% | 100% | 0 | 100% | 100% | 88% | 69% | 4 | – | – | – | 175.9 s | 187.5 s | 25627 | $3.169 | $0.2641 |
| kimi-k3.1-pro-fw | 12 | 83% | 100% | 0 | 100% | 100% | 89% | 76% | 3.98 | – | – | – | 291.2 s | 295.8 s | 18909 | $2.349 | $0.1958 |
| muse-ember-1.0-max | 12 | 100% | 100% | 0 | 100% | 100% | 83% | 91% | 3.92 | – | – | – | 46.8 s | 46.8 s | 27999 | – | – |
| muse-spark-1.3 | 12 | 92% | 100% | 0 | 100% | 91% | 100% | 75% | 3.67 | – | – | – | 267.9 s | 269.8 s | 15833 | – | – |
| deepseek-v4.1-flash | 12 | 100% | 100% | 0 | 100% | 67% | 100% | 82% | 3.63 | – | – | – | 110 s | 110.1 s | 29625 | $0.217 | $0.0181 |

## Mean score each judge gave each model (rows = judge; judges grade on different curves)

| Judge | claude-sonnet-5-5 | muse-spark-1.3 | deepseek-v4.1-flash | muse-ember-1.0-max | kimi-k3.1-pro-fw |
|---|---|---|---|---|---|
| claude-opus-5-5 (independent) | 4 (same company) | 3.67 | 3.63 | 3.92 | 3.98 |

## Success by tier (T1 single component · T2 composed scene · T3 interactive with state)

| Model | T4 |
|---|---|
| claude-sonnet-5-5 | 12/12 |
| muse-spark-1.3 | 12/12 |
| deepseek-v4.1-flash | 12/12 |
| muse-ember-1.0-max | 12/12 |
| kimi-k3.1-pro-fw | 12/12 |

## Failed attempts by kind (before repair)

| Model | panel-markup | panel-text-size | runtime-error |
|---|---|---|---|
| claude-sonnet-5-5 | 1 | 0 | 0 |
| muse-spark-1.3 | 0 | 1 | 0 |
| deepseek-v4.1-flash | 0 | 0 | 0 |
| muse-ember-1.0-max | 0 | 0 | 0 |
| kimi-k3.1-pro-fw | 0 | 0 | 2 |
