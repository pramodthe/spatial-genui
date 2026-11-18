# Controls: the hand actions the coder can build

Every move and every control in `design.md` uses one action from this file. The APIs are the ones a game module
receives from the host (`/skills/game/hand-play`, `/skills/common/kit/references/kit-api.md`). Sizes are in desk
centimetres; in a world game the headset shows them 12 times bigger (`environment.md`).

## Basic actions (built into the kit)

| Action | What the player does | Module API | Limits | Answer in the same frame |
|---|---|---|---|---|
| **Grab and place** | Pinch a piece, carry it, let go | `traits(obj, { grab: true })`, `isGrabbed(obj)`; decide on the frame it is let go | Piece or handle at least 3 cm; only pieces the player picks up and puts down are grabbable; never animate a held object | Lifts with a glow (host); on release snaps home with a pop, or wobbles back with no penalty |
| **Press** | Poke a button, switch or lever with a finger | `traits(obj, { onPress })` | Only when the real action is a press; at least 3 cm | The pressed thing moves (button sinks, lever flips) and clicks |
| **Follow** | A tool or vehicle follows the hand, no pinch | `hands.right.tip` (or `palm`) read in `update`, clamped to the playfield, smoothed with lerp | Tool at least 6 cm; the followed thing is never grabbable; when `tracked` is false it stays put | It moves with the hand; the panel says how to steer |
| **Pinch to act** | Pinch to fire, launch, drop or place | `hands.X.pinched` (first frame), `hands.X.pinching` (held) | Counts only within about 25 cm of the playfield | The thing happens at once, with a sound |
| **Two hands** | The other hand is a second tool or holds something steady | `hands.left` with any action above | Each hand's job stated in the controls table | As above |
| **Walk** (world only) | Thumbstick slide, or point and pinch to teleport | Host-provided | The way to walk is obvious: a path or a glowing ring | Host moves the player |

## Real-world actions built from the basic ones

Write the real action in the move, and the basic action it is built from in the controls table. Five of them are
tested helpers in the hands kit, already in every game module (`/skills/game/hands`): name the helper and write its
gesture as the emulator check. The others the coder builds from the basic actions, so describe their rule exactly.

| Real action | Built from | Rule to write in the design |
|---|---|---|
| Fold, turn a page, open a lid | Grab a handle on the moving part: `handFold` | The part's angle follows the handle; let go past half way and it finishes, before it springs back. State the fold's angle (180 for paper, about 110 for a lid). Check: `{ grab: corner, path: fold.path }`, `fold.done` |
| Twist a knob, turn a dial, a lid or a key | Grab the knob and turn the hand: `handTwist` | The angle is the held knob's own turn about its axis, + clockwise as the player looks at it; state the range and what each angle sets. Check: `{ hold: knob, pinch: true, roll: 90 }`, the angle |
| Stack, sort, assemble, snap parts | Grab and place | Release over a zone: the right zone snaps it in, a wrong one sends it back with a wobble |
| Pour | Grab the container, then tip the hand: `handPour` | Pours while the held container is over the target and tipped past an angle, read from the container's own tilt (a held thing turns with the hand, with hands and with controllers). Never compare `tip` with `palm` (with controllers they are the same point). State the angle and the rate in real units. Check: `{ grab: jug, to: pour.above, tilt: 70, until: () => pour.poured >= 150 }` |
| Stir, whisk, mix | Grab the spoon and move it round: `handStir` | Turns of the held spoon round the bowl's centre, inside the bowl; state the turns needed and what too few or too many do. Check: `{ grab: spoon, path: stir.path(2) }`, `stir.turns` |
| Cut, slice | Grab the knife and draw it across: `handCut` | A cut is the held blade's path crossing the cut line at its height; state the line and where along it the cut should be. Check: `{ grab: knife, path: cut.path }`, `cut.cut` and `cut.at` |
| Crank a handle round, a gear | Grab a handle on the rim | Angle = the handle's angle around the centre; state the range and what each turn sets |
| Draw, trace, paint | Follow + pinch | While pinching, the tip leaves a stroke; score by distance to the target path, in cm |
| Throw, launch | Grab + release, or pinch to act | The motion kit: `motionHeld` gives the speed the thing leaves the hand with, `motionBody` flies it (`/skills/game/motion`). Or a set aim with a pinch; state which |
| Push, press into, sculpt | Follow | The tip near a surface moves it a set distance per second; keep to a few points, not a dense mesh |
| Steer a vehicle or creature | Follow | Heading follows the tip; the idea decides speed (wind, slope, gravity) |

## Hand tools

A grabbed tool moves and turns with the hand, in the headset and in the gate's simulated hand, so every tool is read
from the tool itself: its position, its speed and its rotation. Tilt (a jug), a swing (a hammer's head speed) and a
twist (a screwdriver's turn around its own axis) all come from the held object. Never read the hand's direction from
`tip` and `palm`: with controllers they are the same point. The hands kit reads the jug (`handPour`), the screwdriver
and the key (`handTwist`, `fixed: false` for a tool that is carried), the knife and the saw (`handCut`) and the spoon
and the whisk (`handStir`); for the others, describe the rule exactly, as below.

| Tool | Held how | Action detected from | Effect to write in the design |
|---|---|---|---|
| Hammer | Snapped into the palm, head forward | Head speed along the strike direction, at the target | How far a nail goes in per strike, by strike speed |
| Screwdriver, wrench | Snapped into the palm, tip along the forearm | Turn of the held tool around its own axis | How far it advances per turn |
| Saw | Snapped into the palm, blade forward | Back-and-forth motion along the cut line | How much the cut deepens per stroke |
| Jug, watering can | Grabbed by its handle | Tilt of the held container itself | Flow rate by tilt angle |
| Paintbrush, pen | Tip at the index finger | Tip path while touching the surface | The stroke and how it is scored |
| Knife, spoon, whisk, trowel, magnifier | Snapped into the palm | As the matching real action above (cut, stir, dig, look) | As above |

Hand UX patterns the kit will provide with the tools: a tool rack the player grabs tools from, buttons that visibly
sink when poked, a palm-up menu, and a ghost hand that demonstrates a gesture once. Meta's Unity-FirstHand sample
shows these ideas, but it is Unity and C#, not WebXR; the kit builds them on IWSDK.

## Gaps

If the subject needs something neither table covers (two-hand stretching, catching a fast object, fine finger
poses), do not invent an API. Map it to the closest action above, write the mapping in the design under "Gaps",
and keep the game playable with that mapping.

## Writing the controls table

One row per thing the player does, in the order they first meet it:

| Action | Hand | Gesture | Basic action and API | Object and size | Zone | Feedback (see, hear) | Emulator check |
|---|---|---|---|---|---|---|---|
| Crack the egg | Right | Grab egg, bring it down on the bowl rim | Grab and place: `traits(egg, { grab: true })`, crack when the held egg crosses the rim line moving down | Egg 4 cm | Above the bowl, front half of the desk | Shell splits, yolk drops, crack sound | Emulated hand grabs egg, moves 6 cm down over the rim; `eggCracked` is true |
