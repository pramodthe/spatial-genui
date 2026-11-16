---
name: ink-toon
description: Build a mixed-reality lesson as a hand-inked comic cel on the desk - real 3D objects in flat two-tone colour with an ink line round every shape, halftone dots, hatched shadows, speed lines, impact ticks, steam squiggles and a big lettered word per step, on a sheet of warm paper - where the learner does the action (press, pump, pour, fold) and sees what it causes. Use it whenever a lesson or course asks for comic, cartoon, toon, cel, ink, manga-like or graphic-novel style, and for how-tos, recipes, procedures, repairs and everyday science told with a few recognisable objects - making coffee or tea, pumping a tyre, folding paper, fixing or using a tool, cooking, watering a plant, why a kettle whistles - even if no look is named. Not for maps, big systems with many parts, circuits, anatomy or data-heavy topics.
---

# Ink and toon lessons

An ink-toon lesson is a small comic panel standing on the learner's desk: a sheet of warm paper with a ruled ink border,
and on it a few real objects drawn like an animation cel - flat colour in two tones, an ink line round every shape,
halftone dots where light turns to shadow, hatching in the cast shadows. Each step is **one bold action on the same
hero object** (grind, pour, pump, fold), named by a big lettered word, and the effects of the action are drawn in:
speed lines on what moves, impact ticks where it lands, steam off what is hot, an arrow for the push. The look exists
to make cause and effect loud: the learner presses the pump, the handle slams down, a lump of air runs down the hose,
the needle jumps. So every choice serves one goal: **the learner does the action and sees exactly what it causes.**

Read this file once, then follow the steps. The references are short; open each when its step says so.

## Steps

1. **Start the module.** Run

   ```
   node /skills/looks/ink-toon/scripts/new-lesson.mjs /work/module.js
   ```

   It writes a module that already passes the app's gate: the look kit (`lookShade` cel and halftone shading that
   lights itself, `lookOutline`, `lookTwos`, `lookBack`, `lookPath`), the toon look (`inkToonLook`, its builders and the
   paper sheet) and a starter lesson with a panel, steps and working hand targets. Start from it so your effort goes
   into the lesson, not into materials, layout and hands.

2. **Decide the procedure, the action per step and what it causes.** Before any geometry, write in /work/plan.md:
   - the one idea, as a sentence a learner could repeat ("each push squeezes a fixed amount of air in, so the
     pressure climbs a step at a time and the push gets harder");
   - the hero object every step happens to, and the quantity that changes (a needle, a level of water, an arrow's
     length, a fold, a number lettered in the scene);
   - 3 to 5 steps, each with a question, one bold action the hands do, its word (POUR, FOLD, PUMP!), what it causes on
     the hero and the effect drawn in for it.

   Read `references/teaching.md` for this. A kettle and a cup on paper teach nothing; a pour where the learner tips
   the kettle, the water ribbon lands, the level rises and the scale reads 250 g teaches the recipe.

3. **Build the scene with the toon builders.** Replace `look.demo(subject)` with the lesson's parts. Open
   `references/recipes.md` for how to draw the usual things in ink (kitchen tools, cups and kettles, tools, a bicycle
   wheel, paper and folds, plants, hands and characters, liquids and steam, the effects and the step word), and the
   builders' signatures at the top of `assets/ink-toon.js`. Keep the real proportions and numbers of the subject.
   Every drawn thing comes from the look (`look.ink` and the builders): a lit kit material on the paper breaks the cel.

4. **Wire the hands and the steps.** Return the hand targets (`traits(part, { onPress })` for the thing the action is
   done to, `{ grab: true }` for a piece the learner moves), fill STEPS and the panel, and write the update logic on
   the twos clock: the press raises a flag, `update` plays the action in held poses with an overshoot, shows the
   effect for two drawings, then changes the quantity. Read `/skills/looks/shared/hands.md` for the hand rules (reach,
   size, spacing, put-it-back) every look shares.

5. **Check, then fix.** Run

   ```
   node /skills/looks/ink-toon/scripts/check.mjs /work/module.js
   ```

   It runs the app's gate and dry run, the shared hand checks and the toon rules. Fix every `FIX` line and read the
   `NOTE` lines; run it again until it prints `lesson ok`. Then read `references/mistakes.md` once and make sure none
   of those happened.

## A worked lesson

`assets/example-bike-pump.js` is a whole ink-toon lesson that passes the check: how to pump up a bicycle tyre and why
each push gets harder. The hero is a wheel on a stand with a floor pump clamped to its valve. Step SQUASH: the learner
presses the tyre and it squashes a long way (2 bar). PUMP!: each press slams the handle down in three drawings with
speed lines, a thump of impact ticks, a lump of air runs down the hose and the gauge needle jumps 0.175 bar (0.35 L of
air into a 2 L tyre). HARDER: the yellow arrow on the handle is the push that pressure takes (pressure x 7 cm2, 141 N
growing to 253 N). FIRM!: pressed again at 3.6 bar the tyre squashes about half as far. Open it when you start step 3.
Take its method - one hero, one action per step, the effect drawn in, the quantity in the scene - not its subject.

## The toon look in one paragraph

Real 3D forms, simple and recognisable, each `look.ink`-ed: a lit colour, a hand-picked shadow colour shifted toward
cool teal, a hard white glint on glossy things, and an ink line round it (`#1c1622`, the only ink). Paper, one ink and
4 or 5 spot colours from `look.PAL` (persimmon is the hero colour; teal, mustard, navy, charcoal, cream, white, leaf,
bean, water). Halftone (`{ halftone: true }`) on the hero's big curved surfaces; a hatched `look.shadow` under the
hero and props, to the right and behind. Motion snaps on twos: poses held for two frames (`lookTwos`), each move lands
in two or three drawings with an overshoot (`lookBack(x, 2.2)`, `look.pop`), hits squash and wobble (`look.squash`,
`look.wobble`); effects show for two or three drawings, then vanish. One big lettered word per step on a paper card
(`look.stepWord`), sentences on the panel. The original film is `assets/film/ink-toon.js` (pour-over coffee: grind,
bloom, pour); read it for exact palette, mark shapes and timing.

## Files

- `scripts/new-lesson.mjs` - step 1. `--force` replaces an existing /work/module.js.
- `scripts/check.mjs` - step 5. The toon rules it applies are in `scripts/rules.json`.
- `assets/ink-toon.js` - the look: `inkToonLook(THREE, kit)` and its builders (pasted in by step 1).
- `assets/example-bike-pump.js` - the worked lesson.
- `assets/film/ink-toon.js` - the original film source of the look (reference only; it uses lights, a camera, canvas
  text and a print filter a lesson cannot).
- `references/teaching.md` - step 2: how a toon lesson explains with actions, effects and words.
- `references/recipes.md` - step 3: how to draw common subjects and effects in ink, with code.
- `references/mistakes.md` - step 5: failures to check for.
- `/skills/looks/shared/hands.md` - the hand rules every look shares.
