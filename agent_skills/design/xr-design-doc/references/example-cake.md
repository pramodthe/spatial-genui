# Example: "teach me to bake a sponge cake"

A complete design at the expected quality. It keeps every rule: one gesture per move; three different hand actions
(place, pour by tipping, stir), each learned in its own move before the round uses it; the hands kit's helpers and
the motion kit's physics named with their numbers; three levels, each changing one thing; a scene plan with roles,
sizes and relations, and no coordinates. Every emulator check is written as the play-block gesture that does it, with
the value it proves. This exact design is built as a real game in the app's tests, and it plays through: every move
registers, the round earns three stars at 72 and 30 frames a second, nothing scores with no hand, and every level is
won.

```markdown
# Rise and Bake — Design

Mix a sponge by hand, then bake it to see how high it rises.

## 1. Learning
- Kind: procedure
- The idea: a sponge rises because beating traps air in the mix, and a hot oven sets the mix before the air escapes.
- After playing, the player can:
  - weigh out equal amounts of sugar and flour (100 g each for 100 g of butter and two eggs)
  - explain why butter and sugar are beaten together (it traps air)
  - explain why flour is folded in gently and why the oven is heated first
  - say that an adult uses a real oven, with oven gloves
- Ages: about 9 to adult

## 2. Player fantasy
You are a young baker at your own little kitchen table, with a bowl, two jugs, a whisk and a tiny oven. Your cake
rises because of what your hands did, and you can see exactly why.

## 3. Core loop
1. Goal: "Bake a sponge that rises high."
2. Moves: 3 hand steps, below; each teaches one of the game's three hand actions.
3. Challenge: after Start the oven switches on. Pour 100 g of flour (pour), fold it in gently (stir), put the bowl
   in the oven (place). The cake bakes until its middle reaches 95 °C; its rise in cm is measured. The rise depends on
   the air beaten in, the amounts, a gentle fold and how hot the oven is, which is the idea.
4. Result: stars, best rise, Try again (keeps the level and the creamed mix; puts the flour, the whisk and the bowl
   back and turns the oven off). A round with a star opens the next level.

### Moves
| # | Move (real action) | Hand action (controls.md) | What the scene answers | Why (about 12 words) | done() when |
|---|---|---|---|---|---|
| 1 | Put the butter in the bowl | Place | The butter drops in with a plop; the mix turns yellow | Butter holds the air you will beat in, so the sponge is soft | the butter is let go over the bowl |
| 2 | Tip the sugar jug over the bowl: pour 100 g | Pour: `handPour` | Sugar streams in; the mix rises a little | Sugar crystals cut tiny pockets in the butter that fill with air | the jug is put down after 90 g or more has poured |
| 3 | Whisk the butter and sugar: two turns round the bowl | Stir: `handStir` | The mix turns pale and fluffy, a tick per turn | Beating traps millions of small bubbles, and they lift the cake | the whisk is put down after 1.9 turns or more |

The round uses the same three actions again: pour (the flour), stir (fold it in), place (the bowl in the oven).
Start and Try again are the panel's buttons, never moves.

## 4. Controls
| Action | Hand | Gesture | Basic action and API | Object and size | Zone | Feedback (see, hear) | Emulator check |
|---|---|---|---|---|---|---|---|
| Place (butter in the bowl; the bowl in the oven) | Right | Pinch it, carry it, let go | Grab and place: `traits(butter, { grab: true })`; on the frame it is let go, over the bowl it drops in, anywhere else it goes back | Butter 4.5 × 2.5 × 3.5 cm; bowl 13 cm | Front of the desk to the bowl; the bowl to the oven on its right | Plop and a pop; the oven hums | `{ grab: butter, to: bowl }`: move 1 registers. `{ grab: bowl, to: ovenSlot }`: the bake starts |
| Pour (sugar, flour) | Right | Pick the jug up, carry it over the bowl, tip it | `handPour(THREE, sugarJug, isGrabbed, { over: bowl, angle: 30, rate: 200, amount: 300 })`: flows while held over the bowl and tipped past 30°, read from the jug's own tilt | Jug 8 × 9 × 6 cm | Left of the bowl, then above it | A stream, grains sound; the mix rises | `{ grab: sugarJug, to: sugarPour.above, tilt: 70, until: () => sugarPour.poured >= 100 }`: `sugarGrams` = 100 ± 2 |
| Stir (whisk, fold) | Right | Pick the whisk up and move it round inside the bowl | `handStir(THREE, whisk, isGrabbed, bowl)`: turns of the held whisk round the bowl's centre, inside the bowl | Whisk 11 cm long | Inside the bowl's rim | A tick per turn; the mix turns pale | `{ grab: whisk, path: cream.path(2), seconds: 2.5 }`: `creamTurns` = 2 ± 0.1 |

Each emulator check is also the move's gesture in the game's `play` block, and the values it names (`sugarGrams`,
`flourGrams`, `creamTurns`, `foldTurns`, `ovenC`, `riseCm`) are returned by `play.state()` beside `phase`, `move`,
`result`, `stars` and `level`.

Gaps: none. Cracking the eggs (a fourth action) is left out: the bowl starts with two eggs in it.

## 5. Environment
- Mode: desk, because baking is learned by hand at a table.
- First second: a comic kitchen on the desk, the persimmon bowl in front, the oven on its right; the butter bounces
  first.

Scene plan (environment.md; the coder copies it into /work/parts/scene.js and the solver places it; no coordinates):

```js
const SCENE = {
  mode: 'desk',
  things: {
    bowl: { role: 'hero', size: [0.14, 0.075, 0.14] },
    butter: { role: 'tool', size: [0.05, 0.03, 0.04] },
    sugarJug: { role: 'tool', size: [0.08, 0.09, 0.06] },
    flourJug: { role: 'tool', size: [0.08, 0.09, 0.06] },
    whisk: { role: 'tool', size: [0.13, 0.04, 0.04] },
    oven: { role: 'target', size: [0.2, 0.15, 0.16] },
    start: { role: 'button', size: [0.06, 0.03, 0.06] },
    panel: { role: 'panel', size: [0.3, 0.3, 0.01] },
  },
  relations: [
    ['oven', 'right of', 'bowl'],
    ['sugarJug', 'left of', 'bowl'],
    ['flourJug', 'left of', 'bowl'],
    ['butter', 'in front of', 'bowl'],
    ['whisk', 'in front of', 'bowl'],
    ['start', 'near', 'bowl'],
  ],
};
```

Motion: `motionHeat` twice, stepped in `motionSteps`. The oven: `motionHeat({ value: 20, setting: 20, rate: 0.35 })`,
set to 180 °C when the round starts, so it heats fast at first and never past 180. The cake:
`motionHeat({ value: 20, setting: 20, rate: 0.12 })`, stepped toward the oven's temperature while it bakes; it is set
when its middle reaches 95 °C. Rise = 4.8 cm × whisked (turns / 2, at most 1) × sugar share × flour share (each 1 at
100 g, less by the share it is off) × fold (1 for 0.5 turns up to the level's most, 0.6 over it, 0.7 under 0.5)
× e^(−set time / 40 s): a bowl put in a cold oven sets later and keeps less air.

## 6. Levels and progression
| Level | What changes (one thing) | 1 star | 2 stars | 3 stars |
|---|---|---|---|---|
| 1. Follow the card | A fill line inside the bowl shows where the mix should come to | 1.5 cm | 2.5 cm | 3.5 cm |
| 2. From memory | No fill line | 1.5 cm | 2.5 cm | 3.5 cm |
| 3. Delicate sponge | Folding more than 1.2 turns knocks the air out (2.5 before) | 1.5 cm | 2.5 cm | 3.5 cm |

## 7. Mistakes, failure and reset
| Wrong step | What happens (shows why it matters) | How the player recovers |
|---|---|---|
| Less or more than 100 g of sugar or flour | The rise drops by the share the weight is off | Try again; the panel says "weigh 100 g" |
| Fewer than two whisking turns | Less air is beaten in: a lower rise | Whisk more (the move waits for two turns) |
| Folding past the level's most | The air is knocked out: 0.6 of the rise | Try again, fold once |
| No folding | Lumps of flour: 0.7 of the rise | Try again |
| The bowl in the oven straight away | The oven is still cool, the cake sets late: a lower rise | Try again, pour and fold first |

- A thing put down anywhere but where it belongs goes back to its place; nothing is lost while learning.
- Nothing scores and the oven stays off before Start.
- Try again: keeps the level and the creamed mix; resets the flour, the fold, the bowl and the oven.

## 8. Facts and safety
| Fact the game teaches | Value and units | Where it appears |
|---|---|---|
| A simple sponge uses equal weights of butter, sugar and flour for two eggs | 100 g each | Moves 2, the round |
| Oven temperature for a sponge | 180 °C | The round, the oven's glow |
| A sponge is baked when its middle reaches about 95 °C | 93 to 99 °C | The bake |

Safety notes: an adult uses a real oven; oven gloves for a hot tin.
Facts to check: none (the bake is sped up to seconds, and the panel says so).
Game values (not real-world facts): the rise in cm and the star thresholds come from the game's model.

## 9. Visual and UI direction
(See visual.md.)
- Look: ink-toon, because it is made for recipes and how-tos with a few recognisable objects
- Theme and setting: a sunny kitchen corner drawn like a cookbook comic; the player is a young baker
- Palette:
  | Colour (look palette name) | Used for |
  |---|---|
  | persimmon | The bowl (the hero), the panel's buttons |
  | mustard | Butter, the baked sponge, the oven's glow |
  | cream | The creamed mix |
  | teal | The sugar jug |
  | navy | The flour jug, the whisk's wires |
  | charcoal | The oven, the whisk's handle |
- Panel voice: a cheerful baker friend; opening line: "Mix a sponge by hand, then bake it to see how high it rises."
- Signs: the result sign over the oven, "3 OF 3 STARS" and the rise in cm
- Feedback: success = a pop and a burst over the bowl, the stars and confetti at three; a try that misses = the
  thing slides back, no red
- Motion: the next thing to touch bounces every 2.5 s; steam over the oven while baking; the mix rises as it bakes
- Sound: a click on touch, a whoosh at Start, a plop for the butter, a hum when the bowl goes in, a win chime

## 10. Assets
| ID | Type | Gameplay role | Real size | Made from | Matches style of | Used by (move or level) | Source |
|---|---|---|---|---|---|---|---|
| bowl | 3D model | Hero; holds the mix; goes in the oven | 13 cm | `look.turned` profile | ink-toon | Moves 1-3, the round | Look builder |
| mix | Mesh in the bowl | Shows the moves (colour, height) and the rise | Fills the bowl | `look.turned` disc | ink-toon | All | Look builder |
| butter | 3D model | Placed in the bowl | 4.5 cm | `look.box` | ink-toon | Move 1 | Look builder |
| sugar jug, flour jug | 3D model | Poured from | 8 cm | `look.turned` + `look.tube` handle | ink-toon | Move 2, the round | Look builder |
| whisk | 3D model | Stirs | 11 cm | `look.ball` + `look.rod` | ink-toon | Move 3, the round | Look builder |
| oven | 3D model | Bakes; glows with its heat; steams | 20 cm | `look.box` walls, a flat glowing back | ink-toon | The round | Look builder |
| start | Button | Starts the round | 6 cm | `playStartButton` | ink-toon | The round | Kit shape |
| sounds | Sound | Feedback | - | - | - | All | Synth sounds (parts/sounds.js) |

## 11. Checks
Logic checks (run in Node, no headset):
- 100 g sugar, two whisking turns, 100 g flour, one fold, the bowl in after the oven has heated for 5 s: rise at
  least 3.5 cm (three stars).
- The same with 150 g flour: half the flour share lost, rise under 2.5 cm.
- The oven never passes 180 °C, however long it heats.

Hand checks (emulated hand in the headset runtime), each a gesture of the play block:
- `{ grab: butter, to: bowl }`: move 1 registers, the butter is hidden in the mix.
- `{ grab: sugarJug, to: sugarPour.above, tilt: 70, until: () => sugarPour.poured >= 100 }`: `sugarGrams` = 100 ± 2.
- `{ grab: whisk, path: cream.path(2), seconds: 2.5 }`: `creamTurns` = 2 ± 0.1.
- The round: `{ grab: flourJug, to: flourPour.above, tilt: 70, until: () => flourPour.poured >= 100 }`,
  `{ grab: whisk, path: fold.path(1), seconds: 1.5 }`, `{ grab: bowl, to: ovenSlot }`: the round ends with
  `riseCm` at least 3.5 and three stars, on every level.
- With no hand, nothing pours, the oven stays off before Start, and no round ends.

## 12. Out of scope
- Cracking the eggs (the bowl starts with them), icing, decorating and tasting
- A real bake time (the bake is sped up to seconds)
- Real oven use: the game says an adult does this
```
