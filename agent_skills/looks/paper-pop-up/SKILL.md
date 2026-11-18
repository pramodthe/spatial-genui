---
name: paper-pop-up
description: Build a mixed-reality lesson as an open pop-up book on the learner's desk - die-cut card scenes in a few flat inks that rise out of the gutter on V-folds, one spread per step, with pull tabs, lift-up flaps and paper wheels the learner works by hand and a paper ribbon carrying each step's line. Use it whenever a lesson or course asks for pop-up, paper, papercraft, cut-out, storybook or picture-book, and for anything told in stages or as a story - life cycles (frog, butterfly, plant), step-by-step processes (how bread rises, how a letter is posted, recycling), history and timelines, sequences and before/after, and children's topics - even if no look is named. Not for precise machines, circuits, anatomy, maps with exact distances, or anything the learner must turn and inspect in 3D.
---

# Paper pop-up lessons

> **In a learning game** (every lesson, level and game this app writes): start with the learning-game skill,
> `node /skills/play/learning-game/scripts/new-game.mjs paper-pop-up /work/module.js`, and check with its
> `scripts/check.mjs` (it runs this look's rules too). Use this skill for the look: its builders, recipes, palette
> and mistakes. Skip its own start and check scripts (`scripts/new-lesson.mjs`, `scripts/check.mjs`). Its stage
> flags and step panel are for journeys and processes; a game uses them only when it is one.

A paper pop-up lesson is a pop-up book open on the learner's desk. Every scene is flat die-cut card printed in a few
flat inks, with the pale core showing on every cut edge, standing on real fold mechanisms. When the learner presses the
corner of the page, the page turns: the scene on the old spread is pressed flat under it and the next one is pulled up
out of the gutter, layer after layer, trembling as the page lands. The look exists to tell a change in stages, and to
let the learner make the change happen. A child who pulls a tab and watches the tadpole's legs grow, then turns the
page to find a froglet, understands "it changes in steps, and each step comes from the last" before any sentence says
it. So every choice in this skill serves one goal: **each stage is one spread, and the change in it happens under the
learner's hand.**

Read this file once, then follow the steps. The references are short; open each when its step says so.

## Steps

1. **Start the module.** Run

   ```
   node /skills/looks/paper-pop-up/scripts/new-lesson.mjs /work/module.js
   ```

   It writes a module that already passes the app's gate: the look kit, the pop-up look (`paperPopUpLook`, its card
   and fold builders, the book with turning pages) and a starter lesson with a panel, steps and working hand targets.
   Starting from it means you spend your effort on the lesson, not on paper engineering.

2. **Decide the stages and the change in each.** Before any geometry, write down in /work/plan.md:
   - the one idea of the lesson, as a sentence a learner could repeat ("a frog changes body completely, in steps, and
     the frog it becomes lays the eggs that start it again");
   - 3 to 5 stages, one spread each: the big subject in the middle of the spread, its true number (how long, how
     many, how big), the question the spread asks and the one line for its ribbon;
   - for each spread, the change the hand makes on the spot: a pull tab that grows or moves something, a flap that
     reveals what is inside or underneath, a wheel that turns to the next state.

   Read `references/teaching.md` for this. It is the difference between a pretty book and a lesson: a spread that only
   shows a tadpole teaches little; a spread where the learner pulls the tab and the back legs grow while the tail
   shrinks teaches what changes.

3. **Build the spreads with the card builders.** `look.demo(subject)` becomes `look.set({ spreads: n })` and, per
   spread, V-folds for the subject, parallel folds and paper arms for what stands beside and above it, flat prints on
   the pages, the hand piece and a ribbon. Open `references/recipes.md` for how folds fit together and how to cut the
   usual subjects (animals and insects, plants, houses and scenery, water, sky, people, tabs, flaps, wheels, numbers)
   and read the builders' signatures at the top of `assets/paper-pop-up.js`. Keep real proportions and real numbers.
   Everything is card from `look.card`, `look.flat` and `look.number`: no solid blocks and no own materials.

4. **Wire the hands and the steps.** `go(n)` calls `book.turnTo(n)` and sets the panel; the corner tabs
   (`book.next`, `book.back`) and the panel's Back/Next call `go`. Make the pull tab grabbable (`traits(tab.object,
   { grab: true })`), flaps and wheels pressable, and in `update` call `book.update(time, delta)` and each hand piece's
   `update`, then let the scene answer: read `tab.k` (0..1) and grow, move or fill the thing it drives; show the
   number on the panel. Read `/skills/looks/shared/hands.md` for the hand rules every look shares.

5. **Check, then fix.** Run

   ```
   node /skills/looks/paper-pop-up/scripts/check.mjs /work/module.js
   ```

   It runs the app's gate and dry run, the shared hand checks and the pop-up rules. Fix every `FIX` line and read the
   `NOTE` lines; run it again until it prints `lesson ok`. Then read `references/mistakes.md` once and make sure none
   of those happened.

## A worked lesson

`assets/example-bread.js` is a whole pop-up lesson that passes the check: why bread rises. Spread 1 mixes 500 g flour,
300 ml water and 7 g yeast (lift the yeast packet: living cells inside); spread 2 lets an hour pass on a pull tab while
the dough doubles up to the 2x line and the clock's hand goes round; spread 3 bakes it at 220 C (press the oven: it
springs up and browns) and the crust of a slice lifts to show the holes the gas left. Open it when you start step 3.
Take its method - one spread per stage, the change made by hand, true numbers, one question per step - not its
subject.

## The pop-up look in one paragraph

Flat die-cut card, about 1.5 mm thick, in 4 or 5 inks per spread from the palette (cream, card, navy, coral, pink,
yellow, honey, amber, leaf, sage, deep, sky), with the bare cream core on every cut edge and sometimes a cream margin
round a shape. Detail is printed as smaller cards one thickness in front, never as texture. Depth comes from layers on
fold mechanisms: a tall back wall, the big subject on a V-fold in the middle, side pieces on parallel folds, small
things on trembling paper arms, a ribbon at the front. The book is cloth boards and cream pages, 0.4 m open. Only the
paper moves: pages turn, layers fold up and land with a small overshoot, tabs slide, flaps lift, wheels turn. The
original film this look comes from is `assets/film/paper-pop-up.js`; read it for its fold mechanisms and motion.

## Files

- `scripts/new-lesson.mjs` - step 1. `--force` replaces an existing /work/module.js.
- `scripts/check.mjs` - step 5. The pop-up rules it applies are in `scripts/rules.json`.
- `assets/paper-pop-up.js` - the look: `paperPopUpLook(THREE, kit)`, the book and its builders (pasted in by step 1).
- `assets/example-bread.js` - the worked lesson.
- `assets/film/paper-pop-up.js` - the original film source of the look (reference only; it builds lights, cameras and
  canvas textures a lesson cannot).
- `references/teaching.md` - step 2: how a pop-up book teaches a change in stages.
- `references/recipes.md` - step 3: the folds and how to cut common subjects, with code.
- `references/mistakes.md` - step 5: failures to avoid.
- `/skills/looks/shared/hands.md` - the hand rules every look shares.
