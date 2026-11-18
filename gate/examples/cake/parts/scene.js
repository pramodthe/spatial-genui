// The scene plan, from the cake's design (agent_skills/design/xr-design-doc/references/example-cake.md, section 5):
// what stands in the scene and how the things stand to each other (references/scene.md). layout.mjs finds a place
// for every thing and writes them under this as PLACES; the game stands each thing there with sceneAt.
const SCENE = {
  mode: 'desk',
  things: {
    bowl: { role: 'hero', size: [0.14, 0.075, 0.14] },
    butter: { role: 'tool', size: [0.05, 0.03, 0.04] },
    sugarJug: { role: 'tool', size: [0.08, 0.09, 0.06] },
    flourJug: { role: 'tool', size: [0.08, 0.09, 0.06] },
    whisk: { role: 'tool', size: [0.13, 0.04, 0.04] },
    oven: { role: 'target', size: [0.2, 0.15, 0.16] },
    start: { role: 'button', size: [0.06, 0.03, 0.06] },
    panel: { role: 'panel', size: [0.3, 0.3, 0.01] },
  },
  relations: [
    ['oven', 'right of', 'bowl'],
    ['sugarJug', 'left of', 'bowl'],
    ['flourJug', 'left of', 'bowl'],
    ['butter', 'in front of', 'bowl'],
    ['whisk', 'in front of', 'bowl'],
    ['start', 'near', 'bowl'],
  ],
};
// ---- places (written by scripts/layout.mjs from SCENE above: never edit) ----
// plan: 5e8ec952eb5c
const PLACES = {"bowl":{"position":[0,0.038,0.02],"turn":0,"size":[0.14,0.075,0.14]},"butter":{"position":[0,0.015,0.13],"turn":0,"size":[0.05,0.03,0.04]},"sugarJug":{"position":[-0.13,0.045,0.02],"turn":0,"size":[0.08,0.09,0.06]},"flourJug":{"position":[-0.14,0.045,-0.06],"turn":0,"size":[0.08,0.09,0.06]},"whisk":{"position":[0,0.02,0.2],"turn":0,"size":[0.13,0.04,0.04]},"oven":{"position":[0.19,0.075,0.02],"turn":0,"size":[0.2,0.15,0.16]},"start":{"position":[-0.04,0.015,-0.14],"turn":0,"size":[0.06,0.03,0.06]},"panel":{"position":[0.49,0.282,0],"turn":-0.3,"size":[0.3,0.3,0.01]}};
// ---- end of places ----
