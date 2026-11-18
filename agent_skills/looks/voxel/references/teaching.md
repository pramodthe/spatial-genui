# Teaching with cubes

A lesson works when the learner can say what changed and why after each step. Cubes are good at this because a cube
is a unit: an amount is a count you can see, and a model builds up in an order you can watch. Use both.

## 1. Name the idea, then the quantity that carries it

Write the idea as one sentence a learner could repeat, decide what one cube stands for, then pick the quantity that
decides the idea and give it cubes:

| Topic | The idea | The quantity | In cubes |
|---|---|---|---|
| Plant growth | A plant grows from its tip, fed by water from the roots and light on the leaves | height over days; the stage | one cube = 10 cm or a day's growth; the stem rises a cube at a time beside a cube ruler; each stage (roots, shoot, leaves, bud, flower) is a stage of `look.stages`; a counter for days or height |
| Building | The bottom carries the top, so most of the material sits low | blocks per layer | one cube = one block; each layer its own mesh, placed by hand; a counter counts the blocks as they land |
| Rock layers | Layers settle on top of each other: deeper is older | depth, as time | one layer of cubes = 1,000 years; a fossil lies in the layer of its time; a counter of years |
| Doubling | Each generation doubles: slow at first, then sudden | count per generation | 1, 2, 4, 8, 16 cubes in a tray, each generation dropping in; a counter |
| Area and volume | A box holds length x width x height unit cubes | unit cubes | fill a box layer by layer; the layer count times the cubes per layer is on the counter |
| Food or energy pyramid | Only about a tenth of the energy passes up each level | energy per level | each level a layer, one cube = 10 units: 100, 10, 1 cubes; the learner lifts a level to count it |
| Water stored | A lake rises by what flows in minus what flows out | water level | water cubes added layer by layer; a flow of cubes in, a flow out, a cube ruler on the dam |

If the quantity is only on the panel, the lesson is a model with a caption. Put it in the scene too (`look.counter`, a
column of cubes, a cube ruler, `look.arrow`), and keep the panel for the sentence that explains it.

## 2. Plan steps as questions

3 to 5 steps. Each step asks one question, gives the hand something to do that answers it, and tells the learner
what to notice. The first step shows the whole thing finished (the host sizes the lesson by what it shows first, so
start full, then take it down and build it up). Each step has one word, spelled in cubes on the plinth.

Example (rock layers in a cliff):

1. **CLIFF** - six layers of rock in a cut cliff, a fossil fish in layer 2 and a shell in layer 5; "Which fossil is
   older?" The counter shows 6000 years. Notice: the layers lie in order, one on another.
2. **SETTLE** - the cliff goes back to a sea floor; the learner carries a slab of mud from the bank and lets it go
   over the sea, it drops in column by column and the counter adds 1,000 years. Notice: each layer goes on top.
3. **BURY** - the learner drops the fish on the top layer, then adds two more layers over it. Notice: the fish is as
   old as the layer it lies in.
4. **READ** - the learner lifts any layer and the counter shows how long ago it settled. Notice: deeper is older, so
   the fish is older than the shell.

## 3. The hands build it

The best hand action places the units the lesson is about: carry the next layer and let it go on the pile, drop a
drop of water on the plant, put the next block on the wall, add a generation to the tray. Pressing "Next" moves the
story on; placing cubes is where the learning happens. Each action answers in the same frame: the part glows while it
is held (`look.glow`), the cubes drop in and bounce, the counter counts them as they land, the next stage begins. A
part the hand picks is its own `look.model`; let go in the right place it snaps there and its cubes drop in, let go
anywhere else it goes back to its seat (`lookSeat`). When a step has a goal ("lay the base"), say so on the panel when
it is reached.

## 4. Numbers that are true

Decide what one cube is and say it in a panel note ("One cube is 10 cm"). Keep real proportions: a sunflower 2.5 m
tall at 10 cm a cube is 25 cubes high, its seed is one cube, its flower head about 3 cubes across. Count from the
scene: show `b.arrived` (the cubes of a stage that have landed) or the sum of the parts actually placed, so what the
learner sees and what the counter and panel say can never disagree. Build every sentence once in `build` and only pick
one in `update`.

## Motion

The cubes do the animating. A stage arrives cube by cube: things drop in column by column (`order: 'column'`), grow
layer by layer (`'layer'`), spread out from the front (`'wave'`), each cube falling about three cubes and bouncing once
as it lands (`look.stages`, which uses `lookBounce`). A new word drops in a column at a time. Flows are cubes hopping
cell to cell along a path (`look.flow`), never gliding. Nothing slides, fades or swells smoothly, and a thing that
grows gets more cubes, never bigger ones. Things that are counted arrive a beat apart so the learner can count along.
The one slide is the shared hand rule: a part let go away from its place slides back to its seat. The panel never
moves, and a part the learner can hold stays still while held.
