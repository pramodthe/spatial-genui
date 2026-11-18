# The scene plan: what stands where, decided before anything is built

When the game starts with `/work/parts/scene.js`, it has a **scene plan**. You say what stands in the scene and
how the things stand to each other; a solver finds the places. It puts each thing where its relations hold, where
it collides with nothing, and where the layout rules already hold: in reach, the start spot clear, the first view
open, no hand target hidden. You do not work out coordinates, and you do not find out about a bad layout after
building it.

## Steps

1. **Write the plan** in `/work/parts/scene.js`, before any geometry: every thing of the game once.

   ```js
   const SCENE = {
     mode: 'desk',                                    // or 'world' (new-game.mjs sets it)
     things: {
       plane:  { role: 'hero',    size: [0.2, 0.02, 0.28] },   // the box it fills: [width, height, depth]
       runway: { role: 'set',     size: [0.1, 0.01, 0.5] },
       start:  { role: 'button',  size: [0.08, 0.03, 0.04] },
       hoops:  { role: 'set',     size: [0.05, 0.05, 0.01], count: 6, lift: 0.3 },
       trees:  { role: 'scenery', size: [0.04, 0.09, 0.04], count: 10 },
       panel:  { role: 'panel',   size: [0.23, 0.2, 0.01] },
     },
     relations: [
       ['runway', 'right of', 'plane'],
       ['start', 'near', 'plane'],
       ['trees', 'around', 'edge'],
     ],
   };
   ```

2. **Place it.** Run

   ```
   node /skills/play/learning-game/scripts/layout.mjs /work/module.js
   ```

   It prints the layout from above (far at the top, the player at the bottom) and writes the places under the plan
   as `PLACES`. When a thing finds no place it says which, and what took its places away
   (`No place for start: 40 places do not fit ['start', 'near', 'plane']; 12 are taken by runway`): change a
   relation, make something smaller, or give it less room, and run it again. Never edit `PLACES`.

3. **Build each thing and stand it where the plan put it.** Add it to its group, then

   ```js
   sceneAt(THREE, plane, 'plane', { ground: set.userData.top });
   hoops.forEach((hoop, i) => sceneAt(THREE, hoop, 'hoops', { ground: set.userData.top, index: i }));
   const at = scenePlace('panel');                    // a panel takes its place as options
   kit.panel(ui, { position: at.position, rotationY: at.turn, ... });
   ```

   `sceneAt` centres the thing's own box on its place and sets its base on the ground, so where the object's
   origin is does not matter. Things that move afterwards (the hero in the hand, a ball in flight) start there.

4. **Check.** The check compares what was built with the plan: a thing in the plan and not in the game, or built
   bigger than the box its place was found for, is a `Scene:` FIX. Write its real size in `SCENE` and run
   `layout.mjs` again; when the plan changes, the places must be solved again too.

## Roles

| Role | It is | The solver makes sure |
|---|---|---|
| `hero` | the one thing the hands work on | it is in front of the player, in reach, in plain view |
| `tool`, `target`, `button` | other things a hand takes or presses | in reach (in a world, 0.6 to 1.4 m up), not hidden behind anything |
| `set` | a solid piece of the scene: a wall, a stand, a runway, a goal | it blocks neither the start spot nor the first view |
| `ground` | a flat area the player may walk over: a river bed, a path, a mat | things may stand `on` it |
| `scenery` | trees, rocks, clouds, by `count` | scattered where they are in nobody's way; one with no place is left out |
| `panel` | the game's panel | beside everything, in reach, turned to the player (in a world the app places it) |

A thing can have `count` (several of the same) and `lift` (how high its base is above the ground: a hoop in the
sky). In a world, what the hands use is stood at hand height by itself, and the notes tell you to build a post or a
ledge under it.

## Relations

`[thing, relation, other thing]`, where the other thing may be `'player'`. Right is the player's right, in front
of a thing is the side toward the player, in front of the player is ahead of them.

| Relation | Means |
|---|---|
| `left of`, `right of`, `in front of`, `behind`, `beside` | next to it on that side, lined up with it |
| `near`, `far` | within, or beyond, a distance (a fourth value sets it: `['start', 'near', 'plane', 0.05]`) |
| `on` | standing on top of it |
| `above` | over it, a fourth value higher (`['kite', 'above', 'handle', 0.3]`) |
| `in` | inside it or through it: the two are meant to touch (a dam in a river) |
| `between` | half way between two things: `['bridge', 'between', 'left bank', 'right bank']` |
| `around` | scattered round it, or round the `'edge'` of the scene (for `scenery`) |
| `facing` | turned toward it |
| `room` | `['kite', 'room', [0.5, 0.4, 0.4]]`: the space kept free round a thing that moves; nothing else is placed there |

## Good plans

- **Sizes first.** Decide how big each thing is before you build it; the hero is the biggest thing the hands
  touch. A plan with honest sizes is most of a good layout.
- **Few relations.** Say only what matters to the game: Start near the hero, the goal far from the player, the
  kite's sky kept free. The roles do the rest.
- **Give moving things room.** A thing that flies, rolls or swings needs a `room` as big as its motion, or the set
  ends up in its way.
