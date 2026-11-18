// The game's sounds: what each game event plays. A part (references/parts.md); data only.
// An entry is [effect, { pitch, volume }] (effects: pop, click, tick, good, bad, coin, bounce, win, whoosh, splash),
// { note: 'C4', seconds }, or { tone: 440, seconds, type, glide }; a list of entries plays them all.
const SOUNDS = {
  touch: ['click'],
  cheer: ['good'],
  start: ['whoosh'],
  win: ['win', { volume: 0.8 }],
  miss: ['bad', { volume: 0.3 }],
};
