# The plan and the parts

A learning game keeps its name, colours and sounds in two small part files beside its code, `/work/parts/identity.js`
and `/work/parts/sounds.js`. They are joined into the module's parts block (above the game's code) by
`scripts/assemble.mjs`; the check runs it first. **Never edit the parts block in game.js by hand**: edit the part
file, then run the check.

## /work/plan.md (write it before any geometry)

```
# <title, 1 to 4 words>
pitch: <the whole game in one sentence of about 15 words: the panel's first line>
idea: <the one idea, a sentence a player could repeat>
look: <the look> - mood: <two or three words for the colours, e.g. "night, neon, mysterious">
hero: <the one thing the hands work on; size; where it stands>
main action: <the one hand action; how the hand does it>
moves: <3 to 7: say / what the scene does / why>
challenge: <what is measured, unit, stars at [one, two, three]>
events: <the game's sound events: touch, cheer, start, win, miss, and the subject's own (e.g. echo, splash, slice)>
```

## parts/identity.js

```js
const IDENTITY = {
  title: 'Echo Hunt',                                   // 1 to 4 words: the panel's title and the opening title card
  eyebrow: 'LISTEN AND CATCH',                          // 2 to 4 words in capitals over the title
  pitch: 'Slide the bat and follow the quicker echo to catch the hidden moth.',
  skin: { paper: '#1b1033', ink: '#ffffff', accent: '#7cf7d4', button: '#7cf7d4', edge: '#7cf7d4', round: 28 },
  resultSign: { paper: '#1b1033', ink: '#7cf7d4', edge: '#7cf7d4' },
};
```

Colours are `"#rrggbb"`, picked for this game's look and mood, not the starter's navy and yellow. The app shows the
title as the game's opening title card; build no title sign. Text stays readable (the kit swaps an unreadable ink), but choose
well anyway.

## parts/sounds.js

```js
const SOUNDS = {
  touch: ['click'],
  cheer: ['good'],
  start: ['whoosh'],
  win: ['win', { volume: 0.8 }],
  miss: ['bad', { volume: 0.3 }],
  echo: { tone: 880, seconds: 0.12, type: 'sine' },     // the subject's own sounds, by the events in plan.md
  chirp: { clip: 'snd-1a2b3c4d5e', volume: 0.6 },       // a generated sound (make_sound)
  music: { clip: 'mus-1a2b3c4d5e', loop: true, volume: 0.25 }, // optional music loop (make_music): Start plays it
};
```

An entry is `[effect, { pitch, volume }]` (pop, click, tick, good, bad, coin, bounce, win, whoosh, splash),
`{ note: 'C4', seconds }`, `{ tone: 440, seconds, type, glide }`, `{ clip: id, volume, loop }` (a generated clip),
or a list of those. When `make_sound` is in your tools, make the subject's own sounds with it (one clean sound each,
1 or 2 seconds, at most 4): real sounds teach better than beeps. The starter fires `music` on Start and stops it
when the round ends. The game plays an event with
`sfx.fire('echo')`; a continuous sound (an engine) is `sfx.hum('engine', { frequency, volume })` in update().

## The game code

The starter already reads `IDENTITY` (panel, signs) and `SOUNDS` (`sfx.fire(event)`); keep those, and fire the
events plan.md lists. Do not define IDENTITY or SOUNDS in the game code.
