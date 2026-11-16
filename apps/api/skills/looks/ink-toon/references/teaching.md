# Teaching with ink and toon

A lesson works when the learner can say, after each step, what they did and what it caused. A comic is good at this
because it draws the action itself: the slam, the splash, the puff of steam, the word POUR across the panel. Use that.

## 1. One hero, one bold action per step

Pick the hero object everything happens to (the cup, the tyre, the sheet of paper, the plant) and keep it in the same
place for the whole lesson. Each step is one action done to it, and the step is named by that action in one big
lettered word (`look.stepWord('POUR!')`). The props come and go around the hero; the hero changes.

| Topic | The idea | Hero | Actions (step words) | What changes, in the scene |
|---|---|---|---|---|
| Pour-over coffee | Ratio 1:16, bloom lets the gas out, slow pour extracts evenly | the cup and dripper | GRIND, BLOOM, POUR | the bed of grounds swells and darkens; the scale's lettered grams climb to 250 |
| Pumping a tyre | Each push adds a fixed amount of air; pressure climbs, the push gets harder | the wheel | SQUASH, PUMP!, HARDER, FIRM! | gauge needle, push arrow, how far the tyre squashes |
| Paper airplane | Sharp, even folds make a symmetric glider; the nose carries the weight forward | the sheet | FOLD, FOLD, WINGS, THROW | the sheet's shape, crease lines, the flight arc |
| Boiling an egg | Time in boiling water sets the yolk | the egg in the pan | BOIL, TIME, COOL, CRACK | steam, a timer, the cut egg's yolk (runny vs set) |
| Watering a plant | Roots drink from the soil; too much drowns them | the pot | WATER, WAIT, CHECK | soil colour, droplets, leaves lifting or drooping |
| Tightening a bolt | A longer lever needs less force for the same turn | the bolt | GRIP, TURN, LONGER | force arrow length, a motion arc, the bolt's turn |

## 2. Draw the effect in, then show the result

An action has a moment (the hit) and a result (the change). Draw both:

- **The moment**, for two or three drawings, then gone: speed lines behind what moves (`look.speedLines`), impact ticks
  where it lands (`look.impact`), a splash, a squash and wobble on the thing hit (`look.squash`, `look.wobble`), steam
  that boils off what is hot (`look.steam`), a motion arc for a turn, tilt or throw (`look.motionArc`).
- **The result**, which stays: the level is higher, the needle points further, the arrow is longer
  (`look.stretch`), the paper has a new crease, the number lettered in the scene changed (`look.letters`).
- **Before and after.** End with the hero compared with how it started: the same press on a soft and a firm tyre, the
  flat sheet next to the folded plane, the dry and the bloomed bed. Say the difference on the panel in numbers.
- **Cause and effect in one sentence per step**: "Each push squeezes 0.35 litres in, so the gauge climbs 0.18 bar."

If the result only shows on the panel, the lesson is a cartoon with a caption. Put it in the scene and keep the panel
for the sentence that explains it.

## 3. Plan steps as questions

3 to 5 steps. Each asks one question, names one action the hand does to answer it, and says what to notice. The
first frame already shows the whole scene at full size with every prop present (the host sizes the lesson by what it
shows first); the steps then act on it.

Example (pumping a tyre):

1. **SQUASH - How soft is it?** Press the tyre: it squashes a long way. Notice: 2.0 bar, the side says 3.5.
2. **PUMP! - What does one push do?** Press the pump: the handle slams, air runs down the hose, the needle jumps.
   Notice: the same step up every push (0.175 bar).
3. **HARDER - Why is each push harder?** Keep pumping: the push arrow grows with the gauge. Notice: push = pressure x
   piston area.
4. **FIRM! - Is it firm now?** Press the tyre again. Notice: about half the squash it had at 2 bar.

## 4. The hands do the action

The learner's hand does the verb of the step: press the pump, tip the kettle, fold the corner, turn the crank, drop
the bean in. Panel buttons are the second way in, never the only one. Each action answers at once, on the next
drawing: the part moves, the effect flashes, the result changes, the panel says what happened. When the action
finishes the step ("3.5 bar reached"), move on by itself and let the new word land. Light the part to act on with
`look.glow` (build it with `{ own: true }` so only it glows).

## 5. Numbers that are true

Use the real recipe and the real physics: 15 g of coffee to 250 g of water, a 30 second bloom, water at 93 C; a 3 cm
pump barrel 50 cm long holds 0.35 litres; an A4 sheet is 21 x 29.7 cm. Compute what the panel and the scene show from
the scene's state (count the pushes made, the folds done), so they can never disagree. Exaggerate the drawing (a
squash, a splash), never the numbers; say on the panel when a picture is drawn bigger than life.

## Motion

Toon props move on twos: compute every prop pose from `lookTwos(time)` (15 drawings a second), never from `time`.
A move is two or three drawings, not a glide: `lookBack(lookSeg(t, 0, 3 / 15), 1.8 to 2.4)` overshoots and settles;
`look.pop(t)` makes a thing land. A hit squashes (`look.squash(obj, 0.8)`) and wobbles back (`look.wobble`). Boiling
marks (steam, splashes) cycle between three drawings with `look.flip(group, Math.floor(drawing / 3))`. Presses only
set a flag; `update` starts the action on the next drawing, so the motion stays on the grid. The panel never moves.
