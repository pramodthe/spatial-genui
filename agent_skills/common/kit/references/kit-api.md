# Kit API

Sizes are metres. `root` is the desk: +Y up, +Z toward the user.

## Interaction

- `traits(object, { grab?: boolean, onPress?: () => void })` after the object is in `root`.
- `isGrabbed(object)` is true while that object is held. Do not animate a held object.

## Materials and textures

- `kit.material(preset, { color?, wear?, roughness?, metalness?, opacity?, glow?, colors?, map?, scale? })`
  Presets: plastic, glossy, rubber, paintedMetal, metal, brushedMetal, chrome, steel, iron, gold, copper, brass, rust, glass, wood, stone, rock, concrete, brick, sand, soil, grass, snow, ice, water, lava, fabric, leather, paper, ceramic, skin, tissue, leaf, bone, light.
- `kit.texture(kind, options)` for your own material's `map`. Kinds: noise, bands, cells, stripes, checker, gradient, bricks, wood. Pass `sphere: true` on balls.

Make each material once and reuse it.

## Shapes (each returns a geometry)

- `kit.roundedBox(width, height, depth, radius?)`
- `kit.extrude(outline, depth, { bevel?, holes? })` — outline `[[x, y], ...]`, thickness along z.
- `kit.lathe(profile, segments?)` — profile `[[radius, y], ...]`, spun around Y.
- `kit.tube(points, radius, { closed? })`
- `kit.gear({ teeth, radius, thickness, hole })` — axis along z. Mesh when `radius / teeth` matches and centres are `radius1 + radius2` apart.

## Many copies

- `kit.instances(geometry, material, placements)` — placements are `[[x, y, z], ...]` or `{ position, rotation, scale }`.
- `kit.along(geometry, material, points, { count, closed })`
- `kit.merge(group)` — one mesh per material. Children can no longer move on their own.

## Effects

- `kit.glow(color, size, { opacity })`
- `kit.particles({ count, radius | box, shell, color, size })`
- `kit.ring(inner, outer, { colors, gaps, opacity })` — flat in the XZ plane.
- `kit.arrow(points, { color, radius, glow })`
- `kit.shadow(radius, opacity)` — on the desk, y = 0.
- `kit.stand(radius, { accent, color, height })` — set the model to `stand.userData.top`.

## Name tags

- `kit.card(text, { width?, color? })` — plain ASCII, white text, facing +z. A few at most.

## Module shape

```js
export default function build({ THREE, kit, traits, ui, isGrabbed }) {
  const root = new THREE.Group();
  // ...
  return { root, update(time, delta) {} };
}
```

No imports, no network, no DOM, no timers, no eval, no `window` or `document`. Everything is created synchronously inside `build`. `update` must not allocate.
