# Voxel recipes

All sizes in cubes unless a line says metres. Cells are `[x, y, z, colour, ...extra]` on a whole-number grid (x right,
y up, z toward the learner); a cell at y = 0 sits on whatever its mesh stands on. Colours are names from `look.PAL`
(grass, soilA, sand, wood, leaf, petal, water, stone, brick, red, blue, ink ...) or a '#hex'; a colour can be a
function of the cell for bands and speckle. Every recipe uses the builders of `voxelLook` (`look`); `S = look.size`.

## Contents
- The grid and the size
- Ground, water and terrain
- Plants
- Animals and people
- Buildings and construction
- Machines
- Weather
- Numbers and words
- Arrows and flows
- Building up in stages

## The grid and the size

```js
const look = voxelLook(THREE, kit);
const S = look.size;                               // 0.012 m: a model 25 cubes across is 0.3 m
const tree = look.model(cells, 'Tree');            // one mesh, one draw call, 44 triangles a cube
tree.position.set(4 * S, 3 * S, 0);                // move models by whole cubes so their grids line up
```

Choose the size so the model is 10 to 40 cubes across (0.01 to 0.014 m a cube) and the whole lesson under about 3,000
visible cubes (cubes boxed in on all sides are dropped for you; pass `{ sealed: true }` for a model that stands on
the plinth, so its buried bottom layer is dropped too). Merge cell lists with `look.cells`: a later `put` replaces a
cell, `put(x, y, z, null)` carves it out.

## Ground, water and terrain

```js
const ground = look.model(look.ground(9, 6, 3), 'Ground', { sealed: true });   // 19 x 13, grass on top at y = 2
// Cut the front open so roots and a seed show in the soil:
const soil = look.ground(9, 6, 4).filter(([x, y, z]) => !(Math.abs(x) <= 3 && z >= 2 && y <= 2));
// A pond sunk into the grass; a river is a carved channel filled the same way.
const pond = look.disc(4, 2, 2, 3, (a, b, d) => (d < 1.5 ? 'waterDeep' : 'water'));
// Hills: a height for each column from noise.
const hills = look.cells((put) => {
  for (let x = -10; x <= 10; x++) for (let z = -6; z <= 6; z++) {
    const h = 2 + Math.round(2 + 2 * lookNoise(x * 0.2, 0, z * 0.2));
    for (let y = 0; y < h; y++) put(x, y, z, y === h - 1 ? 'grass' : y > h - 3 ? 'soilA' : 'stone');
  }
});
```

## Plants

A stem is a column, leaves are flat eggs (`look.ball` with radii `[rx, ry, rz]`), a flower head is a disc standing
toward the learner, roots are lines running down into the cut soil. Give each cell its growth stage as an extra field.

```js
const plant = look.cells((put) => {
  for (const c of look.line([0, 3, 2], [-2, 0, 2], 'root')) put(...c, 1);                 // stage 1: roots
  for (let y = 4; y < 10; y++) put(0, y, 2, 'stem', 2);                                    // stage 2: the shoot
  for (const side of [-1, 1]) for (const c of look.ball(side * 3, 9, 2, [2.4, 0.7, 1.4], 'leaf')) put(...c, 3);
  for (let y = 10; y < 18; y++) put(0, y, 2, 'stem', 4);
  for (const c of look.disc(0, 19, 3, 4.2, (a, b, d) => (d < 2 ? 'soilC' : d < 3 ? 'petalDeep' : 'petal'), 'z')) put(...c, 5);
});
// A tree: a trunk box and a crown ball, lighter on top.
const trunk = look.box(-1, 0, -1, 1, 7, 1, (x, y) => (y % 3 ? 'wood' : 'woodDark'));
const crown = look.ball(0, 12, 0, 5.2, (x, y) => (y > 1 ? 'leafLight' : 'leaf'));
```

## Animals and people

Small things are easiest as pictures: rows of text, top row first, one string per row of cubes; an array of
pictures is slices, back to front.

```js
const FISH = ['..OO...', '.OOOO.O', 'OEOOOOO', '.OOOO.O', '..OO...'];
const fish = look.model(look.picture([FISH, FISH], { O: 'orange', E: 'black' }), 'Fish');
const sheep = look.model(look.cells((put) => {
  for (const c of look.box(-3, 2, -2, 3, 5, 2, 'white')) put(...c);
  for (const c of look.box(4, 4, -1, 5, 6, 1, 'black')) put(...c);                         // head
  for (const [x, z] of [[-2, -1], [-2, 1], [2, -1], [2, 1]]) for (const c of look.column(x, z, 0, 2, 'black')) put(...c);
}), 'Sheep');
const person = look.model(look.cells((put) => {
  for (const x of [-1, 1]) for (const c of look.box(x, 0, 0, x, 2, 1, 'blue')) put(...c);  // legs
  for (const c of look.box(-1, 3, 0, 1, 5, 1, 'red')) put(...c);                          // body
  for (const x of [-2, 2]) for (const c of look.box(x, 3, 0, x, 5, 0, 'skin')) put(...c); // arms
  for (const c of look.box(-1, 6, 0, 1, 8, 1, (x, y) => (y === 8 ? 'hair' : 'skin'))) put(...c);
  put(-1, 7, 1, 'black'); put(1, 7, 1, 'black');                                          // eyes
}), 'Builder');
```

## Buildings and construction

Walls are a hollow box; doors and windows are carved or recoloured; a roof steps in one cube per layer. Each course
(row of bricks) can be a stage, so the wall rises as it is built.

```js
const house = look.cells((put) => {
  for (let y = 0; y < 6; y++) for (let x = -5; x <= 5; x++) for (let z = -4; z <= 4; z++) {
    if (Math.abs(x) === 5 || Math.abs(z) === 4) put(x, y, z, (x + y * 2) % 4 ? 'brick' : 'stone', y);   // stage = course
  }
  put(0, 0, 4, null); put(0, 1, 4, null);                                                  // the door
  for (const x of [-3, 3]) put(x, 3, 4, 'glass', 3);                                       // windows
  for (let k = 0; k < 6; k++) for (let x = -6 + k; x <= 6 - k; x++) for (let z = -5; z <= 5; z++) put(x, 6 + k, z, 'roof', 6 + k);
});
```

Parts the learner places (a layer, a beam, a wall panel) are each their own `look.model`, seated where they wait, as
in `assets/example-pyramid.js`.

## Machines

A wheel or a gear is a disc standing up; spin it in jumps, a few cubes' turn at a time, not smoothly. A cube's centre
is half a cube above its cell, so put a spinning disc in a pivot group and lower it half a cube.

```js
const pivot = new THREE.Group();
const wheel = look.model(look.disc(0, 0, 0, 3.2, (a, b, d) => (d > 2.4 ? 'black' : d < 1 ? 'metal' : 'stone'), 'z'), 'Wheel');
wheel.position.y = -S / 2;
pivot.add(wheel);
// in update: pivot.rotation.z = -Math.floor(time * 6) * (Math.PI / 8);   // turns in eighth-turn jumps
const gear = look.cells((put) => {
  for (const c of look.disc(0, 0, 0, 3, 'metal', 'z')) put(...c);
  for (let k = 0; k < 8; k++) put(Math.round(4 * Math.cos((k * Math.PI) / 4)), Math.round(4 * Math.sin((k * Math.PI) / 4)), 0, 'metal');
});
```

A conveyor, a pipe or a wire carrying something is a line of cubes with a `look.flow` hopping along it.

## Weather

```js
const cloud = look.model(look.cells((put) => {
  for (const [cx, cy, rx, ry] of [[-4, 0, 3.4, 2.2], [0, 1, 4.4, 3.2], [4, 0, 3.2, 2.2]]) {
    for (const c of look.ball(cx, cy, 0, [rx, ry, 2.6], (x, y) => (cy + y < 0 ? 'cloudBase' : 'cloud'))) put(...c);
  }
}), 'Cloud');
const sun = look.model(look.cells((put) => {
  for (const c of look.disc(0, 0, 0, 3.7, (a, b, d) => (d < 2.3 ? 'sunCore' : 'sun'), 'z')) put(...c);
  for (let k = 0; k < 8; k++) {
    const dx = Math.round(Math.cos((k * Math.PI) / 4)), dy = Math.round(Math.sin((k * Math.PI) / 4));
    for (const c of look.line([dx * 5, dy * 5, 0], [dx * 6, dy * 6, 0], 'ray')) put(...c);
  }
}), 'Sun');
look.glow(sun, 0.6);
// Rain: a few flows from the cloud's underside to the ground (metres, in their parent's space).
const rain = look.flow([[0.02, 0.2, 0], [0.02, 0.04, 0]], 'water', 'Rain', { count: 4, speed: 0.12 });
```

A cloud or the sun moves in whole-cube hops too (`Math.round(x / S) * S`).

## Numbers and words

```js
const word = look.word('SEED', set);                       // the step's word on the plinth's front, dark letters
root.add(word);                                            // A-Z, 0-9, space, - . %; up to about 10 letters
const days = look.counter(2, 'ink', 'Days', { size: 0.006 });   // days.userData.set(n) shows n, no allocation
days.position.set(-0.12, 0, 0.08);                         // standing on the plinth, low and in front
const unit = look.label('CM', 'ink', 'Unit');              // a short fixed word or number, centred on x = 0
// A ruler: one cube per unit in two alternating colours, beside the thing it measures.
const ruler = look.model(look.column(-6, 2, 3, 25, (x, y) => ((y - 3) % 10 < 5 ? 'ink' : 'white')), 'Ruler');
```

Change a word by giving every step its own word, made once, and showing one (`look.stages` on each, as the example
does). Names of parts are `kit.card` tags beside the part; sentences go on the panel.

## Arrows and flows

```js
const push = look.arrow(7, 'red', 'Push');                 // 7 cubes along +x, in the XY plane
push.rotation.z = Math.PI / 2;                             // now pointing up
const water = look.flow([[0, 0.04, 0.024], [0, 0.22, 0.024]], 'water', 'Water up the stem', { count: 6, speed: 0.03 });
// in update: water.userData.update(time);
```

A length that changes is a row or column of cubes built at its longest and staged one cube per stage:
`const bar = look.stages(column, (c) => c.y)`, then `bar.go(n - 1)` shows n cubes with the newest dropping in.

## Building up in stages

```js
const sunflower = look.model(plant, 'Sunflower');          // cells carry their stage: [x, y, z, colour, stage]
const grow = look.stages(sunflower, (c) => c.src[4] ?? 0, { order: 'layer' });
grow.go(5, true);                                          // step 0: the grown plant, at once
// a step or a hand action: grow.go(grow.stage + 1) drops the next stage in, layer by layer
// in update: grow.update(delta); days.userData.set(grow.arrived) counts the cubes that have landed
```

`order` is `'layer'` (bottom up), `'column'` (left to right), `'top'` (top down), `'wave'` (out from the front
middle) or `(cell) => seconds`. A stage below the current one stands at home, the current one drops in, later ones are
hidden, and a mesh with nothing to show is hidden so no hand catches it.
