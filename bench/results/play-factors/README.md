# What made the games good: a factor study (Nov 17, 2026)

The user played these games on a Quest 3 and rated the **P** games best ("the physics works, the interaction works,
the game assets are decent"). This study asks which factor made the difference, using games that already existed:
35 games, 11 setups, the same four requests (river dam, kite hill, desert canyon, paper plane). Every setup changed
one or a few things against another, so pairs that share the same requests show what each change did.

## How each game was scored

All 35 games were scored the same way, on the same day, with the same code (apps/xr preview with the XR emulator):

- **Picture score (0-20):** the opening view, taken the same way for every game (standing head pose, hands out of
  view, after the title card fades), judged **blind** by one judge (Claude Opus 5.5 through Claude Code) with shuffled,
  neutral file names. Four ratings of 1-5: *fits* the request, *clear* in five seconds, *looks* (cohesive, sensible
  sizes, nothing in the face), *idea* (the scene shows the idea to teach).
- **Layout must-fixes:** today's layout checker (apps/gate/src/layout.ts, v3) run on every module.
- **Hands probe:** an emulated hand presses up to three panel buttons and the first 3D button, then grabs an object,
  moves 10 cm and lets go (as in apps/xr/tests/bench-browser.mjs).
- **Build time** from the run records. All 35 games run without errors.

## Results by setup

| Setup | What it was | Model | Games | Picture score /20 | Fits | Clear | Looks | Idea | Layout must-fixes | Grab held | 3D press fired | Moves after release | Build min |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **B** | one coder, title art + own sounds (iteration 12) | gpt-6.1-sol | 2 | **11.0** | 3.0 | 2.5 | 3.0 | 2.5 | 0 | 2/2 | 0/2 | 0/2 | 14.3 |
| **E** | B + ECS kit (iteration 14) | gpt-6.1-sol | 2 | **13.5** | 4.0 | 3.5 | 3.0 | 3.0 | 1 | 2/2 | 1/2 | 2/2 | 12.4 |
| **A** | layout checker OFF (iteration 17) | gpt-6.1-sol | 3 | **13.0** | 4.3 | 3.0 | 3.0 | 2.7 | 4 | 3/3 | 1/2 | 0/3 | 11.7 |
| **L** | layout checker v1 ON (iteration 17) | gpt-6.1-sol | 3 | **11.3** | 4.0 | 2.7 | 2.3 | 2.3 | 3 | 2/2 | 1/2 | 0/2 | 12.0 |
| **M** | layout checker v2 ON (iteration 17b) | gpt-6.1-sol | 3 | **12.3** | 3.7 | 3.0 | 3.3 | 2.3 | 3 | 2/2 | 0/1 | 0/2 | 13.4 |
| **O** | checker OFF, $6 budget (iteration 18) | gpt-6.1-sol | 3 | **11.3** | 4.0 | 2.7 | 2.0 | 2.7 | 4 | 1/1 | 2/2 | 0/1 | 14.7 |
| **N** | checker v3 ON, $6 budget (iteration 18) | gpt-6.1-sol | 3 | **12.0** | 4.3 | 3.0 | 2.3 | 2.3 | 0 | 3/3 | 0/1 | 0/3 | 13.8 |
| **S** | slim game.js, checker v3, no pictures (iteration 19) | gpt-6.1-sol | 4 | **14.2** | 4.2 | 3.5 | 3.5 | 3.0 | 0 | 3/3 | 2/4 | 0/3 | 13.2 |
| **P** | slim game.js, checker v3, planning pictures (iteration 19) | gpt-6.1-sol | 4 | **13.8** | 4.2 | 3.0 | 3.5 | 3.0 | 1 | 3/3 | 2/3 | 0/3 | 13.5 |
| **DeepSeek** | DeepSeek V4.1 Flash, slim, checker v3, no pictures (model test) | deepseek-v4.1-flash | 4 | **10.5** | 3.0 | 2.2 | 3.0 | 2.2 | 0 | 3/3 | 1/4 | 1/3 | 17.4 |
| **Sonnet** | Sonnet 5.5 via Claude Code: slim, checker v3, no design step, no play-test, no pictures (model test) | claude-sonnet-5-5 | 4 | **12.2** | 3.0 | 3.0 | 3.0 | 3.2 | 0 | 4/4 | 1/4 | 0/4 | 13.6 |

## Results by factor

| Factor | Pair (same requests) | Change in picture score /20 | Per request | Layout must-fixes | Reading |
|---|---|---|---|---|---|
| **Model** (same pipeline) | S → DeepSeek | -3.75 (1 better, 3 worse, 0 same) | river-dam 14→10, kite-world 15→9, canyon-water 15→8, paper-plane 13→15 | 0 → 0 | Biggest single factor. gpt-6.1-sol beat DeepSeek V4.1 Flash on 3 of 4 with everything else the same; DeepSeek also took longer (17 vs 13 min) and cost about 8 times as much. |
| **Model** (outside our pipeline) | S → Sonnet | -2.00 (0 better, 3 worse, 1 same) | river-dam 14→14, kite-world 15→10, canyon-water 15→13, paper-plane 13→12 | 0 → 0 | Sonnet 5.5 was close but behind, and ran without our design step and play-test (it built the canyon as low banks). Not a clean model comparison. |
| **Round 19 pipeline cleanup** | N → S | +2.67 (3 better, 0 worse, 0 same) | river-dam 11→14, kite-world 12→15, canyon-water 13→15 | 0 → 0 | Big gain, 3 of 3 better. Several things changed at once (smaller game.js, the title shown by the host instead of a sign in the scene, the cost-meter fix, $6 → $3 budget), so it can't be pinned on one of them. |
| **Layout checker v3** | O → N | +0.67 (2 better, 1 worse, 0 same) | river-dam 14→11, kite-world 11→12, canyon-water 9→13 | 4 → 0 | Removes every layout must-fix (nothing blocking the start, nothing out of reach, nothing huge in your face) at no cost to looks. A safety floor, not a beauty boost. |
| Layout checker v1 | A → L | -1.67 (1 better, 2 worse, 0 same) | river-dam 16→12, kite-world 13→9, canyon-water 10→13 | 4 → 3 | The first versions did not help (scores went down on 2 of 3); v3 fixed what they missed. |
| Layout checker v2 | A → M | -0.67 (1 better, 2 worse, 0 same) | river-dam 16→12, kite-world 13→11, canyon-water 10→14 | 4 → 3 |  |
| **Planning pictures** | S → P | -0.50 (2 better, 2 worse, 0 same) | river-dam 14→11, kite-world 15→17, canyon-water 15→16, paper-plane 13→11 | 0 → 1 | Even on the first-look picture. The plan picture sets the composition: when the plan is good the game follows it (kite +2, canyon +1); when the plan crowds the view (river: huge stone pillars on both sides), so does the game (paper plane: the pointer ended up barely visible at the edge). In headset play the user rated P best: physics, interaction and assets. |
| **ECS kit** | B → E | +2.50 (2 better, 0 worse, 0 same) | kite-world 11→12, paper-plane 11→15 | 0 → 1 | Better on both (small sample). Game logic written as systems. |

## What made P good

1. **The model.** gpt-6.1-sol is the largest single factor: same requests and pipeline, DeepSeek scored 3.75 lower out of
   20, and Sonnet 5.5 (without our design step and play-test) 2 lower.
2. **The round-19 pipeline**: smaller game.js, the title shown by the host, the fixed cost meter. S and P are the two
   best setups on the picture score.
3. **Layout checker v3**: no blocking, unreachable or in-your-face layouts. It sets a floor rather than raising the
   ceiling.
4. **Planning pictures**: on the first look they are even with S, because the game copies the plan picture closely,
   good or bad. In play, the user found P the best (physics, interaction, assets), which a first-look picture can't
   show. They are worth keeping, and the next gain is a better plan picture: keep the sides of a world open, keep the
   first thing to touch in view, and draw the thing you play with at hand size.
5. **ECS kit**: better on both of its pairs (a small sample); it has been the coder's default since round 14, so S
   and P both use it.

## Limits

- Three or four games per setup, one picture each and one judge: a difference under about 2 points out of 20 is
  within noise. The headset play by the user is the stronger evidence for P.
- The hands probe makes one grab and one press. Grabbing works in every setup (the host does it), so it can't tell
  setups apart, and it can't play a game, so physics and game flow were judged only by the user on the headset.
- Older setups (A, L, M, B, E) still show the generated title pictures they made at the time.
- Desk games (paper plane) are shown in the emulator's furnished living room, the same room for every desk game; the
  judge sometimes counted that room against the asked "ink and toon" style.
- Sonnet ran outside the app (Claude Code, no design step, no play-test, no planning pictures).

## Best five by picture score

- **P kite-world** (17/20): Rolling hilltop with wind lines flowing past the kite and a lift arrow, and the cone clearly marks the reel handle.
- **A river-dam** (16/20): Forest stream with dam slots, timber and a clearly marked start button; notched posts only hint at depth and pressure.
- **P canyon-water** (16/20): Striking striped canyon with three sand mounds carved deeper and deeper, but no pointer or text says what to do first.
- **DeepSeek paper-plane** (15/20): Ink-style fold diagram on the desk, with the cone on the first dot and matching dashed creases that hint at even wings.
- **E paper-plane** (15/20): Tidy desk with a START block, a MIDDLE crease line, a runway and a toon poster; level wings and nose weight are only implied.

## Files

- `scores.json`: every game's setup, model, build time, layout must-fixes, judge ratings with the judge's note, and hands probe.
- `pictures/<setup>__<request>.jpg`: the opening view each game was judged on.
