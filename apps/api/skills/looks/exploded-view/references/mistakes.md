# Mistakes seen in generated teardowns

Each of these happened in a real generated lesson (in this look or another). Check yours against them before you
finish.

1. **A parts catalogue with captions.** The row showed seven labelled parts and the panel listed their names. The
   learner learned names, not jobs. Fix: give every part its job and what fails without it, show what flows through
   the parts (`look.powerPath`, `kit.arrow`), and let taking a part out change it (references/teaching.md).

2. **Parts life-size and tiny.** A real 12 cm flashlight was built at 1:1: a 1.5 cm-wide row of slivers, springs
   thinner than a hair, nothing a hand could pinch. Fix: enlarge until the row apart spans 0.4-0.5 m and the thickest
   part is at least 5 cm, and say so on the panel ("shown 2 x real size") and in `real.size`.

3. **Made-up sizes.** A battery as long as the body, a spring as fat as the cap. Fix: real millimetres through `mm()`
   for every part (references/recipes.md).

4. **A floor that dwarfs the object.** A 0.8 m round platform under a 0.3 m row became the subject. Fix:
   `look.set({ length: row.length + 0.08 })`: a slab no longer than the row and its stands, pale and matte.

5. **Parts scattered instead of on an axis.** Parts were spread over the desk in a grid, so the eye could not read
   how they go together. Fix: one row on one axis in assembly order (`look.row`), the dash-dot centre line through it
   (`look.axis`); flat objects rise as a stack (`dir: [0, 1, -0.35]`).

6. **Floating parts with no stand.** Parts hung in the air with nothing under them. Fix: `look.axis(row)` (the centre
   line on two steel stands) and the row's contact shadows; a part the learner takes out drops to the floor.

7. **Callouts piled on each other.** Seven cards at one height over a crowded row covered each other and the parts,
   or floated at the edge of the scene with long lines. Fix: `look.callouts(row, names)` (straight above each part,
   heights alternated, number tags where names cannot fit), short names, at most 7.

8. **All parts the same grey.** Every part in one plastic: the row read as one blob. Fix: a real finish per part
   (chrome, brass, steel, satin, rubber, clear, pcb, black, white), neighbours never the same, one orange accent.

9. **A case hiding the parts.** A box-shaped housing round the whole row, or a shell drawn on top of everything,
   hid what the lesson was about. Fix: the shell is one part of the row; clear parts where seeing inside matters.

10. **Springs as tubes, threads as nothing.** A spring drawn as a plain cylinder, a cap with no thread. Fix:
    `look.spring` (a true helix with closed ends) and `look.thread` on the end that screws in.

11. **Parts that never go back.** Parts could be grabbed but stayed wherever they were dropped, and the object could
    not be closed again. Fix: `row.hands` (put back near its place, it clicks in) and Apart/Together on the panel.

12. **The whole object grabbable.** The assembled object was one grabbable, so its parts could never be pulled out.
    Fix: the parts are the hand targets; the floor, the axis and the subject group never are.

13. **The lesson starts closed and small.** The first frame showed the closed object; the host sized the lesson for it,
    and the open row later ran off the desk. Fix: the row starts apart (`look.row` does), the floor is the row's
    length; close it in a later step.

14. **Long sentences in big numbers.** The panel's `stat` showed a sentence. A stat is a short value ("Closed: lit",
    "1.5 V"); sentences go in `text` items.
