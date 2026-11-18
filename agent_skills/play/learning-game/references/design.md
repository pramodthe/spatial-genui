# Designing a learning game

## Contents
1. The idea, the goal and the hero
2. Moves: learn by doing
3. The challenge: the same idea, measured
4. The six kinds, with code sketches
5. Writing the words

## 1. The idea, the goal and the hero

(First pass the 5-second test in SKILL.md: one sentence, one gesture per move, at most three hand actions, a
familiar action.)

Start from the idea, not the objects. Write it as one sentence a player could say back after playing: "the more a
lever's weight is from the pivot, the more it turns", "plants need light, water and air to make food", "a sail pushes
the boat when the wind is behind or beside it". If you cannot write that sentence, the game will be a model to look
at, not something to learn from.

The goal is the same idea as something to do, in the player's words: "make the seesaw balance", "grow the tallest
sunflower", "collect the crates before the timer ends".

The hero is the one thing the hands work on: the sheet of paper, the boat, the plank, the seed. It is the biggest
interactive thing in the scene, in the front half of the desk, in a colour that stands out from the set, and it is
obvious from the first second that it is the thing to touch. Everything else is setting.

## 2. Moves: learn by doing

A move is one hand action that does one real step of the idea, and the scene's answer to it.

- **One gesture per move; at most three different hand actions per game; each new action gets its own learn move
  before the round uses it.** A move the hand cannot do in one gesture is two moves. A game with a pour and a stir
  teaches the pour as a move and the stir as a move, then the challenge asks for both; it never asks for a fourth
  kind of action, or for one the player has not learned.

- **The hands do the real thing.** Folding is a pinch that carries the flap over, not a Fold button. Adding weight is
  picking a weight up and dropping it on the plank. Planting is putting the seed in the soil. Press only when the
  real action is a press (a switch, a button on a machine), or to start something the hands set up.
- **`done()` checks the real result**, not that something was touched: the flap is past 90 degrees, the weight sits on
  a mark, the seed is in the pot. Then the scene answers (the flap lands and leaves a crease, the plank tips) and the
  why appears.
- **One why per move, about 12 words**, saying why this step matters for the goal, not describing the step: "the
  centre crease keeps both wings the same size" (not "now fold the paper in half").
- **3 to 7 moves.** Fewer and nothing was learned; more and the challenge never comes.
- **Show me** points at the next move's piece (the starter does this); for a tricky move, also animate it once (the
  flap folds itself halfway and back) so the player sees what the hand should do.
- **Nothing is lost while learning.** A wrong move is undone or just tried again; no score, no timer, no damage.

## 3. The challenge: the same idea, measured

The challenge asks the player to use what the moves taught, and measures it with one number.

- **The number depends on the idea.** The plane's distance depends on how even and sharp the folds were. The
  seesaw's score is how close to level it settles. Crates collected depends on sailing with the wind, not against
  it. A challenge whose number is random, or only about speed of clicking, teaches nothing.
- **Show it while it happens.** The plane flies across the desk and lands; the distance appears where it landed and
  on the panel. Do not jump straight to a number.
- **Stars: 1 for finishing, 2 for doing it well, 3 for doing it the way the idea says.** Tune the thresholds by
  playing it in your head with the numbers in your code: a careless try gets 1, a careful one 2, the best answer 3.
- **Try again keeps what was built** when that is the point (refold one wing; move one weight) and resets what must
  start fresh (the clock, the crates). The best result stays.
- **Nothing hurts before Start.** No clock runs, nothing drifts into danger, no score goes down until the player
  presses Start (or makes the first challenge move).

## 4. The six kinds, with code sketches

The sketches show the shape of the logic; build the pieces with the look's builders, keep `update()` free of `new`,
and clamp `delta` (`const dt = Math.min(delta, 0.05)`).

### Build it (fold, stack, connect, assemble)

The hero is built up step by step and keeps every earlier step. A fold: the flap is a child of a pivot group on the
fold line; the hand carries a small, thick handle on the flap's corner; the pivot's angle follows the handle; let go
past half way and it finishes the fold, before half way and it springs back.

```js
const pivot = new THREE.Group();            // on the fold line, x axis along the line
pivot.add(flap);                            // flap mesh lies at angle 0
const handle = cornerTab;                   // >= 3 cm, grabbable, a child of root (not of the flap)
traits(handle, { grab: true });
let angle = 0, folded = false, was = false;
// in update:
const held = isGrabbed(handle);
if (held) angle = Math.atan2(handle.position.y - lineY, handle.position.z - lineZ); // the hand sets the angle
else if (was) { folded = angle > Math.PI / 2; }                                    // let go: decide
if (!held) angle += ((folded ? Math.PI : 0) - angle) * Math.min(1, dt * 10);       // finish or spring back
pivot.rotation.x = Math.max(0, Math.min(Math.PI, angle));
was = held;
// MOVES: { say: 'Fold the right corner to the centre line.', why: '...', done: () => folded }
```

Keep the built thing visible the whole time: every later step adds to the same object, nothing is swapped for a new
model, and nothing is parented under something that gets hidden.

### Test it (launch, drop, push, then change one thing)

The player sets something up, launches it, watches it go, reads the number, changes one thing and tries again.

```js
const steps = motionSteps();                 // the motion kit (/skills/game/motion), made once
const held = motionHeld(THREE, plane, isGrabbed);   // the speed the hand gives it
const body = motionBody(THREE, { position: plane.position, radius: 0.01, bounce: 0, floor: groundY,
  gravity: 9.8 * SCALE });                   // SCALE: the desk is small, so slow the world down to watch it
let flying = false;
// in update:
if (held.update(delta) === 'thrown') { body.launch(held.velocity); flying = true; }
steps.run(delta, (dt) => {
  if (!flying) return;
  motionGlide(body, { lift, drag }, dt);     // the idea: what the player changed sets lift and drag
  body.step(dt);
  if (body.landed) { flying = false; finishWith(distanceFromStart() / SCALE); } // real metres
});
```

Report results in real units (the plane flew 4.2 m), even though the desk model is small.

### Steer it (vehicle, creature, cursor follows the hand)

The hero follows the hand without a pinch (`hands.right.tip`, in root's coordinates; `/skills/game/hand-play`).
The idea decides how it moves: a sailboat goes fastest with the wind beside it and stalls into it; a planet's speed
depends on its distance from the sun.

```js
const target = new THREE.Vector3();
// in update:
if (hands.right.tracked) target.copy(hands.right.tip).clamp(min, max); // stay on the playfield
heading.subVectors(target, boat.position).setY(0);
const wantYaw = Math.atan2(heading.x, heading.z);
boat.rotation.y = motionTurnTo(boat.rotation.y, wantYaw, 3, dt);        // the short way round, at any frame rate
const windFactor = Math.max(0.15, Math.sin(Math.abs(angleDiff(boat.rotation.y, windYaw)))); // the idea
boat.position.addScaledVector(forwardOf(boat), SPEED * windFactor * dt);
```

Say on the panel how to steer ("move your hand: the boat sails towards it"). The thing that is steered is not
grabbable; give the hands nothing else to pick up by mistake.

### Sort it (classify by putting things where they belong)

Pieces are grabbable; bins or zones are places on the set. On release, check which zone the piece is over.

```js
// in update, for each piece:
const held = isGrabbed(piece);
if (piece.userData.was && !held) {
  const zone = zones.find((z) => Math.abs(piece.position.x - z.x) < z.w / 2 && Math.abs(piece.position.z - z.z) < z.d / 2);
  if (zone && zone.kind === piece.userData.kind) { snapInto(zone, piece); cheer(piece); score++; }
  else { piece.userData.seat.home.copy(piece.userData.start); wobble(piece); } // back where it came from, no penalty
}
piece.userData.was = held;
```

The why for each piece says what made it belong ("ice is water as a solid: its particles hold still").

### Balance it (weights, amounts, until it settles)

Grab weights onto marks, or set amounts with a slider; the system answers continuously and settles. The number is
how close to balance, or how few tries it took.

```js
const lever = motionLever({ limit: MAX, give: 0.5 });                  // made once (/skills/game/motion)
// in update:
const turning = motionTurning(weights.map((w) => ({ mass: w.mass, x: w.mark }))); // mark: signed distance from the pivot
lever.step(dt, turning);
plank.rotation.z = -lever.angle;                                       // level when lever.balanced(turning)
```

### Grow it (set conditions, run time, watch)

The player sets the conditions by hand (moves the pot into the light, pours water, adds a coin a week), then presses
to run time, and the result grows in front of them. The challenge: the biggest or healthiest result in a number of
days or tries. Show time passing (a sun arc, a day counter) and growth that responds to each condition, so the player
can see which one held it back.

### The play block for each kind

Every game says how a hand plays it (`references/play.md`); the check plays that. The usual gestures:

| Kind | A move | A round |
|---|---|---|
| Build it | `{ grab: cornerTab, to: foldEnd }`: carry the handle to where the fold ends | the same gestures in order; the test at the end runs by itself or on a press |
| Test it | `{ grab: plane, path: [back, forward], seconds: 0.3, throw: true }` | one launch; change one thing and launch again is the next round |
| Steer it | `{ hold: () => nextCrate, seconds: 3 }`: the hand goes where the hero should go | holds that follow the next target; a held tiller or bar steers with `roll` |
| Sort it | `{ grab: piece, to: binOf(piece) }` | one for each piece |
| Balance it | `{ grab: weight, to: mark }` | the weights that settle it |
| Grow it | `{ grab: pot, to: lightSpot }`, `{ hold: overPot, tilt: 45, until: () => watered }`, `{ press: runButton }` | the conditions, then the press that runs time |

A tool that works by how the hand is turned (a jug that pours, a bar that steers) needs the pose in its gesture
(`tilt`, `roll`); a hold that lasts "until it happens" says so with `until`.

## 5. Writing the words

- The goal and each `say`: one sentence, an instruction ("Fold the top corners to the centre line.").
- Each `why`: about 12 words, the reason, with the real term once if it helps ("This is the keel: it keeps the plane flying straight.").
- Numbers with units and real values: 4.2 m, 12 seconds, 3 kg.
- Plain words a 10-year-old knows. No caveats or disclaimers on the panel ("a model, not a prediction", "check
  local rules"): say the true simple thing ("in still air"), or leave it out.
- No more than about 8 panel parts. Long explanations are for the voice tutor, which the player can ask.
- No emoji (the panel font has none); write "3 of 3 stars", or show stars in the scene with `playStars`.
