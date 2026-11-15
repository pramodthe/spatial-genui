# Painted

Start: `node /skills/common/styles/scripts/new-lesson.mjs painted /work/module.js`. Module: `assets/styles/painted.js`. Film source: `assets/film/styles/painted.js`.

Any scene as an oil painting: brush dabs fixed to the things they describe, broken colour that leans warm in the light
and cool in the shadow, small warm lamps where the eye should go. Good for stories and processes that happen in a
place, told like a picture book: how something is made, where it comes from, a chain of cause and effect.

## Set

The scene stands on a painted ground: a low round or rounded-square plinth of land (0.36 to 0.44 m across, 0.02 m
high) in `lookShade(THREE, { mode: 'dabs', lit: '#a3a83a', shade: '#3c5a2e' })`, with the edge of the plinth in
canvas: `kit.material('fabric', { color: '#e8dcc0' })`. Paths, fields and water are separate flat shapes on top, each
in its own dab material.

## Palette

Warm light against cool shadow is the whole palette. Every material is a pair: `lit` warm, `shade` cool.

```js
const PAL = {
  meadow: ['#a3a83a', '#3c5a2e'], wheat: ['#efd07a', '#a5532f'], earth: ['#e6c79c', '#6c68a4'],
  wall: ['#fff0cc', '#8f7aa8'], roof: ['#c8582c', '#4c3f6a'], tree: ['#7f9a34', '#1d4a3c'],
  water: ['#8fc0d8', '#3f72c0'], stone: ['#e2c08c', '#5a5a7a'], cloth: ['#4f77a0', '#34557e'],
};
// material: lookShade(THREE, { mode: 'dabs', lit: PAL.wheat[0], shade: PAL.wheat[1] })
```

Lamps (a doorway, a window, a lantern): `kit.material('light', { color: '#ffa23c', glow: 2 })` plus `kit.glow('#ffb45a', 0.06)`.

## Materials

`lookShade(THREE, { mode: 'dabs', lit, shade })` on everything. Dabs default to 16 mm; use `scale: 0.01` on small
things, 0.024 on the ground. Shapes stay big and simple - each subject a big shape that survives a brush: no fine
detail, no thin rails. Trees are a few lumpy spheres (`lookLumpy`), wheat is instanced thin cones.

## Motion: the steps

Each step is one stop in the scene where one thing visibly happens and sets off the next. Something that travels
(wind, a road, a river, a cart, a character) leads from stop to stop: move it along a `lookPath`. The stop's lamp or
subject brightens (`material.uniforms.uGlow.value`) while its step is on. Motion is gentle and continuous: sails turn,
wheat bends in a wave (rotate instanced stalks by a sine of x minus time), smoke rises.

## Words

One short caption per step, as the panel's status line. `kit.card` tags on 2 to 4 stops.

## Helpers

`lookShade` (dabs), `lookLumpy`, `lookPath`, `lookSeg`.

## Avoid

`kit.material` textures (they fight the dabs), thin detailed parts, a cold palette, everything lit evenly.
