# From a film to a desk

These looks come from short films. A lesson is different: the learner sits at the desk, moves their own head, and
reaches in. Translate, do not copy:

- **No camera move.** The learner's head is the camera. A film's beats become the lesson's **steps**: a `Next` (and
  `Back`) button on the panel, or a slow loop. Each step changes the scene in place: parts arrive, rise, open, grow.
  What the film did with focus and framing, do by moving the step's part forward and up, toward the learner, and by
  lighting it (`material.uniforms.uGlow.value` on look shaders, `kit.glow` or a brighter `kit.material` on the rest).
- **No lamps, no filters.** The module cannot add lights, and the headset has only a soft room light. Depth of field,
  bloom, vignette, grain and paper or canvas filters do not exist here. Drawn looks (ink, halftone, pencil, paint) use
  `lookShade`, which lights itself; material looks (clay, card, voxel, low-poly, metal) use real materials. Anything
  that should glow uses `glow` (`kit.material(preset, { glow })`, `kit.material('light')`, `kit.glow`).
- **The set is an object.** Paper, canvas, a book, a board, a plinth: the ground of the look is a real thing on the
  desk under the model: no wider than the subject, the subject on top and biggest. The set is never grabbable. No backdrops taller than the model: the real room is the background.
- **Words.** Sentences go on the panel (`kit.panel`). Part names are `kit.card` tags (2 to 5), each placed right beside the part it names (a
  few centimetres off its surface, or joined to it by a thin leader line), never out in the air at the edge of the scene. A look that letters
  words into the scene (voxel letters, clay letters) does it for one short word per step, low and in front, never
  covering the subject.
- **Start at full size.** The host fits the lesson to the desk by what it shows when it first appears. A model that
  grows, builds up or comes apart must show its full extent at step 0 (the finished plant, the assembled object with
  room for its exploded row), then go back and build it up. Otherwise the fit is made for a seed and the grown plant
  towers over the desk.
- **Motion at desk speed.** Slow enough to follow, looping or stepped. Stop-motion looks hold poses with `lookTwos`;
  arrivals overshoot and settle with `lookBack` or `lookBounce`. Grabbable objects stay still while held
  (`isGrabbed`).
- **Flat things lie flat.** `kit.extrude` (and `lookCard`) builds its outline standing up in the XY plane. A shape that
  lies on the table (a cake and its slices, a coin, a pizza, a puddle, a field, a track) must be turned down:
  `mesh.rotation.x = -Math.PI / 2`, then its thickness is its height. A pie slice is an outline of an arc from the
  centre; a whole cut into n equal pieces is n such slices, each turned by `2 * Math.PI / n` about y.
- **Budget.** Under 150 draw calls and 150,000 triangles, as always. An outline (`lookOutline`) is one more draw call
  per mesh: outline the subject's parts, merge static pieces first (`kit.merge`). A voxel model is one draw call
  (`lookVoxels`).
