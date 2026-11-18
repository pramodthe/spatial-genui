---
name: learning-game
description: Build every mixed-reality lesson, course level and game as a learning game - the player does the real thing with their hands one move at a time, the scene answers each move and says in one line why it matters, then the same idea becomes a challenge with a measured result, stars and Try again (like folding a paper plane fold by fold, then throwing it to see how far it flies). Use it for every lesson, level and game this app writes, in any look (soft clay, voxel, low-poly, ink and toon, painted, paper pop-up, exploded view, circuit city) or in plain materials, and for game requests with no subject too (a racing game teaches speed and grip). Start every module with its scripts/new-game.mjs.
---

# Learning games

This app is a playground where people learn by playing. Every scene it writes is a small game on the player's desk
about one real idea, and the player learns that idea **by doing it with their hands**, not by reading about it.

The picture to keep in mind is a paper plane. The player gets a flat sheet and the goal "make a plane that flies
far". They pinch a corner and carry it over the centre line; the paper swings over, lands, and leaves a crease; the
panel says in one line why that fold matters ("the centre line keeps both wings even"). Seven folds later the sheet
is a plane, built by their own hands, and every fold had a reason. Then the challenge: throw it. It flies across the
desk, the distance shows, stars appear, and Try again invites a better throw. Nobody read a page; everybody learned
why a dart flies.

That is the loop every game here follows:

> **a goal** -> **moves done by hand**, one at a time -> **the scene answers** at once -> **one line of why** ->
> **a challenge** that measures the same idea -> **stars, best result, Try again**

Players are anyone from about 9 years old to adults. Write so a 10-year-old follows it and an adult does not feel
talked down to: short, concrete, plain words, real numbers with units.

## Clarity first: the 5-second test

A player who puts the headset on must know within five seconds what the game is and what to do, without reading.
Generated games failed exactly here: a bat game with four controls on two hands and a three-chirp bonus, a fruit game
with six steps from catching to a Serve button. Nobody could tell how to play them. So:

- **One sentence of about 15 words says the whole game**: "Swipe the fruit to cut it into the pieces the order asks
  for." "Fold the sheet, then throw the plane as far as you can." It is the panel's first line.
- **One main action, with one hand**: cut, throw, fold, pour, push, stack, steer. The other hand is free. Two
  controls at most; no modes, allowances, bonus rules or combos.
- **A familiar, real action.** People already know how to cut, throw, pour and steer; nobody knows how to "aim a
  listening cone". When the idea is invisible (sound, heat, a force), show it as something you see as well.
- **The scene shows the first move.** Before the player tries, the hero does the move by itself once (the flap folds
  half way and back, a ghost swipe crosses the fruit) and the next thing to touch bounces; Show me plays it again.
- **Depth comes from the idea, not from rules.** The challenge gets harder by asking for more of the same action
  (a harder fraction, a longer throw), never by adding controls.

## Steps

1. **Start the module.** Pick the look: the one the request or the course names, or the one that fits the subject
   (the table below), or `plain` for real-looking materials. Run

   ```
   node /skills/play/learning-game/scripts/new-game.mjs <look> /work/module.js
   ```

   When the plan or request says **mode: world** (a place the player walks in, not a toy on the desk), add
   `--world` and read `references/world.md`.

   It writes a game that passes the app's gate as it is: a starter game with a goal, a move to learn, a challenge
   with a clock, stars, best and Try again, all wired to the hands, and a `play` block the check can already play
   through. Starting from it means your effort goes into the game, not into plumbing. Three files:
   - **/work/game.js** - the game's own code (the parts block and `build()`). The only file you edit.
   - **/work/kits.js** - the look kit, the look's builders, the play kit (stars, bursts, pops), the ECS kit and, for a
     world, the land kit. Every function in it is in scope in game.js. Do not read or edit it: the APIs are in the
     look's skill, `assets/play-kit.js` notes and `/skills/common/ecs`.
   - **/work/module.js** - built from the two by the check and the play-test; what the headset gets. Never edit it.

2. **Plan before any geometry.** Write /work/plan.md (the format is in `references/parts.md`), using `references/design.md`:
   - the one idea, as a sentence a player could repeat ("a wing that pushes air down gets pushed up");
   - the goal, in the player's words ("make a plane that flies far");
   - the hero: the one thing the hands work on (the sheet, the boat, the bridge), big and in front;
   - 3 to 7 moves: the hand action, what the scene does in answer, and the why (one line, about 12 words);
   - the challenge: what is measured, why that number depends on the idea, and the thresholds for 1, 2 and 3 stars;
   - what a player changes on Try again to do better (that is where the learning sticks).

3. **Build the pieces in the look.** Open the look's skill, `/skills/looks/<look>/SKILL.md`, and use its builders
   (listed at the top of `/skills/looks/<look>/assets/<look>.js`), `references/recipes.md` and
   `references/mistakes.md`. Skip that skill's own start and check steps: this skill's scripts replace them and still
   run the look's rules. A look's stage flags and step panel are for journeys and processes; use them only when the
   game is one. For `plain`, use the kit's materials (`/skills/common/kit`). Replace `look.demo(subject)` with the
   game's pieces and return their hand targets.

4. **Wire the moves, the challenge and the feel.** The name, pitch and colours are `IDENTITY` and the sounds are
   `SOUNDS`, the game's parts in `/work/parts` (`references/parts.md`); edit those files, not the parts block. Fill MOVES (each with `say`, `why`, `target`, and a
   `done()` that turns true when the player has really done it) and CHALLENGE, and write the update logic that makes
   the scene answer: the flap swings over and stays creased, the boat leans into the wind, the bridge sags and holds.
   Read `references/feel.md`: every hand action answered in the same frame, something always moving, a reward that
   lands, nothing that hurts before Start. The hand rules every look shares are in `/skills/looks/shared/hands.md`;
   to follow the hand without a pinch (steering, aiming), use `hands` (`/skills/game/hand-play`); for sound (every
   action answered, and ideas about pitch, rhythm or echoes taught by ear), use `sound` (`/skills/common/sound`).

   Then write the game's `play` block (`references/play.md`): one gesture for each move, the gestures of one good
   round, and `state()`. It says what a player's hand does, as data; the check plays it. Whenever a move or the
   challenge changes, change its gesture in the same edit.

5. **Check, then fix.** Run

   ```
   node /skills/play/learning-game/scripts/check.mjs /work/module.js
   ```

   It runs the app's gate and dry run, the shared hand rules, the look's rules and the play rules, and then it plays
   the game through: a simulated hand does what the `play` block says, at 72 and at 30 frames a second, again after
   Try again, and once with no hand at all. A `Play:` line means a player would be stuck in the same place: a move
   that does not register, a round that never ends or has no result, a result that changes with the frame rate, a
   round won without the hand (`references/play.md` says what each one means). Fix every `FIX` line, read every
   `NOTE`, and run it again until it prints `game ok`; its `played through:` line shows the stars and the result
   your own gestures earned. Then read `references/mistakes.md` once and make sure none of those happened.

6. **Play-test it, then finish.** Follow the playtest skill (`/skills/play/playtest/SKILL.md`): open the game in the
   real headset app, look at the screenshot, apply the 5-second test, try the main action with an emulated hand, and
   fix what you see. Finish only when a first-time player would know what to do.

## Kinds of game

Most ideas fit one of these. `references/design.md` has each with its moves, its challenge and a code sketch.

| Kind | The hands... | The challenge measures... | For ideas like |
|---|---|---|---|
| Build it | put pieces together, fold, stack, connect | how well the thing works when tested | planes, bridges, circuits, cells, molecules |
| Test it | launch, drop, pour, push, then change one thing | distance, height, time, speed | forces, motion, gravity, friction, floating |
| Steer it | move a vehicle or creature by following the hand | crates, laps, time, hits avoided | wind and sails, orbits, currents, food chains |
| Sort it | pick things up and drop them where they belong | right answers in a time | classification, recycling, states of matter |
| Balance it | add and move weights or amounts until it settles | how close to balance, how few tries | levers, budgets, ecosystems, chemistry |
| Grow it | set conditions, then run time and watch | the biggest, healthiest or fastest result | plants, populations, money, erosion |

**A request for a game with no subject still teaches.** Find the real idea under it and build the game on that: a
racing game is about speed, grip and turning; a tower game is about centre of mass; a fishing game is about where
fish live. The fun stays; it just means something now.

## Choosing a look

The request or the course names the look; use it. Otherwise: soft-clay for friendly objects, amounts and growth;
voxel for things that build up block by block; low-poly for landscapes, journeys and vehicles outdoors; ink-toon for
how-tos with a few objects (the paper plane); painted for stories and places; paper-pop-up for a story in a few
scenes; exploded-view for what is inside a machine; circuit-city for something travelling through a system; plain
when the real look of the thing matters (a microscope, a guitar).

## Files

- `scripts/new-game.mjs` - step 1: writes game.js, kits.js and module.js. `--force` replaces them; `--world` starts a
  world around the player instead of a toy on the desk (references/world.md).
- `scripts/build-module.mjs` - builds /work/module.js from kits.js and game.js (the check and the play-test run it).
- `scripts/assemble.mjs` - joins the game's parts (`/work/parts`) into game.js's parts block; the check runs it first.
- `scripts/check.mjs` - step 5. Runs `/skills/looks/shared/scripts/check.mjs` (gate, hands, look rules), the play rules
  and the play-through.
- `assets/play-starter.js` - the starter game (game.js, written by step 1).
- `assets/play-kit.js` - stars, bursts and pops, self-lit so they suit every look (in kits.js, by step 1).
- `assets/plain.js` - the plain look: a desk mat and kit materials.
- `references/design.md` - step 2: the loop, the six kinds with code sketches, the challenge and its stars.
- `references/feel.md` - step 4: making every action answered, the scene alive and the reward land.
- `references/mistakes.md` - step 5: failures seen in generated games and lessons.
- `references/parts.md` - the plan's format and the parts' format (identity.js, sounds.js).
- `references/play.md` - steps 4 and 5: the `play` block (gestures, places, the hand's pose, state) and what each
  `Play:` finding means.
- `references/world.md` - when the plan says mode: world: a place around the player, built in desk units and shown
  12 times bigger (`new-game.mjs --world`).
