# Hands

The learner uses only their hands: a pinch at the fingertips picks up what is grabbable, a poke or a pointed pinch
presses what is pressable (`traits(object, { grab, onPress })`, after the object is in `root`). A beautiful lesson
the hands cannot use has failed. Every look follows these rules:

- **Hands-on from the first second.** The learner can grab or press something on the model itself in step 0, and
  every step has a hand action on the model that moves the lesson on or shows the idea (pull the part out, turn the
  wheel, drop the coin, press the stop). Panel buttons are the second way in, never the only one.
- **Grab the pieces, not the scene.** Make grabbable the things the lesson is about: a wedge, a part from the
  exploded row, a lever, a coin, a card, the seed. Never the set, the board, the island, the book or the whole scene
  (a pinch anywhere would carry everything off the desk). A single object lesson may make the object grabbable to
  turn it in the hand, and then its parts are pressable (a press on a part of a grabbable model reaches that part).
- **Reachable and hittable.** Interactive things are at least 0.03 m in every direction a hand meets them (a 1 mm
  card or a 2 mm wire cannot be pinched: give it a thicker tab or handle, or press a bigger thing next to it), in the
  front half of the desk (z > -0.1) and no higher than 0.35 m. A near pinch has to touch the object.
- **No grabbable inside a grabbable.** When a whole model is grabbable (to turn it in the hand), its parts are only
  pressable. A grabbable part inside a grabbable model takes every pinch aimed at the model, so the model can never
  be picked up (seen: a honeycomb frame whose lift-out patch was grabbable). Either the model is grabbable and its
  parts pressable, or the model stays put and its parts are grabbable.
- **Apart, or one whole.** Separate grabbables stand at least 4 cm apart. Parts of one whole that touch (slices, a
  row of parts) stay grabbable; the host then picks them with a pointing ray instead.
- **Still while it can be held.** A grabbable object moves slower than 0.05 m/s and stops while `isGrabbed(obj)`.
  Things that travel (a pulse, a truck, a droplet, a moving cart) or snap on twos (`lookTwos`) are never grabbable;
  press a slower thing to start them.
- **A grab means something.** When a part is let go (it was held last frame, `isGrabbed` is now false), check where
  it is: near its seat (within about 3 cm) it slides home and the lesson reacts (the panel counts it, the step moves
  on); somewhere else it stays where it was put, or slides back to its seat after a moment. Keep its seat position
  from build. A part that is put back in place is the strongest feedback a lesson can give.
- **Feedback in the same frame.** Every press or grab changes something at once: the part glows
  (`uniforms.uGlow.value` on look shaders, `emissiveIntensity` on kit materials), lifts, clicks into place, or the panel
  changes. Hover glow is added by the host; do not build your own.
- **One object per hand target.** Give `traits` the group or mesh the learner aims at. Voxel models are one
  InstancedMesh: anything the learner should pick up or press is its own `lookVoxels` mesh (a cube cluster at least
  3 cubes across). Outlines from `lookOutline` never catch a pinch; that is on purpose.
- **Check it.** `scripts/check-lesson.mjs` runs the dry run, which prints `grabbables`, `pressables` and `crowdedGrabPairs`: a lesson needs at least one
  grabbable or pressable besides the panel, and `crowdedGrabPairs` 0 unless the parts are one whole.

By look: exploded view grabs each part of the row and seats it back; pop-up grabs the pull tab (a thick tab, 3 cm
wide) and presses the page corner to turn; pencil, ink and painted press or grab the step's part; clay grabs the
pieces and piles; voxel grabs whole cube clusters; low-poly and circuit city press the stops (flags, landmarks) and
grab only a slow piece the learner places.


## The pattern (assets/starter.js does this already)

```js
traits(part, { grab: true });
const seat = lookSeat(THREE, part, isGrabbed, {
  onHome() { panel.set('state', 'Back in place', 'good'); },
  onAway() { panel.set('state', 'Out: put it back', 'neutral'); },
});
traits(stop, { onPress() { goToStep(2); } });
// in update(time, delta): seat.update(delta);
```

The panel: the host scales the 3D so its largest size is 0.5 m and the panel's position scales with it. Put it at
`x = 1.06 x` the model's largest size (and clear of its right edge), `y = 0.6 x` that size, as the starter does; a
fixed x drifts out of reach on a small model.
