---
name: xr-3d-asset-pipeline
description: Create, prepare and integrate generated art in this IWSDK game - a 3D model (GLB) made from a generated picture, pictures used as textures and signs, and sounds from the library - with scale, pivot, triangle budget, registration in the asset manifest and a check in the running game.
---

# XR 3D Asset Pipeline

Use this skill for the art that ships in the game, not for scene structure or gameplay. Keep the scale, axes, names and palette the game already uses.

## What to generate, and what to build in code

- **Generate a 3D model** only for a thing whose shape a few boxes, cylinders, spheres and wedges cannot make: the beaver, the watering can, a tree. A block, a plank, a wedge, a ball or a table is built in code even when it is the main thing; give it a generated texture instead.
- **Generate a picture** for a texture on a 3D surface (ground, wall, table top) or a sign the game needs. Never a backdrop, poster or picture standing as scenery: in a headset it reads as a board, not a place.
- **Build in code** everything simple or changing: boxes, logs, water surfaces, markers, particles, gauges, anything whose shape the game animates.
- **Take sounds from the library** (`../xr-game-studio/references/sounds.md`).

Each picture and each model costs money and time (a picture takes seconds; a model one to ten minutes, the longest when the generator has to start), and the game has a budget for both: plan them from the design's asset list, generate each once, and leave what the game does not need unspent.

## A model from a picture

1. **Define it** in the design's asset list: what it does in the game, its real size in metres, whether hands grab it, and its triangle budget (about 20,000 for a thing held or seen close, 8,000 for scenery).
2. **Draw the source picture.** Add an image node to the canvas board, aspect ratio `1:1`, with a prompt for one whole object: "a single <object>, three-quarter view from slightly above, the whole object in frame with space around it, plain white background, soft even light, no shadow on the ground, no text", followed by the game's material language and palette. One object per picture; a model made from a scene or a cropped object is unusable.
3. **Make the model.** Add a `model-3d` node that names the image node, with `targetPolycount`, then `generate_canvas_media` with both node IDs (the model starts after its picture). Read the picture when it is done: if it is not one whole object on white, change the prompt and regenerate the picture before spending on the model.
4. **Put it in the game.** Copy the GLB from `assets/generated/` to `public/models/<name>.glb`. Register it in `src/assets.ts` as `{ url: publicAssetUrl('models/<name>.glb'), type: AssetType.GLTF, name: '<Runtime Name>' }`. Place it with a scene node whose content is that asset.
5. **Normalise it where it is placed.** A generated model is about 1 m across with its origin at its centre. Set the node's `scale` so it has the real size from the asset list, lift its `position` by half its scaled height so it stands on its surface, and turn it with `rotationDeg` so its front faces the player. Give the node the runtime name the hand sequences use, and its grab or press component if hands touch it.
6. **Check it in the running game**: typecheck, reload, enter XR, list the targets (its name and size are there), and take one screenshot to see that it is the right way up, the right size and not sunk into its surface.

## A picture as a texture or a sign

Generate it (`generate_image`, or an image node), copy it to `public/textures/<name>.png`, and register it in `src/assets.ts` as `{ url: publicAssetUrl('textures/<name>.png'), type: AssetType.Texture }`. A system applies it once the world is up: `AssetManager.getTexture('<id>')`, set as the `map` of the mesh's material (set the texture's `colorSpace` to `SRGBColorSpace`). Scene asset modules cannot load files, so build the mesh there with a plain colour and let the system give it the picture. Ask for a seamless, evenly lit surface for a texture ("top-down, tileable, no perspective, no shadows"). Files are at most 1024 pixels on the long side, which is enough for a headset.

## Keep it light

- A whole scene should stay under about 150,000 triangles: three generated models at 20,000 leave room for everything else.
- Reuse one material for parts built in code; do not make a material per mesh.
- Do not add collision shapes, level-of-detail copies or baked lighting for a small game.

## Validation

After the art is in, check the design's asset list against reality, one line each: the file exists under `public/`, `src/assets.ts` registers it, the scene or a system uses it, and it was seen (or heard) in the running game. An asset that fails any of these is not in the game: fix it, replace it with shapes built in code, or take it off the list and say so. Do not claim a model looks right from its file size or triangle count.
