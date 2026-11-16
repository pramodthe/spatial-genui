# Painted recipes

All sizes in metres; the ground is about 0.42 x 0.3 m and things stand on `set.userData.top` (put them in the
`subject` group). The story runs left to right; stops sit in the front half (z > -0.1) where hands reach, scenery
(hedges, trees, the sun) at the back. Every recipe uses the builders of `paintedLook` (`look`), which take a paint from
the box: meadow, wheat, stubble, earth, wall, roof, tree, bark, wood, water, stone, cloth, wool, linen, flour, crust,
sail, skin, red, dark. Each paint is a warm lit colour and a cool shadow colour; shared materials are made once.

## Contents
- Any shape, painted
- Fields and crops, and the wind in them
- Trees and hedges
- Houses, mills, bakeries
- Windmills and waterwheels
- Rivers, roads and boats
- Carts, sacks, heaps and loaves
- People and animals
- Sun, lamps and windows; the active stop
- Smoke and steam
- Captions and tags

## Any shape, painted

```js
const barrel = look.paint(kit.lathe([[0.012, 0], [0.015, 0.015], [0.012, 0.03]], 12), 'wood', 'Barrel', 0.008);
const rock = look.blob(0.02, 'stone', 'Rock', { squash: 0.6 });     // lumpy round form; dabs ~ half its radius
```

The fourth argument is the dab size: 0.016 by default, 0.006-0.01 on small things, 0.024 on the ground. Bake a
stretch into the geometry (`geometry.scale(...)`) rather than scaling the mesh, so the dabs keep their shape. Merge a
static group of painted parts with `kit.merge(group)` (one draw call per paint).

## Fields and crops, and the wind in them

```js
const field = look.field(0.14, 0.09, 'Wheat field', { n: 300, colour: 'wheat', h: 0.04 });   // soil + instanced stalks
field.position.set(-0.12, 0, -0.04);
// in update: a breeze always, a gust when the story needs it; the wave runs along the field's +x
field.userData.sway(time, gust);          // gust 0.2 = breeze, 1 = a strong gust bending everything
field.userData.cut(k);                    // reap from -x: k = 0 standing, 1 all stubble
const grass = look.field(0.1, 0.06, 'Grass', { colour: 'meadow', soil: 'meadow', h: 0.018, ears: false });
```

Turn the field (`rotation.y`) so its +x points downwind, toward the mill. Sheaves are short `look.paint` cylinders in
'wheat' standing in threes; a haystack is `look.blob(r, 'wheat', ..., { squash: 0.8 })`.

## Trees and hedges

```js
const oak = look.tree('Oak', { h: 0.1 });                         // trunk + three lumpy crowns, merged
const poplar = look.tree('Poplar', { h: 0.11, kind: 'poplar' });  // one tall crown
const hedge = look.hedge(0.14, 'Hedge', { h: 0.026 });            // a row of bushes along x
```

Put trees and hedges at the back and the sides, not between the learner and a stop. An orchard is 4 to 6 small round
trees with a few 'red' or 'crust' blobs (r 0.004) in the crowns.

## Houses, mills, bakeries

```js
const bakery = look.house('Bakery', { w: 0.08, d: 0.06, h: 0.055, roof: 'roof' });   // front (door, window) faces +z
bakery.position.set(0.12, 0, -0.06);
bakery.userData.window.userData.set(1);   // the lit window is the stop's lamp
const ch = bakery.userData.chimney;       // [x, y, z] of the chimney top, in the house's space: put smoke there
```

A barn: `look.house('Barn', { w: 0.1, h: 0.05, wall: 'roof', roof: 'dark', chimney: false })`. A church: a house and a
tall `look.paint(kit.roundedBox(0.025, 0.09, 0.025, 0.002), 'wall', 'Tower')` with a cone roof. A sill for loaves: a
`look.paint(kit.roundedBox(0.04, 0.005, 0.014, 0.0015), 'wood', 'Sill')` under the window.

## Windmills and waterwheels

```js
const mill = look.windmill('Windmill', { h: 0.13 });   // sails face +z; mill.userData.rotor turns about z
mill.position.set(0.02, 0, -0.07);
// in update: mill.userData.rotor.rotation.z -= delta * (working ? 2.5 : 0.4);
const water = look.waterwheel('Waterwheel', { r: 0.035 });       // stand it at the river's edge, facing +z
// water.userData.wheel.rotation.z -= delta * flow;
```

Sails speed up when their stop is working and slow when it is not: that is how the wind's work shows. A millstone is
`look.paint(new THREE.CylinderGeometry(0.02, 0.02, 0.008, 16), 'stone', 'Millstone')` turning about y.

## Rivers, roads and boats

```js
const river = look.river([[0.02, -0.15], [-0.03, -0.04], [-0.06, 0.05], [-0.05, 0.15]], 'River', { width: 0.04 });
const track = look.path([[-0.2, 0.07], [-0.1, 0.07], [0.0, 0.08], [0.1, 0.05]], 'Track', { width: 0.024 });
const v = new THREE.Vector3();             // made in build
track.userData.route.at(u, v);             // u 0..1 along the track: where the traveller is
const boat = look.boat('Barge', { len: 0.05, sail: false });   // bow toward +x
```

Run the river front to back so it crosses the track, and put a bridge (`look.paint(kit.roundedBox(0.026, 0.005, 0.05,
0.0015), 'wood', 'Bridge')`) where they meet. Put the stops' points in the track's point list, so the traveller passes
through each stop exactly. A boat on the river follows `river.userData.route` the same way.

## Carts, sacks, heaps and loaves

```js
const cart = look.cart('Cart', { len: 0.06 });          // shafts toward +x; turn the wheels as it rolls
cart.userData.load.add(look.sack('Sack 1', { h: 0.025 }));
const open = look.sack('Flour sack', { h: 0.035, open: true });
open.userData.fill(k);                                  // the flour rises inside, 0..1
const bran = look.pile('Bran', { r: 0.015, colour: 'crust' });
bran.userData.fill(k);                                  // a heap that grows, 0..1
const loaf = look.loaf('Loaf 1', { len: 0.03 });
```

Things that are counted (sacks, loaves, balls of yarn) are all built in build and shown one at a time (`visible`).
A cart rolling: `wheel.rotation.y += distance / radius` for each of `cart.userData.wheels`. A heap whose colour
changes (greasy wool to clean, grain to flour): give it its own paint, `heap.material = look.own('wool', 0.006)`, and
lerp `heap.material.uniforms.uLit.value` / `uShade.value` toward colours made in build.

## People and animals

```js
const baker = look.figure('Baker', { h: 0.06, colour: 'wall', hat: false });   // feet at y = 0, faces +z
const farmer = look.figure('Farmer', { h: 0.06, colour: 'cloth', hat: true });
const sheep = look.animal('Sheep', { kind: 'sheep', len: 0.05 });   // 'sheep' | 'cow' | 'horse', faces +x
```

People and animals are big simple silhouettes: a cone coat and a round head, a body, a head and four legs. They are
4 to 7 cm tall at desk size so the dabs can carry them; never add fingers, faces or harness. A horse pulling a cart:
the horse in front of the shafts, both in one group that walks the route. A flock is 3 to 5 sheep, not twenty.

## Sun, lamps and windows; the active stop

```js
const sun = look.sun(0.018);  sun.position.set(-0.19, 0.16, -0.14);   // low, back left: the light comes from the left
const lamp = look.lamp(0.014, 'Mill lamp', { on: 0.1 });              // a lantern; put it on a post at the stop
// in update: lamp.userData.set(i === at ? 1 : i === next ? 0.35 + 0.3 * Math.sin(time * 3) : 0.08);
const glow = look.shine(mill);   // in build; glow(k) in update brightens the mill's own paint (k 0..1)
```

A lantern post: `look.paint(kit.roundedBox(0.005, 0.06, 0.005, 0.0015), 'bark', 'Post')` with the lamp on top at
0.066. Lamps are the only things that glow; keep to one per stop.

## Smoke and steam

```js
const smoke = look.smoke('Chimney smoke', { n: 4, h: 0.06 });
smoke.position.set(house.position.x + ch[0], ch[1], house.position.z + ch[2]);
// in update: smoke.userData.rise(time, 0.5);   lean 0..1: how far the wind takes it
```

Steam from bread or a kettle is a smaller one (`h: 0.025`). Flour dust or chaff in the wind: 3 to 5 small
`look.blob(0.004, 'flour', ...)` moved along the wind in update.

## Captions and tags

```js
const caption = look.caption(['Wind turns the sails', 'The stones grind flour', 'Flour becomes bread'], 'Caption');
caption.position.set(0.03, 0, 0.125);  caption.scale.setScalar(0.7);   // low at the front edge, clear of the stops
caption.userData.show(step);           // one line per step, 2 to 6 words, the number in it when there is one
```

The panel's status line carries the same caption; sentences go in the panel's text. Name tags (`kit.card`) for 2 to
4 stops at most, each just above its lamp; the lamp and the subject usually say enough.
