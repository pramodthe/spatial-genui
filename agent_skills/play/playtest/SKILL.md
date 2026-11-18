---
name: playtest
description: Play-test the module in the real headset app, run headless in this sandbox by Meta's IWSDK runtime - open it in XR with emulated hands, look at a screenshot of it, try each hand action with an emulated hand, and read the console. Use it after the check passes, before you finish any lesson or game, and whenever you need to see what you built or why something does not work in the headset.
---

# Play-test

The check proves the module runs; it cannot tell you whether a player would understand it. Before you finish, look
at your game the way a player first sees it, and try its hand actions with a hand. Meta's IWSDK runtime runs the real
headset app headless in this sandbox (an emulated Quest: headset, hands, WebXR), so what you see is what the player
gets.

## Steps

1. **Open it and look.** Run

   ```
   node /skills/play/playtest/scripts/playtest.mjs /work/module.js        # add --game for a game
   ```

   It starts the runtime if needed (about 30 s the first time), opens the module in XR with hands, points the
   emulated headset at it and saves a screenshot. It prints JSON: `mounted`, `error`, the hand targets the app
   found (`grabbables`, `pressables`, `panelButtons`, each with its `center` in metres), `consoleErrors` and
   `screenshot`. Then look at the picture: `read_file /work/playtest/view-1.png`.

2. **The 5-second test, on the picture.** Answer honestly, as a first-time player:
   - What is the game, and what do I do first? Is the thing to touch big, in front and standing out?
   - Does the panel's first line say the whole game in one sentence?
   - Is anything hidden, cut off, overlapping, too small or floating where it should not be?
   If the answer to any is wrong, fix the module, run the check again, and play-test again.

3. **Try each hand action with a hand.** Use a target's `center` from the report:

   ```
   cd /opt/xr && npx iwsdk xr run-sequence --input-json '{"device":"hand-right","steps":[
     {"label":"grab","position":{"x":0.09,"y":1.04,"z":-0.38},"approach":{"distance":0.06},"pinch":{"value":1,"at":"arrival"}},
     {"label":"move","position":{"x":-0.05,"y":1.06,"z":-0.38}},
     {"label":"let go","pinch":0,"duration":0.15}]}'
   ```

   Press a button with `{"position": ..., "press": {}}` instead of a pinch. A step can name the thing instead of
   giving a position, when its name is the only one like it: `{"label":"grab","target":"Coin 2","approach":...}`.
   Then take another picture to see what changed: `node /skills/play/playtest/scripts/playtest.mjs --shot-only`
   and read the new `view-N.png`. The move should visibly do what the game says (the flap folds, the piece lands,
   the score changes).

4. **Errors.** `consoleErrors` lists runtime errors from the app; `cd /opt/xr && npx iwsdk browser logs` shows the
   full console. A module that throws in `update()` stops moving in the headset: fix every error you see.

5. **Check what a move did, without a picture.** A picture costs far more than text. Read the game's state before
   and after a move:

   ```
   node /skills/play/playtest/scripts/playtest.mjs --state     # before
   # ... the xr run-sequence from step 3 ...
   node /skills/play/playtest/scripts/playtest.mjs --state     # after
   ```

   It prints each piece the hands can pick up with its `center` (metres) and `held`, what glows, `handlerCalls`
   (presses the game answered) and `game`: what your play block's `state()` returns. Add the values your game
   counts to it, beside the four the check reads:

   ```js
   state: () => ({ phase, move, result, stars, scaleGrams, eggs, turns }),
   ```

   Use plain numbers, text and true/false. The move worked when `--state` shows the value the game says it
   changes. Take a picture only to judge how it looks (step 2), not to learn whether something moved.

   Do not use `npx iwsdk ecs ...` for this: those commands read the host's world, and your game runs its own.

6. **Tip the hand.** A held thing turns with the hand, so a jug pours when the hand that holds it tips. Give a
   step an `orientation`: the way the fingers point and the way the palm faces (-z is forward, +y up). A level
   hand is fingers `"forward"`, palm `"down"`; this tips it 45 degrees forward and holds it there:

   ```
   cd /opt/xr && npx iwsdk xr run-sequence --input-json '{"device":"hand-right","steps":[
     {"label":"grab","target":"Jug","approach":{"distance":0.06},"pinch":{"value":1,"at":"arrival"}},
     {"label":"over the cup","position":{"x":0,"y":1.2,"z":-0.45},"orientation":{"fingers":"forward","palm":"down"}},
     {"label":"tip","orientation":{"fingers":[0,-0.7,-0.7],"palm":[0,-0.7,0.7]},"duration":0.6},
     {"label":"hold","duration":1.5}]}'
   ```

   The hand keeps its pinch after the sequence, so read `--state` while the jug is tipped, then let go with a
   sequence of one step, `{"label":"let go","pinch":0,"duration":0.15}`.

7. **Where is a part?** To learn where a part stands without a picture, name it in a dry run, which moves nothing:

   ```
   cd /opt/xr && npx iwsdk xr run-sequence --input-json '{"device":"hand-left","dryRun":true,"steps":[
     {"label":"where","target":"Clay board","anchor":"index-tip"}]}'
   ```

   It prints the point on that part a hand would touch, as `target` (metres). Do not print the scene tree
   (`npx iwsdk scene runtime-hierarchy`): it is tens of thousands of words, nearly all of them the app's own objects.

8. **Play it through in the app.** The check plays your `play` block with a simulated hand; this plays the same
   gestures with the emulated hand in the real headset app:

   ```
   node /skills/play/playtest/scripts/playtest.mjs /work/module.js --game --play
   ```

   It opens the game fresh, does each move's gesture, then Start and one round, and prints JSON: each move with
   `registered`, whether Start `began` a round, and the `round` as `state()` ends it. A move that registers in the
   check and not here is wired to something the headset does differently (a grab the host does not give, a press on
   a part a pinch never reaches): fix the wiring, not the gesture. The whole run keeps inside 390 s; a game whose
   steps take longer is reported "out of time" with the steps it did not play. The hand turns as the gesture's `tilt`, `roll` and `yaw` say,
   after it has pinched, as in the check.

## Notes

- Positions are in metres in the room: -z is away from the player, +y up; the desk is about 0.9 to 1.0 m high.
- The app shows a game bigger than it is built (2.25 times in one test), so a distance in your code is not that
  distance in the room: aim at names, or at the centres the report and `--state` print.
- `npx iwsdk xr --help`, `npx iwsdk browser --help` and `npx iwsdk ui --help` list Meta's other runtime commands
  (headset pose, hand poses, panel inspection). Run them from /opt/xr.
- Each play-test builds /work/module.js from /work/game.js (a learning game) and reopens it, so it always shows your
  latest game.js.
- Meta's own IWSDK skills (`test-interactions` in github.com/facebook/immersive-web-sdk) show more ways to drive the
  runtime from this command line. Their `ecs` recipes check the host's world, not your game's.
