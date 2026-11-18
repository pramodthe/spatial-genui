# RQ4: one-shot vs parallel builders

Source: `bench/results/rq1-a2ui-v3-*` (one-shot, version C) vs `bench/results/rq4-parallel-v3-*` (parallel builders); the same 12 prompts × 2, checker v3, emulator probes and judge (Claude Opus 5.5). Times and output tokens are medians over successful scenes; quality is the judge mean over working scenes (n). Made with:

```bash
npm run bench:rq4 -- --one-shot ../../bench/results/rq1-a2ui-v3-sonnet --parallel ../../bench/results/rq4-parallel-v3-sonnet
npm run bench:rq4 -- --one-shot ../../bench/results/rq1-a2ui-v3-ember --parallel ../../bench/results/rq4-parallel-v3-ember
```

## Sonnet 5.5 (plans by Haiku 5.5)

| Version | Model | n | Success | First try | First content (median) | Full lesson (median) | Output tokens (median) | Quality (judges) |
|---|---|---|---|---|---|---|---|---|
| one-shot | claude-sonnet-5-5 | 24 | 24/24 | 17 | 39.8 s | 39.8 s | 5621.5 | 3.88 (n=24) |
| parallel (placeholders at 6.2 s) | claude-sonnet-5-5 | 24 | 23/24 | 14 | 18.5 s | 50.0 s | 9093 | 3.62 (n=23) |

## Ember 1.0 (plans by Ember at low reasoning)

| Version | Model | n | Success | First try | First content (median) | Full lesson (median) | Output tokens (median) | Quality (judges) |
|---|---|---|---|---|---|---|---|---|
| one-shot | muse-ember-1.0-max | 24 | 22/24 | 15 | 29.1 s | 29.1 s | 12016.5 | 3.84 (n=22) |
| parallel (placeholders at 4.7 s) | muse-ember-1.0-max | 24 | 20/24 | 12 | 14.0 s | 40.0 s | 20712 | 3.58 (n=20) |
