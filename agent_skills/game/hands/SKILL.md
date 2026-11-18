---
name: hands
description: Tested hand actions for learning games. Use it whenever the player pours from a jug, stirs a bowl, folds a flap, turns a knob or a lid, or cuts along a line, instead of working the rule out again. The hands kit (handPour, handStir, handFold, handTwist, handCut) is already in every learning-game module, reads the action from the thing the hand holds, gives the same result at any frame rate, and comes with the play-block gesture that plays it.
---

# Hands

Many ideas are learned by doing the real thing with a hand: tip the jug until the batter reaches the line, stir
until it is smooth, fold the flap along the crease, turn the dial to 180, cut where the mark is. Written from memory,
these go wrong in the same few ways: a pour read from the hand's `tip` against its `palm` (with controllers those are
one point, so it never pours), a stir that counts frames instead of turns, a flap that jumps when it passes the hinge,
a knob that flies off with the hand. The hands kit has each as a small helper with the rule already right, checked in
`gate/test-hands.ts`. It is in every learning-game module (`/work/kits.js`), so its functions are in scope in
`game.js`. The full list, with every option, is at the top of `assets/hands-kit.js`.

The kit reads what the hand did. The game still decides what the action means and shows it: the kit says 150 g has
poured, the game fills the bowl and says why the amount matters.

## Four rules

1. **Every helper counts only while the hand holds the thing** (`isGrabbed`). Make the thing grabbable with
   `traits(thing, { grab: true })`; with no hand nothing pours, turns or folds, as the check's no-hand rounds demand.
2. **Tilt and twist come from the held thing's own rotation.** In the headset and in the check, a held thing turns
   with the hand. Never compare `hands.right.tip` with `hands.right.palm`.
3. **Call `.update(delta)` every frame of the round**, and `.reset()` when Try again puts the scene back.
4. **Use the helper's places in the gesture** (`pour.above`, `stir.path(2)`, `fold.path`, `cut.path`). They are empty
   objects the helper puts beside the thing, so they stay right wherever the game is placed. Ask for them when the
   pieces are in the scene: in the `play` block that `build()` returns.

## Which helper, and its gesture

| The player | Use | It returns | Gesture in the play block |
|---|---|---|---|
| tips a jug, cup or bowl to pour into another | `handPour(THREE, jug, isGrabbed, { over: bowl, angle: 30, rate: 200, amount })` | `.flowing`, `.poured`, `.left`, `.tilt` | `{ grab: jug, to: pour.above, tilt: 70, until: () => pour.poured >= 150 }` |
| stirs, whisks or mixes in a bowl | `handStir(THREE, spoon, isGrabbed, bowl)` | `.turns`, `.way`, `.stirring` | `{ grab: spoon, path: stir.path(2), seconds: 3 }` |
| folds paper, opens a lid, closes a door on a hinge | `handFold(THREE, flap, handle, isGrabbed, { axis: 'x', to: 180 })` | `.angle`, `.done` | `{ grab: handle, path: fold.path, seconds: 0.8 }` |
| turns a knob, a dial, a lid, a key, a screw | `handTwist(THREE, knob, isGrabbed, { axis: 'z' })` | `.angle`, `.turns` | `{ hold: knob, pinch: true, roll: 90, seconds: 1 }` |
| cuts with a knife, a saw or scissors | `handCut(THREE, knife, isGrabbed, mark)` | `.cut`, `.cuts`, `.at`, `.length` | `{ grab: knife, path: cut.path, seconds: 0.5 }` |

Each gesture is one move: one hand action. The check plays it with its simulated hand, which takes the thing level
and then turns it as the pose says (`tilt` tips the fingers down, `roll` lowers the right side), so the jug tips and
the knob turns as a player's would.

## Sketches

A pour that fills a bowl to a line. The jug goes back to its place when it is put down:

```js
const pour = handPour(THREE, jug, isGrabbed, { over: bowl, angle: 30, rate: 200, amount: 300 });   // grams a second
const home = jug.position.clone();
let was = false;
// in update(time, delta), during the round:
pour.update(delta);
batter.scale.y = Math.max(0.01, pour.poured / 300);         // the bowl fills as it pours
const held = isGrabbed(jug);
if (was && !held) { jug.position.copy(home); jug.quaternion.identity(); if (pour.poured > 0) finish(pour.poured); }
was = held;
// play: { challenge: [{ grab: jug, to: pour.above, tilt: 70, until: () => pour.poured >= 150 }], ... }
```

A fold. The flap is a group whose origin is on the crease; the handle is a small grabbable corner beside it (in the
same parent, not inside the flap):

```js
const crease = new THREE.Group();                 // on the hinge line
crease.add(flapMesh);                             // the flap lies off the hinge, e.g. at z -0.04
const corner = new THREE.Mesh(...);               // at the flap's free edge, in root
traits(corner, { grab: true });
const fold = handFold(THREE, crease, corner, isGrabbed, { axis: 'x', to: 180 });
// in update: fold.update(delta); if (fold.done) moveDone();
// play: { learn: [{ grab: corner, path: fold.path, seconds: 0.8 }], ... }
```

A knob that sets an oven: `const dial = handTwist(THREE, knob, isGrabbed, { axis: 'z' })`, then
`ovenC = Math.round(dial.angle / 270 * 250)` clamped to the oven's range.

## What it does not do

It reads hand actions; it does not simulate what they act on. A pour is an amount, not a liquid: show it as a level
(the motion kit's `motionFill`, `/skills/game/motion`). A cut is a crossing, not a mesh split: show the two halves the game
built. For throwing, use the motion kit's `motionHeld` and `motionBody`.
