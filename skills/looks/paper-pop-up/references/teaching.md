# Teaching with a pop-up book

A pop-up book is made for change in stages: each spread is one moment, the page turn is the arrow of time, and a pull
tab or flap shows a change on the spot. A lesson works when, after each spread, the learner can say what changed, by
how much, and what came from the stage before. Use the book's own parts for that.

## 1. One stage per spread, the subject big in the middle

Write the idea as one sentence, then cut it into 3 to 5 stages. Each stage gets a spread with **one** big subject in the
middle (on a V-fold across the gutter), a few supporting pieces at the sides, and one short line on its ribbon.

| Topic | The idea | The stages (one spread each) | The change by hand |
|---|---|---|---|
| Frog life cycle | A frog changes body completely, in steps, and the adult starts it again | spawn, tadpole, tadpole with legs, froglet, frog | pull: legs grow, tail shrinks; flap: lift a lily pad to find the spawn |
| Butterfly | Egg, caterpillar, chrysalis, butterfly: the body is rebuilt inside | egg on a leaf, caterpillar eating, chrysalis, butterfly | pull: the caterpillar grows; flap: open the chrysalis |
| Bread rising | Living yeast makes gas that raises the dough; heat sets it | mix, rise, bake | flap: yeast packet; pull: an hour passes, dough doubles; press: the oven bakes |
| A letter's journey | A letter passes through hands and places in order | post box, sorting office, van, door | pull: the van drives; flap: open the mailbox |
| History / a timeline | Events follow from each other in order | one event per spread, the year on the page | wheel: turn to who was there; flap: what came next |
| Seasons of a tree | The same tree changes over a year | spring, summer, autumn, winter | wheel: turn the season; pull: leaves fall |

If a spread only shows the stage, it is a picture. Give it one change the learner makes: the quantity that changes in
that stage (legs, height, time, how many) moves under the hand, and the panel names it.

## 2. Plan the spreads as questions

Each step asks one question the spread answers, gives the hand something to do that answers it, and tells the learner
what to notice. The first spread already has a hand action on it (hands rule: hands-on from the first second).

Example (frog life cycle):

1. **What does a frog lay?** Frogspawn in a pond: a clump of eggs, each a black dot in clear jelly. Lift the lily-pad
   flap to find it. Notice: 1,000 to 2,000 eggs in one clump (common frog), each a 2 mm dot.
2. **What hatches?** A tadpole with a tail and gills, after about 2 weeks. Pull the tab: it swims across the pond.
   Notice: it lives in water like a fish.
3. **What grows next?** Back legs at about 6 to 9 weeks, then front legs. Pull the tab: the legs grow out and the tail
   gets shorter. Notice: the body is being rebuilt.
4. **When does it leave the water?** A froglet with a stump of tail at about 12 to 16 weeks. Notice: it breathes air
   now.
5. **And then?** An adult frog after 2 to 3 years, which lays spawn: the wheel turns back to the eggs. Notice: it is a
   cycle.

## 3. The hands make the change

The pop-up's three hand pieces, and what they are good for:

- **Pull tab** (`look.pullTab`, grabbed): a continuous change you can scrub back and forth: growing, moving, filling,
  time passing. Drive the scene from `tab.k` (0..1) every frame, so the change follows the hand, and show the number
  (minutes, weeks, centimetres) on the panel as it moves.
- **Flap** (`look.flap`, pressed): a reveal: what is inside, underneath, before, or the answer to the spread's question.
  Put the reveal in `flap.under` and the cover picture in `flap.top`.
- **Wheel** (`look.wheel`, pressed): a cycle or a choice of states seen through a window: the four seasons, the stages
  of a life cycle, the phases of the moon. Each press turns one sector into the window.

The page itself is the fourth: press the corner tab (`book.next` / `book.back`) to turn the page, which is the
strongest "and then" the book has. Pressing Next on the panel does the same. Each action answers at once: the flap
lifts with an overshoot, the tab's change follows the hand, the wheel snaps round, the next spread rises.

## 4. Numbers that are true

Use the real numbers of the subject (a common frog's spawn hatches in about 10 days to 3 weeks; bread dough doubles
in about an hour in a warm room; a monarch butterfly's chrysalis lasts 8 to 15 days). Put the key number in the scene
(`look.number` on a card, a tick on a height chart, a clock's hand) and the sentence on the panel. Compute them from
the scene's state in `update` (`tab.k` to weeks, to height) so the picture and the panel never disagree. Prebuild
the panel strings in build when the values are steps (no allocation in update).

## Motion

Only the paper moves. The book does the big motion for you: `book.update(time, delta)` turns pages in 0.9 s and the
next spread's folds rise out of the gutter, back layers first, with a small overshoot; pieces on paper arms tremble
for a moment when the page lands. Your own motion should be paper motion too: a card that slides in a slot, a flap
that lifts, a piece that grows by scaling its wing (`v.left.scale`, `v.right.scale`), a hand of a clock that turns.
Never animate a piece off its fold, spin it in the air or let it drift.
