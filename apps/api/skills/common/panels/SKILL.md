---
name: panels
description: kit.panel parts, panel.set, panel.show, the font, and where a panel sits.
---

# Panels

Every sentence and control is a `kit.panel` part. Do not call `ui()` yourself, do not write markup or CSS, and do not pass a custom accent.

```js
const panel = kit.panel(ui, {
  width: 0.36,
  position: [0.38, 0.22, 0],
  rotationY: -0.3,
  eyebrow: 'LESSON 2 OF 4',
  title: 'Follow an orbit',
  items: [
    { text: 'One or two sentences.', id: 'info' },
    { stat: '408 N', label: 'force needed', id: 'force' },
    { status: 'Pick a part', tone: 'neutral', id: 'state' },
    { progress: 0.4, label: '2 of 5', id: 'done' },
    { buttons: [{ label: 'Next', onPress() {} }] },
    { choices: ['Mercury', 'Venus'], columns: 2, id: 'planet', onSelect(index, label) {} },
    { segmented: ['0.25x', '1x', '4x'], selected: 1, id: 'speed', onSelect(index, label) {} },
    { list: [{ title: 'Fan', sub: 'Pulls air in', onPress() {} }] },
    { toggle: 'Show orbits', on: true, id: 'orbits', onChange(on) {} },
    { slider: 'Speed', min: 0, max: 10, step: 1, value: 3, id: 'v', onChange(value) {} },
    { note: 'Small print.' },
    { divider: true },
  ],
});
root.add(panel.object3D);
panel.set('info', 'New text');
panel.set('state', 'Correct!', 'good');
panel.show('reset', false);
```

**A game's own look:** pass `skin` to give the panel the game's colours instead of the app's grey card:

```js
kit.panel(ui, { ..., skin: { paper: '#1d2238', ink: '#ffffff', accent: '#ffd23f', button: '#ffd23f', edge: '#ffd23f', round: 28 } });
```

`paper` is the background, `accent` the big poster title, eyebrow and numbers, `button` the main button pill, `edge`
an optional border, `round` the corner radius in px; `poster: false` keeps a small title. The kit keeps it readable: an
ink or accent without enough contrast on the paper is swapped for dark or light text. Every learning game has a skin.

`set` changes a part by id. `show(id, false)` hides a part or a button. Tones: neutral, good, poor, bad.

Font: plain ASCII plus ° § ä ö ü Ä Ö Ü ß. Write CO2, x, -, ->, .... No emoji.

`rotationY` stays within -0.4..0.4. A lesson panel sits beside the model (x about 0.38 or -0.38), centre 0.2 to 0.25 above the desk, never in front of the model. About 8 parts. One panel; a second only when it has its own job.

A game's panel is its scoreboard, beside the playfield like a lesson panel (a panel behind the playfield is out of a pointing hand's reach).
