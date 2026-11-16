# Mistakes to check for in painted lessons

The first ones happened in generated lessons in every look; the rest are what goes wrong with paint. Check yours
against them before you finish.

1. **A painting with a caption.** The scene showed the place (a farm, a mill) and the panel told the process in
   words. Nothing changed at a stop and nothing travelled. Fix: each stop does one visible thing to the stuff the
   traveller carries (the sack fills, the heap shrinks, loaves appear), and the hands carry it on
   (references/teaching.md).

2. **Crude shapes nobody can name.** A mill that was a grey cylinder, a "sheep" that was a white ball, a bakery that
   was a box. Make each subject one big recognisable silhouette: a tower with a cap and four broad sails, a body with
   a dark head and legs, a house with a pitched roof, a door and a lit window. Use the builders; they are drawn to
   read at desk size.

3. **Thin detail the dabs cannot carry.** Fences of 1 mm rails, lattice sails, spokes, fingers, tools in hands. The
   brush dabs are 6 to 16 mm: anything thinner than about 4 mm turns into a flat smear or vanishes. Make it bigger
   and simpler, or leave it out.

4. **Plain or textured materials on the painting.** A `kit.material('wood')`, a brick texture or a shiny metal next
   to the dabs looked pasted in, and lit materials of your own come out dark on the headset, which has no lamps in
   the scene. Paint every part with `look.paint` / `look.mat`; only lamps glow (`look.lamp`).

5. **A cold palette, or everything lit evenly.** A grey-blue scene, or every lamp on at once, has no golden hour and
   no place for the eye to go. Keep the paints' warm lit / cool shadow pairs, put the sun low at the back left, and
   light only the stop the story is at (the next one glows softly).

6. **Too many stops crowding the ground.** Six stops, each with a house and a tree, filled the 0.4 m ground; the
   track was hidden and the lamps were too close to tell apart. Use 3 or 4 stops, at least 8 cm apart, along one
   track that runs left to right through the front half; scenery stays at the back.

7. **The traveller teleports.** The sack vanished at the mill and reappeared at the bakery. The cause has to be seen
   to travel: carry it by hand, or walk it along `path.userData.route` slowly.

8. **The whole scene grabbable, or a grabbable inside a grabbable.** The ground or a whole farm group was given
   `grab: true`, or a sack on a grabbable cart was grabbable too. Grab the traveller; press the stops; the ground is
   never a target.

9. **Small hand targets.** A 1.4 cm lantern was the only thing to press at a stop, a 2 cm loaf the thing to carry.
   Press the stop's big subject (the house, the mill, the field, a bench); make the traveller at least 3 cm across
   (give a basket a handle, a sack a fat body).

10. **The lesson starts small.** The first frame showed the empty field; the host sized the lesson for it and later
   things towered over the desk. Show the finished story in step 0 (every stop's result there, every lamp lit), then
   reset and walk it.

11. **Numbers that disagree.** The panel said 4 jumpers while three were on the line. Compute the heap, the counted
   things and the panel's number from one state.

12. **Long sentences in the scene.** A signboard held a paragraph. A caption is 2 to 6 words with its number;
   sentences go on the panel; a stat is a number with a unit ("2 kg").
