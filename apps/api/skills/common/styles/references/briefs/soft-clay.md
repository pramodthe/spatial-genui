# Soft clay

Start: `node /skills/common/styles/scripts/new-lesson.mjs soft-clay /work/module.js`. Module: `assets/styles/soft-clay.js`. Film source: `assets/film/styles/soft-clay.js`.

Everything modelled in plasticine, like stop-motion on a small tabletop: chunky, slightly lopsided forms with
fingerprints and pits, a few colours from one box of clay. Good for a few friendly objects on a table: amounts as
piles and stacks, growth and comparison, simple characters and props; warm, non-technical topics.

## Set

A clay board: a slab of uncoated coloured card, `kit.roundedBox(0.4, 0.01, 0.3, 0.004)` in
`kit.material('paper', { color: '#12808a', roughness: 0.93 })`, with a low curved backdrop strip behind the objects
(no taller than the tallest object: `kit.extrude` of a quarter-circle profile, same card). Contact shadows:
`kit.shadow` under each stack.

## Palette

One box of clay; each colour has a second colour streaked through it:

```js
const BOX = { card: '#12808a', cream: ['#f3e6cd', '#eec78c'], coral: ['#de3a26', '#f2814f'],
  yellow: ['#f4ad08', '#ee7f14'], navy: ['#253677', '#4467b8'] };
// material: lookClay(THREE, kit, BOX.coral[0], { streak: BOX.coral[1] })
```

Add at most two colours of your own (green `#4f9a3a` / `#8cc15a`, white `#f5f1ea` / `#d9d2c4`).

## Materials and shapes

- `lookClay(THREE, kit, color, { streak })` on every clay object: matte, waxy, velvet sheen, streaks, fingerprint
  bumps. One material per colour.
- Forms are chunky and soft: spheres, capsules, rounded boxes with big radii, `kit.lathe` with round profiles. Run
  every clay geometry through `lookLumpy(THREE, geometry, 0.002, 0.03, seed)` (a different seed per object) so nothing
  is perfectly regular. Give round things 32 to 48 segments so the lumps read.
- Coins, blocks and stacks: slightly different heights and offsets per item (2 to 4 mm), never perfect columns.
- Fat clay letters or numbers: build from capsules (`THREE.CapsuleGeometry`) and tori laid flat, in cream.

## Motion: the steps

Animated on twos with no blur: `const tq = lookTwos(time)` drives all clay motion. A ball buds, hops over on an arc,
lands as a thick puck (scale y 0.6, x/z 1.25 for one pose), springs back (`lookBounce`). Stacks flinch when something
lands on them (the top items squash for one pose). Anything just touched shifts by a hair between poses. Each step
adds or changes one pile: growth is literal (stacks get taller, piles get wider).

## Words

A number or one short word per step as fat clay letters, low at the front; sentences on the panel. `kit.card` tags
on 2 to 3 piles.

## Helpers

`lookClay`, `lookLumpy`, `lookTwos`, `lookBounce`, `lookSeg`.

## Avoid

Smooth, perfect geometry; shiny plastic; more than 6 colours; smooth sliding motion.
