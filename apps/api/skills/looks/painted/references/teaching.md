# Teaching with a painting

A painted lesson works when the learner can say, after each step, what happened at this stop and what it handed to
the next. A picture book is good at this because a process becomes a journey through a place: one stop, one change,
then on. Use that.

## 1. Name the idea, the stops and the traveller

Write the idea as one sentence, then split it into 3 or 4 stops (never more: the ground is 0.4 m across), each where
one thing visibly happens. Pick the traveller that carries the result between them, and the quantity it carries:

| Topic | Stops, left to right | Traveller | The quantity as stuff |
|---|---|---|---|
| Wheat to bread | field, windmill, bakery | a cart, then a sack | sheaves on the cart; the flour sack filling under the spout; loaves on the sill |
| Wool to jumper | pasture, stream, cottage, washing line | a basket | a heap of fleece (4 kg) that shrinks when washed (2 kg); four balls of yarn; four jumpers |
| Where water comes from | rain on hills, river, reservoir, town | the river, a drop | the reservoir's level rising; buckets at the tap |
| Paper from trees | forest, pulp mill, drying lofts, print shop | a log on a river, a cart | logs in, a stack of sheets out |
| A day on the farm | hen house, field, market | the farmer, a cart | eggs in a basket, sacks sold |
| How a river shapes a valley | spring, bend, delta | a boat, the current | sand carried, the bank cut back, a new beach |

If the change at a stop is only on the panel, the lesson is a painting with a caption. Put it in the scene: the
sack fills, the heap shrinks, the field is cut back to stubble (`field.userData.cut(k)`), loaves appear on the sill.
The panel keeps the sentence that explains why.

## 2. One lamp, one stop, one caption

The stop the story is at has its warm lamp fully lit (`lamp.userData.set(1)`, or `house.userData.window`); the next
stop's lamp glows gently, pulsing, to say "carry it here"; the rest are nearly dark (0.05-0.1). The subject of the
active stop can brighten too (`const glow = look.shine(stop); glow(0.4)` in update). Each step has one short caption:
a status line on the panel, and if you like a painted signboard (`look.caption`) low at the front edge that shows the
same words with the number ("Shearing: 4 kg of fleece").

## 3. Plan steps as questions

3 to 5 steps. The first shows the whole story already done (the host sizes the lesson by its first frame, so start
with the loaves on the sill and every lamp lit), then go back to the start and walk it. Each later step asks one
question, gives the hands something to do that answers it, and says what to notice.

Example (wheat to bread):

1. **From field to loaf** - the finished picture: stubble, a full flour sack, loaves on the bakery sill, all lamps lit.
   "How did the field become these loaves? Press Next and follow the cart."
2. **Cut the wheat** - the field stands gold and bends in the wind. Press the field: it is reaped from one side to
   stubble and sheaves pile on the cart (the cart fills as the field empties). Notice: the grain is in the ears.
3. **Grind it** - carry the cart (or press the windmill) to the mill. The sails turn faster in a gust, the sack
   under the spout fills with flour while a smaller heap of bran grows beside it. Notice: about 75 kg of flour
   from 100 kg of wheat; the rest is bran.
4. **Bake it** - carry the sack to the bakery; the oven window glows and loaves appear on the sill, one at a time.
   Notice: a large loaf takes about 0.5 kg of flour; water and a little yeast make the rest.

## 4. The hands carry the cause

The best hand action is the journey itself: grab the traveller and carry it to the next stop. When it is let go near
that stop it settles there (`lookSeat` whose `home` you move to the stop, or your own snap) and the stop does its
work; let go anywhere else it slides back to where it was and the panel says where to take it. Pressing the next
stop's big subject is the second way in: the traveller then walks there along the track by itself
(`path.userData.route.at(u, out)`), slower than 0.05 m/s, and stops if a hand takes it. Other good hands: press the
field to reap it, press the sheep to shear it, tip a sack to pour. The panel's Next and Back are the third way.

## 5. Numbers that are true

Use real amounts with "about": a fleece is about 4 kg and washing leaves about half; 100 kg of wheat gives about 75 kg
of white flour; a large loaf takes about 0.5 kg of flour. Compute what the learner sees and reads from one state value (the
stage, and how far through it is) so the heap, the balls and the panel's number can never disagree.

## Motion

Gentle and continuous, never on twos. A breeze is always there: stalks bend in a wave that runs across the field
(`field.userData.sway(time, wind)` every frame; raise `wind` in a gust), smoke rises and leans
(`smoke.userData.rise(time, lean)`), sails and wheels turn slowly and speed up when their stop is working. The
traveller walks, it does not jump. A change at a stop takes about 2 to 3 seconds, and things that are counted
(balls, loaves, jumpers) arrive one at a time so the learner can count along. The panel never moves.
