---
name: circuit-city
description: Build a mixed-reality lesson as a circuit board seen as a city at night - black chips as buildings, aluminium capacitors as towers, gold tracks as streets, white silkscreen naming each district - where a pulse of light carries a glowing data token from stop to stop and each landmark wakes as it arrives, and the learner presses the next stop, carries the data and times the trip. Use it whenever a lesson or course asks for circuit city, a circuit board, chips or an electronic city, and for journeys and pipelines through a system - how a computer runs a program, what happens when you press a key, how data, messages, packets or a text message travel, how the internet, a phone, a CPU, memory or a compiler works, how a request reaches a server and back, logistics and supply flows - even if no look is named. Not for amounts and sharing (soft clay), for one object's parts (exploded view), or for maps of real places.
---

# Circuit city lessons

A circuit-city lesson is a small circuit board on the learner's desk, read as a city at night: matte black chips are
the buildings, aluminium capacitors the towers, gold tracks the streets, and white silkscreen prints each district's
name. A pulse of warm light travels the tracks from stop to stop and each landmark wakes as it arrives. The look exists
to make a journey through a system followable: a learner who watches the token above the pulse turn from `04` into `A`
at the processor, and who had to carry it there with their own hand, knows what that stage does. So every choice in
this skill serves one goal: **each stage is a place, the data is a thing, and the learner moves it through in order.**

Read this file once, then follow the steps. The references are short; open each when its step says so.

## Steps

1. **Start the module.** Run

   ```
   node /skills/looks/circuit-city/scripts/new-lesson.mjs /work/module.js
   ```

   It writes a module that already passes the app's gate: the look kit (`lookPath`, `lookSeat`, motion helpers), the
   circuit look (`circuitCityLook`, its builders and the board) and a starter lesson with a panel, steps and working
   hand targets. Starting from it means you spend your effort on the journey, not on pins, tracks and hands.

2. **Decide the journey and what travels.** Before any geometry, write down in a few lines (in /work/plan.md):
   - the one idea of this lesson, as a sentence a learner could repeat ("a key sends a number; the processor turns it
     into a letter; the graphics chip draws it; the screen shows it on its next refresh");
   - the stages in order (3 to 6), each with its printed name, its job in one line, and the landmark it becomes;
   - what the data is between stages (the token's label and colour at each stop) and one true number per stage
     (a time, a size, a count);
   - 3 to 5 steps, each with one question, the hand action that answers it, and what the learner should notice.

   Read `references/teaching.md` for this. A board with labelled chips is a diagram; a board where the learner sends
   the pulse to the next stop, sees what the data became, and is told why it cannot skip a stage is a lesson.

3. **Build the city with the circuit builders.** Replace `look.demo(subject)` with the lesson's parts. Open
   `references/recipes.md` for the parts (the processor, memory, chips, capacitor towers, small parts, ports, tracks
   with 45-degree bends, vias, LEDs, silkscreen outlines and names, the pulse, the data token, a meter) and the
   builders' signatures at the top of `assets/circuit-city.js`. Give every stage a different landmark and size, join
   them with tracks, print each name in silkscreen beside it, and fill the rest of the board with towers and small
   parts. Build from the look's materials only (`look.M`): a plain box on the board reads as a toy.

4. **Wire the hands and the steps.** Return the hand targets: the landmarks are pressed (`{ object, press: true }` or
   `traits(stop, { onPress })`), the data token is grabbed (`{ object: token.mesh, grab: true }` with `lookSeat`). Fill
   the STEPS and the panel, and write the update logic that makes the board answer: a pressed stop sends the pulse
   along the track, the token rides above it and changes at the next stop, the landmark wakes, the travelled track stays
   lit, the meter fills. Read `/skills/looks/shared/hands.md` for the hand rules (reach, size, spacing, put-it-back)
   every look shares.

5. **Check, then fix.** Run

   ```
   node /skills/looks/circuit-city/scripts/check.mjs /work/module.js
   ```

   It runs the app's gate and dry run, the shared hand checks and the circuit rules. Fix every `FIX` line and read the
   `NOTE` lines; run it again until it prints `lesson ok`. Then read `references/mistakes.md` once and make sure none
   of those happened.

## A worked lesson

`assets/example-keypress.js` is a whole circuit-city lesson that passes the check: how pressing A becomes an A on the
screen. Five stops (KEYBOARD port, USB chip, CPU, GPU, SCREEN port) joined by gold tracks; a token above the pulse
reads KEY A, 04, A, PIXELS, SHOWN as it goes. The learner presses the next stop to send the pulse (it refuses to skip
one), carries the 04 to the chip that makes the letter (the GPU and the screen say why not them), and times the whole
trip on a meter bar, then switches to a 1000 Hz keyboard and a 144 Hz screen to see which waits shrink (32.7 ms to
15.9 ms). Open it when you start step 3. Take its method - stages as landmarks, data as a token, the order enforced
by the hands, the time as a quantity in the scene - not its subject.

## The circuit look in one paragraph

A deep green solder-mask board with faint copper lines under it, gold pads along the back edge and brass mounting holes.
Matte black epoxy chips with tinned gull-wing pins on gold pads and a thin white silkscreen outline round each; one big
processor with a grid of silicon dies; rows of memory; brushed aluminium capacitor cans as towers; tan and black small
parts as houses; metal ports at the edges where the journey enters and leaves. Gold tracks run with 45-degree bends.
Night cannot be made in a lit room, so the signal is the light: the pulse and its trail, the token, chips glowing from
underneath when they wake, the processor's dies lighting in a diagonal wave, LEDs. Words on the board are white
silkscreen capitals (`look.label`), sentences go on the panel. The original film is `assets/film/circuit-city.js`;
read it for its palette, the wave across the dies and the timing of the pulse.

## Files

- `scripts/new-lesson.mjs` - step 1. `--force` replaces an existing /work/module.js.
- `scripts/check.mjs` - step 5. The circuit rules it applies are in `scripts/rules.json`.
- `assets/circuit-city.js` - the circuit look: `circuitCityLook(THREE, kit)` and its builders (pasted in by step 1).
- `assets/example-keypress.js` - the worked lesson.
- `assets/film/circuit-city.js` - the original film source of the look (reference only; it builds lights, cameras and
  canvas textures a lesson cannot).
- `references/teaching.md` - step 2: how a journey lesson explains each stage and lets the hands run it.
- `references/recipes.md` - step 3: how to build the board's parts, with code.
- `references/mistakes.md` - step 5: failures to avoid in circuit lessons.
- `/skills/looks/shared/hands.md` - the hand rules every look shares.
