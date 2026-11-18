---
name: motion
description: Tested motion for learning games. Use it whenever something in the game is thrown, falls, bounces, rolls to rest, glides on a wing, is carried by wind or water, swings, springs, hangs on a rope, balances on a pivot, topples, floats, fills up, heats or cools, is driven by gears, cranks or cams, or slides down a slope, instead of writing the formula again. The motion kit (motionBody, motionHeld, motionGlide and the rest) is already in every learning-game module, gives the same result at any frame rate, and is what makes a throw leave the hand with the hand's speed.
---

# Motion

Most games here are about something that moves by a rule: a plane glides, a ball bounces, a kite pulls on its line,
a seesaw tips. Written from memory, that motion goes wrong in the same few ways: a thrown thing that stops where the
hand let go, a result that changes with the frame rate, a bounce that never settles. The motion kit has each of
these as a small helper with the physics already right, checked against its formula. It is in every learning-game
module (`/work/kits.js`), so its functions are in scope in `game.js`. The full list is at the top of
`assets/motion-kit.js`.

The kit moves numbers and vectors. The game still decides what the idea is and shows it: the kit makes the ball
fall right, the game makes the fall mean something.

## Three rules

1. **Step in fixed steps.** Make one `const steps = motionSteps()` and put every `.step(dt)` inside
   `steps.run(delta, (dt) => { ... })`. A slow frame then moves things exactly as far as fast ones, which the check's
   play-through tests at 72 and at 30 frames a second.
2. **One scale.** Lengths are in the units the game is built in. A desk game is small, so real gravity would be over
   in a blink: use `gravity: 9.8 * SCALE` with one `SCALE` (0.2 is easy to watch) and report results in real units
   (`distance / SCALE` metres). A world is built 12 times smaller than it is shown: `SCALE = 1 / 12` is real speed.
3. **Give a body the mesh's own position.** `motionBody(THREE, { position: ball.position, ... })` moves the mesh;
   there is nothing to copy back.

## Which helper

| The game has | Use | The idea it can carry |
|---|---|---|
| a thing the hand throws or launches | `motionHeld` for the speed it leaves with, `motionBody` for the flight | a harder throw goes further; the angle matters |
| a ball that bounces, rolls, stops | `motionBody` with `floor`, `bounce`, `friction`, `walls` | energy lost at each bounce; friction |
| balls or pucks that hit each other, a paddle | `motionCollide`, `motionBlock` | momentum: the heavy one hardly slows |
| a plane, a kite, a seed, a parachute | `motionGlide` on a body; `motionDrift` for air that slows a fall | lift and drag; a bigger wing sinks slower |
| a boat, a leaf, a cloud carried along | `motionDrift` toward the wind or the current | things take the speed of what carries them |
| a hero that follows the hand, a needle, a camera | `motionFollowTo`, `motionFollow`, `motionTurnTo` | (smooth motion, the same at any frame rate) |
| a swing, a clock, a wrecking ball | `motionPendulum` | the length sets the time of a swing, the weight does not |
| a scale's pointer, a springy platform, a bouncy answer | `motionSpring` | stiffness; settling |
| a kite line, a fishing line, a rope bridge, a cable | `motionRope` | a line can pull and cannot push |
| a seesaw, a balance, a mobile | `motionTurning`, `motionLever` | mass times distance on each side |
| a tower, a loaded boat, a crane | `motionCentre`, `motionTopples` | it falls when its centre of mass leaves its base |
| a dam, a diver, a boat that floats or sinks | `motionPressure`, `motionFloat` | pressure grows with depth; density decides floating |
| pieces dropped into slots | `motionSnap` | (which slot a piece is over) |
| a bowl, a tin, a tank or a glass that fills | `motionFill`: `to.add(from.take(amount))` | volume is kept: what leaves one arrives in the other; the level is volume over area |
| an oven, a cake baking, a pan cooling, a kettle | `motionHeat` | a thing heats fast at first and slower near the setting, never past it; `timeTo` says when it is ready |
| gears, a bicycle, a clock, an engine, a pump | `motionMechanism` with `motionGearRatio`, cranks and cams | one turn of the driver sets every part: a small gear turns a big one slower, the other way |
| a block on a ramp, a sledge, a car parked on a hill | `motionSlope` | it slides once tan(angle) passes the friction; steeper slides faster |

## Sketches

A throw. The speed comes from the hand, the flight from the body, the result from where it lands:

```js
const steps = motionSteps();
const held = motionHeld(THREE, ball, isGrabbed);
const body = motionBody(THREE, { position: ball.position, radius: 0.02, gravity: 9.8 * SCALE, bounce: 0.3, floor: tableTop });
let flying = false;
// in update(time, delta):
if (held.update(delta) === 'thrown' && phase === 'play') { body.launch(held.velocity); flying = true; }
steps.run(delta, (dt) => {
  if (!flying) return;
  body.step(dt);
  if (body.landed) { flying = false; finish((ball.position.x - startX) / SCALE); }   // metres
});
```

A glider: the same, with a wing. `lift` and `drag` are what the player changes by folding or trimming:

```js
steps.run(delta, (dt) => {
  if (!flying) return;
  motionGlide(body, { lift: wingArea * 3, drag: 0.4 + crumple }, dt);   // it sinks at drag / lift
  body.step(dt);
});
```

A seesaw: the weights the player placed decide the turning, the lever shows it:

```js
const lever = motionLever({ limit: 0.3, give: 0.5 });
// in the steps: marks are signed distances from the pivot
const turning = motionTurning(placed.map((w) => ({ mass: w.kg, x: w.mark })));
lever.step(dt, turning);
plank.rotation.z = -lever.angle;
const level = lever.balanced(turning);
```

A line from the hand to a kite, drawn through the rope's points:

```js
const line = motionRope(THREE, { segments: 10, length: 0.4, gravity: 9.8 * SCALE }).lay(handle.position, kite.position);
// in the steps:
line.step(dt, handle.position, kite.position);
// after the steps: lineMesh.geometry.setFromPoints(line.points)   (make the geometry once, with that many points)
```

Batter poured from a jug into a tin, then baked. Every amount is real (grams, degrees), and the poured mass is the
mass the jug lost:

```js
const jug = motionFill({ volume: 300 });                        // grams of batter
const tin = motionFill({ area: 300 / 0.03 });                   // 300 g stands 3 cm high in the game
const oven = motionHeat({ value: 20, setting: 20, rate: 0.02 });
// in the steps: pouring (pour.flowing from the hands kit) moves what it poured this step
tin.add(jug.take(poured));
batter.scale.y = Math.max(0.01, tin.level / 0.03);
oven.step(dt, ovenOn ? dialC : 20);                             // the dial sets it; it gets there over time
```

A crank the hand turns (the hands kit's `handTwist` gives the angle), driving a wheel and a piston:

```js
const engine = motionMechanism({ ratios: { wheel: motionGearRatio(12, 36) }, cranks: { piston: { radius: 0.03, rod: 0.1 } } });
const parts = engine.drive(THREE.MathUtils.degToRad(crank.angle));
wheel.rotation.z = parts.wheel;
piston.position.y = base + parts.piston;
```

## What it does not do

It has no general rigid-body engine: no spinning boxes, no stacks that fall over piece by piece, no joints. A
stack is judged with `motionCentre` and `motionTopples` (does it stand or fall), and shown falling as one piece.
A liquid is a level and a pressure, not particles. If the idea needs more, show it another way: an arrow, a gauge,
a slow replay.
