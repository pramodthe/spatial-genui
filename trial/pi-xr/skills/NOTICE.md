# Where these skills come from

The skills in this folder are adapted from the `web-game-studio` plugin of OhMyGame
(https://github.com/WhiteTowerAI/ohmygame-plugins, `plugins/web-game-studio/skills/`), which is licensed under the
Apache License, Version 2.0. A copy of that licence is in `LICENSE-APACHE-2.0`.

| Skill here | Adapted from |
|---|---|
| `xr-game-studio` | `web-game-studio` |
| `xr-game-foundations` | `web-game-foundations` |
| `xr-game-playtest` | `game-playtest` |
| `xr-game-ui` | `game-ui-frontend` |
| `xr-3d-asset-pipeline` | `web-3d-asset-pipeline` |

What was changed:

- The target is a VR learning game for a child, built on Meta's IWSDK, not a browser game. Engine choice,
  responsive iframe layout, DOM HUD, touch controls, multiplayer, saves, the tuning panel and the 2D sprite pipeline
  were removed; the Three.js, Phaser and React Three Fiber runtime skills are replaced by IWSDK's own skills.
- OhMyGame's `game_use` play-test tool is replaced by IWSDK's tools (emulated hands, ECS state, console,
  screenshots), and its state bridge by one ECS component, `GameState`.
- Added for learning games: the 12-section design document, the rules of a move and a round, the hand actions, the
  sound library and `playtest.json`.
- The canvas tools (`canvas_initialize`, `canvas_check`, `generate_canvas_media`) and media tools
  (`generate_image`, `generate_3d_asset`) keep OhMyGame's names and file layout; here pictures come from Meta's Muse
  Image and 3D models from TRELLIS.2.
