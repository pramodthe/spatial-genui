# Mistakes to check in an ink-toon lesson

The first group happened in generated lessons in every look; the second is what breaks a comic cel on the headset.
Check yours against both before you finish.

## Any look

1. **A cartoon with a caption.** The scene showed the objects (a kettle, a cup) and the panel explained the recipe in
   words. The learner had nothing to do that changed the hero. Fix: one action per step done by the hand, and its
   result shown in the scene (a level, a needle, a crease, a lettered number) (references/teaching.md).

2. **Flat things standing up.** A sheet of paper, a puddle, a pizza or a coin built with `look.cutout` stood on its
   edge like a wall. Things that lie on the table take `{ flat: true }` (or `rotation.x = -Math.PI / 2`).

3. **The whole scene grabbable.** The sheet or the whole subject was given `grab: true`, so a pinch anywhere carried
   everything off the desk. Make the parts the action is done to pressable or grabbable; the sheet never.

4. **A grabbable inside a grabbable.** A lid on a grabbable kettle, both grabbable: every pinch went to the lid.
   Either the kettle moves (and the lid is pressed) or the lid moves.

5. **Too many colours.** Seven spot colours made a mess. Paper, ink and 4 or 5 colours; give each a meaning
   (persimmon = the hero, mustard = the push arrow, water = water).

6. **Long sentences in big numbers.** The panel's `stat` showed a sentence. A stat is a short number with a unit
   ("3.6 bar"); sentences go in `text` items.

7. **Tags floating away, or piled on the scene.** Name tags sat in the air at the edge of the scene, or five tags
   covered the hero. 2 or 3 tags, each right beside the part it names; the step word is not a tag.

8. **The lesson starts small.** The first frame showed an empty sheet and the props arrived later, so the host sized
   the lesson for the sheet and the kettle came in huge. Every prop is in the first frame at its size; hide only the
   effects.

## Toon

9. **Lit kit materials on drawn objects.** A cup in `kit.material('ceramic')` next to inked objects came out shaded,
   glossy and grey: the cel is broken. Every drawn thing is `look.ink` or a builder; for a new colour add it to the
   look's palette with a hand-picked shadow partner.

10. **Glass and water as transparent materials.** A see-through jug, a glass of water at opacity 0.4. A comic draws
    water as pale colour with an ink line and a hard glint: the `water` colours, `look.mark` glint, no opacity.

11. **More than one ink colour.** Brown lines on the bread, blue lines on the water. One ink (`look.INK`) for every
    line, crease, mark and letter edge; colour goes inside the line, never on it.

12. **Smooth easing instead of snap.** The kettle glided in on `time` with a smooth ease and looked like a 3D
    render. Drive props from `lookTwos(time)`; a move is two or three drawings that overshoot and settle
    (`lookBack(x, 2.2)`, `look.pop`); a hit squashes and wobbles.

13. **Outlines on every tiny part.** Sixty outlined beans, rivets and spokes blew the draw-call budget and the lines
    turned the parts into ink blobs. Outline the hero and the props; give small parts `outline: false`, or draw them
    in ink (spokes, needles) and `kit.merge` them.

14. **Props hidden under the hero.** A scale under the cup, beans inside the grinder, a hose behind the wheel: the
    learner never saw them. Put props beside the hero and in front of it, never under or behind; open what holds
    them (the lid off, the drawer out).

15. **Effects that stay.** Speed lines and impact ticks left on screen read as part of the object (spikes on the
    pump). An effect is drawn in for two or three drawings at the moment of the action, then hidden; only results
    stay.

16. **Words in the scene instead of on the panel.** Sentences lettered on cards covered the hero. One word per step,
    on its card, low at the front (`look.stepWord`); a number in the scene is a short value; sentences are on the
    panel.
