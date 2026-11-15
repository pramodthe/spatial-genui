# Pencil sketch

Start: `node /skills/common/styles/scripts/new-lesson.mjs pencil-sketch /work/module.js`. Module: `assets/styles/pencil-sketch.js`. Film source: `assets/film/styles/pencil-sketch.js`.

A real 3D model that reads as a graphite drawing in a designer's sketchbook: shading in hatching and cross-hatching
that follows the light, graphite outlines, one red accent. Good for how something is built step by step, the anatomy
of an object, plans and exploded views.

## Set

An open sketchbook page as the stand: `kit.roundedBox(0.42, 0.006, 0.3, 0.002)` in
`lookShade(THREE, { mode: 'cel', lit: '#f2ede0', shade: '#e4dccb', band: 0.2 })` (paper that barely shades), with a
spiral of small rings along the back edge (`kit.instances` of a `TorusGeometry`, `kit.material('steel')`). Faint
construction lines on the page: a few thin flat strips (0.0008 m wide) in `kit.material('plastic', { color:
'#c9c2b2', wear: 0 })` - the footprint of the model and its centre lines.

## Palette

Paper `#f2ede0`, graphite `#33343a`, red pencil `#cf472b`, red marker wash `#e8967a`. Nothing else.

## Materials

Every part of the model: `lookShade(THREE, { mode: 'hatch', lit: '#f2ede0', ink: '#33343a' })` - lit faces stay bare
paper, darker faces get one, two, three layers of hatching in new directions. Outline every part with
`lookOutline(THREE, mesh, { width: 0.0012, color: '#33343a' })`. The one part that matters this step:
`lookShade(THREE, { mode: 'hatch', lit: '#e8967a', ink: '#33343a' })` (the marker wash) with the same outline.
Hatch spacing defaults to 6 mm; use `scale: 0.004` for small parts, 0.008 for large flat ones.

Make one hatch material for the model and one wash material; switch a part's material to the wash when its step comes.

## Motion: the steps

The drawing makes itself, part by part, in build order:

1. **Setting out**: the construction lines and footprint appear (scale the strips from 0 along their length).
2. **Each step draws its parts**: they appear in place, rising 0.01 m into position (`lookBack`), turning to the wash
   while they are the step's part, then back to graphite.
3. A **numbered red note** per part: a `kit.card` with the number, and a red leader line (`kit.tube`, radius
   0.0006, `kit.material('plastic', { color: '#cf472b', wear: 0 })`).

No smooth spinning of the whole model: the learner walks round it. A slow turntable is fine on the final step.

## Words

Numbered notes as `kit.card` tags in a column beside the model (the model sits left of centre on the page, notes on
the right). Hand-lettered titles are not possible: the panel carries the words.

## Helpers

`lookShade` (hatch and cel), `lookOutline`, `lookSeg`, `lookBack`.

## Avoid

Lit materials (`kit.material`) on the model - they break the drawing; colour beyond the one red; hatching scale so fine
it turns grey.
