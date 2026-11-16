// Worked example (circuit city): how pressing A on a keyboard becomes an A on the screen. Built on the look kit and
// circuitCityLook (pasted above it by new-lesson.mjs); passes scripts/check.mjs. Take its method, not its subject:
// - every stage is its own landmark with its printed name: KEYBOARD (a port), USB (a small chip), CPU (the big chip),
//   GPU (a chip), SCREEN (a port), joined by gold tracks with 45-degree bends; RAM, towers and small parts fill the city;
// - what travels is visible: a glowing data token rides above the pulse and its label changes at each stage
//   (KEY A -> 04 -> 04 -> A -> PIXELS -> SHOWN); travelled tracks stay faintly lit; each landmark wakes on arrival;
// - the learner runs the journey: press the next stop to send the pulse, carry the token to the chip that makes the
//   letter, time a whole trip and change the slow stages; the pulse can never skip a stop or jump;
// - the time is a quantity in the scene (a meter bar that fills as the trip adds up) with true numbers on the panel;
// - nothing is allocated in update().
export default function build({ THREE, kit, traits, ui, isGrabbed }) {
  const root = new THREE.Group();
  const look = circuitCityLook(THREE, kit);
  const set = look.set({ width: 0.44, depth: 0.3 });
  root.add(set);
  const subject = new THREE.Group();
  subject.name = 'Computer board';
  subject.userData.subject = true;
  subject.position.y = set.userData.top;
  root.add(subject);

  // The five stops of the journey, left to right. ms: the longest wait at that stop (true numbers, see the panel).
  const keyboard = look.connector('Keyboard port', { face: '-x' });
  const usb = look.chip(0.03, 0.03, 'USB controller', { sides: 'xz', mark: 'U1' });
  const cpu = look.cpu(0.07, 'Processor', { cores: 4 });
  const gpu = look.chip(0.036, 0.036, 'Graphics chip', { sides: 'xz', mark: 'U3' });
  const screen = look.connector('Screen port', { face: '+x' });
  const STOPS = [
    { obj: keyboard, at: [-0.185, 0.055], name: 'KEYBOARD', label: [-0.18, 0.096] },
    { obj: usb, at: [-0.11, 0.055], name: 'USB', label: [-0.11, 0.092] },
    { obj: cpu, at: [0, -0.005], name: 'CPU', label: [0, 0.05] },
    { obj: gpu, at: [0.11, 0.055], name: 'GPU', label: [0.11, 0.094] },
    { obj: screen, at: [0.185, 0.055], name: 'SCREEN', label: [0.182, 0.096] },
  ];
  for (const s of STOPS) {
    s.obj.position.set(s.at[0], 0, s.at[1]);
    const name = look.label(s.name, `${s.name} silkscreen`, { h: 0.011 });
    name.position.set(s.label[0], 0, s.label[1]);
    subject.add(s.obj, name);
  }
  // Settings for step 5: a 125 Hz or 1000 Hz keyboard, a 60 Hz or 144 Hz screen.
  let fastUsb = false;
  let fastScreen = false;
  const msOf = (i) => [5, fastUsb ? 1 : 8, 1, 2, fastScreen ? 6.9 : 16.7][i];

  // The streets: one track per leg, stop centre to stop centre (the pulse goes in under each chip, never jumps).
  const LEGS = [
    [STOPS[0].at, STOPS[1].at],
    look.route(STOPS[1].at, STOPS[2].at),
    look.route(STOPS[2].at, STOPS[3].at, { diagonalFirst: true }),
    [STOPS[3].at, STOPS[4].at],
  ].map((pts, i) => look.track(pts, `Leg ${i + 1}`));
  LEGS.forEach((t) => subject.add(t.mesh));

  // The rest of the city: memory behind the processor with its bus, power towers, vias, small parts, an LED.
  const ram = look.memoryBank(4, 'Memory');
  ram.position.set(0, 0, -0.092);
  const ramName = look.label('RAM', 'RAM silkscreen', { h: 0.009 });
  ramName.position.set(0.075, 0, -0.092);
  const bus = [];
  for (let c = 0; c < 4; c++) {
    const x = ram.userData.chipX(c);
    bus.push(look.route([x, -0.077], [x * 0.5, -0.04]));
  }
  bus.forEach((pts, i) => subject.add(look.track(pts, `Memory bus ${i + 1}`, { width: 0.0018, lit: false }).mesh));
  const towers = look.towers([[-0.06, -0.06, 0.008, 0.022], [0.06, -0.06, 0.008, 0.022], [-0.17, -0.09, 0.009, 0.028], [0.17, -0.09, 0.009, 0.028]], 'Power capacitors');
  const vias = look.vias([[-0.06, 0.055], [0.06, 0.055], [-0.02, -0.055], [0.02, -0.055], [-0.14, 0.02], [0.14, 0.02]], 'Vias');
  const led = look.led('#35ff7a', 'Frame LED');
  led.position.set(0.185, 0, 0.022);
  // The time meter: 0 to 40 ms, low and in front, filling as the trip adds up.
  const meter = look.meter('Time meter', { segments: 10, w: 0.1 });
  meter.position.set(0, 0, 0.108);
  const meterName = look.label('MS', 'Meter silkscreen', { h: 0.008 });
  meterName.position.set(-0.064, 0, 0.108);
  const keep = [...STOPS.map((s) => [s.at[0], s.at[1], 0.08, 0.05]), ...STOPS.map((s) => [s.label[0], s.label[1], 0.08, 0.02]),
    [0, -0.092, 0.12, 0.04], [0, 0.108, 0.14, 0.03], [-0.06, -0.06, 0.02, 0.02], [0.06, -0.06, 0.02, 0.02], [-0.17, -0.09, 0.024, 0.024], [0.17, -0.09, 0.024, 0.024], [0.185, 0.022, 0.02, 0.02]];
  const houses = look.smallParts(look.scatter(keep, { lines: [...LEGS.map((t) => t.path.points.map((p) => [p.x, p.z])), ...bus], count: 34, seed: 3, width: 0.44, depth: 0.3 }), 'Resistors and capacitors');
  subject.add(ram, ramName, towers, vias, led, meter, meterName, houses);

  // The pulse and the data token it carries. The token's label is what the data is after each stage.
  const pulse = look.pulse('Signal');
  subject.add(pulse.mesh);
  const token = look.token(['KEY A', '04', '04', 'A', 'PIXELS', 'SHOWN'], ['#f2f2ea', '#5ad1ff', '#8f7bff', '#ffb44a', '#ff6fae', '#7cff6a'], 'Data');
  subject.add(token.mesh);
  const HOVER = 0.03;                                   // the token rides 3 cm above the pulse
  const SPEED = 0.048;                                  // metres per second: slow enough to follow, and to grab
  const hoverAt = (i, out) => out.set(STOPS[i].at[0], HOVER, STOPS[i].at[1]);

  // The steps: one question each; the hands answer it on the board.
  const STEPS = [
    { title: 'From key to screen', text: 'Press A and a signal crosses the board. Watch the token: each chip changes what it carries. The meter adds up the time.' },
    { title: 'What does the keyboard send?', text: 'Press the USB chip to send the pulse from the keyboard. Notice what the token says when it arrives.' },
    { title: 'Which chip makes the letter?', text: 'The keyboard sent 04, the number of the A key, not a letter. Pick up the 04 and drop it on the chip that turns it into a letter.' },
    { title: 'Draw it, then show it', text: 'The processor looked up 04 in the keyboard layout: it is A. Press GPU to draw the A as pixels, then SCREEN to show it.' },
    { title: 'Where does the time go?', text: 'Press KEYBOARD to time a whole trip. Then try a 1000 Hz keyboard or a 144 Hz screen: which waits shrink?' },
  ];
  let step = 0;
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  const big = Math.max(size.x, size.y, size.z);
  const right = new THREE.Box3().setFromObject(root).max.x;
  const panel = kit.panel(ui, {
    width: 0.3, position: [Math.max(1.06 * big, right + 0.05), 0.6 * big, 0], rotationY: -0.3,
    eyebrow: 'INSIDE A COMPUTER', title: 'From a key to the screen',
    items: [
      { status: STEPS[0].title, tone: 'neutral', id: 'state' },
      { text: STEPS[0].text, id: 'info' },
      { stat: '0 ms', label: 'key to screen, longest waits', id: 'time' },
      { segmented: ['Keyboard 125 Hz', '1000 Hz'], selected: 0, id: 'usb', onSelect(i) { fastUsb = i === 1; panel.set('state', fastUsb ? 'Keyboard asked 1000 times a second' : 'Keyboard asked 125 times a second'); } },
      { segmented: ['Screen 60 Hz', '144 Hz'], selected: 0, id: 'hz', onSelect(i) { fastScreen = i === 1; panel.set('state', fastScreen ? 'Screen redraws 144 times a second' : 'Screen redraws 60 times a second'); } },
      { buttons: [{ label: 'Back', onPress() { go(step - 1); } }, { label: 'Next', onPress() { go(step + 1); } }] },
      { note: 'USB waits up to 1 / 125 s = 8 ms; a 60 Hz screen up to 1 / 60 s = 16.7 ms. A blink takes about 100 ms.' },
    ],
  });
  root.add(panel.object3D);

  // ---------------------------------------------------------------- the journey
  // at: the stop the pulse is at; leg >= 0 while it travels leg `leg` (from stop leg to leg + 1); goal: the stop it
  // runs on to by itself; dwell: time left in this stop's wait; fresh: this stop has not done its work yet.
  const J = { at: 0, leg: -1, u: 0, goal: 0, dwell: 0, dwellAll: 0, fresh: true, msDone: 0, ms: 0, loop: false, rest: 0, next: 0 };
  const level = [0, 0, 0, 0, 0];       // how awake each landmark is now
  const target = [0, 0, 0, 0, 0];
  const flash = [0, 0, 0, 0, 0];       // a press flashes the landmark at once
  let detached = false;                // the token was carried by hand and waits at the next stop
  let shownMs = '';
  const pos = new THREE.Vector3();
  const showMs = (total) => { const s = `${Math.round(total * 10) / 10} ms`; if (s !== shownMs) { shownMs = s; panel.set('time', s); } };

  // Put the journey in the state "the pulse is at stop i and its work is done" (fresh: not done yet).
  function placeAt(i, fresh = false) {
    J.at = i; J.leg = -1; J.u = 0; J.dwell = 0; J.fresh = fresh; J.goal = i; J.rest = 0;
    J.msDone = 0;
    for (let k = 0; k < (fresh ? i : i + 1); k++) J.msDone += msOf(k);
    J.ms = J.msDone;
    LEGS.forEach((t, k) => t.light(k < i ? 1 : 0));
    for (let k = 0; k < 5; k++) target[k] = k < i ? 0.45 : k === i && !fresh ? 1 : 0;
    token.show(fresh && i === 0 ? 0 : i + 1);
    hoverAt(i, token.mesh.position);
    seat.home.copy(token.mesh.position);
    detached = false;
    look.wake(led, i === 4 && !fresh ? 1 : 0);
    showMs(J.ms);
  }
  // The pulse arrives at stop i: the landmark wakes, the token changes, the stop starts its wait.
  function arrive(i) {
    J.at = i; J.leg = -1; J.fresh = false;
    J.dwellAll = J.dwell = 0.2 + msOf(i) * 0.08;      // the wait on the board grows with the real wait
    target[i] = 1;
    flash[i] = 1;
    token.show(i === 0 ? 0 : i + 1);
    if (i === 4) look.wake(led, 1);
    if (detached && i === 2) detached = false;       // the pulse caught up with the token the learner carried
  }
  // Stop i has done its work: count its time, then go on if the goal is further.
  function done(i) {
    J.msDone += msOf(i);
    J.ms = J.msDone;
    showMs(J.ms);
    if (i === 0) token.show(1);
    if (i < J.goal) send(i);
    else finished(i);
  }
  function send(from) {
    if (J.fresh && J.at === from) { arrive(from); return; }   // the stop does its work first
    J.leg = from; J.u = 0;
    target[from] = 0.45;
  }
  function finished(i) {
    if (step === 1 && i === 1) { panel.set('state', 'It sent 04, not a letter', 'good'); J.next = 2.2; }
    else if (step === 2 && i === 2) { panel.set('state', 'Right: the processor makes the letter', 'good'); J.next = 2.2; }
    else if (step === 3 && i === 4) { panel.set('state', 'A is on the screen', 'good'); J.next = 2.5; }
    else if (step === 4 && i === 4) panel.set('state', `Trip timed: ${shownMs}`, 'good');
    else if (step === 0 && i === 4) J.rest = 2;
  }
  function start(loop) {
    placeAt(0, true);
    J.loop = loop;
    J.goal = 4;
    send(0);
  }
  function go(n) {
    step = Math.max(0, Math.min(STEPS.length - 1, n));
    J.next = 0;
    panel.set('state', STEPS[step].title);
    panel.set('info', STEPS[step].text);
    panel.show('usb', step === 4);
    panel.show('hz', step === 4);
    if (step === 0) start(true);
    else if (step === 1) placeAt(0, true);
    else if (step === 4) placeAt(4);
    else placeAt(step - 1);
  }

  // ---------------------------------------------------------------- hands
  // Press a landmark: the keyboard starts a trip; any other stop is where the pulse should go next.
  STOPS.forEach((s, i) => traits(s.obj, {
    onPress() {
      flash[i] = 1;
      if (i === 0) {
        if (step === 4) start(false);
        else if (step === 0) start(true);
        else go(1);
        return;
      }
      if (J.leg >= 0 || J.dwell > 0) { panel.set('state', 'Wait: the pulse is still on its way'); return; }
      const next = J.at + 1;
      if (i <= J.at) panel.set('state', `The pulse has already passed ${s.name}`);
      else if (i > next) panel.set('state', `It cannot skip: it goes through ${STOPS[next].name} first`, 'poor');
      else if (step === 2) panel.set('state', 'Carry the 04 there with your hand: pick it up and drop it on the chip');
      else if (step === 1 || step === 3) { J.goal = i; send(J.at); }
    },
  }));
  // The token: picked up and dropped. In step 3 it must go to the chip that turns 04 into a letter.
  traits(token.mesh, { grab: true });
  const seat = lookSeat(THREE, token.mesh, isGrabbed, {
    returnAfter: 1,
    onAway() {
      if (step !== 2 || J.at !== 1 || J.leg >= 0) { panel.set('state', 'The data rides with the pulse: it slides back'); return; }
      const p = token.mesh.position;
      let best = -1;
      let bestD = 0.06;
      STOPS.forEach((s, i) => { const d = Math.hypot(p.x - s.at[0], p.z - s.at[1]); if (d < bestD) { bestD = d; best = i; } });
      if (best === 2) {
        detached = true;
        hoverAt(2, seat.home);                       // it settles over the processor while the pulse follows
        J.goal = 2;
        send(1);
        panel.set('state', 'Dropped on the processor: follow the pulse', 'good');
      } else if (best === 3) panel.set('state', 'The GPU draws letters, but it must be told which letter first', 'poor');
      else if (best === 4) panel.set('state', 'The screen only shows pixels. Something has to make the letter first', 'poor');
      else panel.set('state', 'Drop it right on top of a chip', 'neutral');
    },
  });

  go(0);
  return {
    root,
    update(time, delta) {
      seat.update(delta);
      const held = isGrabbed(token.mesh);
      const away = held || token.mesh.position.distanceTo(seat.home) > 0.002;
      // The pulse waits for its data: it only moves while the token rides with it (or was carried ahead).
      if (!away || detached) {
        if (J.leg >= 0) {
          const t = LEGS[J.leg];
          J.u = Math.min(1, J.u + (delta * SPEED) / t.length);
          t.light(J.u);
          if (J.u >= 1) arrive(J.leg + 1);
        } else if (J.dwell > 0) {
          J.dwell = Math.max(0, J.dwell - delta);
          J.ms = J.msDone + msOf(J.at) * (1 - J.dwell / J.dwellAll);
          if (J.dwell === 0) done(J.at);
        } else if (J.rest > 0) {
          J.rest -= delta;
          if (J.rest <= 0 && step === 0) start(true);
        }
      }
      if (J.next > 0) { J.next -= delta; if (J.next <= 0) go(step + 1); }
      // The pulse travels (never jumps): shown only on the move, the token above it.
      pulse.mesh.visible = J.leg >= 0;
      if (J.leg >= 0) pulse.follow(LEGS[J.leg].path, J.u);
      if (!away && !detached) {
        if (J.leg >= 0) LEGS[J.leg].path.at(J.u, pos);
        else hoverAt(J.at, pos);
        token.mesh.position.set(pos.x, HOVER, pos.z);
        seat.home.copy(token.mesh.position);
      }
      // Landmarks wake as the pulse arrives (the processor's dies light in a wave), stay faintly lit after it leaves.
      for (let i = 0; i < 5; i++) {
        level[i] += (target[i] - level[i]) * Math.min(1, delta * 2.5);
        flash[i] = Math.max(0, flash[i] - delta * 2.5);
        look.wake(STOPS[i].obj, Math.min(1, level[i] + 0.5 * flash[i]));
      }
      look.wake(ram, step >= 2 && J.at >= 2 ? 0.35 + 0.15 * Math.sin(time * 9) : 0);
      meter.userData.set(J.ms / 40);
    },
  };
}
