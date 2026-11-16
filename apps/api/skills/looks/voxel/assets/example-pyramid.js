// Worked example (voxel): where the stone of a step pyramid goes. Built on the look kit and voxelLook (pasted above it
// by new-lesson.mjs); passes scripts/check.mjs. Take its method, not its subject:
// - the quantity is made physical: one cube is one stone block, so the pyramid is the count; a cube counter on the
//   plinth counts the blocks as they land, and lifting a layer counts that layer;
// - the learner builds it by hand: carry each layer from the sledge onto the sand square, its blocks drop in column
//   by column; let go anywhere else, it goes back to the sledge;
// - each step asks one question the scene answers, with the step's word in cubes on the plinth's front;
// - it starts finished (the host sizes the lesson by its first frame), then is taken down and built up;
// - the cubes do the animating (look.stages), nothing is allocated in update().
export default function build({ THREE, kit, traits, ui, isGrabbed }) {
  const root = new THREE.Group();
  const look = voxelLook(THREE, kit);
  const S = look.size;                            // 0.012 m: one cube = one stone block
  const set = look.set({ width: 0.36, depth: 0.2 });
  root.add(set);
  const subject = new THREE.Group();
  subject.name = 'Step pyramid';
  subject.userData.subject = true;
  subject.position.y = set.userData.top;
  root.add(subject);

  // The site, a square of sand one cube thick, and the wooden sledge the next layer waits on, 4 cm to its right.
  const PX = -7 * S;
  const QX = 8 * S;
  const site = look.model(look.box(-6, 0, -6, 6, 0, 6, (x, y, z) => (lookHash3(x, 3, z) > 0.75 ? 'sand' : 'sandLight')), 'Sand square', { sealed: true });
  site.position.x = PX;
  const sledge = look.model(look.cells((put) => {
    for (const z of [-4, 4]) { for (let x = -5; x <= 5; x++) put(x, 0, z, 'wood'); put(-6, 1, z, 'woodDark'); }
    for (const x of [-4, 0, 4]) for (let z = -3; z <= 3; z++) put(x, 0, z, 'woodB');
  }), 'Sledge');
  sledge.position.x = QX;
  subject.add(site, sledge);

  // Five layers, each 2 blocks narrower than the one below: 11 x 11, 9 x 9, 7 x 7, 5 x 5, 3 x 3 = 285 blocks.
  // Each layer is its own mesh (the hand picks it) and builds itself column by column.
  const SIDES = [11, 9, 7, 5, 3];
  const COUNT = SIDES.map((n) => n * n);
  const TOTAL = [0];
  COUNT.forEach((c) => TOTAL.push(TOTAL[TOTAL.length - 1] + c));
  const ALL = TOTAL[SIDES.length];
  const layers = SIDES.map((side, i) => {
    const r = (side - 1) / 2;
    const main = i % 2 ? 'sandDark' : 'sand';
    const other = i % 2 ? 'sand' : 'sandDark';
    const mesh = look.model(look.box(-r, 0, -r, r, 0, r, (x, y, z) => (lookHash3(x + i * 13, i, z) > 0.82 ? other : main)), `Layer ${i + 1}`);
    mesh.position.set(QX, S, 0);                  // made on the sledge: that is the seat it slides back to
    subject.add(mesh);
    traits(mesh, { grab: true });
    const seat = lookSeat(THREE, mesh, isGrabbed, { radius: 0.03, returnAfter: 0.6 });
    const b = look.stages(mesh, () => 0, { order: 'column', gap: 0.05 });
    return { i, mesh, seat, b, spot: new THREE.Vector3(PX, (1 + i) * S, 0), state: 'placed', was: false };
  });

  // The quantity in the scene: a cube counter in front of the pyramid, and the step's word on the plinth's front.
  const counter = look.counter(3, 'ink', 'Blocks counted', { size: 0.006 });
  counter.position.set(PX, 0, 0.088);
  subject.add(counter);
  const STEPS = [
    { word: 'PYRAMID', placed: 5, title: 'Where does the stone go?', text: 'A step pyramid of 5 layers, one cube for each stone block: 285 blocks. Which layer holds the most? Lift one to count it.' },
    { word: 'BASE', placed: 0, title: 'Lay the base', text: 'The base is 11 blocks by 11. Carry it from the sledge onto the sand square and count the blocks as they land.' },
    { word: 'NARROWER', placed: 1, title: 'Each layer is narrower', text: 'Each layer is 2 blocks narrower than the one below: 9 x 9, then 7 x 7. Place them. How many blocks does each add?' },
    { word: 'TOP', placed: 3, title: 'Finish the top', text: 'Place the last two layers. They add as much height as the first two, with only 34 blocks instead of 202.' },
    { word: 'WEIGHT', placed: 5, title: 'The weight sits low', text: 'Lift each layer. The base alone holds 121 of 285 blocks, more than 4 in 10: the weight sits low and wide, so a pyramid cannot tip over.' },
  ];
  const words = STEPS.map((s) => {
    const mesh = look.word(s.word, set, { colour: 'ink' });
    root.add(mesh);
    return look.stages(mesh, () => 0, { order: 'column', gap: 0.03 });
  });
  // Every sentence the lesson shows, made once here (update() only picks one).
  const LIFT = SIDES.map((n, i) => `Layer ${i + 1}: ${n} x ${n} = ${COUNT[i]} blocks, ${Math.round((100 * COUNT[i]) / ALL)}% of the stone`);
  const BUILT = TOTAL.map((t) => `${t} blocks`);
  const GOAL = { 1: [1, 'Base laid: 121 blocks'], 2: [3, 'Three layers: 251 blocks'], 3: [5, 'Finished: 285 blocks'] };

  let step = 0;
  let placed = 0;
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  const big = Math.max(size.x, size.y, size.z);
  const right = new THREE.Box3().setFromObject(root).max.x;
  const panel = kit.panel(ui, {
    width: 0.3, position: [Math.max(1.06 * big, right + 0.05), 0.6 * big, 0], rotationY: -0.3,
    eyebrow: 'BUILDING', title: 'Where the stone goes',
    items: [
      { status: STEPS[0].title, tone: 'neutral', id: 'state' },
      { text: STEPS[0].text, id: 'info' },
      { stat: BUILT[5], label: 'in the pyramid', id: 'blocks' },
      { buttons: [{ label: 'Back', onPress() { go(step - 1); } }, { label: 'Next', onPress() { go(step + 1); } }] },
      { note: 'One cube is one stone block.' },
    ],
  });
  root.add(panel.object3D);

  // The build: layers below k stand on the pyramid, layer k waits on the sledge, the rest are not cut yet (hidden,
  // so no hand can catch them). Layers that newly arrive drop in one after another.
  function setBuild(k, now) {
    let wait = 0;
    for (const L of layers) {
      L.mesh.quaternion.identity();
      if (L.i < k) {
        if (L.state !== 'placed' || now) { L.mesh.position.copy(L.spot); L.b.go(0, now, wait); wait += 0.35; }
        L.state = 'placed';
      } else if (L.i === k) {
        if (L.state !== 'waiting' || now) { L.mesh.position.copy(L.seat.home); L.b.go(0, now, wait); }
        L.state = 'waiting';
      } else {
        L.state = 'hidden';
        L.b.go(-1);
      }
    }
    placed = k;
    panel.set('blocks', BUILT[k]);
  }
  function go(n) {
    const back = n < step;
    step = Math.max(0, Math.min(STEPS.length - 1, n));
    const want = STEPS[step].placed;
    setBuild(step === 1 || back ? want : Math.max(placed, want), false);
    panel.set('state', STEPS[step].title);
    panel.set('info', STEPS[step].text);
    words.forEach((w, i) => w.go(i === step ? 0 : -1));
  }
  setBuild(5, true);
  words.forEach((w, i) => w.go(i === 0 ? 0 : -1, true));

  // A layer let go over the sand square while it waits on the sledge: it is placed, its blocks drop in and the next
  // layer appears on the sledge. A placed layer let go anywhere drops back into its place.
  function letGo(L) {
    look.glow(L.mesh, 0);
    const p = L.mesh.position;
    if (L.state === 'waiting' && Math.abs(p.x - PX) < 0.07 && Math.abs(p.z) < 0.07 && p.y > -0.01) {
      L.state = 'placed';
      L.mesh.position.copy(L.spot);
      L.mesh.quaternion.identity();
      L.b.go(0);
      placed = L.i + 1;
      const next = layers[placed];
      if (next) { next.state = 'waiting'; next.mesh.position.copy(next.seat.home); next.b.go(0, false, 0.5); }
      panel.set('blocks', BUILT[placed]);
      const goal = GOAL[step];
      if (goal && placed >= goal[0]) panel.set('state', goal[1], 'good');
      else panel.set('state', STEPS[step].title);
    } else if (L.state === 'placed') {
      L.mesh.position.copy(L.spot);
      L.mesh.quaternion.identity();
      L.b.go(0);
      panel.set('state', STEPS[step].title);
    } else {
      panel.set('state', 'Put it down on the sand square');
    }
  }

  return {
    root,
    update(time, delta) {
      let held = -1;
      for (const L of layers) {
        const now = isGrabbed(L.mesh);
        if (now && !L.was) { look.glow(L.mesh, 1); panel.set('state', LIFT[L.i]); }
        if (L.state === 'waiting') L.seat.update(delta);   // let go away from the sand: back to the sledge
        if (!now && L.was) letGo(L);
        L.was = now;
        if (now) held = L.i;
        L.b.update(delta);
      }
      for (const w of words) w.update(delta);
      // The true number: a lifted layer shows its own blocks, else the blocks that have landed on the pyramid.
      let landed = 0;
      for (const L of layers) if (L.state === 'placed' && !isGrabbed(L.mesh)) landed += L.b.arrived;
      counter.userData.set(held >= 0 ? COUNT[held] : landed);
    },
  };
}
