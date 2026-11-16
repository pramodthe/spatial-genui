# Mistakes to avoid in voxel lessons

Each of these spoils a generated lesson, in the voxel look or in the other looks the app has. Check yours against
them before you finish.

1. **A model with a caption.** The scene showed the topic (a cube plant, a cube house) and the panel explained the
   idea in words. The learner had nothing to do that changed the quantity. Fix: decide what one cube stands for, count
   it in the scene (`look.counter`, a cube ruler, the layers themselves) and let the hands add to it
   (references/teaching.md).

2. **Smooth parts mixed in.** A cylinder stem, a sphere sun, a `kit.tube` pipe or a glossy kit material on one part
   next to cube models: the eye reads it as a mistake, not a style. Everything except the plinth is cubes; round
   things are `look.ball` and `look.disc`, pipes and ropes `look.line`, arrows `look.arrow`.

3. **Cubes so small it turns to noise.** At 4 mm a cube and 80 cubes across, the model reads as gravel and costs too
   many triangles. Keep the model 10 to 40 cubes across (0.01 to 0.014 m a cube); a detail is one cube (an eye, a seed,
   a window), and a part the hand picks is at least 3 cubes across.

4. **Flat single-colour surfaces.** A whole wall, field or leaf in one colour looks flood-filled. Give every surface 2
   or 3 shades by a rule (bands by height, a hash speckle, a course pattern) with a colour function in the cells;
   `lookVoxels` then nudges each cube a little lighter or darker.

5. **Too many colours.** Ten hues made a mess. Use 3 to 5 colour families, each in 2 or 3 shades, and give each a
   meaning (sand = stone blocks, ink = numbers and words, water = what flows).

6. **One InstancedMesh for things the hand must pick separately.** The whole plant or all five layers were one
   `look.model`, so the learner could not pick the flower or a single layer, and nothing could move on its own. Each
   piece the hand picks up or presses, and each thing that moves on its own, is its own `look.model`.

7. **The whole scene grabbable.** The plinth, the ground or the subject group was given `grab: true`, so a pinch
   anywhere carried everything off the desk. Grab the pieces the lesson is about; the plinth and the ground never.

8. **A grabbable inside a grabbable.** A flower made grabbable inside a grabbable plant: every pinch went to the
   flower and the plant could never be picked up. Either the model moves (and its parts are pressed) or its parts move.

9. **The word unreadable on the plinth.** White or cream letters on the off-white plinth disappear, and a 14-letter
   word runs off its front. Letters are dark (`'letter'`, `'ink'`, `'soilC'`), the word is one short word per step
   (up to about 10 letters), and sentences go on the panel.

10. **Growing by scaling.** A stem stretched with `scale.y`, a pile that swells, a word that fades in: cubes stretched
    into bars and faded cubes break the look. A thing that grows gets more cubes, dropped in by `look.stages`; a flow
    hops cell to cell (`look.flow`).

11. **Long sentences in big numbers.** The panel's `stat` showed a sentence. A stat is a short number with a unit
    ("121 blocks"); sentences go in `text` items.

12. **Tags floating away, or piled on the scene.** Name tags sat in the air at the edge of the scene, or six tags
    crowded the model. Use 2 to 4 tags, each right beside the part it names and clear of the others; name the rest on
    the panel.

13. **The lesson starts small.** The first frame showed one seed cube; the host sized the lesson for it and the grown
    plant later towered over the desk. Show the full extent in step 0 (`b.go(last, true)`), then go back and build up.
