# Circuit city

Start: `node /skills/common/styles/scripts/new-lesson.mjs circuit-city /work/module.js`. Module: `assets/styles/circuit-city.js`. Film source: `assets/film/styles/circuit-city.js`.

A real circuit board seen as a city at night: matte black chips are the buildings, aluminium capacitors the towers,
gold tracks the streets, white silkscreen marks each district, and a pulse of warm light races along the tracks
waking each landmark. Good for journeys and pipelines: something travels through a system and each stage does its
part.

## Set

The board is the stand: `kit.roundedBox(0.42, 0.006, 0.3, 0.004)` in deep green solder mask,
`kit.material('paintedMetal', { color: '#0f4a2e', roughness: 0.42, wear: 0.05 })`, with gold pads round its edge and
mounting holes at the corners (brass rings). Everything else stands on it.

## Palette and materials

```js
const M = {
  mask: kit.material('paintedMetal', { color: '#0f4a2e', roughness: 0.42, wear: 0.05 }),
  gold: kit.material('gold', { color: '#d9a546', roughness: 0.36 }),
  tin: kit.material('metal', { color: '#b9bdc3', roughness: 0.34 }),
  alu: kit.material('brushedMetal', { color: '#c3c7cc' }),
  epoxy: kit.material('plastic', { color: '#141416', roughness: 0.7, wear: 0.05 }),
  silk: kit.material('plastic', { color: '#f2f2ea', roughness: 0.8, wear: 0 }),
  signal: kit.material('light', { color: '#ffb44a', glow: 2.5 }),
  led: kit.material('light', { color: '#7cff6a', glow: 2 }),
};
```

Night is not possible in a lit room, so the signal is the light: glowing tracks, glowing chip undersides, LEDs.

## Landmarks

Each stage of the journey is one landmark component, each a different shape so they read apart:

- **A big chip** (the processor, the main stage): a flat black square (`kit.roundedBox`, 0.08 x 0.012 x 0.08) on a
  tin heat-spreader, pins on all four sides (`kit.instances` of thin tin boxes), a grid of small dies on top that
  light in a diagonal wave.
- **Memory chips**: long black rectangles in a row, gull-wing pins on two sides.
- **Capacitors as towers**: `kit.lathe` aluminium cans with a scored cross on the top, on a black base.
- **Small parts as houses**: resistors and caps as tiny rounded boxes, tan and black (`kit.instances`).
- **Ports and connectors** at the board edge: where the journey enters and leaves.

Tracks are the streets: flat thin strips (`kit.roundedBox(len, 0.0008, 0.003)`) in `gold`, running with 45-degree
bends between landmarks; vias as small tin rings. Silkscreen: thin white outline strips round each landmark
(`silk`), plus its name on a `kit.card`.

## Motion: the steps

A pulse travels the tracks from stop to stop: a `kit.glow('#ffb44a', 0.03)` moved along a `lookPath` through the
track's corner points, with a short trail (3 smaller glows a few mm behind). As it arrives, the landmark wakes: its
glow material brightens, its dies light up, an LED blinks. One step per landmark; the pulse waits at each until
`Next`. Track segments already travelled stay faintly lit (swap their material to a dim `kit.material('light', {
color: '#d9a546', glow: 0.6 })`).

## Words

Each landmark's name on a `kit.card` (PROMPT, MEMORY, PROCESSOR, ANSWER); sentences on the panel.

## Helpers

`lookPath`, `lookSeg`, `lookBack`.

## Avoid

A flat green plane with boxes on it and no pins, tracks or silkscreen; every part the same size; a pulse that jumps
instead of travelling.
