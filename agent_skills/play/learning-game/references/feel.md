# Feel: answered, alive, rewarding

A learning game feels good when the world answers the hands. The same scene with the same idea is a chore when it
is still and silent, and a toy when everything responds. These are the things that make the difference, cheapest
first.

## Every hand action is answered in the same frame

- A grab: the piece lifts a little and the hover glow is already there (the host adds it). Let go in the right
  place: it snaps in, pops (`pops.pop(object)`), and a burst comes out of it (`cheer(object)` in the starter).
- A press: the thing pressed moves (a button sinks, a lever flips, a door opens), not only the panel.
- A move done: the why appears, the moves bar fills, the next piece gives a small bounce.
- A wrong try: a wobble and it goes back where it came from. No red text, no lost points.

## Every action has a sound

Use `sound` (`/skills/common/sound`): a click on a grab, a pop when a piece snaps home, `good` when a move is done,
a soft `bad` on a wrong try, `coin` on a pickup, `win` at the end. The starter already plays these through `sfx`; keep
them, and add the sounds of the subject (an engine's hum that rises with speed, a splash, a string's note). When the
idea is about sound itself, the sound is the lesson: the player hears it change as their hands change it.

## Something is always moving

- Call the look's `look.update(time)` every frame when the look has one (low-poly water heaves, painted skies
  drift). The starter does this; keep it.
- The next thing to touch gives a small bounce every few seconds (the starter's nudge). Keep it until the player has
  learned the moves.
- Living and moving things move a little while idle: the boat bobs, the flag flutters, the seedling sways. Use small
  amplitudes (a few millimetres or degrees) on things that are not being held. A grabbable thing stays still while
  it can be held (`/skills/looks/shared/hands.md`).
- The check's dry run counts how many objects move in the first second. Zero is a FIX.

## The hero reads at a glance

- The hero is the biggest interactive thing, at least 8 cm across (a vehicle or creature the player steers: 12 cm
  long or more, a third of the playfield's width at most), in the front half of the desk, in a colour that
  stands out against the set (a coral boat on teal water, not a brown boat on a brown dock).
- Pickups and targets are at least 3 cm, the same shape and colour every time, so the player learns them once.
- The player can tell from the scene, without the panel, what to touch first: it is in front, it bounces, it has a
  handle.

## In the world, not only on the panel

The play kit (`assets/play-kit.js`, already in the module) makes a game feel like a game; the starter wires all of it.
Keep it, and move it where your game needs it:

- **`playPointer`**: a bouncing arrow over the next thing to touch. It moves to each move's piece, then to Start.
  It is the five-second test in the world: the player sees where to begin.
- **`playStartButton`**: a chunky button with a play triangle on the playfield, pressed with a finger. Put it in
  front, clear of the pieces; it shows when the challenge is ready and again for Try again.
- **`playRing`**: a ring that spreads on the ground where the result happened. Call `ring.at(x, y, z)` at the
  landing point, the catch, the finish line, not at the middle of the table.
- **`playStars`**: 3D stars that pop in over the game at the end, gold for earned, grey for not yet.
- **`playBurst`**: sparkles when a move is done; `fire(x, y, z, true)` is confetti for three stars.

Every piece counts toward the scene's 150 draw calls even while hidden; the kit is about a dozen meshes in all.

## Its own look

Each game looks like itself, not like every other game in the app:
- **A skin** on the panel (`kit.panel(..., { skin })`, `/skills/common/panels`): colours picked for this game's look and
  subject, a poster title. Not the starter's navy and yellow unless they suit it.
- **A title sign** over the back of the scene (`kit.sign`), in the same colours: the game's name, like a logo.
- **A result sign** that pops up where the result happened ("4.2 m!", "CAUGHT!", "3 OF 3 STARS") with the number under it.
- Keep it to these three: one panel, two signs. Everything else is the scene itself.

## The reward lands

- When the challenge ends, show the result where it happened (the landing point, the finish line), then the stars
  over the game (`stars.userData.show(k)`), then the numbers on the panel: result and best.
- 3 stars must be possible, and must need the idea. A player who gets 1 star should be able to see what to change.
- Try again is one press and the game is ready again in under a second.

## Fair and calm

- Nothing hurts before Start: no clock, no drift into danger, no falling score.
- Difficulty goes up after success (a shorter time, more wind), never before the player has won once.
- No flashing, shaking or fast spinning of the whole scene; motion is on the pieces.

## Performance (the headset runs at 72 to 90 frames a second)

- Nothing is created in `update()`: make vectors, materials and geometries once in `build`.
- Clamp `delta` (`Math.min(delta, 0.05)`) so a slow frame does not launch things through walls.
- Set panel text when it changes, at most about ten times a second for a running clock.
