# Mistakes to avoid in circuit lessons

The first five happened in real generated lessons in other looks and apply here unchanged; the rest are the ways a
circuit board goes wrong. Check yours against them before you finish.

1. **A diagram with a caption.** The board showed labelled chips and the panel told the journey in words. The learner
   had nothing to do that moved the data. Fix: the learner sends the pulse (presses the next stop), carries the token,
   or changes a setting and runs the trip again (references/teaching.md).

2. **The whole board grabbable.** The board or the subject group was given `grab: true`, so a pinch anywhere carried
   the city off the desk. The board is never grabbable; landmarks are pressed; only the slow data token is grabbed.

3. **A grabbable inside a grabbable.** A token parked inside a grabbable chip: every pinch went to one of them and the
   other could never be picked up. Landmarks are pressable, not grabbable.

4. **Long sentences in big numbers.** The panel's `stat` showed a sentence. A stat is a short number with a unit
   ("32.7 ms"); sentences go in `text` items.

5. **The lesson starts small.** The first frame showed one chip and the host sized the lesson for it. Show the whole
   journey working in step 0 (every stop, every track, the trip looping), then go back and run it stage by stage.

6. **A flat green plane with plain boxes.** Green box, black boxes, no pins, no tracks, no silkscreen: it reads as a
   toy, not a board. Build with the builders (pins, pads, outlines, dies, cans), join the stops with gold tracks, and
   fill the empty board with towers and small parts (`look.scatter`).

7. **Every part the same size.** Five equal squares in a row read as a bar chart. The processor is the biggest
   building, memory is a row, ports sit on the edge, towers stand tall, small parts are houses.

8. **A pulse that jumps.** The pulse vanished at one chip and appeared at the next, or teleported from the left edge
   of a chip to its right edge. It travels the track at desk speed (`pulse.follow(path, u)`), each leg runs from stop
   centre to stop centre, and the next leg starts where the last one ended.

9. **A pulse that carries nothing.** A light ran along the tracks but nothing said what it carried, so every stop
   looked the same. Put a token above it whose label and colour change at each stage (`look.token`, `show(i)`).

10. **The order is not enforced.** Any landmark could be pressed at any time and the pulse jumped straight there. A
    pressed stop the pulse cannot reach yet says "it goes through X first"; a passed stop says it has been passed.

11. **Tags crowding the board.** A `kit.card` tag on every chip covered the city. Names are printed silkscreen on the
    board (`look.label`), in front of each landmark; use at most one or two `kit.card` tags, and only for something
    that must be read from far away.

12. **Silkscreen as filled slabs.** White rectangles under or round the parts, or white blocks as labels. Silkscreen is
    thin lines: outlines (`look.outline`, built into every chip) and stroke letters (`look.label`).

13. **Smooth or shiny own materials.** A `MeshStandardMaterial` in bright blue or a chrome box on the board. Use
    `look.M` and the builders; the only light comes from the signal (pulse, token, wake, LEDs).

14. **Tracks with curves or right angles everywhere.** A `kit.tube` curving between chips, or square zigzags. Real
    boards route straight with 45-degree bends (`look.route`), flat on the board.

15. **Everything awake at once.** All landmarks glowing from the start, so arrival meant nothing. Stops are dark until
    the pulse reaches them, wake on arrival, and stay faintly awake behind it; travelled tracks stay faintly lit.
