# Teaching with a low-poly landscape

A lesson works when the learner can say what changed and why after each step. A landscape is good at this because
a process becomes a route: the learner sees where each stage happens, watches something travel between them, and
sees the amounts pile up, fill or drain at each place. Use that.

## 1. Name the idea, the stages, and what flows

Write the idea as one sentence a learner could repeat. Then list the stages as places on the island, and pick what
flows between them and how its amount shows:

| Topic | The idea | Stages (flags) | What flows, and how its amount shows |
|---|---|---|---|
| Water cycle | The same water goes round: the sun lifts it, wind carries it, rain returns it | sea, cloud, mountain, river | droplets rise (a count), the cloud grows and darkens, rain falls, the river runs back; a lake's level |
| Tap water | River water is cleaned, stored high, then pushed by gravity to every tap | river intake, treatment, water tower, homes | a droplet traveller along the pipe; the tower's level falls as homes use it and rises as the pump fills it |
| Food supply chain | Each stage changes the goods and some is lost or sold on | field, mill, bakery, shop | crates, sacks and loaves as piles; a truck on the road; a cut-paper count at the end |
| Electricity from a dam | Height of water is stored energy; letting it fall turns it into electricity | lake, dam, turbine, town | lake level drops as the gate opens; lit windows in town counted against water used |
| Recycling | A can is collected, sorted, melted and made again; most of the metal comes back | homes, truck, sorting plant, factory | cans as a pile at each stage; a truck route; a count of new cans |
| Food web / ecosystem | Energy passes up the levels and most is lost at each step | meadow, rabbits, foxes, hawk | piles that shrink up the chain (about a tenth per level) |
| A journey or trade route | Distance, time and what is carried | ports or towns along the route | a boat or truck on a `lookPath`; distance travelled as a count; cargo as a pile |

If the amount is only on the panel, the lesson is a diorama with a caption. Put it in the landscape too (a pile, a
level in a tank, a growing cloud, a `look.number`), and keep the panel for the sentence that explains it.

## 2. Stages are places with flags

Each stage is a spot on the island with a numbered paper flag (`look.flag(n, name)`), its name on a `kit.card` tag
right above the flag, and the things that happen there standing beside it. Order the stages so the route between
them reads left to right or back to front across the island, and draw the route (a river, a road, a pipe, an
`look.arrow`). Pressing a flag goes to that stage's step; the current flag rises and lights
(`flag.userData.active(k)`, eased toward 1 in update).

## 3. Plan steps as questions

3 to 5 steps. Each step asks one question, gives the hand something to do that answers it, and tells the learner
what to notice. The first step shows the whole process already done (the host sizes the lesson by what it shows
first): full piles, the full count, every stage in place. Then go back and run it.

Example (the water cycle):

1. **Where does rain come from?** - the whole cycle running: droplets rising off the sea, the cloud, rain on the
   mountain, the river back to the sea. Notice: it is one loop.
2. **What lifts the water?** (flag 1, sea) - the learner grabs the sun and moves it closer: more droplets rise each
   second (a count beside the sea). Notice: warmth decides how fast water evaporates.
3. **Where does it go up there?** (flag 2, cloud) - the droplets join the cloud, which unfolds bigger and greyer;
   the learner presses the cloud when it is full and rain falls. Notice: the cloud is the same water.
4. **How does it get back?** (flag 3, mountain; flag 4, river) - the rain gathers, the river unfolds downhill and a
   droplet travels it to the sea; the lake level rises. Notice: the loop is closed and nothing was made or lost.

## 4. The hands run the process

The best hand action changes the very amount the lesson is about: drop a crate in the mill, move the sun, open the
dam's gate, press the pump, add a house to the town. Pressing a flag moves the story; placing and pressing on the
landscape is where the learning happens. Grab only slow pieces the learner places (a crate, a sack, the sun, a
house); things that travel (a truck, a boat, a droplet) are never grabbable: press something to send them. Each
action answers in the same frame: the crate's contents vanish into the hopper, the sails speed up, the panel says
what is happening; the result follows along the route. When a step has a goal ("make 120 loaves"), say so on the
panel when it is reached.

## 5. Numbers that are true

Use the real numbers of the subject and keep them consistent: 20 kg of wheat gives about 15 kg of white flour and
5 kg of bran; a loaf takes about 500 g of flour; a person at home uses roughly 150 litres of water a day; about 97 %
of Earth's water is in the sea. Count them in `update` from the scene's state (how many crates went into the mill,
how many sacks the truck delivered) so what the learner sees and what the panel says can never disagree. When one
item stands for many (one loaf in the pile = 10 loaves), say so in its name and on the panel.

## Motion

Desk speed, smooth (not on twos): the truck drives about 5 to 8 cm a second, water heaves (`look.update(time)`
every frame), clouds drift a few centimetres. New things unfold facet by facet from one point (`look.unfold(mesh,
{ from })`, then `set(k)` as k goes 0 to 1 over a second) or pop out of the ground with a bounce (`look.pop(obj,
k)`). Things being counted arrive one at a time, a beat apart, so the learner can count along. The panel never moves.
