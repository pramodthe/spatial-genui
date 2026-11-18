---
name: ecs
description: Organise a game as entities, components and systems (EliCS, the ECS Meta's IWSDK is built on) with the ECS kit - every game thing an entity, what it is and its data in components, every behaviour one system over a query. Use it for every game whose things change while it plays (move, float, get caught, score), and whenever a game has more than one rule.
---

# Entities, components, systems

A game is a small world of **entities** (the things the game talks about: the raft, each stone, the bat, the
moth, the round), **components** (what a thing is, with its data: `Raft { load }`, `Floating`, `Sinking`) and
**systems** (one thing that happens, every frame, to the entities its query finds: `Float`, `Load`, `Deliver`).
This is the ECS that Meta's IWSDK is built on (EliCS); `build` receives it as `api.ecs`, and the ECS kit
(`playWorld`, already in every learning-game module) makes it short. The full kit API is at the top of
`assets/ecs-kit.js`.

```js
export default function build(api) {
  const { THREE, kit } = api;
  const game = playWorld(api);
  const root = new THREE.Group();

  // What things are (data only: nouns and states).
  const Raft = game.component('Raft', { load: 'int', capacity: 'int' });
  const Stone = game.component('Stone', { kg: 'number' });
  const Aboard = game.component('Aboard', { raft: 'entity' });
  const Sinking = game.component('Sinking');

  // The things (build() only makes them).
  const raft = game.spawn(raftMesh, Raft, { capacity: 3 });
  for (const mesh of stoneMeshes) game.spawn(mesh, Stone, { kg: 2 }, game.Grabbable);

  // What happens (one behaviour each, in this order every frame).
  game.system('Load', { dropped: [Stone] }, (q) => {
    for (const stone of q.dropped) {
      if (stone.hasComponent(game.Held) || stone.hasComponent(Aboard)) continue;
      if (isOver(game.objectOf(stone), raftMesh)) {
        stone.addComponent(Aboard, { raft });
        raft.setValue(Raft, 'load', raft.getValue(Raft, 'load') + 1);
      }
    }
  });
  game.system('Float', { rafts: [Raft] }, (q, delta, time) => {
    for (const r of q.rafts) {
      const over = r.getValue(Raft, 'load') > r.getValue(Raft, 'capacity');
      if (over && !r.hasComponent(Sinking)) { r.addComponent(Sinking); sfx.fire('miss'); }
      game.objectOf(r).position.y = over ? -0.01 : 0.004 * Math.sin(time * 2);
    }
  });

  return { root, update: (time, delta) => game.update(time, delta) };
}
```

## Rules

- **One entity per thing the game talks about.** Scenery that never changes and that no rule mentions needs no
  entity: it is just in the root.
- **Components hold data, never code.** Name them as nouns or states: `Moth { distance }`, `Echoing`, `Caught`.
  A component with no fields is a tag: it marks a state (`Held`, `Sinking`, `Delivered`).
- **A system is one behaviour**, named as a verb (`Chirp`, `Echo`, `Catch`, `Score`), and it works only on what
  its query finds. Systems run in the order they are made: input first (the kit's Hands system already runs
  first), then the rules, then what the player sees and hears (`Feedback`, `Panel`).
- **Systems talk through components**, not by calling each other: `Catch` adds `Caught`; `Score` counts the
  entities that have `Caught`; `Feedback` shows a burst for the ones that just got it.
- **The round is an entity too**: `Round { phase: 'text', time: 'number', best: 'number' }`, so Start, Try again
  and the stars are systems over it, not flags scattered through the code. The game's `play` block reads it in
  `state()` (`/skills/play/learning-game/references/play.md`): keep the result and the stars on it too.
- **The hands**: `game.Grabbable` and `game.Pressable` on things spawned in `build()`; read `game.Held` and
  `game.Pressed` (true for the one frame of a press) in systems.
- **Nothing allocates in a system.** Make vectors and materials in `build()` and reuse them.
- The play kit (stars, burst, pointer, ring, `sfx.fire`) and `kit.panel` are called from systems like any code.
