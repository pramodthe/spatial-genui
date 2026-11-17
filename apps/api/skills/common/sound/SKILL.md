---
name: sound
description: The module's sound - synthesized effects (pop, click, good, bad, coin, win, whoosh, splash, bounce, tick), tones and notes in Hz or by name, and continuous hums (an engine, wind, a held string) - to answer the hands and to teach with sound itself (pitch, rhythm, echoes, speed). Use it in every learning game, and whenever an idea is about sound, music, vibration, frequency, waves or timing.
---

# Sound

`build` also receives `sound`. It makes short synthesized sounds in the headset, and plays the game's own generated
clips (a bat's real chirp, a music loop) when the host has made some with `make_sound` / `make_music`. The dry run is
silent but checks every call, and the check counts them.

```js
sound.play('pop');                                  // an effect: pop, click, tick, good, bad, coin, bounce, win, whoosh, splash
sound.play('good', { pitch: 1.5, volume: 0.6 });    // pitch multiplies its frequencies; volume 0..1
sound.tone(440, { seconds: 0.4, type: 'triangle', volume: 0.6, glide: 660 }); // Hz 20-4000; sine | triangle | square | sawtooth
sound.note('C4', { seconds: 0.5 });                 // a note by name: 'C4', 'F#3', 'Bb5'
sound.hum('engine', { frequency: 80 + speed * 40, volume: 0.3, type: 'sawtooth' }); // call every frame to change it
sound.hum('engine', null);                          // stop it
sound.load('snd-1a2b3c4d5e');                       // fetch a generated clip ahead of its first play (in build)
const loop = sound.clip('mus-1a2b3c4d5e', { volume: 0.25, loop: true }); // a generated clip; loop.stop() ends it
```

Generated clips are for what the subject really sounds like (an echo, a splash, a bird); the synth effects stay
the answers to the hands. **The sound library** (`references/library.md`) has 30 ready clips by id: wood, stone,
water, paper, wind, birds, a bat's call, rewards, and ambience loops (a windy hill, a forest, a river, a cave, a night,
the sea). Use them first: they cost nothing and wait for nothing; make a sound only for what they lack. In a learning game the clips go in SOUNDS as `{ clip: id, volume }` and playSounds loads
them for you (the learning-game skill's references/parts.md).

Volume is capped by the host, at most 12 sounds play at once and 30 start each second, at most 4 hums run, and
every hum stops when the lesson closes. Calling `play` every frame plays nothing useful: play on events.

## Answer the hands

Every hand action gets a short sound in the same frame as its visual answer (`/skills/play/learning-game`,
references/feel.md): a grab `click`, a piece snapped home `pop`, a move done `good`, a wrong try a soft `bad` (low
volume, never harsh), a pickup `coin`, the challenge won `win`. Keep each effect for one meaning through the game.

## Teach with sound

When the idea is about sound or timing, the sound is the lesson, and the scene shows the same thing:

- **Pitch and length or tension.** A string, a pipe, a bottle with water: frequency follows the physics
  (`f = k / length` for a string, higher when tighter), and the player hears it change as they shorten it.
- **Pitch and speed.** An engine or a fan hums with a frequency that follows its speed (`hum` every frame).
- **Echoes and distance.** A click, then the echo after `2 x distance / 343` seconds (slowed down so it can be
  heard on a desk, and the panel says by how much).
- **Rhythm and fractions.** Beats as ticks; halves and quarters as notes in a bar.
- **Waves and frequency.** A drawn wave whose crests get closer as the tone rises.

Always show what is heard (a wave, a number in Hz, a bar of beats): some players have the sound off or cannot hear
well, and seeing it with the sound is how it is learned.
