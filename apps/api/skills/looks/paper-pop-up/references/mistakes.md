# Mistakes to avoid in pop-up lessons

The first four go wrong in every look; the rest are how a pop-up book goes wrong. Check yours
against them before you finish.

1. **A picture book with a caption.** Each spread showed a stage and the panel explained it; nothing on the page
   changed under the hand. Fix: give every spread one change the learner makes - pull the tab and the legs grow, lift
   the flap and the eggs are there, turn the wheel to the next season (references/teaching.md).

2. **The whole book grabbable.** `traits(book, { grab: true })` let a pinch carry the book off the desk. The book is
   the set: grab the pull tab, press the flaps, wheels, corners and folds.

3. **Long sentences in the scene or in big numbers.** A whole sentence on a ribbon, or a stat that was a sentence. The
   ribbon has one short line (3 to 5 words); a stat is a number with a unit ("12 weeks"); sentences go in `text`.

4. **Tags piled on the spread.** Six tags covered the subject. Use 2 to 4 per spread, each riding the fold of the part
   it names (`wing.add(tag)`), right beside it.

5. **Thick blocks instead of card.** Boxes, spheres and cylinders stood on the page; it read as toys on a book, not a
   pop-up. Everything is a flat outline cut by `look.card` (1.5 mm); depth comes from layers on folds, never from
   solid shapes.

6. **Textures pretending to be print.** Stripes, spots, windows and faces were faked with textures or with own
   materials. Print detail as smaller cards one thickness in front (`card.position.z = 0.0016`), a few per piece.

7. **Cards a hand cannot pinch.** A 1 mm card or a 1 cm slip was the thing to grab, and the hand went through it. Use
   `look.pullTab` (a 3.5 x 3 cm grip, 1.2 cm thick) for anything pulled; press flaps, wheels and folds that are 3 cm or
   more across. Grab targets at least 4 cm apart and away from the ribbon.

8. **Layers that do not fold.** Pieces were added straight to the root or a page standing up: they did not rise when
   the page turned and stood through the turning page. Every standing piece is on a fold (`look.vFold`, `look.box`,
   `look.float`, `look.layer`) and `book.update(time, delta)` runs every frame.

9. **Too many subjects on one spread.** Three animals, a house and a tree crowded the gutter; the learner did not know
   where to look. One big subject in the middle, 2 or 3 small supporting pieces at the sides, one hand piece.

10. **The book wider than the desk.** Spreads were widened to fit everything, or pieces stuck out past the page. Keep
    the book 0.4 x 0.26 m, pieces within |x| < 0.18, and fold heights that fit the shut book (height x sin(alpha) + z
    under about 0.11).

11. **Seen from the side.** Folds were turned so they faced +x or stood along the gutter; the learner, sitting at +z,
    saw cards edge-on. Draw every card in the XY plane facing +z; V-folds always open toward the learner.

12. **Spreads out of step.** The first spread was full and the others were one card each, or
    the steps ran ahead of the pages. Build all spreads in build (the host sizes the lesson by the first one, so make
    it as tall as the tallest), and let `go(n)` move both the panel and `book.turnTo(n)`.

13. **Shapes that cross themselves.** One outline made of several circles or a figure-eight cut into slivers. A shape
    of round parts is several overlapping cards of the same ink.
