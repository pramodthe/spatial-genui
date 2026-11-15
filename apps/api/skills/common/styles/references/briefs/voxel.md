# Voxel

Start: `node /skills/common/styles/scripts/new-lesson.mjs voxel /work/module.js`. Module: `assets/styles/voxel.js`. Film source: `assets/film/styles/voxel.js`.

Everything built from small cubes, like a hand-made voxel model on a display base: a short palette, every cube a
shade apart from its neighbours, tiny bevels that catch the light, and the step's word spelled in cubes on the front
of the base. Good for a small model that builds up in stages: how something grows, is made or is put together.

## Set

A smooth off-white plinth: `kit.roundedBox(w, 0.03, d, 0.006)` in `kit.material('plastic', { color: '#f6f1e7',
roughness: 0.45, wear: 0 })`, top at y = 0.03, about as wide as the model. The model's ground (grass, soil, water) is
the top layers of cubes. The word sits on the front face of the plinth, one cube deep.

## Palette

A short, deliberate palette; every cube takes one name and `lookVoxels` nudges it lighter or darker:

```js
const PAL = {
  grass: '#86b84f', grassB: '#74a945', soilA: '#8a5a38', soilB: '#74482c', stone: '#a9a297',
  wood: '#d3a468', woodDark: '#9c6f42', leaf: '#3f8f3d', leafLight: '#72b947', stem: '#5c9a3a',
  red: '#e5352b', orange: '#f2952f', yellow: '#ffd94a', cloud: '#ffffff', water: '#3fa0ee',
  metal: '#b9c0c4', pink: '#f39ab0', letter: '#2f7a37',
};
```

Add colours by name for the subject; keep the whole lesson under about 16. The word must contrast with the plinth:
the plinth is off-white, so letters are a dark colour (dark green `#2f7a37`, soil brown, navy), never cream or white.

## Cubes

- A model is a list of cells `[x, y, z, 'name']` on a whole-number grid (x right, y up, z toward the learner).
  Generate them with loops and simple shape rules (a sphere: `x*x + y*y + z*z <= r*r`; a column; a layer), not by
  hand.
- `lookVoxels(THREE, kit, cells, { size, palette: PAL })` makes one InstancedMesh (one draw call, 44 triangles a
  cube; hidden cubes are left out). Choose `size` so the model is 0.25 to 0.35 m across: a 30-cube-wide model at
  `size: 0.01`. Up to about 3,000 visible cubes.
- One mesh per thing that moves on its own (a plant, a cloud, the word): each is a `lookVoxels` call.
- Words: `lookVoxelWord('SPROUT', 'letter')` gives cells 3 x 5 per letter; make them a separate `lookVoxels` at a
  smaller size, on the plinth's front face.

## Motion: the steps

The cubes do the animating. Things drop in column by column, grow layer by layer, pop and get knocked off, each cube
with a small bounce on arrival. Nothing slides or fades. Animate per instance from `mesh.userData.cells`: for each
cube, compute its arrival time from its layer (`y`) or column, then
`m.makeTranslation(x * s, y * s + s / 2 + drop * (1 - lookBounce(k)), z * s)` and `mesh.setMatrixAt(index, m)`, and
set `mesh.instanceMatrix.needsUpdate = true` (reuse one `Matrix4` made in build; no allocation in update). A cube not
yet arrived: scale it to 0 in its matrix. Each step builds the next stage; its word replaces the last.

## Helpers

`lookVoxels`, `lookVoxelWord`, `lookCube`, `lookBounce`, `lookSeg`, `lookHash3`.

## Avoid

Spheres, cylinders or smooth parts mixed in (everything is cubes, except the plinth); cubes so small the model turns
to noise; one flat colour per surface.
