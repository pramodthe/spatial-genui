# Exploded-view recipes

All sizes in metres on the desk, written as real millimetres through one helper:

```js
const ENLARGE = 2;                               // shown 2 x real size: the row apart spans 0.4-0.5 m
const mm = (v) => v * 0.001 * ENLARGE;           // a real millimetre, on the desk
```

Every part is a named Group, built along +x (its axis) round its own origin, in a finish from the look:
chrome brass steel satin gunmetal copper gold rubber clear smoke milky orange black white cream grey pcb red blue
(`look.mat(name)`; one per part, so neighbours never share one; `orange` for the one accent part). Builders take
`(..., finish, name)` and return the part; add more meshes to it with `part.add(look.mesh(geometry, finish))`.

## Contents
- The row, the floor and the axis
- Callouts
- What flows: the power path
- Turned parts: bodies, caps, tubes, knobs
- Springs, threads and screws
- Batteries, LEDs, lenses and reflectors
- Circuit boards, switches, buttons and wires
- Gears, wheels and rubber grips
- Clear housings and shells
- Flat objects: stacks

## The row, the floor and the axis

```js
const subject = new THREE.Group(); subject.userData.subject = true; root.add(subject);
// ...build the parts and subject.add() them first: the row measures them where they are...
const row = look.row([
  { object: tail, at: mm(13) },                  // at = where its origin sits in the closed object (along the axis)
  { object: spring, at: mm(11.4) },              // nested parts overlap: the spring sits inside the tail cap
  { object: battery, at: mm(42.75) },
], { gap: 0.018 });                              // 0.4-0.8 of a typical part's length; dir: [1, 0, 0] (default)
subject.add(look.axis(row));                     // dash-dot ink centre line + two steel stands
const set = look.set({ length: row.length + 0.08, depth: 0.12 });   // the slab: the row and its stands, no more
root.add(set);
subject.position.y = set.userData.top;
row.hands(traits, isGrabbed, { onPress(p, i) {}, onOut(p, i) {}, onSeat(p, i) {} });   // after root.add(subject)
// update(time, delta): row.update(delta);
```

Without `at`, parts are packed end to end (fine for objects whose parts stack, like a bolt and its nuts). The row
starts apart (`k = 1`). `row.go(0)` closes it (parts return in reverse, each seats with a click), `row.go(1)` opens
it, `row.place(v)` follows a slider. `row.parts[i].k` is how far part i is apart, `.out` / `.held` whether the learner
took it out; `row.missing()` is the first part out, or -1. `row.focus(i)` lifts a part (presses do it for you).

## Callouts

```js
look.callouts(row, ['Tail cap', 'Spring', 'Battery', 'Body', 'LED board', 'Reflector', 'Lens']);
```

Numbered in row order, ink blue, each straight above its part on a leader, on a common line; neighbours alternate
between up to three heights so no card covers another card or a leader. Where full names cannot fit (short parts
close together), those cards become number tags and the full name shows while the part is pressed, held or out - so
list the parts by number on the panel too. Callouts show while the row is apart. Use 2 to 4 words, at most 7 parts
named. A single extra tag: `look.callout(n, 'Name', part, { level, side })`.

## What flows: the power path

```js
const LOOP = [                                   // in flow order; at = a point in that part's own frame
  { object: battery, at: [mm(26.2), 0, 0] },     // + end
  { object: ledBoard, at: [mm(-4.5), 0, 0] },    // the board's brass pin
  { object: ledBoard, at: [0, mm(12.8), 0] },    // out to its rim
  { object: body, at: [mm(-40), mm(10), 0] },    // back along the body wall
  { object: spring, at: [mm(6), 0, 0] },
  { object: battery, at: [mm(-25.25), 0, 0] },   // - end
];
const path = look.powerPath(LOOP, { colour: '#ffb12e', speed: 0.08 });
subject.add(path.group);                         // same parent as the parts
// update: the first point whose part is out, or the open switch, is where it stops
path.update(time, stop, together);               // stop -1 = all round; flow false = the route without the bead
```

It is drawn through the parts (an x-ray of the route) and follows them as they move. Use it for current, water, air,
ink or light; for a push or a pull use `kit.arrow([[x0, y, 0], [x1, y, 0]], { color: '#e8742a', radius: 0.003 })`
beside the part. Light an LED with `led.userData.light.emissiveIntensity = 2.5` and `led.userData.halo.visible = true`.

## Turned parts: bodies, caps, tubes, knobs

Anything round is turned: a profile `[[x, r], ...]` spun about x. Walk it front face up (-x end, from the axis out),
along the outside to +x, back face down, and for a hollow part back along the bore; a third value 1 makes the surface
smooth through that point; `bevel` chamfers the hard corners so each edge catches a highlight.

```js
const body = look.turned([[-40, 7.8], [-40, 10], [14, 10], [17, 15], [40, 15], [40, 13], [18, 13], [18, 7.8], [-40, 7.8]]
  .map(([x, r]) => [mm(x), mm(r)]), 'satin', 'Body', { bevel: mm(0.4) });   // tube 20 mm, head 30 mm, hollow
const barrel = look.tube(mm(5.6), mm(4.6), mm(58), 'clear', 'Barrel');    // open both ends
const cap = look.cap(mm(11.5), mm(18), 'gunmetal', 'Tail cap', { closed: 'front', wall: mm(0.9) });
const knob = look.turned([[mm(-4), 0], [mm(-4), mm(9), 1], [mm(3), mm(9.5), 1], [mm(4), mm(7)], [mm(4), 0]], 'black', 'Knob');
```

For a geometry to add inside another part: `look.mesh(look.turnedGeometry(profile, { seg: 48, bevel }), 'brass')`.

## Springs, threads and screws

```js
const spring = look.spring(mm(5), mm(15), 6, { wire: mm(0.7), name: 'Spring' });   // r, free length, turns
// squeeze it as it seats (its mesh, not the group, so the callout keeps its place):
spring.children[0].scale.x = 0.81 + 0.19 * Math.min(1, Math.max(0, row.parts[1].k));
const thread = look.thread(mm(10.3), mm(5), mm(0.8), 'satin', 'Body thread');       // r, length, pitch
thread.position.x = mm(-37); body.add(thread);   // round the end that screws into the next part
const screw = look.screw(mm(1.5), mm(8), { finish: 'steel', name: 'Screw' });        // M3 x 8, head at -x
```

A spring is a true helix with closed coils at both ends; a compression spring has 5 to 12 turns, a wire about a tenth
of its radius. Never a plain cylinder.

## Batteries, LEDs, lenses and reflectors

```js
const aa = look.battery(mm(50.5), mm(7.25), 'Battery');                    // AA; AAA 44.5 x 10.5; 18650 65 x 18
const coin = look.part(new THREE.CylinderGeometry(mm(10), mm(10), mm(3.2), 40).rotateZ(Math.PI / 2), 'steel', 'CR2032');
const led = look.led(mm(2.5), 'LED');                                     // 5 mm LED, dome toward +x
const lens = look.lens(mm(12.9), mm(2.5), 'Lens', { dome: 0 });          // dome 0.3-0.8 for a magnifying lens
const reflector = look.reflector(mm(12.5), mm(3.5), mm(14), 'Reflector'); // front r, back r, depth; opens to +x
```

A part that points the other way: `part.rotation.y = Math.PI` before `look.row` (the row keeps it).

## Circuit boards, switches, buttons and wires

```js
const board = look.part(kit.roundedBox(mm(55), mm(1.6), mm(90), mm(0.4)), 'pcb', 'Circuit board');
const chip = look.mesh(kit.roundedBox(mm(8), mm(1.2), mm(8), mm(0.3)), 'black'); chip.position.set(mm(5), mm(1.4), 0);
const sw = look.mesh(kit.roundedBox(mm(6), mm(4), mm(6), mm(0.5)), 'black'); sw.position.set(mm(-15), mm(2.8), mm(-30));
const plunger = look.mesh(new THREE.CylinderGeometry(mm(1.2), mm(1.2), mm(1.5), 16), 'red'); plunger.position.set(mm(-15), mm(5.5), mm(-30));
board.add(chip, sw, plunger);                    // a micro switch with its red plunger: what a mouse button presses
const wire = look.mesh(kit.tube([[0, 0, 0], [mm(10), mm(4), 0], [mm(25), mm(2), mm(5)]], mm(1)), 'red');
```

A switch the learner clicks is pressed through its part's `onPress` (the whole part is the hand target); show the click
by moving the plunger or button 1-2 mm and changing what flows.

## Gears, wheels and rubber grips

```js
const gear = look.gear(16, mm(8), mm(3), 'brass', 'Gear');               // teeth, pitch radius, thickness; turns about x
const wheel = look.part(new THREE.CylinderGeometry(mm(10), mm(10), mm(7), 40).rotateZ(Math.PI / 2), 'rubber', 'Scroll wheel');   // axle along x
const ribs = Array.from({ length: 13 }, (_, i) => [mm(-15 + i * 2.5), mm(i % 2 ? 6.4 : 6)]);   // a ribbed sleeve, 30 mm
const grip = look.turned([[mm(-15), mm(5)], ...ribs, [mm(15), mm(5)]], 'rubber', 'Grip');
```

Two gears mesh when `radius / teeth` is the same and their centres are `r1 + r2` apart. Turn them in update by
`gear.children[0].rotation.x`, the smaller one faster by the tooth ratio.

## Clear housings and shells

Clear and milky plastic show what is inside when the row is closed: `look.tube(..., 'clear', ...)` for a barrel,
`look.part(kit.roundedBox(w, h, d, r), 'smoke', 'Window')` for a window. Keep a clear part's walls 1-2 mm thick (real)
and its neighbours opaque, or it disappears. A shell that hides everything is one part of the row, never a box round
the whole row.

## Flat objects: stacks

Mice, phones, remotes, keyboards and watches come apart upward. Give the row a `dir` up and slightly back, so each
layer steps away from the learner and the one below stays visible:

```js
const row = look.row([{ object: base }, { object: battery }, { object: board }, { object: wheel }, { object: shell }],
  { dir: [0, 1, -0.35], gap: 0.03 });             // bottom first; each part's length is its height
subject.position.z = 0.08;                        // the top layers lean back: keep every part at z > -0.1
```

Build each layer flat (lying in XZ, centred on its origin). Callouts go beside the parts (`side: 'right'`, swapping to
the left when two would touch); the axis is a centre line up the stack with no stands; one shadow under it.
