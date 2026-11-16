---
name: exploded-view
description: Build a mixed-reality lesson as a product teardown - one real object, enlarged on a pale floor slab, taken apart along its axis into its parts in assembly order, each part in its real finish (chrome, brass, steel spring, rubber, clear plastic, circuit board) with a numbered ink-blue callout, a glowing path showing what flows through them, and parts the learner pulls out of the row and clicks back in. Use it whenever a lesson asks what is inside an object, how it is put together or how its parts work together - flashlights, pens, computer mice, locks, bike bells, staplers, taps, toasters, kettles, hand tools, toys, small appliances, gadgets, mechanisms - and whenever a lesson names an exploded view, teardown, disassembly, "how it is made" or a parts list, even if no look is named. Not for living things, landscapes, processes without a physical object, or abstract ideas.
---

# Exploded view lessons

> **In a learning game** (every lesson, level and game this app writes): start with the learning-game skill,
> `node /skills/play/learning-game/scripts/new-game.mjs exploded-view /work/module.js`, and check with its
> `scripts/check.mjs` (it runs this look's rules too). Use this skill for the look: its builders, recipes, palette
> and mistakes. Skip its own start and check scripts (`scripts/new-lesson.mjs`, `scripts/check.mjs`). Its stage
> flags and step panel are for journeys and processes; a game uses them only when it is one.

An exploded-view lesson is one real object on the learner's desk, enlarged, that comes apart along its axis: each part
moves out to its own place in a row, in the order the object is assembled, wearing its real finish and a numbered
ink-blue callout. Then it goes back together, each part seating with a click. The look exists to answer "what is in
there, and why is each piece there?". A learner who pulls the spring out of a flashlight, closes it, and sees the
light stay dark and the current stop at the gap understands what the spring does better than any caption can tell
them. So every choice in this skill serves one goal: **each part's job becomes something the learner can see, take
out and put back.**

Read this file once, then follow the steps. The references are short; open each when its step says so.

## Steps

1. **Start the module.** Run

   ```
   node /skills/looks/exploded-view/scripts/new-lesson.mjs /work/module.js
   ```

   It writes a module that already passes the app's gate: the look kit (`lookBack`, `lookBounce`, `lookSeg`,
   `lookSeat`), the exploded-view look (`explodedViewLook`, its part builders, the row, callouts, axis, power path and
   floor) and a starter lesson with a panel, steps and working hand targets. Starting from it means you spend your
   effort on the object and the lesson, not on materials, layout and hands.

2. **Decide what the learner must understand, and how they will see it.** Before any geometry, write in /work/plan.md:
   - the one idea, as a sentence a learner could repeat ("a flashlight is one loop: current leaves the battery, lights
     the LED, comes back along the metal body, through the switch and the spring");
   - the parts in assembly order (5 to 8), each with its real size in mm, its finish, its job in one sentence and
     what fails without it;
   - what travels through the parts (current, force, air, water, ink, light) and its route, part to part;
   - the enlargement: the row apart should span 0.4 to 0.5 m and the thickest part be at least 5 cm;
   - 3 to 5 steps, each a question, the hand action that answers it, and what the learner should notice.

   Read `references/teaching.md` for this. It is the difference between a parts catalogue and a lesson: a row of
   labelled parts teaches names; a row where taking one out stops the flow teaches what each part does.

3. **Build the parts and the row.** Replace `look.demo(subject)` with the object. Open `references/recipes.md` for how
   to build real parts (springs, threads, screws, caps, bodies, batteries, LEDs, lenses, reflectors, gears, switches,
   grips, circuit boards, clear housings, wires) and how to lay them on the row (`look.row`), name them
   (`look.callouts`), show the axis (`look.axis`) and the flow (`look.powerPath`). The builders' signatures are at the
   top of `assets/exploded-view.js`. Draw every part from its real millimetres (`mm(v)` with the enlargement); give
   parts that nest inside others their real place with `at`.

4. **Wire the hands and the steps.** `row.hands(traits, isGrabbed, { onPress, onOut, onSeat })` makes every part
   grabbable and pressable: a press lifts the part and should say its job; a part pulled out and left on the floor
   should say what fails; a part put back clicks in. Fill the STEPS and the panel (an Apart slider, Apart/Together
   buttons, Back/Next, the enlargement in a note), call `row.update(delta)` and `path.update(time, stop, flow)` in
   `update`, and return `real: { size: big / ENLARGE }`. Read `/skills/looks/shared/hands.md` for the hand rules every
   look shares.

5. **Check, then fix.** Run

   ```
   node /skills/looks/exploded-view/scripts/check.mjs /work/module.js
   ```

   It runs the app's gate and dry run, the shared hand checks and the exploded-view rules. Fix every `FIX` line and
   read the `NOTE` lines; run it again until it prints `lesson ok`. Then read `references/mistakes.md` once and make
   sure none of those happened.

## A worked lesson

`assets/example-flashlight.js` is a whole exploded-view lesson that passes the check: what is inside a 1 x AA LED
flashlight. Seven parts from tail to head (tail cap with an orange switch, steel spring, AA cell, aluminium body,
LED board, chrome reflector, clear lens), each drawn from its real millimetres at 2 x; a glowing loop shows the
current's route through them; the learner presses parts to hear their jobs, pulls one out and closes the flashlight
to see where the current stops, puts it back with a click and clicks the switch to light it. Open it when you start
step 3. Take its method - true sizes, row = assembly order, a job per part, the flow made visible, the hands taking it
apart - not its subject.

## The look in one paragraph

One object over a pale, matte floor slab (`#dedbd5`, 6 mm thick, no longer than the row and its stands), sitting on a
thin ink dash-dot centre line held by two steel stands, or rising from the slab as a stack for flat objects. Every part
a real finish, one per part, so neighbours never share one: chrome, brass, steel, satin aluminium, rubber, clear and
milky plastic, circuit-board green, black and white plastic, and one accent part in moulded orange (`#e8742a`). Numbered
callouts in ink blue (`#1b2f8c`), one per part, straight above it on a thin leader. Motion: parts leave one after
another, overshoot and settle with a slight tilt of their own; they return in reverse and seat with a click. The
original film this look comes from is `assets/film/exploded-view.js` (a ballpoint pen); read it for its finishes,
its turned parts and helices, and its timing.

## Files

- `scripts/new-lesson.mjs` - step 1. `--force` replaces an existing /work/module.js.
- `scripts/check.mjs` - step 5. The exploded-view rules it applies are in `scripts/rules.json`.
- `assets/exploded-view.js` - the look: `explodedViewLook(THREE, kit)` and its builders (pasted in by step 1).
- `assets/example-flashlight.js` - the worked lesson.
- `assets/film/exploded-view.js` - the original teardown film of a ballpoint pen (reference only; it builds lights,
  cameras and a 2D overlay a lesson cannot).
- `references/teaching.md` - step 2: how a teardown explains an object, and how the hands test it.
- `references/recipes.md` - step 3: real parts, the row, callouts, axis and flow, with code.
- `references/mistakes.md` - step 5: failures seen in generated teardowns.
- `/skills/looks/shared/hands.md` - the hand rules every look shares.
