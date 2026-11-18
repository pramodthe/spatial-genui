# Ink and toon recipes

All sizes in metres; the sheet is about 0.42 x 0.3 m and things stand on it at y = 0 in `subject` (which sits at
`set.userData.top`). Every recipe uses the builders of `inkToonLook` (`look`); colours come from `look.PAL`: paper,
white, cream, teal, persimmon, mustard, navy, charcoal, leaf, bean, water, ink. Builders take an options object:
`{ halftone, outline: false, line, own }`. Each builder makes one mesh plus its ink line (two draw calls); pass
`outline: false` for small or many parts (spokes, rivets, seeds) and `kit.merge(group)` them into one draw call.

## Contents
- Kitchen tools
- Cups, kettles and pots
- Tools
- A bicycle wheel
- Paper and folds
- Plants
- Hands and characters
- Liquids, glass and steam
- Effects: speed lines, impact ticks, motion arcs, arrows
- Words and numbers
- Shadows

## Kitchen tools

```js
const board = look.box(0.16, 0.012, 0.1, 'bean', 'Cutting board');
board.position.set(-0.08, 0.006, 0.02);                       // a box is centred: lift it by half its height
const knife = new THREE.Group(); knife.name = 'Knife';         // lying flat on the board
const blade = look.cutout([[0, 0], [0.09, 0], [0.1, 0.012], [0.02, 0.022], [0, 0.022]], 0.002, 'white', 'Blade', { flat: true, line: 0.0012 });
const knifeGrip = look.box(0.05, 0.012, 0.018, 'charcoal', 'Knife handle');
knifeGrip.position.set(-0.025, 0.006, -0.011);
knife.add(blade, knifeGrip);
knife.position.set(-0.1, 0.012, 0.03);
const spoon = new THREE.Group(); spoon.name = 'Spoon';
const spoonBowl = look.ball(0.014, 'navy', 'Spoon bowl');
spoonBowl.scale.set(1, 0.35, 0.7);
const spoonStem = look.box(0.07, 0.004, 0.008, 'navy', 'Spoon handle', { line: 0.0012 });
spoonStem.position.set(0.045, 0.004, 0);
spoon.add(spoonBowl, spoonStem);
spoon.position.set(0.08, 0.005, 0.08);
```

With `{ flat: true }` a cutout lies on the paper and an outline point `[x, y]` lands at `(x, 0, -y)`.

## Cups, kettles and pots

Turned shapes: the profile `[[radius, y], ...]` goes from the axis at the bottom, out, up the outside, over the lip
and back down the inside, so the shape closes. Corners are softened for you. Handles and spouts are tubes.

```js
const mug = look.turned([[0, 0], [0.034, 0], [0.037, 0.075], [0.032, 0.075], [0.029, 0.006], [0, 0.006]], 'persimmon', 'Mug', { halftone: true });
mug.add(look.tube([[0.03, 0.062, 0], [0.056, 0.058, 0], [0.06, 0.032, 0], [0.033, 0.018, 0]], 0.006, 'persimmon', 'Mug handle'));
look.crease(mug, 0.0372, 0.068);                               // an inner ink line under the rim, broken on the lit side
mug.position.set(-0.08, 0, 0);
const kettle = new THREE.Group(); kettle.name = 'Kettle';     // spout toward -x
kettle.add(look.turned([[0, 0], [0.05, 0], [0.056, 0.01], [0.059, 0.012], [0.044, 0.058], [0.032, 0.066], [0, 0.066]], 'teal', 'Kettle body', { halftone: true }));
kettle.add(look.turned([[0, 0.064], [0.012, 0.066], [0.012, 0.074], [0.007, 0.08], [0, 0.081]], 'navy', 'Kettle knob', { line: 0.0015 }));
kettle.add(look.tube([[-0.05, 0.015, 0], [-0.07, 0.02, 0], [-0.085, 0.045, 0], [-0.1, 0.062, 0]], 0.0045, 'teal', 'Spout'));
kettle.add(look.tube([[0.035, 0.06, 0], [0.07, 0.07, 0], [0.088, 0.045, 0], [0.07, 0.02, 0], [0.052, 0.015, 0]], 0.005, 'navy', 'Kettle handle'));
kettle.position.set(0.08, 0, -0.02);
// Tip it to pour about the spout's base, on twos: kettle.rotation.z = -0.5 * look.pop(t - pourT)
```

A pan: a short wide turned profile in charcoal plus a `look.box` handle. A dripper or funnel: a cone profile that is
open at the bottom. Keep 2 or 3 creases on the hero, none on the props.

## Tools

```js
const hammer = new THREE.Group(); hammer.name = 'Hammer';     // lying on the paper
const hammerHead = look.box(0.022, 0.022, 0.06, 'navy', 'Hammer head');
hammerHead.position.set(0.06, 0.011, 0);
const hammerHandle = look.rod(0.0065, 0.12, 'bean', 'Hammer handle');
hammerHandle.rotation.z = Math.PI / 2;
hammerHandle.position.set(0, 0.011, 0);
hammer.add(hammerHead, hammerHandle);
hammer.position.set(0, 0, 0.09);
const bolt = look.rod(0.009, 0.006, 'navy', 'Bolt head', { sides: 6 });   // a hex: a rod with 6 sides
bolt.position.set(0.12, 0.003, 0.09);
const driver = new THREE.Group(); driver.name = 'Screwdriver';
const driverGrip = look.turned([[0, 0], [0.009, 0], [0.011, 0.05], [0.008, 0.06], [0, 0.06]], 'persimmon', 'Grip', { halftone: true });
const driverShaft = look.rod(0.0025, 0.06, 'navy', 'Shaft', { line: 0.0012 });
driverShaft.position.y = 0.09;
driver.add(driverGrip, driverShaft);
driver.position.set(-0.15, 0, -0.06);
```

A wrench or spanner is a flat `look.cutout` outline (handle and open jaw) lying flat, 4 mm thick. Turning a tool is
a `look.motionArc` round its axis and a force arrow at the end of the handle; a longer handle, a shorter arrow.

## A bicycle wheel

```js
const bikeWheel = new THREE.Group(); bikeWheel.name = 'Bike wheel';  // origin where the tyre touches: squash keeps it down
const tyreMesh = look.ink(new THREE.TorusGeometry(0.098, 0.012, 12, 56), 'charcoal', 'Tyre', { halftone: true });
const rimMesh = look.ink(new THREE.TorusGeometry(0.085, 0.0035, 8, 56), 'navy', 'Rim', { line: 0.0015 });
const hubMesh = look.rod(0.009, 0.03, 'navy', 'Hub', { line: 0.0015 });
hubMesh.rotation.x = Math.PI / 2;
const spokeSet = new THREE.Group(); spokeSet.name = 'Spokes';        // ink lines, one draw call
for (let i = 0; i < 16; i++) {
  const a = (i / 16) * Math.PI * 2;
  const spoke = look.rod(0.0011, 0.075, 'ink', 'Spoke', { outline: false, sides: 6 });
  spoke.position.set(Math.cos(a) * 0.0455, Math.sin(a) * 0.0455, (i % 2 ? 1 : -1) * 0.004);
  spoke.rotation.z = a - Math.PI / 2;
  spokeSet.add(spoke);
}
kit.merge(spokeSet);
for (const m of [tyreMesh, rimMesh, hubMesh, spokeSet]) { m.position.y += 0.11; bikeWheel.add(m); }
bikeWheel.position.set(0, 0, -0.04);
// Pressed: look.squash(bikeWheel, 1 - amount) for two drawings, then 1 + amount * 0.5 * look.wobble(t)
```

A whole bicycle is two of these, a frame of `look.tube`s (navy) and a chain as a closed `look.tube` in ink. For a
pump, see `assets/example-bike-pump.js`.

## Paper and folds

Paper is `white`, 0.8 mm thick, `{ flat: true }`. An A4 sheet is 0.21 x 0.297 m: at desk scale use 0.7 of it. A fold
is a flap on a hinge group whose axis is the fold line; the rest of the sheet stays.

```js
const PW = 0.147, PD = 0.208, PT = 0.0008;                    // A4 at 0.7 scale
const paper = new THREE.Group(); paper.name = 'Paper';
const half = look.cutout([[0, -PD / 2], [PW / 2, -PD / 2], [PW / 2, PD / 2], [0, PD / 2]], PT, 'white', 'Right half', { flat: true, line: 0.001 });
const foldHinge = new THREE.Group(); foldHinge.name = 'Fold';        // the fold line is the z axis through x = 0
foldHinge.position.y = 2 * PT;                                         // so the flap lands on top, not inside
const flap = look.cutout([[-PW / 2, -PD / 2], [0, -PD / 2], [0, PD / 2], [-PW / 2, PD / 2]], PT, 'white', 'Left half', { flat: true, line: 0.001 });
foldHinge.add(flap);
const crease = look.mark([[[[0, -PD / 2], [0, PD / 2]], 0.0008, 'none']], 'ink', { name: 'Crease' });
crease.rotation.x = -Math.PI / 2;                              // a mark laid flat: its [x, y] lands at (x, 0, -y)
crease.position.y = PT + 0.0004;
const foldArrow = look.motionArc(0.04, Math.PI - 0.3, 0.3, { width: 0.004, name: 'Fold arrow' });
foldArrow.position.set(0, 0.006, 0);
paper.add(half, foldHinge, crease, foldArrow);
paper.position.set(0, 0, 0.02);
// update, on twos: foldHinge.rotation.z = -(Math.PI - 0.03) * lookBack(lookSeg(t - foldT, 0, 4 / 15), 1.4)
```

- **A diagonal fold** (a plane's nose): put the hinge on the fold line, give the flap's outline relative to the hinge,
  and turn it with `foldHinge.quaternion.setFromAxisAngle(AXIS, angle)`, AXIS a unit `Vector3` along the line, made
  once in build.
- **Several folds in a row**: build each folded state you need as its own outline (what you see from above), once,
  and at the end of a fold hide the flap and the old state and show the next. Do not nest hinges five deep.
- **A paper plane in flight**: the finished plane is a few cutouts (two wings, a keel) in one group; it flies along
  a `lookPath` arc on twos, banking a little, with `look.speedLines` behind it and a dotted `look.mark` trail.
- **Hands**: the flap is 0.8 mm thick and cannot be pinched. Press it: give `traits` a group holding the flap and the
  standing fold arrow over it, so the target is tall enough (shared/hands.md).

## Plants

```js
const pot = look.turned([[0, 0], [0.03, 0], [0.038, 0.05], [0.042, 0.052], [0.04, 0.056], [0.035, 0.054], [0.028, 0.006], [0, 0.006]], 'persimmon', 'Pot', { halftone: true });
const soil = look.ink(new THREE.CircleGeometry(0.034, 28).rotateX(-Math.PI / 2), 'bean', 'Soil', { outline: false });
soil.position.y = 0.048;
const stem = look.tube([[0, 0.048, 0], [0.004, 0.08, 0], [-0.003, 0.11, 0], [0, 0.135, 0]], 0.0025, 'leaf', 'Stem', { line: 0.0012 });
pot.add(soil, stem);
for (const [y, a] of [[0.075, 0.6], [0.098, -0.7], [0.12, 0.5]]) {
  const leaf = look.cutout([[0, 0], [0.012, 0.008], [0.028, 0], [0.012, -0.008]], 0.002, 'leaf', 'Leaf', { line: 0.0012 });
  leaf.position.set(0, y, 0);
  leaf.rotation.set(0.3, a > 0 ? 0 : Math.PI, 0.35);
  pot.add(leaf);
}
pot.position.set(0.14, 0, 0.06);
```

Growth: scale the stem up and show leaves one at a time, each landing with `look.pop`. Droop: turn leaves down.

## Hands and characters

A cartoon hand is a white glove: a flattened ball for the palm and four capsule fingers. Use it to show an action
the learner should copy (it presses, pours, folds), never as something they must grab.

```js
const glove = new THREE.Group(); glove.name = 'Cartoon hand';
const palm = look.ball(0.02, 'white', 'Palm');
palm.scale.set(1, 0.8, 0.45);
glove.add(palm);
for (let i = 0; i < 4; i++) {
  const finger = look.ink(new THREE.CapsuleGeometry(0.0055, 0.018, 4, 10), 'white', 'Finger', { line: 0.0015 });
  finger.position.set(-0.012 + i * 0.008, 0.026 - Math.abs(i - 1.5) * 0.003, 0);
  glove.add(finger);
}
const thumb = look.ink(new THREE.CapsuleGeometry(0.006, 0.014, 4, 10), 'white', 'Thumb', { line: 0.0015 });
thumb.position.set(-0.022, 0.004, 0.004);
thumb.rotation.z = 0.9;
glove.add(thumb);
glove.position.set(-0.05, 0.16, 0.05);
glove.rotation.z = Math.PI;                                    // fingers down, pressing
```

A character: a bean body (`look.turned` in a spot colour), a cream ball head, two ink balls for eyes, tube arms. One
or two characters at most; the object is the hero.

## Liquids, glass and steam

Never transparent: water is the `water` colours with an ink line and a glint; coffee, tea and soil are flat discs.

```js
const coffee = look.ink(new THREE.CircleGeometry(0.03, 32).rotateX(-Math.PI / 2), 'bean', 'Coffee', { outline: false });
coffee.position.y = 0.06;                                      // the level inside the mug: move it, never rebuild it
mug.add(coffee);
const jug = look.turned([[0, 0], [0.032, 0], [0.034, 0.08], [0.03, 0.08], [0.028, 0.004], [0, 0.004]], 'water', 'Glass jug');
const glint = look.mark([[[[0, 0], [0.002, 0.03]], 0.004, 'both']], 'white', { name: 'Glint', edge: 0 });
glint.position.set(-0.018, 0.03, 0.028);
jug.add(glint);
jug.position.set(-0.17, 0, 0.06);
const stream = look.tube([[-0.1, 0.062, 0], [-0.106, 0.05, 0], [-0.11, 0.02, 0]], 0.003, 'water', 'Pour', { line: 0.0012 });
kettle.add(stream);                                            // show it only while pouring
const steam = look.steam(0.05, { n: 2 });
steam.position.set(0, 0.08, 0.01);
mug.add(steam);
// update: look.flip(steam, Math.floor(drawing / 3)) - steam boils between three drawings, it never slides
```

Drops: small `water` balls falling on twos, each with a two-drawing splash (`look.impact(5, 0.006, 0.008, { from: 0,
to: Math.PI })`) where it lands. A rising level: move the disc up on twos with an overshoot.

## Effects: speed lines, impact ticks, motion arcs, arrows

All effects are flat ink marks that face the learner (+z) and never catch a pinch. Build them once, hide them, and
show each for two or three drawings at the moment of the action.

```js
const lines = look.speedLines(0.04, { n: 3, gap: 0.012 });    // trail along +x from the part: point +x back along its path
lines.rotation.z = Math.PI / 2;                                // part moving down: lines stand above it
lines.position.set(0.08, 0.1, 0.03);
const hit = look.impact(7, 0.025, 0.014, { ry: 0.012, from: 0, to: Math.PI, name: 'Thump' });   // upper half: a hit on the table
hit.position.set(0.08, 0.002, 0.03);
const turn = look.motionArc(0.03, 0.3, 2.6, { name: 'Turn' }); // a curved arrow; lay flat (rotation.x = -PI/2) for a stir
turn.position.set(0.12, 0.03, 0.09);
const force = look.arrow(0.05, 'persimmon', 'Force');          // solid, inked, along +y from its base
force.rotation.z = Math.PI;                                    // pointing down
force.position.set(0, 0.2, 0.05);
look.stretch(force, 0.03);                                     // resize in update: the head keeps its size
const shake = look.mark([[[[0, 0], [0.012, 0.004]], 0.0015], [[[0, -0.008], [0.013, -0.008]], 0.0015]], 'ink', { name: 'Shake' });
shake.position.set(-0.1, 0.1, 0.05);
subject.add(lines, hit, turn, force, shake);
```

A custom mark is a list of strokes `[[[x, y], ...], width, taper]` (taper 'both', 'head' thick at the first point,
'tail' thick at the last, 'none'); with a spot colour it gets an ink edge (splashes in `water`, a crema swirl in
`mustard`). For a stretched in-between on a fast move, `look.squash(part, 1.3)` along its path for one drawing.

## Words and numbers

```js
const word = look.stepWord('POUR!', { h: 0.022, n: 2 });      // a lettered word on a standing paper card, step badge 2
word.position.set(-0.12, 0, 0.1);                              // low, front, beside the hero
const grams = ['0', '50', '100', '150', '200', '250'].map((v) => {
  const m = look.letters(`${v} G`, { h: 0.014, face: 'white', block: 'teal' });
  m.position.set(0.06, 0.012, 0.1);
  m.visible = v === '0';
  subject.add(m);
  return m;
});
subject.add(word);
const tag = kit.card('Spout');                                 // a name tag right beside its part, 2 or 3 per lesson
tag.position.set(0.02, 0.07, 0.01);
subject.add(tag);
```

Build one word per step up front, show only the step's one and land it with `look.pop`. Lettering knows A-Z, 0-9 and
`! ? - + = . , : / %`; lower case is printed as capitals. A number in the scene is built once per value and the right
one shown (`grams[i].visible`), never rebuilt in update. Sentences go on the panel.

## Shadows

```js
const mugShadow = look.shadow(0.045, 0.03, 'Mug shadow');     // hatched, lying on the paper
mugShadow.position.set(-0.08 + 0.025, mugShadow.position.y, -0.015);   // to the right of and behind the thing
subject.add(mugShadow, board, knife, spoon, mug, kettle, hammer, bolt, driver, bikeWheel, paper, pot, glove, jug);
```

One shadow under the hero and each big prop (one draw call each), none under small things. A shadow that should move
with a prop is a child of the prop's group.
