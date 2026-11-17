---
name: kit
description: The kit paintbox (materials, textures, shapes, instances, effects, cards). Read references/kit-api.md before building geometry.
---

# Kit

`build` receives `THREE` (r185), `kit`, `traits`, `ui` and `isGrabbed`. Do not create a renderer, scene, camera or lights.

Read `references/kit-api.md` for the calls. The worked example is `references/example-module.js` (a lesson, not a game).

Text in the world (a result where it happened, a results card; never the game's name: the app shows it) is `kit.sign(text,
{ width, paper, ink, edge, sub })`: a rounded card with big bold text in the game's colours, facing +z, one mesh;
`sign.userData.setText(text, sub)` changes it.

Panels are only `kit.panel`. Calling `ui()` yourself is rejected. See the panels skill.
