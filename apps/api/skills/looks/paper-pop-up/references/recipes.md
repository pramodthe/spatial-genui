# Card recipes

Sizes in metres. The book is 0.4 x 0.26 m open; each page runs from the gutter (x = 0) about 0.19 out, and from
z = -0.124 at the back to z = 0.124 at the front. Pieces stand on the paper at y = 0. A card is an outline
`[[x, y], ...]` that `look.card` cuts from card 1.5 mm thick, printed on both faces, pale on the cut edge. Every recipe
below assumes:

```js
const S = look.shape;                                                     // outline helpers
const front = (card, n = 1) => { card.position.z = 0.0016 * n; return card; };   // a print n cards in front
```

## Contents
- How a spread is put together (folds, depth, what fits)
- Animals and insects
- Plants and flowers
- Houses, scenery and layers of depth
- Water
- Sky, sun, moon and weather
- People
- Pull tabs, flaps and wheels
- Ribbons, tags, arrows and numbers
- The draw-call budget

## How a spread is put together

```js
const book = look.set({ spreads: 4 });         // one spread per step; book.userData.top is the paper
root.add(book);
const sp = book.spreads[0];                    // sp.left / sp.right: the pages; sp.pop: the mechanisms
// The back wall: a V-fold that is nearly flat (alpha 78-84), the tallest piece, at the back.
const wall = look.vFold(sp, { z: -0.07, alpha: 80, name: 'Pond bank' }, [
  look.card(S.ridge(-0.16, 0.16, (x) => 0.09 + 0.02 * Math.cos(x * 18)), 'sage', 'Far bank'),
  front(look.card(S.ridge(-0.16, 0.16, (x) => 0.05 + 0.01 * Math.cos(x * 30 + 1)), 'leaf', 'Near bank')),
]);
// The subject: a V-fold across the gutter (alpha 58-65 is a clear V), in the middle, big.
const subject = look.vFold(sp, { z: 0.0, alpha: 60, name: 'Frog' }, frog(0, 0.0, 1.6));
// Side pieces: parallel folds standing in front of a wing (side -1 left, 1 right), drawn in that wing's x.
look.box(sp, wall, { side: -1, depth: 0.05, strap: 0.03, name: 'Reeds' }, reeds(-0.15, -0.09));
// Small things in the air: on a paper arm in front of a wing, glued at `at`; they tremble when the page lands.
look.float(sp, wall, { side: 1, at: [0.1, 0.1], gap: 0.015, name: 'Dragonfly' }, dragonfly(0.1, 0.1));
// Prints on the page: flat cards in page coordinates [x, z]; glue each page's prints into one mesh.
sp.left.add(look.flat(S.ellipse(-0.1, 0.05, 0.06, 0.03), 'sky', 'Puddle'));
look.glue(sp.left);
look.ribbon(sp, 'A frog lays eggs');
```

- Draw every fold piece flat: x = 0 is the crease, y = 0 the paper, +z is toward the learner. A V-fold cuts its cards
  at the crease for you; a card that does not reach x = 0 sits on one wing.
- Depth is layers: back wall about z -0.07, side pieces 4-5 cm in front of it, the subject near z 0, the ribbon at
  z 0.075. Taller at the back.
- It must fold flat into the shut book: keep each V-fold's height x sin(alpha) + z under about 0.11, and every piece
  within |x| < 0.18.
- `look.layer(sp, { x, z }, cards)` is a plain layer hinged on one page (it rises after the V-folds); keep it off the
  gutter (|x| > 0.05 everywhere) so the turning page does not pass through it.
- A piece the lesson changes (it grows, it changes colour) is its own fold: scale its wings
  (`v.left.scale.set(sx, sy, 1)` and the same on `v.right`) or swap two folds with `v.group.visible`.
- Extra cards can ride a fold: `wing.add(card)` with the card placed in the wing's own x, y (a clock hand on a float,
  a tag on a box). They move with it and can be animated (a hand's `rotation.z`).

## Animals and insects

Animals are a few overlapping cut-outs: body, head, limbs, then small prints in front (eyes, spots, stripes). Give the
body a cream margin (`{ margin: true }`) so it reads against the scene.

```js
// A frog sitting, facing the learner, centred on x, feet at y; s scales it (1 = 6 cm wide).
const frog = (x, y, s = 1) => [
  ...[-1, 1].map((k) => look.card(S.leaf(x + k * 0.018 * s, y + 0.006 * s, 0.03 * s, k > 0 ? 0.25 : Math.PI - 0.25, 0.4), 'deep', 'Back leg')),
  look.card(S.ellipse(x, y + 0.02 * s, 0.026 * s, 0.017 * s), 'leaf', 'Frog body', { margin: true }),
  front(look.card(S.ellipse(x, y + 0.016 * s, 0.015 * s, 0.009 * s), 'sage', 'Belly')),
  ...[-1, 1].map((k) => front(look.card(S.circle(x + k * 0.012 * s, y + 0.036 * s, 0.006 * s, 16), 'cream', 'Eye'))),
  ...[-1, 1].map((k) => front(look.card(S.circle(x + k * 0.012 * s, y + 0.036 * s, 0.003 * s, 12), 'navy', 'Pupil'), 2)),
];
// A tadpole (or fish): an egg-shaped body and a tail fin; the tail is its own card so it can shrink.
const tadpole = (x, y, s = 1) => [
  look.card(S.ellipse(x, y, 0.012 * s, 0.009 * s), 'navy', 'Tadpole body', { margin: true }),
  look.card(S.leaf(x - 0.01 * s, y, 0.03 * s, Math.PI, 0.25), 'deep', 'Tail'),
  front(look.card(S.circle(x + 0.006 * s, y + 0.003 * s, 0.0025 * s, 10), 'cream', 'Eye')),
];
// A bee: yellow body with navy stripes printed in front, two sky wings behind.
const bee = (x, y, s = 1) => [
  look.card(S.ellipse(x - 0.004 * s, y + 0.01 * s, 0.009 * s, 0.006 * s, 0.6), 'sky', 'Wing'),
  look.card(S.ellipse(x, y, 0.014 * s, 0.009 * s), 'yellow', 'Bee', { margin: true }),
  ...[-0.004, 0.004].map((d) => front(look.card(S.rect(x + d * s - 0.0015 * s, y - 0.008 * s, 0.003 * s, 0.016 * s), 'navy', 'Stripe'))),
];
// A butterfly: four wings (two leaf shapes each side), a navy body on top.
const butterfly = (x, y, s = 1) => [
  ...[-1, 1].flatMap((k) => [look.card(S.leaf(x, y, 0.03 * s, k > 0 ? 0.6 : Math.PI - 0.6, 0.45), 'coral', 'Fore wing'),
    look.card(S.leaf(x, y, 0.022 * s, k > 0 ? -0.5 : Math.PI + 0.5, 0.45), 'yellow', 'Hind wing')]),
  front(look.card(S.ellipse(x, y, 0.003 * s, 0.014 * s), 'navy', 'Body')),
];
// A dragonfly on an arm: long body, two pairs of thin wings.
const dragonfly = (x, y) => [
  look.card(S.rect(x - 0.025, y - 0.002, 0.05, 0.004, 0.002), 'deep', 'Dragonfly body'),
  front(look.card(S.leaf(x + 0.01, y, 0.025, 1.3, 0.2), 'sky', 'Wing')), front(look.card(S.leaf(x + 0.01, y, 0.025, 1.85, 0.2), 'sky', 'Wing')),
];
```

A bird is the same: an ellipse body, a leaf tail and wing, a small triangle beak, an eye. Spots, scales and feathers
are small cards in front, 3 to 6 of them, not dozens.

## Plants and flowers

```js
// A flower on a stem, x = where it stands; petals are leaf shapes around a heart.
const flower = (x, h, colour = 'coral', n = 7, r = 0.03) => [
  look.card(S.rect(x - 0.002, 0, 0.004, h), 'deep', 'Stem'),
  look.card(S.leaf(x, h * 0.3, 0.035, 0.5), 'leaf', 'Leaf'), look.card(S.leaf(x, h * 0.45, 0.03, 2.6), 'sage', 'Leaf'),
  ...Array.from({ length: n }, (_, i) => look.card(S.leaf(x, h, r, (i / n) * Math.PI * 2, 0.3), colour, 'Petal')),
  front(look.card(S.circle(x, h, r * 0.35, 16), 'yellow', 'Heart')),
];
// Reeds or grass: a ridge with a jagged top.
const reeds = (x0, x1) => [look.card(S.ridge(x0, x1, (x) => 0.03 + 0.03 * Math.abs(Math.sin(x * 140)), 0, 0.004), 'deep', 'Reeds')];
// A tree: a trunk and a crown of overlapping circles in two greens.
const tree = (x, h) => [
  look.card(S.rect(x - 0.006, 0, 0.012, h * 0.55), 'amber', 'Trunk'),
  look.card(S.circle(x, h * 0.7, h * 0.3), 'deep', 'Crown'),
  front(look.card(S.circle(x - h * 0.1, h * 0.75, h * 0.17), 'leaf', 'Leaves')),
];
```

Growth: a plant that grows is its own V-fold whose wings scale in y (`v.left.scale.y = v.right.scale.y = 0.4 + 0.6 * tab.k`),
or one fold per size shown in turn. A seed is `S.drop(x, y, r)` turned on its side, on the page or in a flap.

## Houses, scenery and layers of depth

```js
// A house: wall, roof, door and windows printed in front.
const house = (x, w, h) => [
  look.card(S.rect(x - w / 2, 0, w, h * 0.6), 'cream', 'House', { margin: true }),
  look.card([[x - w * 0.6, h * 0.58], [x + w * 0.6, h * 0.58], [x, h]], 'coral', 'Roof'),
  front(look.card(S.rect(x - w * 0.1, 0, w * 0.2, h * 0.32, 0.003), 'navy', 'Door')),
  ...[-1, 1].map((k) => front(look.card(S.rect(x + k * w * 0.3 - w * 0.08, h * 0.32, w * 0.16, w * 0.16), 'sky', 'Window'))),
];
```

Scenery is 3 layers of ridges, each lower and darker toward the front, on the back wall's V-fold (prints one thickness
apart) or on separate V-folds at z -0.07, -0.05, -0.03. A street is houses of different heights on two parallel folds,
one per wing.

## Water

Water is flat or nearly flat: a pond printed on the page (`look.flat(S.ellipse(...), 'sky', 'Pond')`), with a darker
ripple ring on level 1 (`{ level: 1 }`); waves standing up are a `S.wave` strip on a low V-fold or a layer at the front.

```js
sp.right.add(look.flat(S.ellipse(0.1, 0.0, 0.07, 0.045), 'sky', 'Pond'));
sp.right.add(look.flat(S.ellipse(0.1, 0.0, 0.05, 0.03), '#b6d8d1', 'Ripple', { level: 1 }));
const lilyPad = look.flat(S.arc(0, 0, 0, 0.022, 0.4, Math.PI * 2 - 0.1), 'leaf', 'Lily pad', { level: 2 });
```

A raindrop is `S.drop`; a river across a page is a flat `S.wave` strip turned (`S.turn`) along its course.

## Sky, sun, moon and weather

```js
const sun = [look.card(S.star(0.1, 0.1, 0.03, 0.022, 12), 'yellow', 'Sun rays'), front(look.card(S.circle(0.1, 0.1, 0.018), 'honey', 'Sun'))];
const moon = [look.card(S.arc(0, 0.1, 0.012, 0.02, -1.6, 1.6), 'cream', 'Moon')];
const cloud = (x, y) => [[0, 0, 0.012], [0.015, 0.006, 0.014], [0.03, 0, 0.011]].map(([dx, dy, r]) => look.card(S.circle(x + dx, y + dy, r), 'cream', 'Cloud'));
```

A shape made of several round parts (a cloud, a crown of leaves) is several cards of one colour that overlap; an
outline must not cross itself. Sky behind a scene is the back wall in `sky`; the sun goes behind the far
hills (`card.position.z = -0.0016`) or on a paper arm.

## People

A person is a cut-out figure about 6-9 cm tall: head circle, body as a rounded rect or a trapezoid (a dress, a coat),
legs as two thin rects, arms as leaf shapes; face prints are 2 navy dots. Keep people simple and friendly, facing the
learner; give them a margin.

```js
const person = (x, h, coat = 'coral') => [
  ...[-1, 1].map((k) => look.card(S.rect(x + k * h * 0.06 - h * 0.025, 0, h * 0.05, h * 0.35), 'navy', 'Leg')),
  look.card([[x - h * 0.15, h * 0.33], [x + h * 0.15, h * 0.33], [x + h * 0.1, h * 0.72], [x - h * 0.1, h * 0.72]], coat, 'Coat', { margin: true }),
  look.card(S.circle(x, h * 0.85, h * 0.13), 'pink', 'Head', { margin: true }),
  ...[-1, 1].map((k) => front(look.card(S.circle(x + k * h * 0.045, h * 0.87, h * 0.015, 10), 'navy', 'Eye'))),
];
```

## Pull tabs, flaps and wheels

They go on a page (`sp.left` or `sp.right`), in the front half, at least 4 cm from each other and from the ribbon.

```js
// Pull tab: a 3.5 x 3 x 1.2 cm grip in a slot, pulled along +x by `length`. Grabbed, it stays where it is let go.
const tab = look.pullTab(sp.right, { x: 0.12, z: 0.06, length: 0.05, name: 'Grow tab' });
traits(tab.object, { grab: true });
// update: tab.update(isGrabbed, delta); then use tab.k (0..1): legs.scale.y = tab.k; tail.scale.x = 1 - 0.8 * tab.k;
// tab.set(0) slides it home (a reset).

// Flap: a lid hinged at its back edge; a press lifts it. Print on flap.top, hide the answer in flap.under.
const pad = look.flap(sp.left, { x: -0.11, z: 0.03, w: 0.06, d: 0.05, colour: 'leaf', name: 'Lily pad' });
pad.top.add(look.flat(S.circle(0, 0.025, 0.01), 'deep', 'Vein'));                 // [x, z] from the hinge, z 0..d
for (let i = 0; i < 7; i++) pad.under.add(look.flat(S.circle(-0.015 + (i % 4) * 0.01, 0.015 + Math.floor(i / 4) * 0.012, 0.004, 10), 'navy', 'Egg'));
look.glue(pad.under);
traits(pad.object, { onPress() { pad.toggle(); } });                                 // update: pad.update(delta)

// Wheel (volvelle): sectors seen through a window at the front; a press turns the next one in.
const wheel = look.wheel(sp.left, { x: -0.11, z: 0.05, r: 0.045, sectors: [
  { colour: 'sky', name: 'Spawn' }, { colour: 'sage', name: 'Tadpole' }, { colour: 'leaf', name: 'Froglet' }, { colour: 'deep', name: 'Frog' }] });
wheel.sector(0).add(look.flat(S.circle(0, 0.028, 0.006, 12), 'navy', 'Egg', { level: 1 }));   // pictures at z about 0.6 r
look.glue(wheel.disc);
traits(wheel.object, { onPress() { wheel.next(); panel.set('info', STAGES[wheel.index]); } });  // update: wheel.update(delta)
```

## Ribbons, tags, arrows and numbers

```js
look.ribbon(sp, 'Tadpoles hatch');                       // one short line per spread, at the front (z 0.075)
const t = kit.card('Back legs', { color: look.PAL.navy });  // a name tag beside the part, riding its fold
t.position.set(0.05, 0.03, 0.005);
subject.right.add(t);
const arrow = look.card(S.arrow(-0.05, 0.1, 0.05, 0.1, 0.006), 'coral', 'Next');   // an arrow on a wall or a page
const weeks = look.number('12', 'navy', '12 weeks', { h: 0.02 });                   // digits 0-9 + - = x / . : C E F H L P U
weeks.position.set(-0.1, 0.06, 0.0016);                  // inside a fold's card list, or lying: rotation.x = -Math.PI / 2
```

A number that changes with a tab: build each value once in build and show one at a time (`visible`), or put the
changing number on the panel and keep the scene's number for the fixed facts. Sentences always go on the panel; 2 to 4
tags per spread, each right beside its part.

## The draw-call budget

Each `look.card` is a mesh, but a fold glues all its cards into one mesh per wing, so a whole V-fold is 2 draw calls,
a box fold 2, a float 1, a ribbon 2 plus its tag (3). Glue each page's prints with `look.glue(page)` (tabs, flaps and
wheels inside are left alone) and the wheel's disc with `look.glue(wheel.disc)`. A five-spread book with 4-6 folds a
spread stays near 100 draw calls; the gate stops at 150.
