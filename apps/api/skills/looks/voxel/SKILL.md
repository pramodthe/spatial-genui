---
name: voxel
description: "Build a mixed-reality lesson as a hand-made voxel model on a display plinth - everything from small chamfered cubes in a short palette, the step's word spelled in cubes on the plinth's front, stages that drop in column by column and layer by layer - that the learner builds up by hand and counts cube by cube. Use it whenever a lesson or course asks for voxels, cubes, blocks, blocky, pixel-art 3D or a Minecraft-like look, and for subjects that build up in stages or are made of countable units - how a plant or animal grows, how something is built, assembled or layered (a house, a pyramid, rock layers, a reef), area and volume, doubling and populations, food and energy pyramids, a tank or a lake filling up - even if no look is named. Not for smooth or precise forms: curves, faces, anatomy, circuits or fine mechanisms."
---

# Voxel lessons

A voxel lesson is a small model on a smooth off-white plinth on the learner's desk where everything is built from
cubes: the ground is the top layers of cubes, the plant or the building stands on it in the same cubes, and the
step's word is spelled in dark cubes on the plinth's front. The look exists to make "how much" and "in what order"
countable. A cube is a unit - one block, one centimetre, one day, a thousand years - and a model builds up in an
order you can watch. A learner who carries the base of a pyramid onto its square and sees the counter stop at 121
knows where the stone goes before any sentence explains it. So every choice in this skill serves one goal: **the idea
of the lesson becomes cubes the learner can count, place and build up in order.**

Read this file once, then follow the steps. The references are short; open each when its step says so.

## Steps

1. **Start the module.** Run

   ```
   node /skills/looks/voxel/scripts/new-lesson.mjs /work/module.js
   ```

   It writes a module that already passes the app's gate: the look kit (cubes, voxel words, arrival motion,
   `lookSeat`), the voxel look (`voxelLook`, its builders and the plinth) and a starter lesson with a panel, steps and
   working hand targets. Starting from it means your effort goes into the lesson, not into getting cubes, layout and
   hands to work.

2. **Decide what the learner must understand, and how they will see it.** Before any cubes, write down in a few
   lines (in /work/plan.md):
   - the one idea of this lesson, as a sentence a learner could repeat ("each layer of a pyramid is 2 blocks
     narrower, so most of the stone sits in the bottom layers");
   - what one cube stands for (a block, 10 cm, a day) and the quantity that carries the idea, shown in cubes (a count
     on a cube counter, a stem's height against a cube ruler, the number of layers);
   - 3 to 5 steps, each with one question, the hand action that answers it, and what the learner should notice.

   Read `references/teaching.md` for this. It is the difference between a voxel model of the topic and a lesson about
   it: a cube sunflower alone teaches nothing; a sunflower that grows a stage each time the learner gives it water,
   with its height counted in cubes, teaches how it grows.

3. **Build the scene with the voxel builders.** Replace `look.demo(subject)` with the lesson's parts. Open
   `references/recipes.md` for how to make the usual things in cubes (ground and water, plants, animals, people,
   buildings, machines, weather, numbers and words, arrows and flows, stages) and the builders' signatures at the top
   of `assets/voxel.js`. Write cells with loops and simple shape rules, not by hand, and keep the real proportions and
   numbers of the subject. Every part is cubes; only the plinth is smooth. Each thing the hand picks up or that moves
   on its own is its own `look.model`.

4. **Wire the hands, the stages and the steps.** Return the hand targets (`{ object, grab: true }` for pieces the
   learner carries, `{ object, press: true }` for things they press), fill the STEPS and the panel, and write the
   update logic that makes the scene answer: a layer let go over its square drops in column by column and the counter
   counts its blocks as they land; a drop of water let go on the plant grows the next stage layer by layer. Drive
   every build with `look.stages`. Read `/skills/looks/shared/hands.md` for the hand rules (reach, size, spacing,
   put-it-back) every look shares.

5. **Check, then fix.** Run

   ```
   node /skills/looks/voxel/scripts/check.mjs /work/module.js
   ```

   It runs the app's gate and dry run, the shared hand checks and the voxel rules. Fix every `FIX` line and read the
   `NOTE` lines; run it again until it prints `lesson ok`. Then read `references/mistakes.md` once and make sure none
   of those happened.

## A worked lesson

`assets/example-pyramid.js` is a whole voxel lesson that passes the check: where the stone of a step pyramid goes.
One cube is one stone block. Five layers (11 x 11 down to 3 x 3, 285 blocks) stand on a sand square; the learner
carries each layer from a wooden sledge onto the square, its blocks drop in column by column, and a cube counter in
front counts them as they land; lifting a placed layer shows its own count and share of the stone. It starts finished,
then is taken down and built up again, with the step's word in cubes on the plinth. Open it when you start step 3. Take
its method - one cube one unit, the quantity counted in the scene, the build done by hand, one question per step - not
its subject.

## The voxel look in one paragraph

Small cubes with a narrow chamfer that catches the light, matte and painted, every cube a shade lighter or darker
than its neighbours, from a short palette (`look.PAL`): 3 to 5 colour families in a lesson, each in 2 or 3 shades
(grass and grassB, sand and sandDark). A smooth off-white plinth about as wide as the model; the model's ground is the
top layers of cubes on it. The cube size makes the model 0.25 to 0.35 m across, 10 to 40 cubes (`look.size` is
0.012 m). The cubes do the animating: a stage drops in column by column or grows layer by layer, each cube falling a
little and bouncing once on arrival (`look.stages`); flows are cubes hopping cell to cell (`look.flow`). Nothing
slides, fades or swells smoothly: a thing that grows gets more cubes, not bigger ones. The step's word is in dark cubes
on the plinth's front (`look.word`), counts are cube numbers (`look.counter`), sentences go on the panel. The original
film this look comes from is `assets/film/voxel.js` (a tomato plant growing); read it for its palette, its model
generators and its arrival timing.

## Files

- `scripts/new-lesson.mjs` - step 1. `--force` replaces an existing /work/module.js.
- `scripts/check.mjs` - step 5. The voxel rules it applies are in `scripts/rules.json`.
- `assets/voxel.js` - the voxel look: `voxelLook(THREE, kit)` and its builders (pasted in by step 1).
- `assets/example-pyramid.js` - the worked lesson.
- `assets/film/voxel.js` - the original film source of the look (reference only; it builds lights and cameras a
  lesson cannot).
- `references/teaching.md` - step 2: how a voxel lesson makes an idea countable and lets the hands build it.
- `references/recipes.md` - step 3: how to build common subjects in cubes, with code.
- `references/mistakes.md` - step 5: failures to avoid in voxel lessons.
- `/skills/looks/shared/hands.md` - the hand rules every look shares.
