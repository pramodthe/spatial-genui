---
name: painted
description: Build a mixed-reality lesson as a picture-book oil painting of a place - a golden-hour landscape on a painted canvas ground where brush dabs are fixed to big simple shapes (fields of wheat, cottages, mills, rivers, carts, sheep, people), warm lamps mark the stop the story is at, and a traveller (a basket, a cart, a sack, a boat, the wind) carries the cause from one stop to the next while the learner presses stops and carries it by hand. Use it for stories and processes that happen in a place - how something is made (bread, wool, paper, cheese), where food or a material comes from, a day in a life, a history scene, a journey, a chain of cause and effect along a river or a road - and whenever a lesson or course asks for painting, painted, oil painting, storybook or picture book, even if the topic is not rural. Not for precise machines, circuits, abstract maths, charts or anatomy, where the dabs would blur the detail that matters.
---

# Painted lessons

> **In a learning game** (every lesson, level and game this app writes): start with the learning-game skill,
> `node /skills/play/learning-game/scripts/new-game.mjs painted /work/module.js`, and check with its
> `scripts/check.mjs` (it runs this look's rules too). Use this skill for the look: its builders, recipes, palette
> and mistakes. Skip its own start and check scripts (`scripts/new-lesson.mjs`, `scripts/check.mjs`). Its stage
> flags and step panel are for journeys and processes; a game uses them only when it is one.

A painted lesson is a small landscape on the learner's desk, painted in oils: a meadow on a canvas ground with a
ragged unpainted edge, and on it a few big simple things - a field, a stream, a cottage, a mill - each covered in
brush dabs that lean warm in the light and cool in the shadow. It reads like one page of a picture book. The look
exists to tell a process that happens in a place: each stop in the landscape does one visible thing, and something
that travels carries the result to the next stop. A learner who carries the basket from the stream to the cottage
and watches the heap of wool become four balls of yarn understands the chain because they moved it themselves. So
every choice in this skill serves one goal: **the story of the process is a journey the learner's hands make, and
what changes at each stop is something they can see.**

Read this file once, then follow the steps. The references are short; open each when its step says so.

## Steps

1. **Start the module.** Run

   ```
   node /skills/looks/painted/scripts/new-lesson.mjs /work/module.js
   ```

   It writes a module that already passes the app's gate: the look kit (`lookShade` in its self-lit `dabs` mode,
   `lookLumpy`, `lookPath`, `lookSeat`), the painted look (`paintedLook`, its builders and the canvas ground) and a
   starter lesson with a panel, steps and working hand targets. Starting from it means you spend your effort on the
   lesson, not on getting the paint, layout and hands to work.

2. **Decide the story and its stops.** Before any geometry, write in /work/plan.md:
   - the one idea, as a sentence a learner could repeat ("wind turns the mill, the stones grind wheat into flour, and
     the flour is baked into bread");
   - 3 or 4 stops in the landscape, left to right, each with the one thing that happens there;
   - the traveller that carries the result from stop to stop (a basket, a cart, a sack, a boat, the wind, a person);
   - the quantity and how it shows as stuff (a sack filling, a heap shrinking, sheaves on a cart, loaves on a sill),
     with its true numbers;
   - for each step: the question, the hand action that answers it, and what to notice.

   Read `references/teaching.md` for this. It is the difference between a pretty painting of a farm and a lesson:
   a mill alone teaches nothing; a sack the learner carries to the mill, which comes back as a smaller sack of flour
   and a heap of bran, teaches what milling does.

3. **Paint the place with the builders.** Replace `look.demo(subject)` with the lesson's place. Open
   `references/recipes.md` for how to paint the usual things (fields and crops, trees and hedges, houses and mills,
   windmills and waterwheels, rivers and boats, animals and people, carts and roads, sun and lamps, wind, captions)
   and the builders' signatures at the top of `assets/painted.js`. Make each subject one big recognisable
   silhouette: the dabs eat anything thinner than about 4 mm. Paint everything with the look (`look.paint`,
   `look.mat`); only lamps glow.

4. **Wire the hands, the lamps and the steps.** Return the hand targets: the traveller is grabbable (the learner
   carries it to the next stop, `lookSeat` with a home that moves to each stop), each stop's big subject is pressable
   (press it and the traveller walks there along `path.userData.route`, or the stop does its work). Light the lamp at
   the stop the story is at and let the next one glow gently (`lamp.userData.set(k)`), keep a slow breeze in the
   fields and smoke in the chimney, and compute the quantity and the panel from one state. Read
   `/skills/looks/shared/hands.md` for the hand rules (reach, size, spacing, put-it-back) every look shares.

5. **Check, then fix.** Run

   ```
   node /skills/looks/painted/scripts/check.mjs /work/module.js
   ```

   It runs the app's gate and dry run, the shared hand checks and the painted rules. Fix every `FIX` line and read
   the `NOTE` lines; run it again until it prints `lesson ok`. Then read `references/mistakes.md` once and make sure
   none of those happened.

## A worked lesson

`assets/example-wool.js` is a whole painted lesson that passes the check: how one sheep's fleece becomes four
jumpers. Four stops along a track - a pasture, a stream, a cottage with a spinning wheel, a washing line - each with
a warm lamp. The learner presses the sheep and the fleece fills the basket (4 kg); carries the basket to the stream
and the heap shrinks and turns clean (2 kg: half was grease and dirt); carries it to the cottage and the wheel spins
it into four balls of yarn; carries it to the line and four jumpers appear, one per 0.5 kg ball. The panel and a
signboard caption read the same state. Open it when you start step 3. Take its method - stops along a track, a
traveller the hands carry, the quantity as stuff in it - not its subject.

## The painted look in one paragraph

Golden hour, painted. Every surface is brush dabs from `lookShade` mode `dabs`: each dab its own tilt and a warm or
cool lean, lit side warm, shadow side blue-violet, so warm light against cool shadow is the whole palette (`look.PAL`:
meadow, wheat, stubble, earth, wall, roof, tree, bark, wood, water, stone, cloth, wool, linen, flour, crust, sail, skin,
red, dark). The shader lights itself from the upper left, because the headset has no lamps in the scene. Shapes are
rough and simple, with no detail of their own; small things get smaller dabs (`scale` 0.006-0.01), the ground 0.024.
Small warm lamps (a window, a lantern, a doorway) are where the eye goes. Motion is gentle and continuous - stalks
bend in a wave, sails turn, smoke rises, the traveller walks the track - never snappy. One short caption per step.
The original film is `assets/film/painted.js` (wind to bread); read it for its palette, its wind and its sacks.

## Files

- `scripts/new-lesson.mjs` - step 1. `--force` replaces an existing /work/module.js.
- `scripts/check.mjs` - step 5. The painted rules it applies are in `scripts/rules.json`.
- `assets/painted.js` - the painted look: `paintedLook(THREE, kit)` and its builders (pasted in by step 1).
- `assets/example-wool.js` - the worked lesson.
- `assets/film/painted.js` - the original oil-painting film (reference only; it builds lights, cameras and screen
  filters a lesson cannot).
- `references/teaching.md` - step 2: stops, the traveller, lamps, the quantity as stuff, steps as questions.
- `references/recipes.md` - step 3: how to paint common things, with code.
- `references/mistakes.md` - step 5: failures to check for.
- `/skills/looks/shared/hands.md` - the hand rules every look shares.
