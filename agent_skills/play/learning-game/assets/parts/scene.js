// The scene plan: what stands in the scene and how the things stand to each other (references/scene.md). Write it
// before any geometry, then run `node /skills/play/learning-game/scripts/layout.mjs`: it finds a place for every
// thing and writes them under this as PLACES. In the game, stand each thing where the plan put it with
// sceneAt(THREE, object, 'name', { ground }). Change the plan here and run layout.mjs again; never edit PLACES.
const SCENE = {
  mode: '__MODE__',
  things: {
    // REPLACE: every thing of the game once, with the box it fills [width, height, depth] in the game's units.
    hero: { role: 'hero', size: __HERO__ },
    start: { role: 'button', size: __START__ },
    panel: { role: 'panel', size: [0.3, 0.3, 0.01] },
  },
  relations: [
    // REPLACE: ['start', 'near', 'hero'], ['runway', 'right of', 'hero'], ['kite', 'above', 'handle', 0.3], ...
  ],
};
