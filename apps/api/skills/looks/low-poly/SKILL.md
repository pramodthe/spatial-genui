---
name: low-poly
description: Build a mixed-reality lesson as a faceted low-poly miniature landscape on the desk - an island tile with mountains, rivers, fields, little buildings, vehicles and numbered paper flags at the stages, every triangle one flat tone in a sand, coral, teal and sage palette - where the learner presses the stages and moves what flows between them. Use it whenever a lesson or course asks for low-poly, faceted, papercraft or diorama landscapes, and for processes that happen in a place, even if no look is named - cycles (water, carbon, rock), journeys and routes, supply chains (food, energy, goods from source to shop), ecosystems and food webs, geography, farming, towns and infrastructure (water supply, waste, power), trade. Not for the inside of a machine, a circuit, anatomy, abstract maths or a single object turned in the hand.
---

# Low-poly lessons

A low-poly lesson is a small faceted world on the learner's desk: an island tile with a mountain, a river, a field, a
few buildings and a road, every triangle one flat tone like cut paper, and a numbered paper flag at each stage of
the process. The look exists to make a process that happens in a place visible all at once. A learner who sees the
grain leave the field, the flour pile up at the mill and the truck carry it to the bakery understands where bread
comes from as a route with places on it, not as a list. So every choice in this skill serves one goal: **the stages
of the process are places the learner can point at, and what flows between them travels, piles up and can be
counted.**

Read this file once, then follow the steps. The references are short; open each when its step says so.

## Steps

1. **Start the module.** Run

   ```
   node /skills/looks/low-poly/scripts/new-lesson.mjs /work/module.js
   ```

   It writes a module that already passes the app's gate: the look kit (facets, paths, motion, `lookSeat`), the
   low-poly look (`lowPolyLook`, its builders and the island tile) and a starter lesson with a panel, steps and a
   working flag to press. Starting from it means you spend your effort on the lesson, not on materials, layout and
   hands.

2. **Decide what the learner must understand, and where it happens.** Before any geometry, write down in a few lines
   (in /work/plan.md):
   - the one idea, as a sentence a learner could repeat ("80 kg of wheat becomes 60 kg of flour and 120 loaves; the
     rest is bran, nothing is lost");
   - the stages (3 to 5), each a place on the island with a flag;
   - what flows between them and how its amount is shown (a traveller on the route, a pile, a water level, a count);
   - 3 to 5 steps, each with one question, the hand action that answers it, and what the learner should notice.

   Read `references/teaching.md` for this. It is the difference between a pretty diorama and a lesson: an island
   with a mill on it teaches nothing; a mill where the learner tips in a crate and watches 20 kg become 15 kg of
   flour and 5 kg of bran teaches the idea.

3. **Build the place with the low-poly builders.** Replace `look.demo(subject)` with the lesson's landscape and
   stages. Open `references/recipes.md` for how to build the usual things in facets (terrain, mountains, rivers and
   sea, trees, fields, buildings, roads and pipes, vehicles, clouds and rain, people, flags, numbers, arrows) and the
   builders' signatures at the top of `assets/low-poly.js`. Keep real proportions and real numbers. Take every colour
   from the palette by name: the builders refuse other colours, because one off-palette colour breaks the calm of
   the whole world.

4. **Wire the hands and the steps.** Flags at the stages are pressed (`traits(flag, { onPress })`) to go to that
   step; the slow pieces the learner places (a crate, a sack, a seed, the sun) are grabbed and answer where they
   are dropped. Things that travel (the truck, a droplet, a boat) are never grabbable: press something to send them.
   Fill STEPS and the panel, and write the update logic that makes the place answer: the crate is tipped in, the
   mill turns, a sack appears, the truck drives off. Read `/skills/looks/shared/hands.md` for the hand rules every
   look shares.

5. **Check, then fix.** Run

   ```
   node /skills/looks/low-poly/scripts/check.mjs /work/module.js
   ```

   It runs the app's gate and dry run, the shared hand checks and the low-poly rules. Fix every `FIX` line and read
   the `NOTE` lines; run it again until it prints `lesson ok`. Then read `references/mistakes.md` once and make sure
   none of those happened.

## A worked lesson

`assets/example-bread.js` is a whole low-poly lesson that passes the check: from a field of wheat to loaves in a
shop. Four stages with flags (field, mill, bakery, shop) on one island, joined by a road. The learner picks up a
crate of grain (20 kg) and drops it on the mill's hopper; the sails spin, a big flour sack (15 kg) and a small bran
sack (5 kg) appear in the yard, the truck carries the flour along the road to the bakery, smoke rises while it
bakes, and the loaves (30 per sack) pile up at the shop under a cut-paper count. Open it when you start step 3.
Take its method - stages as flagged places, the flow carried by a traveller, amounts as piles and counts worked out
from the scene's state, one question per step - not its subject.

## The low-poly look in one paragraph

A miniature world of flat, faceted shapes, like folded paper or cut stone: every triangle is one tone and neighbours
differ slightly (`look.facet` does this), inside a short palette of sand, coral and cream against teal water and
sage greens. Few segments: 5 to 8 sides on cones and cylinders, detail 0 or 1 on icosahedra, a little jitter so no
shape looks like a primitive. Matte paper-like facets with no texture; only water is slightly glossy, and it heaves
(`look.update(time)`) so its facets keep catching the light. Motion: things unfold facet by facet from one point
(`look.unfold`) or pop out of the ground with a bounce (`look.pop`); clouds drift; cut-gem droplets rise and fall;
something travels the route between the stages (`look.follow`); the current stage's flag rises and lights
(`flag.userData.active`). Words: stage names on 3 to 5 `kit.card` tags right above the flags, amounts as cut-paper
numbers (`look.number`), sentences on the panel. The original film this look comes from is `assets/film/low-poly.js`
(the water cycle); read it for its exact palette, the unfolding and the way the flags pop up.

## Files

- `scripts/new-lesson.mjs` - step 1. `--force` replaces an existing /work/module.js.
- `scripts/check.mjs` - step 5. The low-poly rules it applies are in `scripts/rules.json`.
- `assets/low-poly.js` - the look: `lowPolyLook(THREE, kit)` and its builders (pasted in by step 1).
- `assets/example-bread.js` - the worked lesson.
- `assets/film/low-poly.js` - the original film source of the look (reference only; it builds lights, a sky and a
  camera a lesson cannot).
- `references/teaching.md` - step 2: how a landscape lesson makes a process visible and lets the hands run it.
- `references/recipes.md` - step 3: how to build common things in facets, with code.
- `references/mistakes.md` - step 5: failures to avoid in low-poly lessons.
- `/skills/looks/shared/hands.md` - the hand rules every look shares.
