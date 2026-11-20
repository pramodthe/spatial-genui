---
name: xr-game-foundations
description: Set or repair a VR game's structure in this IWSDK project - who owns the game state, how hand actions map to game actions, how assets and levels are organised, and what to settle before building.
---

# XR Game Foundations

Use this skill for structure decisions and changes that cut across the game. For focused work in a game that already runs, keep its working boundaries and change only what the request needs.

## The runtime

The runtime is IWSDK: entities, components and systems, scenes composed in JSON, panels in UIKitML. Its rules are in the project's `AGENTS.md` and `src/AGENTS.md`, and its own skills cover each part. Do not add another engine, a physics library or a UI library; use what IWSDK provides and what is installed.

## Stable boundaries

- **Rules and state are independent of how things look.** The game's phase, moves, measures, timers and level live in the `GameState` component and are changed by one or two systems. Meshes, panels, sounds and effects read that state and show it; they never hold the truth. One place decides that a move is done.
- **Hand actions map to named game actions in one place.** A grab released near a slot is `placeLog(1)`; a press on the button is `start()`. The systems that watch `Grabbed` and `Pressed` call those functions, and the same functions serve Try again and the levels.
- **Assets are named once.** Every model, picture, panel and sound has an ID in `src/assets.ts`; code and scenes use the ID, never a file path.
- **Levels are data.** One `LEVELS` array holds what changes per level and the star thresholds. No level number is written into a system.
- **Words stay on panels.** Dynamic text and numbers are set in code on UIKitML elements; nothing the player must read is baked into a texture.
- **Reset is complete.** Try again puts every thing back where it started, releases anything held, clears timers and returns `GameState` to its start values for the same level.

Add layers only when ownership or lifetime needs them: a small game is a state component, one or two systems, a few scene assets and a panel. Guard against the concrete failures of this game (a second thing dropped into a full slot, Start pressed twice, a thing let go in mid-air); do not hide an error behind a default.

## Before implementation

For a new or much changed game, settle these, in the design document:

- the idea, the player fantasy and the three hand moves
- the round: what is measured, in which units, and how it depends on the idea
- success, failure and reset
- where the player stands and what is within reach
- what owns the state and which systems change it
- the asset list and where each asset is loaded from
- the panel: what it shows in each phase

Once these are clear, build the first playable slice instead of extending the structure.
