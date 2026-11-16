# Clay recipes

All sizes in metres; the board is about 0.4 x 0.28 m and things stand on `set.userData.top`. Every recipe uses the
builders of `softClayLook` (`look`), which take a clay colour from the box: cream, coral, yellow, navy, green, white,
pink, brown, black. Make each thing once and reuse its material through the builder.

## Contents
- People and animals
- Coins, stacks and money
- Food, bowls and shares
- Plants and growth
- Simple machines and forces
- Numbers, words and labels
- Water, ground and weather

## People and animals

```js
const kid = look.character('coral', 'Big child', { h: 0.1 });   // feet at y = 0, faces +z
kid.position.set(-0.1, 0, 0.02);
// An animal: body capsule lying down, head ball, ears as small balls, legs as short capsules.
const pig = new THREE.Group(); pig.name = 'Piggy bank';
const body = look.capsule(0.03, 0.03, 'pink', 'Pig body'); body.rotation.z = Math.PI / 2; body.position.y = 0.035;
const snout = look.coin(0.012, 0.01, 'pink', 'Pig snout'); snout.rotation.x = Math.PI / 2; snout.position.set(0.045, 0.04, 0);
pig.add(body, snout);
for (const [x, z] of [[-0.02, -0.015], [-0.02, 0.015], [0.02, -0.015], [0.02, 0.015]]) {
  const leg = look.capsule(0.007, 0.01, 'pink', 'Pig leg'); leg.position.set(x, 0.01, z); pig.add(leg);
}
const slot = look.slab(0.02, 0.003, 0.004, 'black', 'Coin slot'); slot.position.set(0, 0.067, 0); pig.add(slot);
```

## Coins, stacks and money

A coin is about 0.02-0.025 m across and 0.008 m thick at desk scale. A stack is a Group of coins, each a little off
true, so it reads as hand-placed; its height is `stack.userData.top`.

```js
const week = look.stack(2, 'yellow', 'Week 1', { r: 0.012, h: 0.006 });
// Growing a stack in update: keep all coins built, show the first n (no allocation in update).
week.children.forEach((coin, i) => { coin.visible = i < n; });
// A dropped coin arrives: start it 3 cm above its place, then lookBounce over 0.3 s.
```

Many stacks in a row are a bar chart without axes: put them on a clay strip (`look.slab(len, 0.004, 0.02, 'white')`)
and label the first and last with `look.number`.

## Food, bowls and shares

```js
const bowl = look.bowl(0.035, 'white', 'Bowl 1');          // base at y = 0, open top
const counter = look.ball(0.008, 'coral', 'Counter 1');    // pieces to share
// A whole cut into n equal parts, lying flat, centred on the cake's middle:
for (let i = 0; i < n; i++) {
  const w = look.wedge(0.08, 0.03, (i * 2 * Math.PI) / n, (2 * Math.PI) / n - 0.02, 'yellow', `Part ${i + 1} of ${n}`);
  w.position.y = 0.015;                                     // a cylinder wedge is centred on its height
  cake.add(w);
}
```

Each share the learner moves is its own object (grabbable); a share that should go back uses `lookSeat`.

## Plants and growth

Stem: `look.capsule(0.005, h, 'green')`. Leaf: `look.ball(0.015, 'green')` scaled `(1, 0.3, 0.6)`. Pot:
`look.bowl(0.03, 'brown')` with a soil coin inside. Growth steps scale the stem and add leaves one at a time.

## Simple machines and forces

```js
const fulcrum = look.fulcrum(0.07, 'navy', 'Fulcrum');      // a triangle wedge, base at y = 0
const plank = look.plank(0.42, 'cream', 'Plank');           // put it in a pivot Group at the fulcrum's tip
const weightArrow = look.arrow(0.03 * weight, 'coral', 'Weight');   // along +y from its base
weightArrow.rotation.z = Math.PI;                          // pointing down
// Grow an arrow in update without rebuilding it: arrow.scale.y = newLength / builtLength.
```

A ramp is a `look.slab` rotated about z; a wheel is `look.coin` rotated about x; a rope is a chain of small
`look.ball`s along a `lookPath`.

## Numbers, words and labels

```js
const total = look.number('24', 'white', 'Total', { h: 0.05 });  // fat clay digits, XY plane, left edge at x = 0
total.position.set(-total.userData.width / 2, 0.02, 0.1);       // centred, low at the front
```

`look.number` knows 0-9, + - = / x and the dot. Changing a number means building each value once up front and
showing the right one (or the right digits) in update. Names of parts are `kit.card` tags beside the part; sentences go
on the panel.

## Water, ground and weather

Water: a blue clay coin (`'navy'` streaked, opacity is not clay - keep it solid) lying flat. Ground patches: green or
brown `look.slab` 4 mm thick. Sun: a yellow ball with short capsule rays. Rain: small white-blue balls falling on twos.
