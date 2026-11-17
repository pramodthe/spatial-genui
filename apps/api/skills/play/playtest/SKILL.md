---
name: playtest
description: Play-test the module in the real headset app, run headless in this sandbox by Meta's IWSDK runtime - open it in XR with emulated hands, look at a screenshot of it, try the main action with an emulated hand, and read the console. Use it after the check passes, before you finish any lesson or game, and whenever you need to see what you built or why something does not work in the headset.
---

# Play-test

The check proves the module runs; it cannot tell you whether a player would understand it. Before you finish, look
at your game the way a player first sees it, and try its main action with a hand. Meta's IWSDK runtime runs the real
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

3. **Try the main action with a hand.** Use a target's `center` from the report:

   ```
   cd /opt/xr && npx iwsdk xr run-sequence --input-json '{"device":"hand-right","steps":[
     {"label":"grab","position":{"x":0.09,"y":1.04,"z":-0.38},"approach":{"distance":0.06},"pinch":{"value":1,"at":"arrival"}},
     {"label":"move","position":{"x":-0.05,"y":1.06,"z":-0.38}},
     {"label":"let go","pinch":0,"duration":0.15}]}'
   ```

   Press a button with `{"position": ..., "press": {}}` instead of a pinch. Then take another picture to see what
   changed: `node /skills/play/playtest/scripts/playtest.mjs --shot-only` and read the new `view-N.png`. The move
   should visibly do what the game says (the flap folds, the piece lands, the score changes).

4. **Errors.** `consoleErrors` lists runtime errors from the app; `cd /opt/xr && npx iwsdk browser logs` shows the
   full console. A module that throws in `update()` stops moving in the headset: fix every error you see.

## Notes

- Positions are in metres in the room: -z is away from the player, +y up; the desk is about 0.9 to 1.0 m high.
- `npx iwsdk xr --help`, `npx iwsdk browser --help` and `npx iwsdk ui --help` list Meta's other runtime commands
  (headset pose, hand poses, panel inspection). Run them from /opt/xr.
- Each play-test builds /work/module.js from /work/game.js (a learning game) and reopens it, so it always shows your
  latest game.js.
