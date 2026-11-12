# Benchmark summary

Source: `bench/results/pilot-claude` · 16 generations · 16 mounted in the emulator · 16 judge scores

| Model | n | pass@1 | Success (≤2 repairs) | Mounted clean | Grab works | Press works | Quality: claude-opus-5-5 (1–5) | Panel quality (all) | Panel, other-provider judges | Panel, adjusted for strictness | Median first try | Median total | Output tokens | Cost | Cost / success |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-fable-5-2 | 4 | 100% | 100% | 100% | 75% | 100% | 4.5 | – | – | – | 125.4 s | 125.4 s | 14853 | $2.459 | $0.6146 |
| claude-opus-5-5 | 4 | 75% | 100% | 100% | 100% | 100% | 4.06 | – | – | – | 54.1 s | 58.7 s | 6951 | $0.623 | $0.1558 |
| claude-sonnet-5-5 | 4 | 100% | 100% | 100% | 100% | – | 4 | – | – | – | 41.5 s | 41.5 s | 7441 | $0.318 | $0.0795 |
| claude-haiku-5-5 | 4 | 100% | 100% | 100% | 100% | 100% | 3.5 | – | – | – | 18 s | 18 s | 4770 | $0.01 | $0.0026 |

## Mean score each judge gave each model (rows = judge; judges grade on different curves)

| Judge | claude-opus-5-5 | claude-fable-5-2 | claude-sonnet-5-5 | claude-haiku-5-5 |
|---|---|---|---|---|
| claude-opus-5-5 (independent) | 4.06 (same company) | 4.5 (same company) | 4 (same company) | 3.5 (same company) |

## Success by tier (T1 single component · T2 composed scene · T3 interactive with state)

| Model | T1 | T2 | T3 |
|---|---|---|---|
| claude-opus-5-5 | 1/1 | 1/1 | 2/2 |
| claude-fable-5-2 | 1/1 | 1/1 | 2/2 |
| claude-sonnet-5-5 | 1/1 | 1/1 | 2/2 |
| claude-haiku-5-5 | 1/1 | 1/1 | 2/2 |

## Failed attempts by kind (before repair)

| Model | syntax |
|---|---|
| claude-opus-5-5 | 1 |
| claude-fable-5-2 | 0 |
| claude-sonnet-5-5 | 0 |
| claude-haiku-5-5 | 0 |
