# design.md template

Fill every section, in this order. Keep the headings. Use tables where shown. Short, plain sentences; numbers with
units.

```markdown
# <TITLE: 2 to 4 words, original> — Design

<One sentence of about 15 words that says the whole game.>

## 1. Learning
- Kind: <procedure | mechanism | physics | hand skill | concept>
- The idea: <one sentence a player could repeat after playing>
- After playing, the player can: <2 to 4 goals, each something they can do or explain>
- Ages: about 9 to adult

## 2. Player fantasy
<Two or three sentences: who the player is and what it feels like.>

## 3. Core loop
1. Goal: <in the player's words>
2. Moves: <3 to 7 hand steps, below>
3. Challenge: <what is measured, in real units, and why it depends on the idea>
4. Result: stars, best result, Try again (<what Try again keeps and what it resets>)

### Moves
| # | Move (real action) | Hand action (controls.md) | What the scene answers | Why (about 12 words) | done() when |
|---|---|---|---|---|---|

## 4. Controls
| Action | Hand | Gesture | Basic action and API | Object and size | Zone | Feedback (see, hear) | Emulator check |
|---|---|---|---|---|---|---|---|

Gaps: <actions the subject needs that controls.md lacks, and the mapping used; or "none">

## 5. Environment
- Mode: <desk | world>, because <reason>
- First second: <what the player sees, and what bounces first>

Scene plan (environment.md; the coder copies it into /work/parts/scene.js and the solver places it; no coordinates):

```js
const SCENE = {
  mode: '<desk | world>',
  things: {
    <name>: { role: '<hero | tool | target | button | set | ground | scenery | panel>', size: [<w>, <h>, <d>] },   // metres, the game's units
  },
  relations: [
    ['<thing>', '<relation>', '<other thing or player>'],
  ],
};
```

<World only: sky, ground, the path, the near and far areas.>

Motion (only when something moves by a physical rule): <the motion kit helper for each, from
/skills/game/motion (motionHeld + motionBody for a throw, motionGlide, motionFloat, motionLever...), with its numbers:
masses, sizes, gravity scale (SCALE), and what the player's action changes>

## 6. Levels and progression
| Level | What changes (one thing) | 1 star | 2 stars | 3 stars |
|---|---|---|---|---|

## 7. Mistakes, failure and reset
| Wrong step | What happens (shows why it matters) | How the player recovers |
|---|---|---|

- Nothing scores, drifts or times out before Start.
- Try again: <keeps / resets>

## 8. Facts and safety
| Fact the game teaches | Value and units | Where it appears |
|---|---|---|

Safety notes: <real-world safety the game teaches, or "none">
Facts to check: <anything uncertain; or "none">

## 9. Visual and UI direction
(See visual.md.)
- Look: <ink-toon | exploded-view | circuit-city | low-poly | painted | paper-pop-up | soft-clay | voxel | plain | custom (plain)>, because <why it fits the subject>
- Theme and setting: <where it happens, who the player is>
- Palette:
  | Colour (look palette name, or hex for custom) | Used for |
  |---|---|
- Materials (custom look only): <object kind: kit preset, texture>
- Panel voice: <how it speaks>; opening line: "<the goal in one sentence>"
- Signs: <what, where, colours>
- Feedback: <what success and try again look and sound like, the same all game>
- Motion: <idle motion; how moves land>
- Sound: <per action; ambience for a world>

## 10. Assets
| ID | Type | Gameplay role | Real size | Made from | Matches style of | Used by (move or level) | Source |
|---|---|---|---|---|---|---|---|

Source is one of: kit shape, look builder, library model (name), model-maker, sound library, generated sound.

## 11. Checks
Logic checks (run in Node, no headset):
- <statement with numbers, e.g. "100 g flour and 2 eggs gives a rise of at least 3 cm">

Hand checks (emulated hand in the headset runtime):
- <statement, e.g. "grab the egg, move 6 cm down over the rim: eggCracked is true">

## 12. Out of scope
- <what this version does not do>
```
