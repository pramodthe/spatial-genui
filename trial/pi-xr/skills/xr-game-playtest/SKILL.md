---
name: xr-game-playtest
description: Test a VR game in the emulated headset with real hand input - boot, the first view, each hand move, the round, reset, the console, screenshots - and write the working hand sequences to playtest.json.
---

# XR Game Playtest

Choose checks for the risks the change touches, not a full pass every time. After checks pass, repeat or widen them only for relevant changes, failures or new evidence.

## Choose the pass

- `smoke`: the app loads, the console is clean, XR is entered, and the first hand action works.
- `feature`: the new behaviour, its entry and exit states, its failure cases and what sits next to it.
- `bug regression`: reproduce the old failure, verify the fix, check the nearest related paths.
- `visual`: capture the opening view and the result view; judge visibility, framing, clipping and feedback.
- `full`: every move, Start, one round to its result, Try again, written down as `playtest.json`.

## Workflow

1. Run `npm run typecheck` first. A type error can stop a system starting with no message in the browser.
2. Enter XR and set hand mode: `xr_get_session_status`, `xr_accept_session` when a session is offered, `xr_set_input_mode` with `{"mode":"hand"}`. A saved file reloads the page and a reload leaves XR, so do this again after every edit.
3. `xr_list_targets` shows what the hand can find by name. A thing that is not listed cannot be grabbed or pressed by a sequence.
4. Exercise the changed actions with `xr_run_sequence` (the sequences are in `../xr-game-studio/references/hand-actions.md`), then read `GameState` with `ecs_find_entities` and `ecs_query_entity`.
5. Read `browser_get_console_logs` after loading and after playing.
6. For looks, take `browser_screenshot` and read the file. State cannot show that a model is the wrong way up or that a panel hides the playfield.
7. Before finishing a game that has a mockup, compare the two: the opening-view screenshot, taken from the player's start right after entering XR, beside the mockup picture. Name the three biggest differences, fix the cheap ones, and report the rest.

## Policy

- **State is the evidence for behaviour; pictures are the evidence for looks.** Prove a move with `GameState`, not with a screenshot. Read at most 6 pictures in a session: every image stays in context to the end.
- **Real input only.** Reach a state by playing to it with hand sequences. Do not set `GameState` or move entities with ECS tools to pass a check; the replay of `playtest.json` starts from a fresh reload and has only hands.
- **When a sequence does not register**, check in this order: the session is in XR; the target's name is in the target list; the thing has its grab or press component; the hand can reach it (0.4 to 0.7 m in front, 0.8 to 1.2 m up); a `selectstart` event is in the result.
- A press landed when `presses[0].contactMs` is under 800; at 800 or more, run it once more.
- Do not install test tools or write a test harness; the emulated headset is the test.

## Write it down

Record each step with `playtest_record`: give it an id, the hand sequence and what `GameState` should show afterwards. It runs the sequence, compares the state before and after, and writes the step into `playtest.json` only when the move worked, so the file is always in the format the independent check replays (`../xr-game-studio/references/playtest-format.md`). Do not write that file by hand. Record one step per move in order, then Start, then the round.

Whenever you place or move things, check the layout with `playtest_view`: it reloads, enters XR and measures the first view in about 15 seconds without playing. Once the game is complete, run `playtest_replay` (about 40 seconds). It reloads the page, enters XR and replays the whole file with hands only, exactly as the independent check will, and it measures the same first view: every panel must be wholly within 45 degrees of straight ahead, at most 0.7 m wide, 0.6 to 2.5 m away and turned to the player, with no cut-off text; every thing the hands must touch must be within 50 degrees to the side and between 40 degrees down and 20 up. Fix what it reports with the numbers it gives, and run it again until it passes.

## Review focus

Select only what the change touches:

- the first view: what the player sees in the first second, and whether the thing to touch first is obvious
- reach and comfort: nothing to grab below the knee, above the shoulder or behind the player; the standing spot is empty
- feedback: every hand action answers at once, seen and heard
- the panel: readable from where the player stands, not hiding the playfield, updated in every phase
- transitions: learn to play, play to result, Try again, Next level
- loading: missing assets, console errors, a blank or half-built scene
- art: the generated models in view from the start, at the right scale and the right way up; no starter content left
- the view: nothing big between the player and the main thing; panel text inside its panel

Report what was checked and how: typecheck, build, hand sequences, state, screenshots. Say plainly what was not checked. A build or one screenshot is not a playtest.
