# Benchmark summary

Source: `bench/results/run-2-kimi` · 24 generations · 24 of 24 mounted in the emulator · 24 judge scores

Success and pass@1 count a scene only if it passed the checks **and** ran in the emulator without errors. Failed scenes score 1/5 in every quality column, so each model's average covers all its scenes.

| Model | n | pass@1 | Success (≤2 repairs) | Failed scenes | Mounted clean | Grab works | Press works | Quality: claude-opus-5-5 (1–5) | Panel quality (all) | Panel, other-provider judges | Panel, adjusted for strictness | Median first try | Median total | Output tokens | Cost | Cost / success |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| kimi-k3.1-pro-fw | 24 | 100% | 100% | 0 | 100% | 83% | 100% | 4.05 | – | – | – | 148.8 s | 148.9 s | 9378 | $2.337 | $0.0974 |

## Mean score each judge gave each model (rows = judge; judges grade on different curves)

| Judge | kimi-k3.1-pro-fw |
|---|---|
| claude-opus-5-5 (independent) | 4.05 |

## Success by tier (T1 single component · T2 composed scene · T3 interactive with state)

| Model | T1 | T2 | T3 |
|---|---|---|---|
| kimi-k3.1-pro-fw | 8/8 | 8/8 | 8/8 |

## Failed attempts by kind (before repair)

_No failed attempts._
