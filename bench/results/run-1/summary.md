# Benchmark summary

Source: `bench/results/run-1` · 72 generations · 72 mounted in the emulator · 284 judge scores

| Model | n | pass@1 | Success (≤2 repairs) | Mounted clean | Grab works | Press works | Quality: claude-opus-5-5 (1–5) | Panel quality (all) | Panel, other-provider judges | Panel, adjusted for strictness | Median first try | Median total | Output tokens | Cost | Cost / success |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | 24 | 100% | 100% | 100% | 82% | 100% | 4.18 | 4.33 | 4.53 | 4.32 | 39.7 s | 39.8 s | 6946 | $1.79 | $0.0746 |
| muse-spark-1.3 | 24 | 100% | 100% | 100% | 96% | 100% | 4.13 | 4.25 | 4.01 | 4.25 | 98.2 s | 98.2 s | 11400 | – | – |
| deepseek-v4.1-flash | 24 | 92% | 100% | 96% | 100% | 100% | 3.97 | 4.09 | 4.08 | 4.05 | 46.7 s | 46.7 s | 16934 | $0.251 | $0.0105 |

## Mean score each judge gave each model (rows = judge; judges grade on different curves)

| Judge | claude-sonnet-5-5 | muse-spark-1.3 | deepseek-v4.1-flash |
|---|---|---|---|
| claude-opus-5-5 (independent) | 4.18 (same company) | 4.13 | 3.97 |
| claude-sonnet-5-5 | 3.94 (own model) | 3.89 | 3.6 |
| muse-spark-1.3 | 4.83 | 4.72 (own model) | 4.57 |
| deepseek-v4.1-flash | 4.23 | 4.14 | 4.11 (own model) |

## Success by tier (T1 single component · T2 composed scene · T3 interactive with state)

| Model | T1 | T2 | T3 |
|---|---|---|---|
| claude-sonnet-5-5 | 8/8 | 8/8 | 8/8 |
| muse-spark-1.3 | 8/8 | 8/8 | 8/8 |
| deepseek-v4.1-flash | 8/8 | 8/8 | 8/8 |

## Failed attempts by kind (before repair)

| Model | syntax | truncated |
|---|---|---|
| claude-sonnet-5-5 | 0 | 0 |
| muse-spark-1.3 | 0 | 0 |
| deepseek-v4.1-flash | 1 | 1 |
