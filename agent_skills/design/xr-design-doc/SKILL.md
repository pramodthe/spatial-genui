---
name: xr-design-doc
description: Write the design document (design.md) for a hands-on XR learning game before any code exists - the idea, the moves, the exact hand controls, the desk or world environment, levels, facts, assets and checks - so the coder builds to a spec and the grader can test it. Use it for every new game and course level.
---

# XR design document

You write `design.md` for one learning game that a child (about 9 and up) plays with their hands in a Meta Quest
headset. The coder builds only what this document says, so every line must be buildable with the app's kit and
testable without a person in the headset.

A good design document is specific. "The player folds the paper" is not a design. "Right hand pinches the 3 cm
corner tab and carries it over the centre line; past 90 degrees the flap finishes the fold, before it springs back;
a crease line appears and the panel says why" is.

## Steps

1. **Decide the kind of learning** (procedure, mechanism, physics, hand skill or concept) and the one idea under the
   request, as a sentence a player could repeat. See `references/template.md`, section 2.
2. **Choose desk or world** with `references/environment.md`, and write the scene plan: every thing with its role,
   size and relations. Never coordinates: the placement solver finds the places.
3. **Write the moves.** Each move is one real hand action from `references/controls.md`. Use only the actions listed
   there. If the subject needs an action the list does not have, map it to the closest listed action and say so
   under "Gaps", never invent an API.
4. **Choose the look, palette and UI** with `references/visual.md`. This is where the game gets its own identity:
   the theme, setting, palette, panel voice, feedback, motion and sound are yours to decide, inside the rules there.
5. **Fill every section of `references/template.md`**, in order, with tables where the template has tables.
6. **Check it** against the list at the end of this file before you finish.

`references/example-cake.md` is a complete example at the quality expected.

## Rules that are never broken

- One sentence of about 15 words says the whole game; the first move is clear in five seconds without reading.
- The hands do the real thing: fold, pour, stir, stack, steer. A press only when the real action is a press.
- The challenge's number depends on the idea, never on speed of clicking.
- Nothing scores, drifts or times out before Start. A wrong move is undone or retried, with no lost points.
- Facts are true and stated with units. Anything you are not sure of goes under "Facts to check", not into the game.
- Original names and looks only: never the name, characters or look of an existing game, film or brand.
- Panel text is at most two short sentences; the why is one line of about 12 words.

## Where the details live

| You need | Read |
|---|---|
| Which hand actions exist and their limits | `references/controls.md` (the only list the coder can build) |
| Desk and world sizes, reach, layout | `references/environment.md` |
| Looks, palettes, custom look, UI direction | `references/visual.md`, then the look's skill `/skills/looks/<look>` |
| The coder's hands API | `/skills/game/hand-play/SKILL.md` |
| Grab and press | `/skills/common/kit/references/kit-api.md` (`traits`, `isGrabbed`) |
| How moves and challenges are coded | `/skills/play/learning-game/references/design.md` |
| What made games feel good or fail | `/skills/play/learning-game/references/feel.md`, `mistakes.md` |

The host is built on Meta's Immersive Web SDK (IWSDK). Its docs (https://iwsdk.dev/concepts/xr-input/actions.html,
pointers, gaze and pinch, grabbing, locomotion) describe what the headset can do, but **a game module cannot call
IWSDK input directly**: it only gets the kit's `hands`, `traits` and `isGrabbed`. Design against `controls.md`.
When the team adds an IWSDK feature to the kit (for example two-hand grabbing), it is added to `controls.md` first.

## Before you finish

- [ ] Every move names one action from `controls.md`, a size, a feedback and a `done()` condition.
- [ ] Every control row has a size or zone that meets the limits in `controls.md`.
- [ ] Every thing is in the scene plan once, with a role and an honest size; the hands' things have the role `hero`,
      `tool`, `target` or `button`, so the solver keeps them in reach (`environment.md`).
- [ ] Everything that moves by a physical rule names its motion kit helper and numbers (`/skills/game/motion`).
- [ ] There are 3 or more levels, each changing one thing, with star thresholds in real units.
- [ ] Every asset has a gameplay role, a real size, a source and the step that uses it.
- [ ] The look fits the subject (`visual.md`); every palette colour has a job, and the hero stands out.
- [ ] The panel voice, feedback, motion and sound are written down, not left to the coder.
- [ ] Every check can be tested by code or by the emulated hand, without a person, and each move's emulator check
      can be written as one gesture of the game's `play` block (`/skills/play/learning-game/references/play.md`).
- [ ] Facts have units; doubtful ones are listed under "Facts to check".
