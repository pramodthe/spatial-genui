// The game's sounds: what each game event plays. A part (references/parts.md); data only.
// An entry is [effect, { pitch, volume }] (effects: pop, click, tick, good, bad, coin, bounce, win, whoosh, splash),
// { note: 'C4', seconds }, or { tone: 440, seconds, type, glide }; a list of entries plays them all.
const SOUNDS = {
  touch: ['click'],
  cheer: ['good'],
  start: ['whoosh', { pitch: 0.8 }],
  pour: ['whoosh', { pitch: 1.6, volume: 0.4 }],
  whisk: ['tick', { volume: 0.5 }],
  plop: ['pop', { pitch: 0.7 }],
  oven: { tone: 110, seconds: 0.6, type: 'triangle' },
  win: ['win', { volume: 0.8 }],
  miss: ['bad', { volume: 0.3 }],
};
