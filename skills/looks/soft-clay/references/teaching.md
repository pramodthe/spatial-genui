# Teaching with clay

A lesson works when the learner can say what changed and why after each step. Clay is good at this because amounts
are objects: you can see a stack is taller, hold a bigger share, watch an arrow grow. Use that.

## 1. Name the idea, then the quantity that carries it

Write the idea as one sentence a learner could repeat, then pick the quantity that decides it and give it a body:

| Topic | The idea | The quantity | In clay |
|---|---|---|---|
| Saving money | A little every week adds up; interest makes the pile grow faster | money over time | one coin stack per week in a row; the row of stack heights is the graph; a fat clay number for the total |
| Sharing / division | Equal shares: total / people, and what is left over | items per person | counters dropped into bowls, one bowl per person; leftovers stay on the tray |
| Fractions | One whole cut into n equal parts; more parts, smaller parts | size of one part | a round clay cake as wedges lying flat; a single wedge held next to another |
| Balance / force | Weight x distance on each side decides which way it turns | turning effect | children on marked plank, weight arrows, the plank's tilt |
| Growth | Growth needs inputs and builds up over time | size over time | a plant in steps, a stack of "days", food/water pellets the learner gives it |
| Comparison | Which is more, and by how much | difference | two stacks side by side, the gap as a clay bracket and number |

If the quantity is only on the panel, the lesson is a model with a caption. Put it in the scene too (`look.number`,
`look.arrow`, a stack's height), and keep the panel for the sentence that explains it.

## 2. Plan steps as questions

3 to 5 steps. Each step asks one question, gives the hand something to do that answers it, and tells the learner
what to notice. The first step shows the whole thing already working (the host sizes the lesson by what it shows
first, so start full, then go back and build up).

Example (saving money):

1. **The whole year** - 52 small stacks in a row, growing; "Each week adds 2 coins. What will the pile be after a
   year?" The total number in clay. Notice: the row of stacks is a straight ramp.
2. **One week at a time** - the row resets; the learner drops 2 coins on this week's stack, the next week appears;
   the total counts up. Notice: same amount each time.
3. **Add interest** - the learner presses a "bank" piggy; each week now also gets interest coins (a different colour)
   proportional to the pile; the ramp curves up. Notice: the later weeks grow more.
4. **Compare** - both rows side by side, with the difference as a clay bracket and number. Notice: how much interest
   added.

## 3. The hands run the experiment

The best hand action changes the very quantity the lesson is about: drop a coin, move a weight, cut the cake, give a
share. Pressing "Next" moves the story; grabbing and dropping is where the learning happens. Each action answers in
the same frame: the piece lands with a bounce, the number changes, the arrow grows, the plank tips. When a step has a
goal ("make it balance"), say so on the panel when it is reached.

## 4. Numbers that are true

Take the real numbers (a coin is about 2 cm across; a week has 7 days; 2 + 2 + 2 = 6). Compute them in `update` from
the scene's state (count the coins actually on the stack) so what the learner sees and what the panel says can never
disagree.

## Motion

Clay moves on twos: compute poses from `lookTwos(time)` (15 poses a second) for the clay, not from `time`. An arrival
is a short drop with a squash (`scale.y` 0.75 for one pose, then `lookBounce`). Things that are being counted arrive
one at a time, a beat apart, so the learner can count along. The panel and the camera never move on twos.
