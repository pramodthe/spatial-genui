# Circuit recipes

All sizes in metres; x right, z toward the learner. The board is about 0.42 x 0.3 m; build in a `subject` group at
`set.userData.top`, so y = 0 is the board's surface. Every recipe uses the builders of `circuitCityLook` (`look`) and
its materials `look.M` (mask, copper, gold, tin, alu, steel, epoxy, plastic, substrate, ceramic, silicon, silk, etch,
travelled). Landmarks are Groups with `userData.wake(k)`; call `look.wake(landmark, k)` every frame you animate it.

## Contents
- The board
- The processor (the big building)
- Memory and other chips
- Capacitor towers
- Small parts (the houses)
- Ports and connectors
- Tracks, bends and vias
- LEDs
- Silkscreen outlines and names
- The pulse
- The data token
- A meter
- Budget

## The board

```js
const set = look.set({ width: 0.44, depth: 0.3 });   // green mask, copper lines under it, gold pads, mounting holes
root.add(set);                                       // never grabbable
subject.position.y = set.userData.top;
```

`traces: false` leaves out the copper lines (for a very busy board). Keep the back strip (pads) and the corners
(holes) free; put the journey in the front two thirds, where the hands reach (z > -0.1).

## The processor (the big building)

```js
const cpu = look.cpu(0.07, 'Processor', { cores: 4 });  // substrate, pins on 4 sides, steel frame, 4 x 4 dies
cpu.position.set(0, 0, -0.005);
look.wake(cpu, 0.5);                                  // the underglow on, half the dies lit in a diagonal wave
```

One per board, the biggest landmark (0.06-0.08 m). `cores` 2-6. Ease its wake level from 0 to 1 when the pulse arrives
and the wave runs across the dies by itself. For stages inside the processor (fetch, decode, execute), press the
processor and show the stage on the panel, or build three chips in a row instead.

## Memory and other chips

```js
const usb = look.chip(0.03, 0.03, 'USB controller', { sides: 'xz', mark: 'U1' });   // pins on all four sides
const gpu = look.chip(0.04, 0.04, 'Graphics chip', { sides: 'xz', mark: 'GPU' });
const radio = look.chip(0.05, 0.022, 'Radio', { sides: 'z', h: 0.006 });            // long, pins front and back
const ram = look.memoryBank(4, 'Memory', { w: 0.012, d: 0.03 });                    // a row of 4 along x
ram.position.set(0, 0, -0.09);
look.wake(ram, 1, 2);                      // wake only chip 2 of the row; look.wake(ram, k) wakes them all
const x2 = ram.userData.chipX(2);          // where chip 2 is, for a track to it
```

Vary size and shape between stages: a square chip, a long one, a row. `mark` etches a short code on the top (grey).
`h` is the height (6-9 mm). A whole `memoryBank` is one hand target; when each memory chip is a stop, build them as
separate `look.chip`s.

## Capacitor towers

```js
const towers = look.towers([[-0.06, -0.06, 0.008, 0.022], [0.06, -0.06, 0.008, 0.022]], 'Power');  // [x, z, r, h]
look.wake(towers, 1, 0);                   // tower 0 glows at its base
const relay = look.tower(0.01, 0.03, 'Tower');   // one can at the origin: a cell tower, a relay, a power stage
```

Towers are tall (2-3 cm): put them at the back and the sides so they do not hide the route. All the towers of one
call are 5 draw calls together.

## Small parts (the houses)

```js
const keep = [[0, 0, 0.09, 0.09], [-0.11, 0.055, 0.05, 0.05]];          // [x, z, w, d] footprints to stay off
const lines = LEGS.map((t) => t.path.points.map((p) => [p.x, p.z]));  // tracks to stay 8 mm off
subject.add(look.smallParts(look.scatter(keep, { lines, count: 30, seed: 2, width: 0.44, depth: 0.3 }), 'Small parts'));
// or by hand: look.smallParts([[0.03, 0.08, 0, 'r'], [0.04, 0.08, Math.PI / 2, 'c']], 'Filter')
```

Resistors are black ('r'), ceramic capacitors tan ('c'), 7 mm long. They make the board read as a real city; 20-40
of them, never on the route or a label.

## Ports and connectors

```js
const keyboard = look.connector('Keyboard port', { face: '-x' });   // mouth facing out of the left edge
keyboard.position.set(-0.185, 0, 0.055);
const screen = look.connector('Screen port', { face: '+x' });
look.wake(screen, 1);                                                // contacts glow, light spills out of the mouth
```

The journey enters and leaves at ports on the edges: put the mouth flush with the board's edge. 3.4 x 1.3 x 3.2 cm, a
good press target.

## Tracks, bends and vias

```js
const a = [-0.11, 0.055], b = [0, -0.005];
const leg = look.track(look.route(a, b), 'USB to CPU');   // straight, then one 45-degree diagonal
subject.add(leg.mesh);
leg.light(0.5);                    // the first half is travelled (faintly lit); call it as the pulse moves
const out = look.track(look.route(b, [0.11, 0.055], { diagonalFirst: true }), 'CPU to GPU');
const bus = look.track([[x, -0.077], [x * 0.5, -0.04]], 'Bus 1', { width: 0.0018, lit: false });   // dressing
subject.add(look.vias([[-0.06, 0.055], [0.06, 0.055]], 'Vias'));
```

Points are `[x, z]`. Run each leg of the journey from stop centre to stop centre: the track and the pulse go in under
the chip, so the pulse never jumps from one side of a chip to the other. Bends are 45 degrees (`look.route`, or your
own points with equal dx and dz on the diagonals); never curves. `track.path.at(u, out)` samples it, `track.length` is
its length. Width 3 mm for the route, 1.5-2 mm for buses and dressing. Vias go at bends and track ends.

## LEDs

```js
const led = look.led('#35ff7a', 'Done LED');      // green done, amber busy '#ffb347', red error '#ff3b30'
led.position.set(0.185, 0, 0.022);
look.wake(led, 1);                                // on; blink with look.wake(led, Math.sin(time * 12) > 0 ? 1 : 0.1)
```

## Silkscreen outlines and names

```js
const name = look.label('CPU', 'CPU silkscreen', { h: 0.011 });   // white capitals lying on the board, centred
name.position.set(0, 0, 0.05);                                    // just in front of the part (toward the learner)
const ref = look.label('U5', 'U5', { h: 0.006 });                 // a small reference designator
subject.add(look.outline(0.05, 0.03, 'Keep-out', { round: false }));   // an outline round an area
```

Letters: A-Z, 0-9 and `- . / > < : + =`. `h` 0.009-0.013 for names (a word of up to 8 letters), 0.006 for designators;
`width` shrinks it to fit; `userData.width` / `userData.depth` give its size. Names lie in front of their landmark,
tops toward the back, so they read from the learner's seat. Chips, towers and ports draw their own outlines.

## The pulse

```js
const pulse = look.pulse('Signal');               // a warm glow, a hot core and a 3-glow trail
subject.add(pulse.mesh);
// in update: u += delta * 0.045 / leg.length; pulse.follow(leg.path, u); leg.light(u);
pulse.mesh.visible = moving;                      // hide it while it waits inside a stop
```

## The data token

```js
const token = look.token(['HI', 'BITS', 'WAVE', 'PACKET'], ['#f2f2ea', '#5ad1ff', '#ff6fae', '#ffb44a'], 'Message');
subject.add(token.mesh);
token.show(2);                                    // prints WAVE on it, glowing pink
// riding the pulse: leg.path.at(u, v); token.mesh.position.set(v.x, 0.03, v.z);
traits(token.mesh, { grab: true });
const seat = lookSeat(THREE, token.mesh, isGrabbed, { returnAfter: 1, onAway() { /* dropped: which stop is it on? */ } });
```

4.4 x 1.2 x 3 cm, a good grab target. Labels up to about 6 letters stay large; longer ones shrink. Keep `seat.home`
equal to where the token should be (`seat.home.copy(token.mesh.position)` each frame while it rides), and stop the
pulse while the token is held or away.

## A meter

```js
const meter = look.meter('Time meter', { segments: 10, w: 0.1 });   // green, then amber, then red segments
meter.position.set(0, 0, 0.108);
meter.userData.set(ms / 40);                                        // 0..1 of its range
```

Name its unit with a small `look.label` beside it (MS, KB, HOPS), and put the exact number on the panel (`stat`).

## Budget

A chip is 5 draw calls, the processor 8, a port 7, a track 2, a label 1, the pulse 5, the token 2 plus one per label (the check counts hidden meshes too).
The worked lesson (5 stops, memory, 4 towers, 34 small parts, a meter) is 82 draw calls and 60,000 triangles: room
for 2-3 more stops, not for 20 separate chips. Build rows with `memoryBank`, `towers` and `smallParts`.
