---
name: styles
description: Draw a mixed-reality lesson in one of nine looks - voxel, soft-clay, low-poly, pencil-sketch, ink-toon, painted, paper-pop-up, exploded-view, circuit-city - with working hand interaction. Has a script that starts a lesson in the look (look module, helpers, starter with grabs, presses and put-it-back), a checker for the gate, the hands and the look, a runnable XR module per look, and the original film source of each look. Use when the request or course names a look, or the subject plainly fits one.
---

# Styles

A look is how a lesson is drawn: palette, materials, the set it stands on, motion, words. It never changes what the
lesson is about, and it never replaces the hands: the learner picks things up and presses them in every look.

## Pick the look

| Look | Good for |
|---|---|
| `exploded-view` | What is inside an object and how it goes together |
| `paper-pop-up` | A story or process in a few steps, one spread per step |
| `pencil-sketch` | How something is built, step by step; anatomy of an object, plans |
| `ink-toon` | Steps, recipes, how-tos with a few recognisable objects |
| `painted` | Processes and stories that happen in a place |
| `soft-clay` | Friendly objects on a table: amounts as piles, growth, comparison |
| `voxel` | A small model that builds up in stages |
| `low-poly` | Cycles, journeys, supply chains in a landscape |
| `circuit-city` | Something travelling through a system, stage by stage |

Use the look the request or course names. Otherwise use none, unless the subject plainly fits a row.

## Steps

1. **Start the lesson in the look.** Run
   `node /skills/common/styles/scripts/new-lesson.mjs <look> /work/module.js`.
   It writes a module that already passes the gate: the helpers, the look's module, and a starter with the set,
   a subject group, hand targets (grab with put-it-back, press with feedback), steps on the panel and a demo.
2. **Read the look's brief**, `references/briefs/<look>.md`: its set, palette, how the film's beats become steps, the
   words, and what the hands do in this look.
3. **Read `references/hands.md`** (always) and `references/film-to-desk.md` (the first time you use a look).
4. **Replace the demo** (`look.demo(subject)`) with the lesson's parts, built with the look's helpers (listed at the
   top of `assets/styles/<look>.js`). Return the hand targets: `{ object, grab: true }` for the pieces the learner
   picks up, `{ object, press: true }` for the stops and parts they press. Replace the STEPS, the panel title and the
   press handlers. Keep the set, the subject group, the seats, the bounce and the panel placement.
5. **Check:** `node /skills/common/styles/scripts/check-lesson.mjs /work/module.js`. It runs the app's gate and dry run,
   then checks the hands (targets on the model, none on the set or the whole scene, put-it-back on grabbed parts) and
   the look (its module is used, the demo is gone). Fix every FIX line, read the NOTE lines, run it again until it
   prints `lesson ok`.

## Files

- `scripts/new-lesson.mjs` - starts a lesson in a look (step 1). `--force` replaces an existing file.
- `scripts/check-lesson.mjs` - the gate, hands and look check (step 5).
- `assets/styles/<look>.js` - one XR module per look: a function `<look>Look(THREE, kit)` returning the palette,
  materials made once, `set()` (the ground of the look, never grabbable), builders for that look's parts, and
  `demo()`. new-lesson.mjs pastes it in; read it for the builders.
- `assets/lib/look-kit.js` - the shared helpers: self-lit drawn materials (`lookShade`: cel, halftone, hatch, dabs;
  the headset has no lamps, so these light themselves), `lookOutline`, `lookFacets`, `lookVoxels`, `lookVoxelWord`,
  `lookClay`, `lookLumpy`, `lookCard`, motion (`lookSeg`, `lookBack`, `lookBounce`, `lookTwos`, `lookPath`) and
  `lookSeat` (a released part slides home). Pasted in by new-lesson.mjs.
- `assets/starter.js` - the lesson skeleton new-lesson.mjs fills in.
- `assets/examples/voxel-sprout.js`, `assets/examples/pencil-stool.js` - two whole lessons with steps and hands (a
  pressable watering can; a seat to lift off and put back, pressable legs). Open the closer one when you need more
  than the starter.
- `assets/film/styles/<look>.js` and `assets/film/lib/` - the original film source of each look (a three.js motion
  graphic for a 1920x1080 film, with its stage, sound, 3D text and stroke-font kits). Read it for a look's exact
  palette, shapes and motion; never paste it into a lesson (it builds lights, cameras and filters a lesson cannot).
- `references/briefs/<look>.md`, `references/hands.md`, `references/film-to-desk.md` - as in the steps.

## Rules every look keeps

- Real proportions and real numbers; the subject is the biggest, clearest thing; the set no wider than the subject.
- Hands-on from the first second, a hand action on the model in every step; grab the pieces, never the scene.
- No lights, cameras or filters: drawn looks use `lookShade`, the rest real materials; glow for anything that shines.
- Under 150 draw calls and 150,000 triangles. Outlines cost a draw call each; a voxel model is one.
