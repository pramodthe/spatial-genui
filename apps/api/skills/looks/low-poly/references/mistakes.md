# Mistakes in low-poly lessons

Items 1, 2, 11 and 12 were seen in generated lessons of other looks; the rest are the ways a faceted landscape goes
wrong. Check yours against them before you finish.

1. **A diorama with a caption.** The island showed the place (a mill, a river, a town) and the panel explained the
   process in words. The learner had nothing to do that changed an amount. Fix: put the amount in the landscape
   (piles, levels, counts) and let the hands change it: drop the crate, move the sun, open the gate
   (references/teaching.md).

2. **The whole island grabbable.** The set, the terrain or the whole subject was given `grab: true`, so a pinch
   anywhere carried everything off the desk. Grab only the slow pieces the learner places; the island is never
   grabbable.

3. **A grabbable traveller.** The truck, the boat or a droplet that moves along the route was grabbable, so it
   escaped the hand or was carried off its path. Travellers are never grabbable; press a flag or a building to send
   them.

4. **Smooth, high-segment geometry.** Spheres with 32 segments and cylinders with 24 sides read as plastic toys,
   not cut paper. 5 to 8 sides on cones and cylinders, detail 0 or 1 on icosahedra, and everything through
   `look.facet` or a builder so each triangle gets its own tone.

5. **Gradients, textures and own materials.** A `kit.material`, a texture or a new `MeshStandardMaterial` makes one
   piece smooth or patterned among flat facets. Colour comes per triangle from the palette, never from a gradient
   or a map; only water is glossy.

6. **Colours outside the palette.** A bright red roof or a pure blue lake broke the calm of the world. Use palette
   names only (the builders refuse anything else), 4 to 6 of them in a lesson, each with one meaning.

7. **Flat, empty ground.** The island was a bare green plate with three objects on it, which reads as a board, not a
   place. Frame the stages with a mountain or woods at the back, a river or road between them, a few rocks and trees
   in the gaps, keeping the front clear for the hands.

8. **The traveller jumps.** The droplet or truck appeared at the next stage instead of travelling there, so the
   route never showed how the stages connect. Move it along a `lookPath` with `look.follow` at desk speed (5 to 8 cm
   a second), and let the next stage react when it arrives.

9. **Tags crowding the island.** Eight tags named every tree and house and covered the stages. Use 3 to 5 tags,
   one per stage, just above its flag; name everything else on the panel.

10. **Flags out of reach or in the way.** Flags stood at the back behind the mountain, or in front of the building
    they belong to and hid it. Put each flag in the front half of the island (z > -0.1), beside its stage.

11. **Long sentences in big numbers.** The panel's `stat` held a sentence. A stat is a short number with a unit
    ("45 kg"); sentences go in `text` items.

12. **The lesson starts empty.** The first frame showed an empty field and no piles; the host sized the lesson for
    that, and a cloud or tower added later poked out of the fit. Show the whole process done in step 0 (full piles,
    full count, every stage built), then reset and run it.

13. **Water that stands still.** The sea and river were frozen because `look.update(time)` was never called in
    update. Call it every frame.
