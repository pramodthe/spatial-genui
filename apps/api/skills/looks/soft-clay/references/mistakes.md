# Mistakes seen in generated clay lessons

Each of these happened in a real generated lesson. Check yours against them before you finish.

1. **A model with a caption.** The scene showed the topic (a seesaw, a cake) and the panel explained the idea in
   words. The learner had nothing to do that changed the quantity. Fix: put the quantity in the scene (stack heights,
   arrows, clay numbers) and let the hands change it (references/teaching.md).

2. **Flat things standing up.** Cake halves extruded in the XY plane stood on their edges like walls. `kit.extrude`
   and plain shapes stand up; a cake, a coin, a pizza or a puddle lies flat. Use `look.wedge` / `look.coin` (they lie
   flat already) or rotate an extrusion `rotation.x = -Math.PI / 2`.

3. **The whole scene grabbable.** The board or the whole tabletop was given `grab: true`, so a pinch anywhere carried
   everything off the desk. Grab the pieces the lesson is about; the board is never grabbable.

4. **A grabbable inside a grabbable.** A coin on a grabbable stack, both grabbable: every pinch went to the coin and
   the stack could never be picked up. Either the stack moves (and its coins are pressed) or the coins move.

5. **Smooth, perfect geometry.** Spheres and boxes in plain materials read as plastic toys, not clay. Every clay
   object goes through `look.clay` (lumpy) and `look.mat` (waxy, streaked, fingerprinted).

6. **Too many colours.** Eight or more colours made a mess. Use 3 to 5 colours from the box; give each meaning
   (coral = the learner's coins, yellow = interest).

7. **Long sentences in big numbers.** The panel's `stat` showed a sentence. A stat is a short number with a unit
   ("24 coins"); sentences go in `text` items.

8. **Tags floating away, or piled on the scene.** Name tags sat in the air at the edge of the scene, or six tags
   crowded a row of stacks and covered them. Use 2 to 4 tags, each right beside the part it names and clear of the
   others; name the rest on the panel.

9. **The lesson starts small.** The first frame showed one coin; the host sized the lesson for one coin and the full
   stack later towered over the desk. Show the full extent in step 0, then reset and build up.
