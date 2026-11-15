# Ink and toon

Start: `node /skills/common/styles/scripts/new-lesson.mjs ink-toon /work/module.js`. Module: `assets/styles/ink-toon.js`. Film source: `assets/film/styles/ink-toon.js`.

Real 3D that reads as a hand-inked animation cel: flat colour in two tones, a brush line round every shape, halftone
dots where light turns to shadow, a hard white glint on glossy things, printed on warm paper. Good for steps, recipes
and how-tos with a few recognisable objects: each step is one bold action on the same hero object.

## Set

A sheet of warm paper as the table: `kit.roundedBox(0.44, 0.006, 0.32, 0.002)` in
`lookShade(THREE, { mode: 'cel', lit: '#f7ecd6', shade: '#e6d6b8', band: 0.2 })`, outlined with
`lookOutline(THREE, sheet, { width: 0.0025 })` so it reads as a ruled panel.

## Palette

Paper, one ink and four spot colours. Every colour has a hand-picked shadow partner, shifted in hue, not just darker:

```js
const INK = '#1c1622', PAPER = '#f7ecd6';
const PAL = {
  teal: { lit: '#2a9d94', shade: '#1c7376', deep: '#12565c' },
  cream: { lit: '#f7e8cc', shade: '#b3c9bd' },
  paper: { lit: '#fffdf6', shade: '#c9dcd4' },
  persimmon: { lit: '#ee5a36', shade: '#ae2f33', gloss: '#ffd2bd' },
  mustard: { lit: '#f6b63c', shade: '#c9722c', gloss: '#fff1c4' },
  navy: { lit: '#3b4568', shade: '#222641', gloss: '#b4c0e6' },
  bean: { lit: '#6a3d27', shade: '#3c221b' },
  water: { lit: '#effbf6', shade: '#9fd8cf' },
};
```

Pick 4 or 5 per lesson. For a new colour, choose its shadow by shifting the hue toward cool teal and darkening.

## Materials

- Most surfaces: `lookShade(THREE, { mode: 'cel', ...PAL.persimmon })` (gloss adds the hard glint on glossy things).
- The hero object's big curved surfaces: `mode: 'halftone'` with `deep` - dots where light turns to shadow.
- Outline the hero and the props: `lookOutline(THREE, mesh, { width: 0.002 })` (INK). Merge static props first.
- No textures, no metal or glass presets: a glass jug is `water` colours with an outline and a glint.

## Motion: the steps

Snap, not glide. Props are animated on twos: `const tq = lookTwos(time)` and drive props from `tq`; they jump between
held poses with an overshoot and a quick settle (`lookBack(x, 2.2)`). Each step is one bold action on the hero
object (grind, pour, fold, press). Effects drawn in for a moment: speed lines (3 thin outlined boxes behind a moving
part), impact ticks (short radial strips), steam squiggles (`kit.tube` along a sine, cream, outlined).

## Words

Each step is named by one big word - the panel's title (`GRIND`, `BLOOM`, `POUR`) - and a short caption sentence.
Name tags (`kit.card`) only on 2 or 3 props.

## Helpers

`lookShade` (cel, halftone), `lookOutline`, `lookTwos`, `lookBack`, `lookSeg`.

## Avoid

`kit.material` on the drawn objects (lit shading breaks the cel look), smooth easing on props, more than one ink
colour, outlines on every tiny part (draw calls).
