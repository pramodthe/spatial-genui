# Exploded view

Start: `node /skills/common/styles/scripts/new-lesson.mjs exploded-view /work/module.js`. Module: `assets/styles/exploded-view.js`. Film source: `assets/film/styles/exploded-view.js`.

A product teardown: one object comes apart along its axis into its parts, every part gets a numbered callout in ink
blue, and it goes back together with a click. Good for what is inside an object and how it is assembled.

## Set

Enlarge the object first: the exploded row should span 0.4 to 0.5 m and the thickest part be at least 0.05 m across
(a 0.15 m flashlight is shown about 2.5 times real size; the panel says so). Then a pale floor disc under the middle of
the row, no wider than the row (or a long rounded slab under it), 6 mm thick:
`new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.006, 64), kit.material('plastic', { color: '#dedbd5', roughness: 0.95, wear: 0 }))`,
top at y = 0.006. The object hangs just above it on its axis, held by one or two thin stands; `kit.shadow` under it.
Nothing else on the desk: the disc is never the biggest, brightest thing.

## Palette

- Ink (numbers, leader lines): `#1b2f8c`. Paper (callout background if any): `#fbf7ee`.
- Floor `#dedbd5`. Neutral colour everywhere else: the parts carry real finishes.
- One accent part in moulded orange `#e8742a`; all other colour comes from the materials.

## Materials

Real finishes, one per part, so neighbours never share a material:
`kit.material('glass')` (clear plastic), `'chrome'`, `'brass'`, `'steel'`, `'brushedMetal'`, `'rubber'` (dimpled grip),
`'plastic'` with a colour, `'glossy'` for the one orange piece. Springs as true helices with `kit.tube` (points on a
helix, 10 to 14 turns). Turned parts with `kit.lathe` at 48 segments.

## Motion: the steps

The assembled object is step 0. Then:

1. **Unscrew and pull apart along the axis** into 2 or 3 sub-assemblies, which park in two tiers.
2. **Each sub-assembly spreads into its parts**, one after another, in assembly order along the axis. Each part
   overshoots its place and settles (`lookBack`) and keeps a slight tilt of its own (2 to 6 degrees).
3. **Callouts draw on** as each part arrives: number + name.
4. **Back together** in reverse, each part seating with a small drop (`lookBounce`).

Put the axis left to right (x) or front to back so the row recedes toward the learner's view and every part is
visible from the seat; the gap between parts is about 0.4 to 0.8 of a part's length. The exploded row must still fit
the 0.8 m desk: plan the spread first, then size the parts. Animate each part's offset from its seated position:
`part.position.x = seat.x + spread * lookBack(lookSeg(t, start, start + 0.6))`. Keep the part the step names a
little higher (+0.01 m) and glowing faintly.

A slider "Apart" (0 to 1) can drive the same offset so the learner pulls it apart by hand; grabbable parts can also
be lifted off directly.

## Words

Numbered callouts: `kit.card('1  Spring', { width: 0.07 })` above each part, with a leader line from the card to the
part (`kit.tube([[x, y, z], [x, y2, z]], 0.0006)` in `kit.material('plastic', { color: '#1b2f8c', wear: 0 })`).
Each callout sits straight above its own part, so callouts never overlap: when parts are closer together than a card
is wide, alternate the cards between two heights (or above and below the row), and place them from the parts'
positions in the current state (exploded or seated), not from a fixed list. At
most 5 to 7 callouts; the panel lists the order of assembly.

## Helpers

`lookSeg`, `lookBack`, `lookBounce`.

## Avoid

A box-shaped "case" hiding the parts, parts that float with no axis to read, cards that cover the parts, all parts
the same grey.
