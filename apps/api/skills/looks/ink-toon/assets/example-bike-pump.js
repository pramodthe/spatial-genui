// Worked example (ink and toon): how to pump up a bicycle tyre, and why each push gets harder. Built on the look kit
// and inkToonLook (pasted above it by new-lesson.mjs); passes scripts/check.mjs. Take its method, not its subject:
// - one hero object (the wheel) and one bold action per step (squash it, pump, pump harder, squash it again), each
//   named by a big lettered word on a paper card at the front;
// - the quantity is in the scene, not only on the panel: the gauge needle is the pressure, the yellow arrow on the
//   handle is the push it takes (pressure x piston area), the squash of the tyre is how soft it is;
// - the hands do the real action: press the pump to push air in, press the tyre to feel how soft it is;
// - true numbers: a 3 cm x 50 cm pump barrel holds 0.35 litres; a 700x35 tyre holds about 2 litres, so one push adds
//   0.35 / 2 = 0.175 bar, and the push at the bottom of a stroke is pressure x 7.07 cm2 (141 N at 2 bar);
// - effects drawn in for two drawings (speed lines, impact ticks, a motion arc by the gauge), a lump of air that
//   travels down the hose, everything snapping on twos with an overshoot, nothing allocated in update().
export default function build({ THREE, kit, traits, ui, isGrabbed }) {
  const root = new THREE.Group();
  const look = inkToonLook(THREE, kit);
  const set = look.set({ width: 0.44, depth: 0.3 });
  root.add(set);
  const subject = new THREE.Group();
  subject.name = 'Wheel and pump';
  subject.userData.subject = true;
  subject.position.y = set.userData.top;
  root.add(subject);
  const F = 1 / 15;                                   // one drawing (props move on twos)

  // ---- the numbers
  const START = 2.0, TARGET = 3.5;                    // bar on the gauge; the tyre's side says 3.5
  const PUSH_L = 0.35, TYRE_L = 2.0;                  // litres of air per push, litres in the tyre
  const PER_PUSH = PUSH_L / TYRE_L;                   // 0.175 bar more per push
  const AREA = Math.PI * 0.015 * 0.015;               // piston 3 cm across: 7.07 cm2
  const NEED = Math.ceil((TARGET - START) / PER_PUSH - 1e-9);   // 9 pushes
  const MAX = 14;
  const barAt = (n) => START + n * PER_PUSH;
  const newtons = (bar) => bar * 1e5 * AREA;
  // Every text the panel can show, made once (update never builds strings).
  const pText = [], fText = [], leftText = [];
  for (let n = 0; n <= MAX; n++) {
    pText.push(`${(Math.round(barAt(n) * 10) / 10).toFixed(1)} bar`);
    fText.push(`${Math.round(newtons(barAt(n)))} N`);
    leftText.push(n >= NEED ? `${TARGET} bar reached` : `${NEED - n} push${NEED - n === 1 ? '' : 'es'} to ${TARGET} bar`);
  }

  // ---- the wheel (the hero): its origin is where the tyre touches, so a squash keeps it on the stand
  const WX = -0.075, WZ = -0.01, R = 0.11;
  const wheel = new THREE.Group();
  wheel.name = 'Wheel';
  wheel.position.set(WX, 0, WZ);
  subject.add(wheel);
  const tyre = look.ink(new THREE.TorusGeometry(0.098, 0.012, 12, 56), 'charcoal', 'Tyre', { halftone: true, own: true });
  tyre.position.y = R;
  const rim = look.ink(new THREE.TorusGeometry(0.085, 0.0035, 8, 56), 'navy', 'Rim', { line: 0.0015 });
  rim.position.y = R;
  const hub = look.rod(0.009, 0.03, 'navy', 'Hub', { line: 0.0015 });
  hub.rotation.x = Math.PI / 2;
  hub.position.y = R;
  const spokes = new THREE.Group();                   // ink lines, merged into one draw call
  spokes.name = 'Spokes';
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const s = look.rod(0.0011, 0.075, 'ink', 'Spoke', { outline: false, sides: 6 });
    s.position.set(Math.cos(a) * 0.0455, R + Math.sin(a) * 0.0455, (i % 2 ? 1 : -1) * 0.004);
    s.rotation.z = a - Math.PI / 2;
    spokes.add(s);
  }
  kit.merge(spokes);
  wheel.add(tyre, rim, hub, spokes);
  const stand = look.box(0.07, 0.018, 0.05, 'navy', 'Wheel stand');
  stand.position.set(WX, 0.009, WZ);
  const wheelShadow = look.shadow(0.06, 0.02, 'Wheel shadow');
  wheelShadow.position.set(WX + 0.035, wheelShadow.position.y, WZ - 0.022);
  subject.add(wheelShadow, stand);

  // The valve and the pump head clamped on it (bottom right of the rim), and the hose back to the pump.
  const VA = -0.9;
  const vx = WX + Math.cos(VA) * 0.079, vy = R + Math.sin(VA) * 0.079;
  const stem = look.rod(0.0022, 0.014, 'navy', 'Valve stem', { outline: false });
  stem.position.set(vx, vy, WZ);
  stem.rotation.z = VA + Math.PI / 2;
  const head = look.box(0.014, 0.014, 0.026, 'charcoal', 'Pump head', { line: 0.0015 });
  head.position.set(vx, vy, WZ + 0.016);
  subject.add(stem, head);

  // ---- the pump
  const PX = 0.14, PZ = -0.005, Y_UP = 0.26, TRAVEL = 0.08;
  const pump = new THREE.Group();
  pump.name = 'Pump';
  subject.add(pump);
  const foot = look.box(0.09, 0.01, 0.034, 'navy', 'Pump foot');
  foot.position.set(PX, 0.005, PZ);
  const barrel = look.turned([[0, 0], [0.012, 0], [0.012, 0.15], [0.009, 0.156], [0, 0.156]], 'persimmon', 'Barrel', { halftone: true });
  barrel.position.set(PX, 0.01, PZ);
  look.crease(barrel, 0.0122, 0.012, -60, 110);
  const cap = look.turned([[0, 0], [0.0135, 0], [0.0135, 0.008], [0.006, 0.012], [0, 0.012]], 'navy', 'Barrel cap', { line: 0.0015 });
  cap.position.set(PX, 0.162, PZ);
  pump.add(foot, barrel, cap);
  // The handle moves: rod, bar and two grips (own materials so they can glow when it is their step).
  const handle = new THREE.Group();
  handle.name = 'Handle';
  handle.position.set(PX, Y_UP, PZ);
  const rod = look.rod(0.0028, 0.1, 'navy', 'Pump rod', { line: 0.0012 });
  rod.position.y = -0.05;
  const bar = look.rod(0.0065, 0.085, 'charcoal', 'Handle bar', { own: true });
  bar.rotation.z = Math.PI / 2;
  bar.position.y = 0.006;
  handle.add(rod, bar);
  const glowing = [bar];
  for (const side of [-1, 1]) {
    const grip = look.rod(0.0085, 0.03, 'charcoal', 'Grip', { own: true });
    grip.rotation.z = Math.PI / 2;
    grip.position.set(side * 0.03, 0.006, 0);
    handle.add(grip);
    glowing.push(grip);
  }
  pump.add(handle);
  // The gauge: a white dial on the foot, 0 to 6 bar over 240 degrees, a red tick at the target, an ink needle.
  const angleOf = (bar) => ((210 - bar * 40) * Math.PI) / 180;
  const dial = new THREE.Group();
  dial.name = 'Gauge';
  dial.position.set(PX + 0.03, 0.028, PZ + 0.008);
  dial.rotation.x = -0.35;
  const face = look.rod(0.019, 0.006, 'white', 'Gauge face', { line: 0.0015 });
  face.rotation.x = Math.PI / 2;
  const ticks = [];
  for (let b = 0; b <= 6; b++) { const a = angleOf(b); ticks.push([[[Math.cos(a) * 0.0132, Math.sin(a) * 0.0132], [Math.cos(a) * 0.0165, Math.sin(a) * 0.0165]], 0.0012, 'none']); }
  const scale = look.mark(ticks, 'ink', { name: 'Gauge scale' });
  scale.position.z = 0.0032;
  const ta = angleOf(TARGET);
  const target = look.mark([[[[Math.cos(ta) * 0.0095, Math.sin(ta) * 0.0095], [Math.cos(ta) * 0.0168, Math.sin(ta) * 0.0168]], 0.0024, 'none']], 'persimmon', { name: 'Target mark', edge: 0.0006 });
  target.position.z = 0.0033;
  const needlePivot = new THREE.Group();
  needlePivot.position.z = 0.0045;
  const needle = look.box(0.0016, 0.0145, 0.001, 'ink', 'Needle', { outline: false, radius: 0.0003 });
  needle.geometry.translate(0, 0.0062, 0);
  needlePivot.add(needle, look.ball(0.0022, 'ink', 'Needle pin', { outline: false }));
  const jump = look.motionArc(0.026, 2.3, 1.1, { width: 0.0024, name: 'Needle jump' });
  jump.position.z = 0.004;
  dial.add(face, scale, target, needlePivot, jump);
  pump.add(dial);
  const pumpShadow = look.shadow(0.05, 0.022, 'Pump shadow');
  pumpShadow.position.set(PX + 0.022, pumpShadow.position.y, PZ - 0.014);
  subject.add(pumpShadow);

  // The hose, and the lump of air that runs down it on each push (from the pump to the valve).
  const HOSE = [[PX - 0.018, 0.012, PZ + 0.012], [0.105, 0.005, 0.045], [0.06, 0.005, 0.068], [0.01, 0.006, 0.06], [vx + 0.006, 0.022, 0.045], [vx, vy - 0.006, WZ + 0.03]];
  subject.add(look.tube(HOSE, 0.0035, 'charcoal', 'Hose', { line: 0.0015 }));
  const hosePath = lookPath(THREE, HOSE);
  const air = [];
  for (let i = 0; i < 3; i++) { const b = look.ball(0.0058 - i * 0.0008, 'white', 'Air', { line: 0.0012 }); b.visible = false; subject.add(b); air.push(b); }

  // ---- the drawn-in effects and the push arrow
  const speed = look.speedLines(0.035, { n: 3, gap: 0.022 });
  speed.rotation.z = Math.PI / 2;                     // lines trail above the handle as it comes down
  speed.position.set(PX, Y_UP, PZ + 0.012);
  const thump = look.impact(7, 0.03, 0.014, { ry: 0.012, from: 0, to: Math.PI, seed: 2, name: 'Handle hits bottom' });
  thump.position.set(PX, Y_UP - TRAVEL + 0.004, PZ + 0.012);
  const squashTicks = look.impact(6, 0.022, 0.016, { ry: 0.01, from: 0.2, to: Math.PI - 0.2, seed: 5, name: 'Tyre squash' });
  squashTicks.position.set(WX, 2 * R - 0.004, WZ + 0.015);
  const push = look.arrow(0.03, 'mustard', 'Push needed', { width: 0.007 });
  push.rotation.z = Math.PI;                          // points down onto the handle
  push.position.set(PX, Y_UP + 0.04, PZ);
  for (const m of [speed, thump, squashTicks, jump, push]) m.visible = false;
  subject.add(speed, thump, squashTicks, push);

  // ---- the step words: one big lettered word per step, on a card low at the front left
  const STEPS = [
    { word: 'SQUASH', title: 'How soft is it?', text: 'This tyre is at 2.0 bar; its side says 3.5. Press the tyre and watch how far it squashes.' },
    { word: 'PUMP!', title: 'What does one push do?', text: 'Press the pump. One push squeezes 0.35 litres of air into a 2 litre tyre: about 0.18 bar more. Watch the gauge.' },
    { word: 'HARDER', title: 'Why is each push harder?', text: 'The air inside pushes back on the piston: push = pressure x piston area (7 cm2). The yellow arrow grows with the gauge.' },
    { word: 'FIRM!', title: 'Is it firm now?', text: 'Press the tyre again. At 3.6 bar it squashes about half as far as at 2 bar: ready to ride.' },
  ];
  const words = STEPS.map((s, i) => {
    const w = look.stepWord(s.word, { h: 0.02, n: i + 1 });
    w.position.set(-0.105, 0, 0.1);
    w.visible = i === 0;
    subject.add(w);
    return w;
  });
  const wordTicks = look.impact(8, 0.085, 0.016, { ry: 0.03, from: -0.3, to: Math.PI + 0.3, seed: 7, name: 'Word pops' });
  wordTicks.position.set(-0.105, 0.03, 0.1);
  wordTicks.visible = false;
  subject.add(wordTicks);

  // Two name tags, right beside their parts.
  const gaugeTag = kit.card('Gauge');
  gaugeTag.position.set(PX + 0.075, 0.03, PZ + 0.02);
  const valveTag = kit.card('Valve');
  valveTag.position.set(vx + 0.045, vy - 0.02, 0.05);
  subject.add(gaugeTag, valveTag);

  // ---- the panel
  let step = 0;
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  const big = Math.max(size.x, size.y, size.z);
  const right = new THREE.Box3().setFromObject(root).max.x;
  const panel = kit.panel(ui, {
    width: 0.3, position: [Math.max(1.06 * big, right + 0.05), 0.6 * big, 0], rotationY: -0.3,
    eyebrow: 'HOW TO', title: 'Pump up a bike tyre',
    items: [
      { status: STEPS[0].title, tone: 'neutral', id: 'state' },
      { text: STEPS[0].text, id: 'info' },
      { stat: pText[0], label: `tyre pressure (side says ${TARGET})`, id: 'bar' },
      { stat: fText[0], label: 'push at the bottom of a stroke', id: 'force' },
      { buttons: [{ label: 'Back', onPress() { go(step - 1); } }, { label: 'Next', onPress() { go(step + 1); } }, { label: 'Let air out', onPress() { letOut = true; } }] },
      { note: 'Press the pump to push. Press the tyre to feel it.' },
    ],
  });
  root.add(panel.object3D);
  let tq = 0, stepT = -10;
  function go(n) {
    step = Math.max(0, Math.min(STEPS.length - 1, n));
    stepT = tq;
    panel.set('state', STEPS[step].title);
    panel.set('info', STEPS[step].text);
  }

  // ---- hands: the presses only raise a flag; update() runs the action on the twos clock
  let pumpPressed = false, tyrePressed = false, letOut = false;
  traits(pump, { onPress() { pumpPressed = true; } });
  traits(wheel, { onPress() { tyrePressed = true; } });

  let pushes = 0, strokeT = -1, queued = false, arrived = false;
  let needleFrom = START, needleT = -10, shown = START;
  let tyreT = -10, tyreAmp = 0, goAt = -1;
  const startStroke = () => { strokeT = tq; arrived = false; };
  return {
    root,
    update(time) {
      tq = lookTwos(time);
      const n = Math.round(tq * 15);

      // The learner's actions.
      if (letOut) {
        letOut = false;
        needleFrom = shown; needleT = tq; pushes = 0; strokeT = -1; queued = false;
        panel.set('bar', pText[0]); panel.set('force', fText[0]);
        go(0);
      }
      if (pumpPressed) {
        pumpPressed = false;
        if (step === 0) go(1);
        if (pushes >= MAX) panel.set('state', 'Plenty: the side says 3.5 to 5 bar', 'good');
        else if (strokeT < 0) startStroke();
        else queued = true;
      }
      if (tyrePressed) {
        tyrePressed = false;
        tyreT = tq;
        tyreAmp = (0.16 * START) / barAt(pushes);         // a thumb squashes a tyre about 1 / pressure
        if (step === 0) { panel.set('state', 'Soft: it squashes a long way at 2 bar', 'poor'); goAt = tq + 1.2; }
        else if (pushes >= NEED) panel.set('state', 'Firm: about half the squash it had at 2 bar', 'good');
        else panel.set('state', 'Still soft: keep pumping', 'neutral');
      }
      if (goAt > 0 && tq >= goAt) { goAt = -1; if (step === 0) go(1); }

      // One stroke of the pump: down in three drawings with an overshoot, a thump, the air runs down the hose and
      // reaches the tyre, the handle comes back up.
      let y = Y_UP;
      const x = strokeT >= 0 ? tq - strokeT : -1;
      if (x >= 0) {
        const down = lookBack(lookSeg(x, 0, 3 * F), 1.8), up = lookBack(lookSeg(x, 6 * F, 11 * F), 1.2);
        y = Y_UP - TRAVEL * down * (1 - up);
        const s = lookSeg(x, 3 * F, 10 * F) * 1.25;
        for (let i = 0; i < 3; i++) {
          const u = s - i * 0.12;
          air[i].visible = x >= 3 * F && u > 0 && u < 1;
          if (air[i].visible) hosePath.at(u, air[i].position);
        }
        if (!arrived && x >= 10 * F) {
          arrived = true;
          needleFrom = shown; needleT = tq; pushes++;
          panel.set('bar', pText[pushes]); panel.set('force', fText[pushes]);
          panel.set('state', leftText[pushes], pushes >= NEED ? 'good' : 'neutral');
          if (step === 1 && pushes >= 3) go(2);
          if (pushes >= NEED && step < 3) { go(3); panel.set('state', `${pText[pushes]}: press the tyre to check`, 'good'); }
        }
        if (x >= 11 * F) { strokeT = -1; if (queued && pushes < MAX) { queued = false; startStroke(); } }
      } else {
        for (let i = 0; i < 3; i++) air[i].visible = false;
      }
      handle.position.y = y;
      speed.visible = x >= F && x < 3 * F;
      speed.position.y = y + 0.01;
      thump.visible = x >= 3 * F && x < 5 * F;
      thump.scale.setScalar(x < 4 * F ? 0.85 : 1.1);

      // The gauge snaps to the new pressure with an overshoot; the arrow is the push that pressure takes.
      const goal = barAt(pushes);
      shown = needleFrom + (goal - needleFrom) * lookBack(lookSeg(tq - needleT, 0, 3 * F), 2.2);
      needlePivot.rotation.z = angleOf(shown) - Math.PI / 2;
      jump.visible = tq - needleT >= 0 && tq - needleT < 3 * F && pushes > 0;
      const len = 0.00018 * newtons(shown);
      look.stretch(push, len);
      push.visible = step >= 1;
      push.position.y = y + 0.014 + len;

      // The tyre: pressed, it squashes (less the harder it is) and springs back; each push swells it a little.
      const t = tq - tyreT;
      let s = 1;
      if (t >= 0 && t < 2) s = t < F ? 1 - tyreAmp * 0.6 : t < 3 * F ? 1 - tyreAmp : 1 + tyreAmp * 0.5 * look.wobble(t - 3 * F, 2.6, 7);
      s *= 1 + 0.03 * look.wobble(tq - needleT, 3, 9);
      look.squash(wheel, s);
      squashTicks.visible = t >= F && t < 3 * F;

      // The step's word lands with an overshoot and ticks; the part to act on glows.
      const w = tq - stepT;
      for (let i = 0; i < words.length; i++) words[i].visible = i === step;
      words[step].scale.setScalar(Math.max(0.001, look.pop(w, 0.25)));
      wordTicks.visible = w >= F && w < 3 * F;
      const pulse = 0.45 + 0.25 * (n % 8 < 4 ? 1 : 0);
      look.glow(tyre, step === 0 || step === 3 ? pulse : 0);
      for (let i = 0; i < glowing.length; i++) look.glow(glowing[i], step === 1 || step === 2 ? pulse : 0);
    },
  };
}
