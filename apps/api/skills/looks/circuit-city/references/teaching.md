# Teaching a journey on a circuit board

A journey lesson works when, after each step, the learner can say where the data is, what it is now, and what the
last stage did to it. The board is good at this because stages are places and data is a thing: you can see the pulse
leave one chip and arrive at the next, read what the token says, and see which streets have already been travelled.

## 1. Name the stages, their jobs and what travels

Write the idea as one sentence, then list the stages in order. Each stage is one landmark with a printed name and a
one-line job; between stages, the token says what the data is now.

| Topic | The stages (landmarks) | What the token says | A true number |
|---|---|---|---|
| A keypress | KEYBOARD (port), USB (chip), CPU (big chip), GPU (chip), SCREEN (port) | KEY A, 04, A, PIXELS, SHOWN | USB polls up to every 8 ms (125 Hz); a 60 Hz screen redraws every 16.7 ms |
| Running a program | RAM (memory bank), FETCH, DECODE, EXECUTE (dies on the CPU), RAM again | the instruction, then its parts, then the result | a 3 GHz core does a step every 0.33 ns |
| A text message | PHONE (port), RADIO (chip), TOWER (capacitor tower), NETWORK (CPU), TOWER, PHONE | HI, BITS, RADIO WAVE, PACKET, BITS, HI | an SMS holds 160 characters; it usually arrives within a few seconds |
| A web page | BROWSER, DNS, ROUTER, SERVER, back | the address, an IP number, packets, HTML | light in fibre covers about 200 km per ms |
| A compiler | SOURCE, LEXER, PARSER, CODEGEN, CPU | text, tokens, a tree, machine code | one line of code becomes a handful of instructions |
| Logistics | FACTORY, WAREHOUSE, HUB, VAN, HOME | parts, boxes, a parcel, a delivery | hours or days per leg |

Give each stage a different kind of landmark and size (the processor is the biggest building; a port is where the
journey enters or leaves; memory is a row; a relay or tower is a can), so the city reads as districts, not a grid of
equal boxes. Draw the stages in reading order, left to right or front to back, with the start at a port on an edge.

## 2. The pulse carries something, and it changes

The pulse alone says "something moved". The token says what. Show it as a glowing puck riding above the pulse
(`look.token(texts, colours)`), and at each stop `show(i)` its new label and colour: the change at a stop *is* that
stage's job. Name the job on the panel in one sentence when the token changes ("the processor looked up 04 in the
keyboard layout: it is A").

## 3. Plan steps as questions

3 to 5 steps. Each step asks one question, gives the hand something to do that answers it, and tells the learner what
to notice. The first step shows the whole journey already working: a looping trip with every track, every stop and
the token changing (the host sizes the lesson by what it shows first, and the learner should see the goal before the
parts).

Example (a keypress):

1. **From key to screen** - the trip loops; the token reads KEY A, 04, A, PIXELS, SHOWN; the meter fills.
2. **What does the keyboard send?** - press the USB chip; the pulse travels; the token arrives as 04. Notice: a key
   sends its number, not a letter.
3. **Which chip makes the letter?** - carry the 04 and drop it on the right chip. The GPU and the screen explain why
   not them; the processor accepts it and the token becomes A.
4. **Draw it, then show it** - press GPU, then SCREEN; the screen LED lights. Notice: the screen waits for its refresh.
5. **Where does the time go?** - time a whole trip, switch to a faster keyboard and screen, compare. Notice: the two
   waits, not the chips, decide the time.

## 4. The hands run the journey

- **Press the next landmark** to send the pulse there. It travels the track, never jumps. Pressing a stop it has
  passed says so; pressing one further on says "it cannot skip: it goes through X first". The order is the lesson.
- **Carry the data token** and drop it on the stage that does the next job. A right drop sends the pulse after it; a
  wrong drop slides back (`lookSeat` with `returnAfter`) with one sentence on why that stage is wrong.
- **Toggle a path or a setting** (a panel `segmented` or a pressable switch chip): a faster clock, a broken link, a
  cache hit. Run the trip again and compare the time.
- **Break a stage.** Press a stage to switch it off and run the trip: the pulse stops at the dead chip and the token
  never changes. What breaks when a stage is missing is often the clearest way to say what it does.

Every press flashes the landmark at once (`look.wake` with a short flash). The pulse waits while the token is held
(a grabbable never moves while held), and moves slower than 0.05 m/s so the token can be caught.

## 5. Numbers that are true

Use the real numbers of the system (a 125 Hz USB poll is 8 ms; a 60 Hz screen is 16.7 ms; light in fibre about
200 km per ms) and add them up in `update` from what has actually happened (each stop adds its time as the pulse
finishes there), so the meter, the panel and the token can never disagree. Show the quantity on the board too: a
`look.meter` bar that fills, the dwell at a slow stop longer than at a fast one, a busier street lit brighter.

## Motion

The pulse travels: move it along the track's path with `pulse.follow(path, u)`, `u` growing by
`delta * speed / track.length` (about 0.04-0.05 m/s), and make each leg's path run from stop centre to stop centre
so it goes in under a chip and comes out the other side instead of jumping. A landmark wakes when the pulse arrives
(ease its `wake` level to 1 over half a second; the processor's dies light in a diagonal wave as the level rises),
then stays faintly awake (about 0.45) after the pulse leaves. Travelled tracks stay faintly lit (`track.light(u)`).
A slow stage holds the pulse longer than a fast one: the waiting is part of the story. The panel never animates.
