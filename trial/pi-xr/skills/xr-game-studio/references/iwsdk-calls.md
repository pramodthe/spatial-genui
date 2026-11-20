# The IWSDK calls a game here uses

Taken from a game that ran on a Quest and checked against this project's IWSDK (1.1.0-rc.2). Everything imports from `@iwsdk/core`. Look further (IWSDK's skills, `node_modules/@iwsdk/*/dist/*.d.ts`) only for what is not here.

## Hands: components in the scene, tags in code

Name the components on a node's `components` in `public/scenes/main.iwsdk.scene.json`; code reads the tags IWSDK adds and removes.

- Grab: `OneHandGrabbable` on the thing. While it is held it has the `Grabbed` tag.
- Press: `PokeInteractable` and `RayInteractable` on the button. While it is pressed it has the `Pressed` tag.
- A UIKitML panel the player presses: `RayInteractable` (and `PokeInteractable`) on the panel node; the element's `click` listener runs.

```ts
export class GameSystem extends createSystem({
  held: { required: [Block, Grabbed] },
  pressed: { required: [GameButton, Pressed] },
}) {
  init(): void {
    this.queries.held.subscribe('disqualify', (entity) => this.letGo(entity)); // the hand opened
    this.queries.pressed.subscribe('qualify', (entity) => this.press(entity));
  }
}
```

## Scene objects and panels

- `this.world.getSceneObject<UIKitMLAsset>('game-panel')` finds a scene node by its **id**, not its name; `requireSceneObject(id)` throws when it is missing.
- Panel text: `panel?.getElementById('goal')?.setProperties({ text: 'Put the heavy block on' })`.
- Hide or show an element: `setProperties({ display: 'none' })` or `{ display: 'flex' }`. Hide a 3D thing: `entity.object3D.visible = false`.
- A UIKitML button: `panel.getElementById('start')?.addEventListener('click', start)`, and push its remover to `this.cleanupFuncs`.

## Sounds

`AudioUtils.createOneShot(this.world, './audio/library/block-snap.mp3', { volume: 0.8 })` plays once and removes itself.

## Shapes in a scene asset

```ts
const wood = createSceneMaterial({ id: 'wood', model: 'standard', baseColor: '#D9A25F', roughness: 0.8 });
const plank = createScenePrimitiveObject({ geometry: { type: 'box', size: [1.8, 0.06, 0.24] } }, wood);
```

Geometry: `box` (`size` [x, y, z]), `roundedBox` (`size`, `radius`), `sphere` (`radius`), `cylinder` (`radius`, `height`, or `radiusTop` and `radiusBottom`), `cone` (`radius`, `height`), `capsule` (`radius`, `length`), `plane` (`size` [x, y]), `torus` (`radius`, `tube`, `arcDeg`), `extrude` (`points`, `depth`), `lathe` (`profile`), `tube` (`points`, `radius`). The origin is the shape's centre.

## A generated texture on a shape

Copy it to `public/textures/`, register it in `src/assets.ts` (`'wood-grain': { url: publicAssetUrl('textures/wood-grain.png'), type: AssetType.Texture }`), and apply it in a system once the world is up. Build the URL from `import.meta.env.BASE_URL`: the game is served from a sub-folder.

```ts
new TextureLoader().load(`${import.meta.env.BASE_URL}textures/wood-grain.png`, (texture) => {
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(2, 1);
  const material = new MeshStandardMaterial({ map: texture, roughness: 0.75 });
  if (board instanceof Mesh) board.material = material;
});
```
