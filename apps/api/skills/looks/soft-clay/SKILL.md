---
name: soft-clay
description: Build a mixed-reality lesson as a plasticine stop-motion tabletop - chunky, slightly lopsided clay figures, coin stacks, bowls, fat clay numbers and force arrows on a coloured card board - that the learner picks up, drops and presses to see an idea work. Use it whenever a lesson or course asks for clay, plasticine, claymation or stop-motion, and for friendly, concrete topics where amounts and comparisons carry the idea - money and saving, sharing and division, fractions, counting, growth, balance and simple forces, food and portions, life cycles told with characters - even if no look is named. Not for precise machines, circuits, maps or anatomy.
---

# Soft clay lessons

A soft-clay lesson is a small tabletop on the learner's desk where everything is plasticine: the board is coloured card,
the objects are chunky and a little lopsided with fingerprints in them, and they move like stop-motion, a pose at a
time. The look exists to make abstract amounts touchable. A child who drops a fourth coin on a stack and watches the
stack, the clay number and the arrow all change understands "more" before any sentence explains it. So every choice in
this skill serves one goal: **the idea of the lesson becomes something the learner can hold, move and compare.**

Read this file once, then follow the steps. The references are short; open each when its step says so.

## Steps

1. **Start the module.** Run

   ```
   node /skills/looks/soft-clay/scripts/new-lesson.mjs /work/module.js
   ```

   It writes a module that already passes the app's gate: the look kit (clay material, lumpy shapes, stop-motion
   timing, `lookSeat`), the clay look (`softClayLook`, its builders and the card board) and a starter lesson with a
   panel, steps and working hand targets. Starting from it means you spend your effort on the lesson, not on getting
   materials, layout and hands to work.

2. **Decide what the learner must understand, and how they will see it.** Before any geometry, write down in a few
   lines (in /work/plan.md):
   - the one idea of this lesson, as a sentence a learner could repeat ("every week's coins add to the pile, and the
     pile grows faster when it earns interest");
   - the quantity that carries it and how it is made visible in clay (a stack's height, an arrow's length, a fat clay
     number, a share in a bowl);
   - 3 to 5 steps, each with one question, the hand action that answers it, and what the learner should notice.

   Read `references/teaching.md` for this. It is the difference between a clay model of the topic and a lesson about
   it: a seesaw alone teaches nothing; a seesaw where the learner moves a child and watches weight x distance decide
   which way it tips teaches the idea.

3. **Build the scene with the clay builders.** Replace `look.demo(subject)` with the lesson's parts. Open
   `references/recipes.md` for how to make the usual things in clay (characters, coins and stacks, bowls and food,
   plants, money and labels, simple machines, force and motion arrows, numbers and words) and the builders' signatures
   at the top of `assets/soft-clay.js`. Keep the real proportions and numbers of the subject. Build from the clay box
   only: a shiny or plain material on the board breaks the illusion that it was all modelled by hand.

4. **Wire the hands and the steps.** Return the hand targets (`{ object, grab: true }` for pieces the learner moves,
   `{ object, press: true }` for things they press), fill the STEPS and the panel, and write the update logic that
   makes the scene answer: a coin dropped on the stack lands with a bounce and the number changes; a child dropped on
   a mark snaps there and the plank tilts. Read `/skills/looks/shared/hands.md` for the hand rules (reach, size,
   spacing, put-it-back) every look shares.

5. **Check, then fix.** Run

   ```
   node /skills/looks/soft-clay/scripts/check.mjs /work/module.js
   ```

   It runs the app's gate and dry run, the shared hand checks and the clay rules. Fix every `FIX` line and read the
   `NOTE` lines; run it again until it prints `lesson ok`. Then read `references/mistakes.md` once and make sure none of
   those happened.

## A worked lesson

`assets/example-balance.js` is a whole soft-clay lesson that passes the check and the emulator hand test: why a
seesaw balances. Two clay children (weights 2 and 1, written on them in clay) stand on a plank with marks 1 to 4; a red
clay arrow under each shows its weight; the learner picks a child up and drops it on a mark, it snaps there, and the
plank tilts the way weight x distance says, while the panel shows the turning on each side. Open it when you start
step 3. Take its method - the quantity made physical, the experiment done by hand, one question per step - not its
subject.

## The clay look in one paragraph

Chunky forms with soft edges and big radii, pushed slightly out of true (`look.clay` does this), from one box of clay:
cream, coral, yellow, navy, green, white, pink, brown, black - each with a second colour streaked through it. A teal card
board with a low curved backdrop strip behind, no taller than the tallest object. Matte and waxy, never shiny. Motion
on twos: a pose held for two frames (`lookTwos(time)`), arrivals that squash and bounce (`lookBounce`), stacks that
flinch when something lands. Words in the scene are fat clay numbers and short words (`look.number`), sentences go on
the panel. The original film this look comes from is `assets/film/soft-clay.js`; read it if you need its exact
palette, lighting intent or animation timing.

## Files

- `scripts/new-lesson.mjs` - step 1. `--force` replaces an existing /work/module.js.
- `scripts/check.mjs` - step 5. The clay rules it applies are in `scripts/rules.json`.
- `assets/soft-clay.js` - the clay look: `softClayLook(THREE, kit)` and its builders (pasted in by step 1).
- `assets/example-balance.js` - the worked lesson.
- `assets/film/soft-clay.js` - the original stop-motion film source of the look (reference only; it builds lights and
  cameras a lesson cannot).
- `references/teaching.md` - step 2: how a clay lesson makes an idea visible and lets the hands test it.
- `references/recipes.md` - step 3: how to build common subjects in clay, with code.
- `references/mistakes.md` - step 5: failures seen in generated clay lessons.
- `/skills/looks/shared/hands.md` - the hand rules every look shares.
