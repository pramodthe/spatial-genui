// Soft clay look for an XR lesson: chunky, slightly lopsided plasticine forms on a coloured card board, animated like
// stop-motion. Needs look-kit.js (lookClay, lookLumpy, lookNoise, lookTwos, lookBounce). new-lesson.mjs pastes it in.
//
// softClayLook(THREE, kit) returns:
//   PAL                       the box of clay: { name: [colour, streak] }
//   mat(colour)               one clay material per colour, made once
//   clay(geometry, colour, name)          any geometry as a clay object (pushed out of true)
//   ball(r, colour, name)  capsule(r, len, colour, name)  slab(w, h, d, colour, name)
//   coin(r, h, colour, name)  wedge(r, h, from, angle, colour, name)  (lie flat; wedge angle in radians)
//   stack(n, colour, name, { r, h })      a Group of n coins, each a little off true; .userData.top = its height
//   bowl(r, colour, name)                 an open clay bowl, base at y = 0
//   character(colour, name, { h })        a friendly clay figure (body, head, eyes), feet at y = 0
//   plank(len, colour, name)  fulcrum(h, colour, name)   a beam and its wedge for balances and levers
//   arrow(len, colour, name)              a fat clay arrow along +y from its base: scale.y sets its length
//   number(text, colour, name, { h })     fat clay digits and + - = / . x (7-segment rolls of clay)
//   set({ width, depth })                 the card board with a low backdrop; never grabbable; .userData.top
//   demo(subject)                         a working sample (replace it)
function softClayLook(THREE, kit) {
  const BOX = {
    card: '#12808a', cream: ['#f3e6cd', '#eec78c'], coral: ['#de3a26', '#f2814f'], yellow: ['#f4ad08', '#ee7f14'],
    navy: ['#253677', '#4467b8'], green: ['#4f9a3a', '#8cc15a'], white: ['#f5f1ea', '#d9d2c4'], pink: ['#f39ab0', '#e66f8f'],
    brown: ['#8a5a38', '#b07a4a'], black: ['#2a2626', '#4a4444'],
  };
  const mats = {};
  let seed = 1;
  const look = { name: 'soft-clay', PAL: BOX };
  look.mat = (colour) => {
    if (!BOX[colour]) throw new Error(`softClayLook: no clay colour "${colour}". Colours: ${Object.keys(BOX).join(', ')}`);
    if (!mats[colour]) mats[colour] = lookClay(THREE, kit, BOX[colour][0], { streak: BOX[colour][1], seed: seed++ });
    return mats[colour];
  };
  look.clay = (geometry, colour, name, lumps = 0.002) => {
    const mesh = new THREE.Mesh(lumps > 0 ? lookLumpy(THREE, geometry, lumps, 0.03, seed++) : geometry, look.mat(colour));
    mesh.name = name;
    return mesh;
  };
  look.ball = (r, colour, name) => look.clay(new THREE.SphereGeometry(r, 36, 24), colour, name, r * 0.06);
  look.capsule = (r, len, colour, name) => look.clay(new THREE.CapsuleGeometry(r, len, 8, 24), colour, name, r * 0.05);
  look.slab = (w, h, d, colour, name) => look.clay(kit.roundedBox(w, h, d, Math.min(w, h, d) * 0.35, 4), colour, name, 0.0015);
  look.coin = (r, h, colour, name) => look.clay(new THREE.CylinderGeometry(r, r * 0.96, h, 40, 2), colour, name, 0.0012);
  look.wedge = (r, h, from, angle, colour, name) => {
    const segments = Math.max(8, Math.round((48 * angle) / (2 * Math.PI)));
    return look.clay(new THREE.CylinderGeometry(r, r, h, segments, 2, false, from, angle), colour, name, 0.0015);
  };
  look.stack = (n, colour, name, { r = 0.025, h = 0.009 } = {}) => {
    const g = new THREE.Group();
    g.name = name;
    for (let i = 0; i < n; i++) {
      const c = look.coin(r, h, colour, `${name} ${i + 1}`);
      c.position.set((lookHash3(i, 1, 2) - 0.5) * 0.004, h / 2 + i * h * 0.96, (lookHash3(i, 3, 4) - 0.5) * 0.004);
      c.rotation.y = lookHash3(i, 5, 6) * Math.PI;
      g.add(c);
    }
    g.userData.top = n * h * 0.96;
    return g;
  };
  look.bowl = (r, colour, name) => {
    const t = r * 0.12;
    const profile = [[0, 0], [r * 0.55, 0], [r * 0.9, r * 0.3], [r, r * 0.62], [r - t, r * 0.62], [r * 0.9 - t, r * 0.32], [r * 0.55 - t, t], [0, t]];
    return look.clay(kit.lathe(profile, 40), colour, name, 0.0015);
  };
  look.character = (colour, name, { h = 0.09 } = {}) => {
    const g = new THREE.Group();
    g.name = name;
    const body = look.capsule(h * 0.22, h * 0.4, colour, `${name} body`);
    body.position.y = h * 0.42;
    const head = look.ball(h * 0.2, 'cream', `${name} head`);
    head.position.y = h * 0.86;
    g.add(body, head);
    for (const side of [-1, 1]) {
      const eye = look.ball(h * 0.035, 'black', `${name} eye`);
      eye.position.set(side * h * 0.07, h * 0.9, h * 0.17);
      const foot = look.ball(h * 0.09, colour, `${name} foot`);
      foot.scale.y = 0.55;
      foot.position.set(side * h * 0.1, h * 0.04, h * 0.03);
      g.add(eye, foot);
    }
    return g;
  };
  look.plank = (len, colour, name) => look.slab(len, 0.014, 0.06, colour, name);
  look.fulcrum = (h, colour, name) => {
    const mesh = look.clay(kit.extrude([[-h * 0.7, 0], [h * 0.7, 0], [0, h]], 0.05, { bevel: 0.004 }), colour, name, 0.0015);
    return mesh;
  };
  // A fat clay arrow pointing along +y from y = 0, `len` long; set arrow.scale.y to grow or shrink it in place.
  look.arrow = (len, colour, name) => {
    const g = new THREE.Group();
    g.name = name;
    const r = 0.007;
    const shaft = look.capsule(r, Math.max(0.001, len - 0.03), colour, `${name} shaft`);
    shaft.position.y = (len - 0.03) / 2;
    const tip = look.clay(new THREE.ConeGeometry(r * 2.4, 0.03, 20, 2), colour, `${name} tip`, 0.001);
    tip.position.y = len - 0.015;
    g.add(shaft, tip);
    return g;
  };
  // Fat clay numbers: each character is rolls of clay on a 7-segment grid, h tall, standing in the XY plane.
  const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g' };
  look.number = (text, colour, name, { h = 0.05 } = {}) => {
    const g = new THREE.Group();
    g.name = name;
    const w = h * 0.55;
    const r = h * 0.075;
    const roll = (x0, y0, x1, y1, n) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const c = look.capsule(r, Math.max(0.001, len - 2 * r), colour, n);
      c.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
      c.rotation.z = Math.atan2(y1 - y0, x1 - x0) - Math.PI / 2;
      return c;
    };
    const lines = { a: [0, 1, 1, 1], b: [1, 1, 1, 0.5], c: [1, 0.5, 1, 0], d: [0, 0, 1, 0], e: [0, 0.5, 0, 0], f: [0, 1, 0, 0.5], g: [0, 0.5, 1, 0.5] };
    let x = 0;
    for (const ch of String(text)) {
      if (ch === ' ') { x += w * 0.8; continue; }
      const parts = [];
      if (SEG[ch]) for (const s of SEG[ch]) { const [a, b, c, d] = lines[s]; parts.push([a * w, b * h, c * w, d * h]); }
      else if (ch === '+') parts.push([0, h * 0.5, w, h * 0.5], [w / 2, h * 0.22, w / 2, h * 0.78]);
      else if (ch === '=') parts.push([0, h * 0.35, w, h * 0.35], [0, h * 0.65, w, h * 0.65]);
      else if (ch === '/') parts.push([0, 0, w, h]);
      else if (ch === 'x') parts.push([0, h * 0.2, w, h * 0.8], [0, h * 0.8, w, h * 0.2]);
      else if (ch === '.') { const dot = look.ball(r * 1.3, colour, `${name} dot`); dot.position.set(x + r, r, 0); g.add(dot); x += w * 0.5; continue; }
      for (const [x0, y0, x1, y1] of parts) g.add(roll(x + x0, y0, x + x1, y1, `${name} ${ch}`));
      x += w * 1.45;
    }
    g.userData.width = x - w * 0.45;
    return g;
  };
  // The board: uncoated coloured card with a low curved backdrop strip behind. Its top is set.userData.top.
  look.set = ({ width = 0.4, depth = 0.28 } = {}) => {
    const set = new THREE.Group();
    set.name = 'Clay board';
    const card = kit.material('paper', { color: BOX.card, roughness: 0.93 });
    const board = new THREE.Mesh(kit.roundedBox(width, 0.01, depth, 0.004), card);
    board.position.y = 0.005;
    const back = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, width, 24, 1, true, Math.PI, Math.PI / 2), card);
    back.rotation.z = Math.PI / 2;
    back.position.set(0, 0.06, -depth / 2 + 0.05);
    set.add(board, back);
    set.userData.top = 0.01;
    set.userData.width = width;
    set.userData.depth = depth;
    return set;
  };
  look.demo = (subject) => {
    const stack = [];
    for (let i = 0; i < 3; i++) {
      const c = look.coin(0.03, 0.012, i === 2 ? 'yellow' : 'coral', `Coin ${i + 1}`);
      c.position.set(-0.1 + i * 0.1, 0.006, 0.02);
      subject.add(c);
      stack.push({ object: c, grab: true });
    }
    return stack;
  };
  return look;
}
