# Teaching with a teardown

A teardown works when, after each step, the learner can say what a part does and what would happen without it. An
exploded view is good at this because every part is a thing they can see on its own, take out and put back. Use that.

## 1. Name the idea, then what flows through the parts

Write the idea as one sentence a learner could repeat. Almost every object is explained by something that passes
through its parts in order - current, force, air, water, ink, light, a turning motion. Name it and its route:

| Object | The idea | What flows | Its route through the parts |
|---|---|---|---|
| Flashlight | One closed loop of current lights the LED | current | battery + -> LED board -> body -> tail cap switch -> spring -> battery - |
| Computer mouse | A click and a movement become signals to the computer | press, light, signal | button -> switch on the board; LED -> lens -> desk -> sensor; board -> cable or radio |
| Ballpoint pen | Each click turns a cam that locks the refill out or in | force | button -> cam -> refill -> spring pushes back |
| Bike bell | A thumb lever spins a striker that hits the dome | force, sound | lever -> gear -> striker -> dome rings |
| Door lock | The right key lifts every pin to the shear line, so the plug turns | force | key -> pins -> plug -> cam -> bolt |
| Tap | Turning the handle lifts a washer off the seat, so water passes | water | inlet -> seat -> washer -> spout |
| Stapler | Pressing drives one staple through and the anvil folds it | force | handle -> driver -> staple -> paper -> anvil |

If what flows is only in the panel's text, the lesson is a parts catalogue. Draw it through the parts
(`look.powerPath`: a glowing line with a bead running along it, or `kit.arrow` for a force), and keep the panel for
the sentence that explains it.

## 2. The row is the order of assembly

Put the parts on the row in the order they go together (tail to head, bottom to top). Then the row itself teaches:
the numbers on the callouts are the build order, closing the row shows where each part goes, and a part in the wrong
place is visibly wrong. For each part write three things before building it:

- **its job** in one sentence, as a function, not a name ("pushes the battery onto the LED board and carries the
  current back to the cap", not "the spring");
- **what fails without it** ("no spring: the battery's - end touches nothing, the loop is open, no light");
- **its real size** in mm and its real finish.

5 to 8 parts. Small pieces that only work together (a screw and its washer, two halves of a clip) are one part.

## 3. Plan steps as questions

3 to 5 steps. Each asks one question, gives the hands something to do that answers it, and says what to notice. The
first step shows the object apart, full size (the host sizes the lesson by what it shows first).

Example (flashlight):

1. **What is inside?** - the row apart, seven numbered parts. Press a part: it lifts and the panel says its job. Pull
   one out and put it back. Notice: the order of the row is the order it is built.
2. **Which way does the current go?** - the route lights up through the parts (`path.update(time, -1, false)`: the
   route, nothing moving yet). Notice: one loop, and the metal body is part of the wire.
3. **What closes the loop?** - Together: the parts seat with a click; press the tail cap to click the switch; the bead
   runs round, the LED lights. Notice: light only when every part touches the next.
4. **What if a part is missing?** - apart again; the learner pulls one part out, leaves it on the floor, presses
   Together; the current stops at the gap and the panel says what failed. Put it back: click, light. Notice: some
   parts (lens, reflector) are not on the loop, and it still lights without them.

## 4. The hands take it apart

The best hand actions are the real ones: pull a part out of the row, put it back where it belongs, click the switch,
press the button, turn the wheel. `row.hands` gives every part both:

- **press** (a poke) lifts the part toward the learner, lights its callout and should put its job on the panel;
- **grab** (a pinch) pulls it out; let go near its place and it slides home with a click (`onSeat`: say so, green);
  let go elsewhere and it drops onto the floor and stays out (`onOut`: say what fails, amber);
- the panel's **Apart slider** and **Apart / Together** buttons open and close the whole row
  (`row.place(k)` for the slider, `row.go(k)` for the buttons). They are the second way in, never the only one.

Each action answers in the same frame: the part lifts, the path stops at the gap, the light goes out, the panel
changes. When a step has a goal ("make it light"), say so on the panel when it is reached.

## 5. Numbers that are true

- Build every part from its real millimetres through one helper, `const mm = (v) => v * 0.001 * ENLARGE`, so the
  proportions are the real ones (an AA cell is 50.5 x 14.5 mm, a mouse is about 115 x 62 x 38 mm, a pen spring about
  5 mm across).
- Enlarge so the row apart spans 0.4 to 0.5 m and the thickest part is at least 5 cm (a 99 mm flashlight at 2 x; a
  pen at 3 x). Say it on the panel ("Shown 2 x real size: the real one is 99 mm long") and return
  `real: { size: big / ENLARGE }`, so the host's real-size view shows every part at its true size.
- Compute what the panel says from the scene (which parts are out, whether the row is closed, whether the switch is
  on) so what the learner sees and what the panel says can never disagree.

## Motion

Parts leave one after another, about 0.09 s apart, each overshooting its place and settling (`lookBack`) with a slight
tilt of its own; they come back in reverse and seat with a click (`lookBounce`). `row.go(k)` does all of this; do not
animate the parts yourself. A part the learner pressed rises toward them and stays up until another is pressed.
Mechanisms move at desk speed: a spring squeezes as it seats (scale its mesh, not its group), a button dips when
pressed, a wheel turns. Nothing moves while it is held (`isGrabbed`).
