# The design document's template

The game's design is the canvas main document, `canvas/documents/design.md`. Fill every section, in this order, and
keep the headings. Use the tables where shown. Short, plain sentences; numbers with units. About 800 words in all.

```markdown
# <TITLE: 2 to 4 words, original> — Design

<One sentence of about 15 words that says the whole game.>

## 1. Learning
- Kind: <procedure | mechanism | physics | hand skill | concept>
- The idea: <one sentence a player could repeat after playing>
- After playing, the player can: <2 to 4 things they can do or explain>
- Ages: about 9 to adult

## 2. Player fantasy
<Two or three sentences: who the player is and what it feels like.>

## 3. Core loop
1. Goal: <in the player's words>
2. Moves: <3 hand steps, below>
3. Challenge: <what is measured, in real units, and why it depends on the idea>
4. Result: stars, best result, Try again (<what it keeps and what it resets>)

### Moves
| # | Move (real action) | Hand action (hand-actions.md) | What the scene answers | Why (about 12 words) | Done when (a GameState value) |
|---|---|---|---|---|---|

## 4. Controls
| Action | Hand | Gesture | IWSDK component | Object name and size | Feedback (see, hear) | Hand check (the sequence, and the GameState it gives) |
|---|---|---|---|---|---|---|

At most three different hand actions. Gaps: <what the subject needs that hand-actions.md lacks, and the mapping used; or "none">

## 5. Environment
- Setting: <where it happens>; the player stands at the origin facing -Z, and that spot is empty
- First second: <what the player sees, and the one thing that moves to say "touch me first">

| Object (its runtime name) | Position x, y, z (m) | Size (m) | Hands touch it? |
|---|---|---|---|

- Motion (only what moves by a rule): <the rule and its numbers, e.g. "water depth rises 2 cm per second while the gate is shut">

## 6. Levels and progression
| Level | What changes (one number) | 1 star | 2 stars | 3 stars |
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
- Theme and setting: <where it happens, who the player is>
- Material language: <what things are made of: wood and stone, soft clay, paper, metal...>
- Palette: <4 to 6 colours as hex, and what each is used for; one accent colour for what the hands touch>
- First-view mockup: <one sentence: what the mockup picture should show>
- Panel voice: <how it speaks>; opening line: "<the goal in one sentence>"
- Feedback: <what success and "try again" look and sound like, the same all game>
- Motion: <what idles; how a move lands>
- Sound: <per action>

## 10. Assets
| ID | Type | Gameplay role | Size (m) | Source | Loaded from | Used by (move or level) |
|---|---|---|---|---|---|---|

Type is one of: 3D model, picture, scene asset (shapes built in code), UIKitML panel, sound.
Source is one of: generated model (from a generated picture), generated picture, built in code, sound library (its name).
Loaded from is where the game gets it: `public/models/<name>.glb`, `public/textures/<name>.png`,
`public/audio/library/<name>.mp3`, `src/scene-assets/<file>`, `public/ui/<file>`.
At most 3 generated models and 8 generated pictures (the mockup counts as one): the hero and the props that carry
the idea get models; the rest is built in code.

## 11. Checks
Hand checks, one per move, then Start and the round. Each becomes a step of playtest.json:
- <e.g. "pinch Log 1, carry it to Dam Slot 1, let go: movesDone is 1">

Logic checks:
- <a statement with numbers, e.g. "with 3 logs the water holds at 0.30 m; with 2 it leaks to 0.10 m">

## 12. Out of scope
- <what this version does not do>
```
