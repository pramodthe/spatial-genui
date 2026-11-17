# Low-poly recipes

All sizes in metres. The island is about 0.46 x 0.32 m; build in the `subject` group, which sits on the island's top,
so things stand at y = 0 (`set.userData.groundAt(x, z)` is the small dip of the ground there, 0 to -2 mm). Keep
everything on the island: `set.userData.isLand(x, z)` says whether a spot is on land. Every recipe uses the builders
of `lowPolyLook` (`look`), which take colours by palette name:

seaDeep, sea, seaShallow, foam, river, sand, bed, grass, meadow, forest, pine, leaf, ochre, rock, rockDark, snow,
trunk, cloud, cloudSide, cloudBase, paper, ink, accent, sun.

Give colours a meaning and keep to it (accent = the stage markers and the thing that flows, ochre = grain and
bread, river = clean water).

## Contents
- The island, terrain and land forms
- Rivers, lakes and the sea
- Trees, forests and fields
- Buildings: houses, factories, markets, tanks and towers
- Routes: roads, pipes and arrows
- Vehicles and travellers
- Sky: clouds, rain and the sun
- People
- Goods and amounts: crates, piles, levels, numbers
- Flags and labels
- Your own shapes, and draw calls

## The island, terrain and land forms

```js
const set = look.set({ width: 0.46, depth: 0.32, sea: 'left' });   // sea: 'none' | 'left' | 'right' | 'back'
const peak = look.mountain(0.055, 0.09, 'Mountain');              // 7-sided cone: meadow foot, rock, snow cap
peak.position.set(0.14, 0, -0.09);
const hill = look.hill(0.05, 0.025, 'meadow', 'Hill');             // a flattened faceted dome
const stone = look.rock(0.012, 'Rock');
// Any landform from a height function over an outline [[x, z], ...] (edges at height 0 so it meets the island):
const ridge = look.terrain([[-0.2, -0.14], [0, -0.15], [0.05, -0.08], [-0.2, -0.06]], 'Ridge', {
  height: (x, z) => 0.04 * Math.max(0, 1 - Math.hypot(x + 0.1, z + 0.11) / 0.07),
  paint: (x, y, z, up) => (y > 0.03 ? 'snow' : y > 0.012 ? 'rock' : 'grass'),   // up: 1 flat, 0 a cliff
});
```

Put mountains and woods at the back and sides, where they frame the stages without hiding them. Ground with nothing
on it is a missed chance: scatter a few rocks, trees or a hill between the stages.

## Rivers, lakes and the sea

```js
// A river: points from the source down to the mouth, y falling a little; it heaves and has a path for travellers.
const river = look.river([[0.13, 0.05, -0.08], [0.08, 0.02, -0.04], [0.02, 0.004, 0.0], [-0.08, 0, 0.03]], 'River', { width: 0.026 });
// A lake or pond: a polygon of water, lying just above the ground.
const lake = look.water([[-0.05, 0.03], [0.02, 0.02], [0.04, 0.07], [-0.03, 0.09]], 'Lake', { colour: 'seaShallow' });
lake.position.y = 0.001;
// in update(time, delta): look.update(time);   // heaves every sea, lake and river
```

The sea from `look.set({ sea })` is already there, a few millimetres below the land, so its coast is where the ground
rises out of it. Water colours by depth: seaShallow near the shore, sea, seaDeep far out; foam for surf and spray.

## Trees, forests and fields

```js
const oak = look.tree('Oak', { h: 0.05, kind: 'round' });           // 'pine' | 'round' | 'autumn'
// Many trees in one draw call: [x, z, scale] spots, kinds mixed.
const woods = look.forest([[0.05, -0.12], [0.08, -0.13, 0.8], [0.12, -0.11]], 'Woods', { h: 0.04 });
const wheat = look.field(0.12, 0.1, 'Wheat field', { crop: 'ochre', rows: 6 });   // crops: ochre, leaf, meadow
```

Growth: `const grow = look.unfold(wheat, { from: [0.06, 0, 0] })`, then `grow.set(k)` with k rising from 0 to 1; or
scale a crop's height in steps.

## Buildings: houses, factories, markets, tanks and towers

```js
const home = look.house('House', { w: 0.03, d: 0.026, h: 0.022, roof: 'accent' });   // door on +z
home.rotation.y = -Math.PI / 2;                                    // turn the door toward a road
const plant = look.factory('Treatment plant', { w: 0.07, d: 0.045, h: 0.028 });
const [cx, cy, cz] = plant.userData.chimney;                       // where smoke comes out (in its own space)
const tower = look.tank(0.022, 0.04, 'Water tower', { legs: 0.05 });   // legs 0: a tank on the ground
tower.userData.setLevel(0.7);                                      // 0 empty .. 1 full: amounts as a level
// A market stall: a counter, a tilted awning, a pile of goods.
const stall = new THREE.Group(); stall.name = 'Market stall';
const counter = look.facet(new THREE.BoxGeometry(0.04, 0.012, 0.016), 'trunk', 'Counter'); counter.position.y = 0.006;
const awning = look.facet(new THREE.BoxGeometry(0.046, 0.002, 0.024), 'accent', 'Awning'); awning.position.set(0, 0.032, 0.002); awning.rotation.x = 0.25;
stall.add(counter, awning);
look.merge(stall);                                                 // static parts: one draw call
```

A small town is 4 to 8 houses in two colours of roof along a road, merged into one group if they never move.

## Routes: roads, pipes and arrows

```js
const road = look.road([[-0.1, 0, 0.02], [0, 0, 0.0], [0.1, 0, 0.04]], 'Road');             // dirt: 'bed'; tarmac: 'rockDark'
const main = look.pipe([[0.0, 0.004, -0.05], [0.0, 0.004, 0.02], [0.1, 0.004, 0.02]], 0.004, 'Water main');
const flow = look.arrow([[-0.12, 0, 0.1], [0, 0, 0.12], [0.1, 0, 0.1]], 'Flow');           // flat paper arrow, head at the end
```

Each has `.userData.path`, a `lookPath` along its centre line, for travellers. A pipe that goes underground can
dip below y = 0 between two short risers. An arrow made bigger or smaller (`scale.x`) shows a flow's size.

## Vehicles and travellers

```js
const truck = look.vehicle('truck', 'Truck');                      // faces +x; load sits at truck.userData.bed
const crate = look.crate(0.012, 'Load', { fill: 'ochre' }); crate.position.set(-0.007, truck.userData.bed, 0); truck.add(crate);
const boat = look.vehicle('boat', 'Boat');                         // a folded paper boat
// in update: drive along the road and back, no allocation
u += (delta * 0.07) / road.userData.path.length;
look.follow(truck, road.userData.path, u);                         // look.follow(obj, path, u, -1) when driving back
```

The object must be in the same group as the path's points (both in `subject`). Load and unload with `look.pop(cargo,
k)`.

## Sky: clouds, rain and the sun

```js
const cloud = look.cloud('Cloud', { r: 0.03 });                    // flat base; { storm: true } for a grey rain cloud
cloud.position.set(-0.08, 0.16, -0.06);
const sun = look.sun(0.018, 'Sun');                                // glows a little; good to grab and move
const rain = look.drops(24, 0.003, 'Rain');                        // 24 droplets, one draw call
const at = new THREE.Vector3();                                    // made once, in build
// in update: each drop falls from the cloud base to the ground and starts again
for (let i = 0; i < 24; i++) {
  const k = (time * 0.8 + i * 0.37) % 1;
  rain.userData.place(i, cloud.position.x + ((i * 7) % 11 - 5) * 0.006, cloud.position.y * (1 - k), cloud.position.z + ((i * 5) % 7 - 3) * 0.006, 1);
}
// droplets travelling a pipe or river: main.userData.path.at((time * 0.2 + i / 6) % 1, at); rain.userData.place(i, at.x, at.y, at.z, 1);
```

A storm cloud can grow as it fills: `look.pop(cloud, k)` or `cloud.scale.setScalar(0.6 + 0.4 * k)`.

## People

```js
const farmer = look.person('accent', 'Farmer', { h: 0.03 });     // body in a palette colour, sand head
```

People are small (2.5 to 4 cm) and stand at the stage they belong to. Two or three are plenty.

## Goods and amounts: crates, piles, levels, numbers

```js
const box = look.crate(0.032, 'Crate (20 kg)', { fill: 'ochre' });   // box.userData.fill is the contents (hide it when emptied)
const sacks = look.pile(8, 'Flour sacks', { shape: 'sack', colour: 'paper', size: 0.02 });   // 'crate' | 'sack' | 'gem' | 'log'
sacks.userData.show(3);                                            // the first 3 of 8: a pile that grows
const count = look.number('120', 'ink', 'Loaves', { h: 0.024 });   // cut-paper digits, standing, left edge at x = 0
count.position.set(0.06 - count.userData.width, 0, 0.1);
```

A grabbable piece is at least 3 cm across and 4 cm clear of the next one. A changing number: build each value once
and show the right one (`n.visible`), never rebuild in update. A tank level, a pile and a number together say the
same amount three ways; one or two are usually enough.

## Flags and labels

```js
const flag = look.flag(2, 'Flag 2: Mill');                         // 9 cm pin, 5 x 3 cm paper with the number
flag.position.set(-0.11, 0, -0.04);
traits(flag, { onPress() { go(2); } });
const tag = kit.card('Mill'); tag.position.set(-0.11 + 0.026, 0.125, -0.04);   // just above the flag
// in update: flag.userData.active(k), k eased toward 1 for the current stage and 0 for the rest
```

Flags stand in the front half of the island (z > -0.1) so a hand reaches them, beside their stage, not in front of
it.

## Your own shapes, and draw calls

```js
const damGeo = new THREE.BoxGeometry(0.08, 0.03, 0.012);
damGeo.translate(0, 0.015, 0);                                     // stand it on y = 0 first
const dam = look.facet(damGeo, 'rock', 'Dam', { ground: true });   // ground: its base stays flat on the ground
const silo = look.facet(new THREE.CylinderGeometry(0.01, 0.01, 0.05, 7), 'paper', 'Silo', { jitter: 0.0008 });
```

Any three.js geometry goes through `look.facet(geometry, colour, name)`: 5 to 8 sides, detail 0 or 1, a little
jitter. Each mesh is a draw call; the builders already fuse their parts into one mesh. Group static scenery and call
`look.merge(group)` to make it one mesh (it skips water, which has to stay separate to heave). The budget is 150 draw
calls and 150,000 triangles; a whole island lesson is usually 40 to 70 draw calls.
