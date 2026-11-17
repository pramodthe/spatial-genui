// Worked example (painted): how one sheep's fleece becomes four jumpers. Built on the look kit and paintedLook (pasted
// above it by new-lesson.mjs); passes scripts/check.mjs. Take its method, not its subject:
// - the place is a row of stops along a track, each a big simple shape with a warm lamp (pasture, stream, cottage,
//   washing line), and the story runs left to right;
// - a traveller carries the cause from stop to stop: the basket. The learner carries it to the next lit lamp (or
//   presses the next stop and it walks there along the track), and each stop does one visible thing to what is in it;
// - the quantity is visible stuff in the basket (a heap of fleece that shrinks when washed, four balls of yarn, four
//   jumpers on the line), its true number is on the panel and the signboard, computed from the same state;
// - each step asks one question; gentle continuous motion (grass, smoke, the wheel), nothing allocated in update().
export default function build({ THREE, kit, traits, ui, isGrabbed }) {
  const root = new THREE.Group();
  const look = paintedLook(THREE, kit);
  const set = look.set({ width: 0.44, depth: 0.3 });
  root.add(set);
  const subject = new THREE.Group();
  subject.name = 'Farm';
  subject.userData.subject = true;
  subject.position.y = set.userData.top;
  root.add(subject);

  // ---- the place: a track from the pasture over the stream to the cottage and the washing line
  const SEATS = [[-0.12, 0, 0.07], [-0.015, 0.008, 0.08], [0.075, 0, 0.045], [0.17, 0.02, 0.06]];   // where the basket stands at each stop
  const track = look.path([[-0.2, 0.06], ...SEATS.map((s) => [s[0], s[2]]), [0.21, 0.08]], 'Track', { width: 0.026 });
  const stream = look.river([[0.0, -0.15], [-0.03, -0.05], [-0.06, 0.04], [-0.055, 0.15]], 'Stream', { width: 0.04 });
  const bridge = look.paint(kit.roundedBox(0.026, 0.005, 0.05, 0.0015), 'wood', 'Footbridge', 0.008);
  bridge.position.set(-0.058, 0.004, 0.083);
  bridge.rotation.y = 1.45;
  const grass = look.field(0.11, 0.07, 'Pasture grass', { n: 160, colour: 'meadow', soil: 'meadow', h: 0.018, ears: false });
  grass.position.set(-0.15, 0, -0.06);
  const hedge = look.hedge(0.12, 'Hedge', { h: 0.026 });
  hedge.position.set(-0.15, 0, -0.125);
  const oak = look.tree('Oak', { h: 0.1 });
  oak.position.set(0.17, 0, -0.1);
  const poplar = look.tree('Poplar', { h: 0.11, kind: 'poplar' });
  poplar.position.set(-0.035, 0, -0.12);
  const sun = look.sun(0.018);
  sun.position.set(-0.19, 0.16, -0.14);
  subject.add(track, stream, bridge, grass, hedge, oak, poplar, sun);

  // Stop 1, the pasture: the sheep in its fleece, and the shearer.
  const sheep = look.animal('Sheep', { kind: 'sheep', len: 0.06, colour: 'linen' });   // shorn body under the fleece
  sheep.position.set(-0.165, 0, 0.0);
  const fleece = look.blob(0.024, 'wool', 'Fleece', { squash: 0.8 });
  fleece.position.set(0, 0.027, 0);
  fleece.scale.set(1.2, 1.15, 0.85);
  sheep.add(fleece);
  const shearer = look.figure('Shearer', { h: 0.06, colour: 'cloth', hat: true });
  shearer.position.set(-0.2, 0, 0.05);
  shearer.rotation.y = 0.6;
  subject.add(sheep, shearer);

  // Stop 2, the stream: a flat washing stone at the bank.
  const stone = look.paint(lookLumpy(THREE, kit.roundedBox(0.05, 0.008, 0.04, 0.003), 0.0015, 0.02, 4), 'stone', 'Washing stone', 0.01);
  stone.position.set(-0.015, 0.004, 0.08);
  subject.add(stone);

  // Stop 3, the cottage: lit window, smoke, and a spinning wheel by the door.
  const cottage = look.house('Cottage', { w: 0.085, d: 0.06, h: 0.055 });
  cottage.position.set(0.08, 0, -0.065);
  const smoke = look.smoke('Chimney smoke', { n: 4, h: 0.06 });
  const ch = cottage.userData.chimney;
  smoke.position.set(0.08 + ch[0], ch[1], -0.065 + ch[2]);
  const spinner = new THREE.Group();
  spinner.name = 'Spinning wheel';
  const stand = look.paint(kit.roundedBox(0.04, 0.008, 0.016, 0.002), 'wood', 'Spinning wheel stand', 0.008);
  stand.position.y = 0.004;
  const leg = look.paint(kit.roundedBox(0.006, 0.028, 0.006, 0.0015), 'wood', 'Spinning wheel post', 0.008);
  leg.position.set(-0.004, 0.02, 0);
  spinner.add(stand, leg);
  kit.merge(spinner);
  const wheel = look.paint(new THREE.CylinderGeometry(0.02, 0.02, 0.004, 20), 'wood', 'Spinning wheel disc', 0.008);
  wheel.geometry.rotateX(Math.PI / 2);                 // faces +z; it turns about z
  wheel.position.set(-0.004, 0.034, 0.006);
  spinner.add(wheel);
  spinner.position.set(0.03, 0, 0.005);
  subject.add(cottage, smoke, spinner);

  // Stop 4, the washing line and a bench to set the basket on.
  const line = new THREE.Group();
  line.name = 'Washing line';
  for (const x of [0.125, 0.215]) {
    const post = look.paint(kit.roundedBox(0.006, 0.078, 0.006, 0.0015), 'bark', 'Line post', 0.008);
    post.position.set(x, 0.039, 0);
    line.add(post);
  }
  const cord = look.paint(new THREE.CylinderGeometry(0.0012, 0.0012, 0.09, 5), 'linen', 'Line', 0.006);
  cord.rotation.z = Math.PI / 2;
  cord.position.set(0.17, 0.072, 0);
  line.add(cord);
  kit.merge(line);
  const bench = look.paint(kit.roundedBox(0.06, 0.02, 0.036, 0.003), 'wood', 'Bench', 0.01);
  bench.position.set(0.17, 0.01, 0.06);
  const J = 0.0075;                                     // half the body width of a jumper
  const jumperShape = [[-J, 0], [J, 0], [J, 0.012], [J * 1.6, 0.009], [J * 2, 0.015], [J * 0.6, 0.022], [-J * 0.6, 0.022], [-J * 2, 0.015], [-J * 1.6, 0.009], [-J, 0.012]];
  const jumpers = [0.137, 0.159, 0.181, 0.203].map((x, i) => {
    const j = look.paint(kit.extrude(jumperShape, 0.004, { bevel: 0.001 }), 'red', `Jumper ${i + 1}`, 0.006);
    j.position.set(x, 0.049, 0.003);
    subject.add(j);
    return j;
  });
  subject.add(line, bench);

  // A lamp marks each stop: lit where the basket is, glowing gently where it goes next.
  const lantern = (name, x, z) => {
    const post = look.paint(kit.roundedBox(0.005, 0.06, 0.005, 0.0015), 'bark', `${name} post`, 0.008);
    post.position.set(x, 0.03, z);
    const lamp = look.lamp(0.014, name, { on: 0.1 });
    lamp.position.set(x, 0.066, z);
    subject.add(post, lamp);
    return lamp;
  };
  const lamps = [lantern('Pasture lamp', -0.09, 0.03), lantern('Stream lamp', 0.012, 0.05), cottage.userData.window, lantern('Line lamp', 0.205, 0.035)];

  // ---- the traveller: a basket. What is in it is the quantity: fleece (greasy, then clean), then yarn.
  const basket = new THREE.Group();
  basket.name = 'Basket';
  const shell = new THREE.Group();
  const wicker = look.paint(kit.lathe([[0, 0], [0.016, 0], [0.021, 0.008], [0.023, 0.02], [0.0205, 0.02], [0.019, 0.009], [0.015, 0.002], [0, 0.002]], 18), 'wheat', 'Basket wicker', 0.006);
  const handle = look.paint(new THREE.TorusGeometry(0.019, 0.0025, 6, 16, Math.PI), 'wood', 'Basket handle', 0.006);
  handle.position.y = 0.019;
  shell.add(wicker, handle);
  kit.merge(shell);
  const heap = look.pile('Wool in the basket', { r: 0.019, colour: 'wool' });
  heap.material = look.own('wool', 0.006);              // its own paint: greasy fleece turns clean in the stream
  heap.position.y = 0.004;
  const balls = [[-0.008, -0.006], [0.008, -0.006], [-0.008, 0.007], [0.008, 0.007]].map(([x, z], i) => {
    const b = look.blob(0.0075, 'red', `Ball of yarn ${i + 1}`);
    b.position.set(x, 0.01, z);
    basket.add(b);
    return b;
  });
  basket.add(shell, heap);
  subject.add(basket);
  const GREASY = [new THREE.Color('#d8c49a'), new THREE.Color('#6a5a5a')];
  const CLEAN = [new THREE.Color(look.PAL.wool[0]), new THREE.Color(look.PAL.wool[1])];

  // The route along the track, and where each stop sits on it (0..1).
  const route = track.userData.route;
  const along = [0];
  for (let i = 1; i < route.points.length; i++) along.push(along[i - 1] + route.points[i].distanceTo(route.points[i - 1]));
  const seatU = SEATS.map((_, i) => along[i + 1] / route.length);

  // ---- the story, one state number: 0 = sheep in fleece, 1 = shorn (4 kg), 2 = washed (2 kg), 3 = spun (4 balls),
  // 4 = knitted (4 jumpers). Everything the learner sees and reads is computed from it.
  const kgAt = (v) => (v <= 1 ? 4 * v : v <= 2 ? 4 - 2 * (v - 1) : v <= 3 ? 2 : 2 - 2 * (v - 3));
  const KG = ['0 kg', '0.5 kg', '1 kg', '1.5 kg', '2 kg', '2.5 kg', '3 kg', '3.5 kg', '4 kg'];
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  function show(v) {
    const shorn = clamp01(v);
    fleece.visible = shorn < 0.98;
    fleece.scale.set(1.2 * (1 - shorn), 1.15 * (1 - shorn), 0.85 * (1 - shorn));
    const loose = v <= 2 ? kgAt(v) : v <= 3 ? 2 - 2 * (v - 2) : 0;   // fleece or clean wool not yet spun
    heap.userData.fill(loose / 4);
    const clean = clamp01(v - 1);
    heap.material.uniforms.uLit.value.lerpColors(GREASY[0], CLEAN[0], clean);
    heap.material.uniforms.uShade.value.lerpColors(GREASY[1], CLEAN[1], clean);
    const knitted = v < 3 ? 0 : Math.min(4, Math.floor((v - 3) * 4 + 0.5));
    const spun = v < 2 ? 0 : v < 3 ? Math.min(4, Math.floor((v - 2) * 4 + 0.5)) : 4 - knitted;
    for (let i = 0; i < 4; i++) { balls[i].visible = i < spun; jumpers[i].visible = i < knitted; }
  }

  // ---- steps: one question each; the basket's journey answers it
  const STEPS = [
    { title: 'From sheep to jumper', caption: 0, text: 'One sheep\'s fleece made these four jumpers. Where does the wool go on the way? Press Next and follow the basket.' },
    { title: 'How much wool is on a sheep?', caption: 1, text: 'Press the sheep to shear it. The whole fleece comes off in one piece into the basket: about 4 kg, once a year.' },
    { title: 'Why does the heap shrink?', caption: 2, text: 'Carry the basket to the lit lamp by the stream. Washing takes out grease, dirt and bits of plant: about half the weight.' },
    { title: 'Does spinning change the amount?', caption: 3, text: 'Carry the basket to the cottage. The wheel twists clean wool into yarn: 2 kg in, 2 kg out, wound into four balls.' },
    { title: 'How many jumpers?', caption: 4, text: 'Carry the basket to the bench by the line. A jumper takes about 0.5 kg of yarn, so 2 kg makes 4 jumpers.' },
  ];
  const DOING = ['Shearing...', 'Washing in the stream...', 'Spinning...', 'Knitting...'];
  const DONE = ['', 'Sheared: 4 kg of greasy fleece', 'Washed: 2 kg of clean wool', 'Spun: four 0.5 kg balls', 'Knitted: 4 jumpers'];
  const caption = look.caption(['One fleece, four jumpers', 'Shearing: 4 kg of fleece', 'Washing: half goes', 'Spinning: 4 balls', 'Knitting: 0.5 kg each'], 'Caption', { width: 0.12 });
  caption.position.set(0.035, 0, 0.125);
  caption.scale.setScalar(0.7);                         // low at the front edge: it must not hide the stops
  subject.add(caption);

  let step = 0;
  let stage = 4;                                         // the finished story first: the host sizes the lesson by it
  let anim = -1;                                         // 0..1 while the next stage happens, else -1
  let travel = -1;                                       // 0..1 while the basket walks itself along the track
  let travelFrom = 0;
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  const big = Math.max(size.x, size.y, size.z);
  const right = new THREE.Box3().setFromObject(root).max.x;
  const panel = kit.panel(ui, {
    width: 0.3, position: [Math.max(1.06 * big, right + 0.05), 0.6 * big, 0], rotationY: -0.3,
    eyebrow: 'HOW THINGS ARE MADE', title: 'From sheep to jumper',
    items: [
      { status: STEPS[0].title, tone: 'neutral', id: 'state' },
      { text: STEPS[0].text, id: 'info' },
      { stat: '0 kg', label: 'wool in the basket', id: 'kg' },
      { buttons: [{ label: 'Back', onPress() { go(step - 1); } }, { label: 'Next', onPress() { go(step === STEPS.length - 1 ? 0 : step + 1); } }] },
      { note: '4 kg fleece -> 2 kg clean wool -> 4 balls -> 4 jumpers' },
    ],
  });
  root.add(panel.object3D);

  const atStop = () => Math.max(0, stage - 1);           // where the basket stands
  const place = (i) => { basket.position.set(SEATS[i][0], SEATS[i][1], SEATS[i][2]); seat.home.copy(basket.position); };
  function go(n) {
    step = Math.max(0, Math.min(STEPS.length - 1, n));
    stage = step === 0 ? 4 : step - 1;                   // each step starts just before its own stop
    anim = -1;
    travel = -1;
    place(atStop());
    show(stage);
    panel.set('state', STEPS[step].title);
    panel.set('info', STEPS[step].text);
    caption.userData.show(STEPS[step].caption);
  }
  function arrive() {                                    // the basket is at the next stop: that stop does its work
    if (stage >= 4 || anim >= 0) return;
    anim = 0;
    if (step !== stage + 1) {                            // the hands moved the story on: the panel follows
      step = stage + 1;
      panel.set('info', STEPS[step].text);
      caption.userData.show(STEPS[step].caption);
    }
    panel.set('state', DOING[stage], 'neutral');
  }

  // ---- hands: press the sheep to shear it; carry the basket to the next lit lamp (or press the next stop)
  traits(sheep, {
    onPress() {
      if (stage === 0 && anim < 0) arrive();
      else panel.set('state', 'It grows a new fleece in about a year', 'neutral');
    },
  });
  traits(basket, { grab: true });
  const seat = lookSeat(THREE, basket, isGrabbed, {
    radius: 0.03,
    returnAfter: 0.5,
    onHome() { panel.set('state', 'The basket is back at its stop', 'neutral'); },
    onAway() {
      const next = stage;                                // stage 1 -> stop 2 (index 1), and so on
      if (step === 0 || stage === 0 || stage >= 4 || anim >= 0) { panel.set('state', stage === 0 ? 'First press the sheep to shear it' : 'Watch this stop first', 'neutral'); return; }
      const dx = basket.position.x - SEATS[next][0], dz = basket.position.z - SEATS[next][2];
      if (dx * dx + dz * dz < 0.06 * 0.06) { seat.home.set(SEATS[next][0], SEATS[next][1], SEATS[next][2]); arrive(); }
      else panel.set('state', 'Carry it to the lamp that is glowing', 'neutral');
    },
  });
  const presses = [stone, cottage, bench];               // stops 2 to 4: press the next one and the basket walks there
  presses.forEach((object, k) => {
    traits(object, {
      onPress() {
        if (step === 0 || stage !== k + 1 || anim >= 0 || travel >= 0 || isGrabbed(basket)) { panel.set('state', stage === 0 ? 'First press the sheep to shear it' : 'Go to the lamp that is glowing', 'neutral'); return; }
        travelFrom = k;
        travel = 0;
      },
    });
  });
  const shineSheep = look.shine(sheep);

  go(0);
  const here = new THREE.Vector3();
  let shownKg = -1;
  return {
    root,
    update(time, delta) {
      // the basket walks the track by itself (slowly, so a hand can still take it), then the stop does its work
      if (travel >= 0 && !isGrabbed(basket)) {
        const u0 = seatU[travelFrom], u1 = seatU[travelFrom + 1];
        travel = Math.min(1, travel + (delta * 0.035) / Math.max(0.01, (u1 - u0) * route.length));
        route.at(u0 + (u1 - u0) * travel, here);
        basket.position.set(here.x, SEATS[travelFrom][1] + (SEATS[travelFrom + 1][1] - SEATS[travelFrom][1]) * travel + 0.008 * Math.sin(Math.PI * travel), here.z);
        if (travel >= 1) { travel = -1; seat.home.set(SEATS[travelFrom + 1][0], SEATS[travelFrom + 1][1], SEATS[travelFrom + 1][2]); arrive(); }
      } else if (travel < 0) seat.update(delta);

      // the stop's work, over about 2.5 s
      if (anim >= 0) {
        anim = Math.min(1, anim + delta / 2.5);
        const from = Math.floor(stage);
        show(from + anim);
        if (anim >= 1) {
          anim = -1;
          stage = from + 1;
          panel.set('state', DONE[stage], 'good');
          show(stage);
        }
      }
      const v = anim >= 0 ? Math.floor(stage) + anim : stage;
      const kg = Math.round(kgAt(v) * 2);
      if (kg !== shownKg) { shownKg = kg; panel.set('kg', KG[kg]); }

      // lamps: lit at the basket's stop, glowing where it goes next; all lit on the finished picture
      const at = Math.max(0, Math.floor(v) - 1), next = Math.floor(stage) >= 1 && Math.floor(stage) < 4 ? Math.floor(stage) : -1;
      for (let i = 0; i < 4; i++) lamps[i].userData.set(step === 0 ? 0.8 : i === at ? 1 : i === next ? 0.35 + 0.3 * Math.sin(time * 3) : 0.08);
      shineSheep(step === 1 && stage === 0 && anim < 0 ? 0.35 + 0.35 * Math.sin(time * 3) : 0);

      // gentle continuous motion: grass in the breeze, smoke, the wheel (fast while spinning), jumpers on the line
      grass.userData.sway(time, 0.25);
      smoke.userData.rise(time, 0.5);
      wheel.rotation.z -= delta * (v > 2 && v < 3 ? 9 : 0.4);
      for (let i = 0; i < 4; i++) jumpers[i].rotation.z = 0.06 * Math.sin(time * 1.3 + i * 0.9);
    },
  };
}
