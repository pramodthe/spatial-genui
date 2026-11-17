# A world around the player

Most games here are toys on the player's real desk. When the plan says **mode: world**, the game is a place the
player stands in and walks around instead: a riverbank, a campsite, a race track, the inside of a cell. Start it
with `node scripts/new-game.mjs <look> /work/module.js --world`.

## The same game, 12 times bigger

A world is built exactly like a desk game: the same units, the same look builders, the kit and the play kit. The
headset shows it **12 times bigger** around the player. So think in desk centimetres and know what they become:

| In your code | In the world |
|---|---|
| 1 cm | 12 cm |
| a 15 cm tree | a 1.8 m tree |
| 5 to 12 cm up | waist to chest height: where hands touch things |
| 13 cm up | the player's eyes |
| 5 cm around the player | what they reach without walking |
| 30 to 60 cm away | 4 to 7 m: the far side of the place |

The hands (`hands.right.tip`) and every distance in your code are in the same desk units, so a touch radius of
3 cm is 36 cm in the world: right for things this big.

## Lay it out as a place

- **The player stands at the origin, facing -Z.** The starter moves the set 25 cm ahead (3 m in the world).
  Put the first thing to do 8 to 15 cm ahead (1 to 2 m), clearly visible from where they stand.
- **Spread the place out**: a near area to learn in, a path, a far area for the challenge, a few things to the
  sides to find. Leave room to walk between them (at least 4 cm, half a metre in the world).
- **Things the hands touch stand 5 to 12 cm high**, on a post, a table, a rock or a ledge; never flat on the
  ground and never above the head.
- **The sky and the far ground are the host's.** Choose them in what `build()` returns: `sky` is `day`, `dawn`,
  `dusk`, `night` (with stars) or `overcast`; `ground` is `grass`, `sand`, `snow` or `rock` (the starter returns day
  and grass). The land the player walks on is yours: see "The land" below.
- **Sound the place**: start an ambience loop from the sound library on Start (a windy hill, a forest, a river, a
  cave, a night, the sea; `/skills/common/sound/references/library.md`).
- **The panel is placed by the host**, beside the player at reading size. Signs go on the place itself, 15 to
  25 cm up, readable from the start spot. The app shows the game's name as a title card when it opens.
- **The player walks** with the thumbstick (slide) or by pointing and pinching where to go (teleport). Make the
  way to walk obvious: a path, a glowing ring where to stand, the pointer.

## The land

`--world` adds the land kit (`assets/world-kit.js`, its full API at the top) and the starter already builds a
land at the end of `build()`: flat where the player starts and where the game stands, a short path, pines and
rocks round about, mountains at the edge. **Replace it to suit the place**; keep it after the game is measured, as
the starter does.

- `worldTerrain(THREE, { flat, hills, valley, colors, seed })`: the ground. `flat` spots (`{ x, z, r }`) for the
  start and every area the game uses; `hills` (`{ x, z, r, h }`); one `valley` for a riverbed. Stand things on it
  with `land.userData.heightAt(x, z)`.
- `worldPath(THREE, land, points, { width, color })`: a path that shows where to walk.
- `worldWater(THREE, land, { color })` fills the valley; `{ x, z, r }` makes a pond.
- `worldScatter(THREE, land, kind, { count, from, to, avoid, seed })`: `pine`, `round`, `bush` or `rock`, one draw
  call for all of them. `avoid` the flat spots so nothing grows through the game.
- `worldEdge(THREE, { kind, color })`: `mountains` or `hills` all round, so the world has no end.

The land and paths are walkable: the player walks over them in the headset, so keep slopes gentle where they go.
Colour the land, path, water and scatter in the look's palette.

## Budget

The same as on the desk: about 150 meshes. A world needs many repeated things (trees, rocks, fence posts), so make
them with `kit.instances`, not one mesh each.
