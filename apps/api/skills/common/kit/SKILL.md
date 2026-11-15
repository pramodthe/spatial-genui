---
name: kit
description: The kit paintbox (materials, textures, shapes, instances, effects, cards). Read references/kit-api.md before building geometry.
---

# Kit

`build` receives `THREE` (r185), `kit`, `traits`, `ui` and `isGrabbed`. Do not create a renderer, scene, camera or lights.

Read `references/kit-api.md` for the calls. The worked example is `references/example-module.js` (a lesson, not a game).

Panels are only `kit.panel`. Calling `ui()` yourself is rejected. See the panels skill.
