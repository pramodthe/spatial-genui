# Low-poly

Start: `node /skills/common/styles/scripts/new-lesson.mjs low-poly /work/module.js`. Module: `assets/styles/low-poly.js`. Film source: `assets/film/styles/low-poly.js`.

A miniature world of flat, faceted shapes, like folded paper or cut stone: every triangle is one tone and neighbours
differ slightly, in sand, coral and cream against teal water and sage greens. Good for processes that happen in a
place: cycles, journeys, supply chains, how a system of parts feeds itself.

## Set

The world is a faceted island or landscape tile, 0.36 to 0.44 m across: a low `THREE.CylinderGeometry(r, r * 0.92,
0.03, 9, 1)` (few sides) run through `lookFacets` with jitter, with the land and sea shapes on top. Its sides show
the layers (sand over soil) as a second, slightly smaller cylinder.

## Palette

Nothing in the scene uses a colour that is not in here:

```js
const PAL = {
  seaDeep: '#1f6a80', sea: '#2e8f9c', seaShallow: '#63bfb4', foam: '#e6f5ea', river: '#59b9cc',
  sand: '#ecd3a0', bed: '#c9b99a', grass: '#a5bf66', meadow: '#86ad5c', forest: '#5d9160', pine: '#3f7d62',
  leaf: '#74a857', ochre: '#e0a646', rock: '#a3929b', rockDark: '#857a8c', snow: '#fffbf4', trunk: '#7d5e4e',
  cloud: '#fff8ef', cloudBase: '#c8c4dc', paper: '#fff6e4', ink: '#22303c', accent: '#e9684a', sun: '#ffcf99',
};
```

## Shapes and materials

- Every piece: `lookFacets(THREE, geometry, PAL.x, { jitter, seed })` with one shared `lookFacetMaterial(THREE)`
  (water: a second one, `lookFacetMaterial(THREE, 0.35)`). Use few segments: mountains are `ConeGeometry(r, h, 6, 2)`,
  hills `IcosahedronGeometry(r, 1)` flattened, trees a cone on a thin cylinder, clouds 3 to 5 icosahedra (detail 0),
  rocks `DodecahedronGeometry`. jitter 0.002 to 0.006 m keeps them irregular.
- Colour per triangle from the palette, never gradients; each piece one family colour, nudged per facet.
- Merge static scenery by material (`kit.merge`) to save draw calls.

## Motion: the steps

Each step is a stage at one spot in the landscape, marked by a small paper flag (a `kit.extrude` triangle in
`paper`, outlined `ink`, on a thin pole) with its number. Things grow by unfolding (scale up from one point with
`lookBack`) or pop out of the ground with a bounce; water heaves (move the sea's vertices up and down a few mm by a
sine of position and time - keep the original positions in a Float32Array made in build); clouds drift; cut-gem
droplets (`OctahedronGeometry`) rise and fall along a `lookPath`. Something travels the route between stages (a
droplet, a boat, a truck), and the current stage's flag rises and glows.

## Words

Stage names on `kit.card` tags at the flags (3 to 5); sentences on the panel.

## Helpers

`lookFacets`, `lookFacetMaterial`, `lookPath`, `lookBack`, `lookSeg`, `lookBounce`.

## Avoid

Smooth, high-segment geometry; textures; colours outside the palette; one huge flat-coloured plane.
