// Worked example (pencil sketch; the same method serves ink and toon and painted). The look-kit functions were pasted above it
// (lookSeg, lookBack, lookShade, lookOutline from references/look-kit.js); assembled, it passes the dry run, the audit
// and the photos. Take its method (self-lit drawn materials, outlines, a wash on the step's part, numbered notes with
// leader lines, start whole), not its subject.
// A pencil-sketch lesson: how a wooden stool goes together, in three steps, on a sketchbook page.
// Every part is drawn with the hatch shader and a graphite outline; the step's part takes the red marker wash and a
// numbered red note. Step 0 shows the whole stool (the host fits a lesson by what it shows first).
export default function build({ THREE, kit, traits, ui, isGrabbed }) {
  const root = new THREE.Group();
  const PAPER = '#f2ede0', GRAPHITE = '#33343a', RED = '#cf472b', WASH = '#e8967a';
  const D = { seatW: 0.2, seatD: 0.2, seatT: 0.025, legH: 0.24, leg: 0.022, rail: 0.016, railY: 0.08, page: 0.006 };

  // The sketchbook page, with faint construction lines: the stool's footprint and its centre lines.
  const paperMat = lookShade(THREE, { mode: 'cel', lit: PAPER, shade: '#e4dccb', band: 0.2 });
  const page = new THREE.Mesh(kit.roundedBox(0.36, D.page, 0.3, 0.002), paperMat);
  page.name = 'Sketchbook page';
  page.position.y = D.page / 2;
  root.add(page);
  const lineMat = kit.material('plastic', { color: '#c9c2b2', wear: 0 });
  const lines = new THREE.Group();
  lines.name = 'Construction lines';
  for (const [w, d, x, z] of [[0.3, 0.0008, 0, 0], [0.0008, 0.26, 0, 0], [D.seatW, 0.0008, 0, -D.seatD / 2], [D.seatW, 0.0008, 0, D.seatD / 2], [0.0008, D.seatD, -D.seatW / 2, 0], [0.0008, D.seatD, D.seatW / 2, 0]]) {
    const l = new THREE.Mesh(kit.roundedBox(w, 0.0004, d, 0.0001), lineMat);
    l.position.set(x, D.page + 0.0002, z);
    lines.add(l);
  }
  root.add(lines);

  // The stool. Each step's parts share one group so the step can lift and wash them together.
  const hatch = lookShade(THREE, { mode: 'hatch', lit: PAPER, ink: GRAPHITE, scale: 0.005 });
  const wash = lookShade(THREE, { mode: 'hatch', lit: WASH, ink: GRAPHITE, scale: 0.005 });
  const stool = new THREE.Group();
  stool.name = 'Stool';
  stool.userData.subject = true;
  stool.position.y = D.page;
  stool.rotation.y = -0.45;                       // a three-quarter view: every leg in sight from the seat
  root.add(stool);
  const draw = (geometry, name, group) => {
    const mesh = new THREE.Mesh(geometry, hatch);
    mesh.name = name;
    lookOutline(THREE, mesh, { width: 0.0012, color: GRAPHITE });
    group.add(mesh);
    return mesh;
  };
  const steps = [
    { word: 'Legs', note: '1', text: 'Four legs stand at the corners, splayed out a little so the stool does not tip.' },
    { word: 'Rails', note: '2', text: 'Rails join the legs low down. They stop the legs spreading when you sit.' },
    { word: 'Seat', note: '3', text: 'The seat sits on top of the legs and ties them together. Your weight goes down the legs.' },
  ].map((s) => ({ ...s, group: new THREE.Group(), meshes: [] }));
  steps.forEach((s, i) => { s.group.name = s.word; stool.add(s.group); });
  const lx = D.seatW / 2 - D.leg, lz = D.seatD / 2 - D.leg;
  for (const [x, z, name] of [[-lx, -lz, 'Back left leg'], [lx, -lz, 'Back right leg'], [-lx, lz, 'Front left leg'], [lx, lz, 'Front right leg']]) {
    const leg = draw(kit.roundedBox(D.leg, D.legH, D.leg, 0.003), name, steps[0].group);
    leg.position.set(x, D.legH / 2, z);
    steps[0].meshes.push(leg);
  }
  for (const [x, z, w, d] of [[0, -lz, 2 * lx - D.leg, D.rail], [0, lz, 2 * lx - D.leg, D.rail], [-lx, 0, D.rail, 2 * lz - D.leg], [lx, 0, D.rail, 2 * lz - D.leg]]) {
    const rail = draw(kit.roundedBox(w, D.rail, d, 0.002), 'Rail', steps[1].group);
    rail.position.set(x, D.railY, z);
    steps[1].meshes.push(rail);
  }
  // The seat has its own group so the learner can lift it off and put it back (the step animation moves the step's
  // group, the hand moves this one). Its seat position is kept to check where it is let go.
  const seatHold = new THREE.Group();
  seatHold.name = 'Seat (lift it off)';
  seatHold.position.y = D.legH + D.seatT / 2;
  steps[2].group.add(seatHold);
  const seat = draw(kit.roundedBox(D.seatW, D.seatT, D.seatD, 0.008), 'Seat', seatHold);
  steps[2].meshes.push(seat);
  const seatHome = seatHold.position.clone();
  let seatWasHeld = false;

  // Numbered red notes with leader lines, one per step, in a column to the right of the stool.
  const red = kit.material('plastic', { color: RED, wear: 0 });
  const notes = steps.map((s, i) => {
    const g = new THREE.Group();
    g.name = `Note ${s.note}`;
    const card = kit.card(`${s.note}  ${s.word}`, { width: 0.06 });
    const y = [0.12, 0.08, 0.27][i];
    card.position.set(0.17, y, 0.04);
    g.add(card);
    const at = new THREE.Vector3(...[[lx, 0.12, lz], [lx, D.railY, 0], [D.seatW / 2 - 0.03, D.legH + D.seatT, 0.03]][i]);
    at.applyAxisAngle(new THREE.Vector3(0, 1, 0), stool.rotation.y);   // the stool is turned: point at where the part is
    g.add(new THREE.Mesh(kit.tube([[0.14, y, 0.04], [at.x, at.y + D.page, at.z]], 0.0007), red));
    g.visible = false;
    root.add(g);
    return g;
  });

  let step = -1;
  let since = 0;
  const panel = kit.panel(ui, {
    width: 0.3, position: [0.36, 0.22, -0.02], rotationY: -0.3, eyebrow: 'HOW A STOOL GOES TOGETHER', title: 'Drawing a stool',
    items: [
      { status: 'The whole stool', tone: 'neutral', id: 'state' },
      { text: 'Lift the seat off, or press a leg or a rail to draw that part.', id: 'info' },
      { buttons: [{ label: 'Back', onPress() { go(step - 1); } }, { label: 'Next', onPress() { go(step + 1); } }] },
    ],
  });
  root.add(panel.object3D);
  // Hands: the seat can be lifted off and put back; pressing a leg or a rail draws that step.
  traits(seatHold, { grab: true });
  steps[0].meshes.forEach((m) => traits(m, { onPress() { go(0); } }));
  steps[1].meshes.forEach((m) => traits(m, { onPress() { go(1); } }));
  function go(n) {
    step = Math.max(-1, Math.min(2, n));
    since = 0;
    steps.forEach((s, i) => s.meshes.forEach((m) => { m.material = i === step ? wash : hatch; }));
    notes.forEach((g, i) => { g.visible = step === -1 || i <= step; });
    panel.set('state', step === -1 ? 'The whole stool' : `Step ${step + 1} of 3: ${steps[step].word}`);
    panel.set('info', step === -1 ? 'Lift the seat off, or press a leg or a rail to draw that part.' : steps[step].text);
  }
  go(-1);

  return {
    root,
    update(time, delta) {
      since += delta;
      // Let go near its place, the seat drops home and the panel says why it matters; elsewhere it stays put.
      const held = isGrabbed(seatHold);
      if (seatWasHeld && !held) {
        if (seatHold.position.distanceTo(seatHome) < 0.03) {
          seatHold.position.copy(seatHome);
          seatHold.rotation.set(0, 0, 0);
          panel.set('state', 'Seat back on', 'good');
          panel.set('info', steps[2].text);
        } else {
          panel.set('state', 'Seat off: the legs can spread', 'poor');
        }
      }
      seatWasHeld = held;
      steps.forEach((s, i) => {
        // Parts after the current step are not drawn yet; the current one is set down from just above.
        const shown = step === -1 || i <= step;
        s.group.visible = shown;
        s.group.position.y = i === step ? 0.03 * (1 - lookBack(lookSeg(since, 0, 0.6))) : 0;
      });
    },
  };
}
