// Circuit city look for an XR lesson: a circuit board seen as a city at night. Matte black chips are the buildings,
// aluminium capacitors the towers, gold tracks the streets, white silkscreen prints each district's name, and a pulse
// of warm light travels the tracks from stop to stop, waking each landmark as it arrives. Needs look-kit.js
// (lookPath, lookHash3). new-lesson.mjs pastes it in.
//
// Sizes in metres. x right, z toward the learner, y up from the board's top: build in a group at set.userData.top.
// Landmarks are Groups with userData.wake(k) (k = 0 asleep .. 1 awake, call it every frame you animate it).
// The travelling things (track, pulse, token) are handles: { mesh, ... }.
//
// circuitCityLook(THREE, kit) returns:
//   M                                    materials: mask, copper, gold, tin, alu, steel, epoxy, plastic, substrate,
//                                        ceramic, silk, etch, travelled (make nothing shiny or plain of your own)
//   route(a, b, { diagonalFirst })       [[x, z], ...] from a to b with one 45-degree bend (straight, then diagonal)
//   chip(w, d, name, { h, sides, pitch, mark })   a black chip, w along x, d along z; gull-wing pins on sides
//                                        'z' (front and back, default), 'x' (left and right), 'xz' (all four) or '';
//                                        mark = a short code etched on its top; wake(k) lights it from underneath
//   cpu(size, name, { cores })           the big chip: substrate, pins on four sides, a steel frame and cores x cores
//                                        silicon dies; wake(k) lights the dies in a diagonal wave (k 0.5 = half lit)
//   memoryBank(n, name, { w, d, gap })   n memory chips in a row along x; wake(k, i) wakes chip i (all without i)
//   towers(list, name)                   capacitor cans [[x, z, r, h], ...] in 5 draw calls; wake(k, i)
//   tower(r, h, name)                    one can at the origin
//   smallParts(list, name)               resistors and ceramic caps, the houses: [[x, z, angle, 'r' | 'c'], ...]
//   scatter(keep, { lines, count, seed, width, depth })   smallParts placements that keep off keep = [[x, z, w, d]]
//                                        rectangles and 8 mm off the tracks in lines = [[[x, z], ...], ...]
//   connector(name, { face, w, h, d })   a metal port at the board's edge, mouth facing '+x' | '-x' | '+z' | '-z';
//                                        wake(k) lights its contacts and the light spilling out of the mouth
//   led(colour, name)                    an indicator LED; wake(k) turns it on
//   meter(name, { segments, w })         a bar of lamp segments on a black body; userData.set(k) lights k (0..1) of it
//   track(points, name, { width, lit })  -> { mesh, path, length, light(u) }: a flat gold street through [[x, z], ...]
//                                        at board height; path.at(u, out) samples it; light(u) keeps 0..u lit
//   vias(points, name)                   tin rings where tracks drop through the board: [[x, z], ...]
//   outline(w, d, name, { round })       a silkscreen outline (thin white lines) round a footprint
//   label(text, name, { h, ink, stretch, width })   silkscreen letters lying on the board (A-Z 0-9 - . / > < : + =),
//                                        centred on the origin, tops toward -z; userData.width, userData.depth
//   pulse(name, { size, trail })         -> { mesh, follow(path, u) }: the travelling light and its trail
//   token(texts, colours, name)          -> { mesh, show(i) }: a glowing data puck (4.4 x 3 cm, grabbable); show(i)
//                                        prints texts[i] on it in colours[i]
//   wake(object, k)                      object.userData.wake(k)
//   set({ width, depth, traces })        the board: green solder mask, copper under it, gold edge pads, mounting
//                                        holes; never grabbable; userData.top
//   demo(subject)                        a working sample (replace it)
function circuitCityLook(THREE, kit) {
  // A material that glows: `colour` light, `base` its colour when dark, `glow` its strength now.
  const lamp = (colour, glow, base) => {
    const m = kit.material('light', { color: colour, glow: 1 });
    if (base) m.color.set(base);
    m.emissiveIntensity = glow;
    return m;
  };
  const M = {
    mask: kit.material('paintedMetal', { color: '#0f4a2e', roughness: 0.42, wear: 0.05 }),
    copper: kit.material('paintedMetal', { color: '#1b6040', roughness: 0.36, wear: 0 }),
    gold: kit.material('gold', { color: '#d9a546', roughness: 0.36 }),
    tin: kit.material('metal', { color: '#b9bdc3', roughness: 0.34 }),
    alu: kit.material('brushedMetal', { color: '#c3c7cc' }),
    steel: kit.material('metal', { color: '#8a9098', roughness: 0.4 }),
    epoxy: kit.material('plastic', { color: '#141416', roughness: 0.7, wear: 0.05 }),
    plastic: kit.material('plastic', { color: '#0a0a0b', roughness: 0.5, wear: 0 }),
    substrate: kit.material('plastic', { color: '#1d1b15', roughness: 0.55, wear: 0 }),
    ceramic: kit.material('plastic', { color: '#ffffff', roughness: 0.62, wear: 0 }),
    silicon: kit.material('metal', { color: '#ffffff', roughness: 0.26 }),
    silk: kit.material('plastic', { color: '#f2f2ea', roughness: 0.8, wear: 0 }),
    etch: kit.material('plastic', { color: '#6a6964', roughness: 0.85, wear: 0 }),
    travelled: lamp('#ffb04a', 0.75, '#d9a546'),
  };
  const AMBER = new THREE.Color('#ffb44a');
  const tmp = new THREE.Color();
  const BOX = new THREE.BoxGeometry(1, 1, 1);
  const DISC = new THREE.CylinderGeometry(1, 1, 1, 28);
  const noHit = () => {};
  // The look calls its own builders as cc.*, so the check's look rules see only the lesson's look.* calls.
  const cc = { name: 'circuit-city', M, PAL: M };

  // Glow that leaks out from under a part when it wakes: flat additive plates, invisible (black) while asleep.
  const plates = (geometry, placements, colour = AMBER) => {
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const mesh = kit.instances(geometry, mat, placements);
    mesh.name = 'Underglow';
    mesh.raycast = noHit;
    for (let i = 0; i < placements.length; i++) mesh.setColorAt(i, tmp.setRGB(0, 0, 0));
    mesh.instanceColor.needsUpdate = true;
    return {
      mesh,
      set(i, k) {
        mesh.setColorAt(i, tmp.copy(colour).multiplyScalar(1.3 * Math.max(0, Math.min(1, k))));
        mesh.instanceColor.needsUpdate = true;
      },
    };
  };

  // Gull-wing pin, unit size: reaches 1 along +x from the body, shoulder at height 1, centred on z.
  const GULL = kit.extrude([[-0.15, 1], [0.3, 1], [0.56, 0.15], [1, 0.15], [1, 0], [0.47, 0], [0.21, 0.85], [-0.15, 0.85]], 1);
  const SIDE = { '+z': -Math.PI / 2, '-z': Math.PI / 2, '+x': 0, '-x': Math.PI };
  const sideList = (s) => [...(s.includes('x') ? ['+x', '-x'] : []), ...(s.includes('z') ? ['+z', '-z'] : [])];
  // Pins (tin) and their pads (gold) round a w x d footprint centred at (cx, cz).
  const pinRows = (cx, cz, w, d, h, sides, pitch, pins, pads) => {
    for (const side of sides) {
      const alongX = side[1] === 'z';
      const n = Math.max(1, Math.floor(((alongX ? w : d) - pitch * 0.6) / pitch));
      const sg = side[0] === '+' ? 1 : -1;
      for (let i = 0; i < n; i++) {
        const u = (i - (n - 1) / 2) * pitch;
        const px = alongX ? cx + u : cx + sg * w / 2;
        const pz = alongX ? cz + sg * d / 2 : cz + u;
        pins.push({ position: [px, 0.0004, pz], rotation: [0, SIDE[side], 0], scale: [0.0035, h * 0.5, pitch * 0.45] });
        pads.push({ position: [px + (alongX ? 0 : sg * 0.0026), 0.0002, pz + (alongX ? sg * 0.0026 : 0)], rotation: [0, SIDE[side], 0], scale: [0.0034, 0.0004, pitch * 0.62] });
      }
    }
  };

  // ---------------------------------------------------------------- silkscreen
  const SILK_Y = 0.0003;
  const outlineInto = (list, cx, cz, w, d, t = 0.0009) => {
    list.push(
      { position: [cx, SILK_Y, cz - d / 2], scale: [w + t, 0.0003, t] }, { position: [cx, SILK_Y, cz + d / 2], scale: [w + t, 0.0003, t] },
      { position: [cx - w / 2, SILK_Y, cz], scale: [t, 0.0003, d] }, { position: [cx + w / 2, SILK_Y, cz], scale: [t, 0.0003, d] },
    );
  };
  // A broken circle, open at the front-left like a polarity mark.
  const ringInto = (list, cx, cz, r, t = 0.0009) => {
    const n = 28;
    for (let i = 0; i < n; i++) {
      const a = ((i + 0.5) / n) * Math.PI * 2;
      if (Math.abs(Math.atan2(Math.sin(a - 2.4), Math.cos(a - 2.4))) < 0.3) continue;
      list.push({ position: [cx + Math.cos(a) * r, SILK_Y, cz + Math.sin(a) * r], rotation: [0, -Math.atan2(Math.cos(a), -Math.sin(a)), 0], scale: [(2 * Math.PI * r) / n * 1.08, 0.0003, t] });
    }
  };
  cc.outline = (w, d, name, { round = false } = {}) => {
    const list = [];
    if (round) ringInto(list, 0, 0, w / 2);
    else outlineInto(list, 0, 0, w, d);
    const mesh = kit.instances(BOX, M.silk, list);
    mesh.name = name;
    return mesh;
  };
  // A stroke font for silkscreen: each glyph is strokes "x0 y0 x1 y1" on a grid x 0..2, y 0..4 (bottom to top).
  const FONT = {
    A: '0003 0314 1423 2320 0222', B: '0004 0414 1423 2312 0212 1221 2110 1000', C: '2414 1403 0301 0110 1020',
    D: '0004 0414 1423 2321 2110 1000', E: '0004 0424 0212 0020', F: '0004 0424 0212',
    G: '2414 1403 0301 0110 1020 2022 2212', H: '0004 2024 0222', I: '0424 1410 0020', J: '2421 2110 1000 0001',
    K: '0004 0224 0220', L: '0004 0020', M: '0004 0412 1224 2420', N: '0004 0420 2024',
    O: '0103 0314 1423 2321 2110 1001', P: '0004 0414 1423 2312 1202', Q: '0103 0314 1423 2321 2110 1001 1120',
    R: '0004 0414 1423 2312 1202 1220', S: '2414 1403 0312 1221 2110 1000', T: '0424 1410', U: '0401 0110 1021 2124',
    V: '0410 1024', W: '0400 0012 1220 2024', X: '0024 0420', Y: '0412 1224 1210', Z: '0424 2400 0020',
    0: '0103 0314 1423 2321 2110 1001 0123', 1: '0314 1410 0020', 2: '0314 1423 2322 2200 0020',
    3: '0424 2412 1221 2110 1000', 4: '0402 0222 2420', 5: '2404 0402 0212 1221 2110 1000',
    6: '2414 1403 0301 0110 1021 2112 1202', 7: '0424 2410', 8: '1423 2312 1201 0110 1021 2112 1203 0314',
    9: '2023 2314 1403 0312 1222', '-': '0222', '.': '1010', '/': '0024', '>': '0412 1200', '<': '2402 0220',
    ':': '1111 1313', '+': '0222 1113', '=': '0121 0323', ' ': '',
  };
  // Letters h tall (and h * stretch deep: stretched toward the learner so they still read on a board seen at a slant),
  // lying on the board, centred on the origin. width = the most it may take (h shrinks to fit).
  cc.label = (text, name, { h = 0.012, ink = 'silk', stretch = 1.35, width } = {}) => {
    const str = String(text).toUpperCase();
    const n = str.length;
    if (width) h = Math.min(h, width / Math.max(0.5, n * 0.75 - 0.25));
    const cw = h / 2, adv = h * 0.75, t = h * 0.13, depth = h * stretch;
    const W = n * adv - (adv - cw);
    const strokes = [];
    let x = -W / 2;
    for (const ch of str) {
      const def = FONT[ch];
      if (def === undefined) throw new Error(`look.label: no silkscreen letter "${ch}". Letters: A-Z 0-9 and - . / > < : + =`);
      for (const s of def.split(' ')) {
        if (s.length !== 4) continue;
        const x0 = x + (+s[0] * cw) / 2, z0 = depth / 2 - (+s[1] * depth) / 4;
        const x1 = x + (+s[2] * cw) / 2, z1 = depth / 2 - (+s[3] * depth) / 4;
        const dx = x1 - x0, dz = z1 - z0;
        strokes.push({ position: [(x0 + x1) / 2, SILK_Y, (z0 + z1) / 2], rotation: [0, -Math.atan2(dz, dx), 0], scale: [Math.hypot(dx, dz) + t, 0.0003, t] });
      }
      x += adv;
    }
    if (!strokes.length) throw new Error('look.label: give it at least one letter.');
    const mesh = kit.instances(BOX, typeof ink === 'string' ? M[ink] : ink, strokes);
    mesh.name = name;
    mesh.raycast = noHit;
    mesh.userData.width = W;
    mesh.userData.depth = depth;
    return mesh;
  };

  // ---------------------------------------------------------------- streets
  // A flat strip through [[x, z], ...] with mitred corners at height y, cut into short pieces so it can be lit part
  // way. Returns positions (6 per piece) and ends (distance along the strip where each piece ends).
  const strip = (pts, width, y, piece = 0.003) => {
    const hw = width / 2, n = pts.length;
    const dir = (i) => { const dx = pts[i + 1][0] - pts[i][0], dz = pts[i + 1][1] - pts[i][1], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
    const side = [];
    for (let i = 0; i < n; i++) {
      const a = dir(Math.max(0, i - 1)), b = dir(Math.min(n - 2, i));
      let mx = -a[1] - b[1], mz = a[0] + b[0];
      const ml = Math.hypot(mx, mz) || 1;
      mx /= ml; mz /= ml;
      const k = hw / Math.max(0.3, mx * -a[1] + mz * a[0]);
      side.push([mx * k, mz * k]);
    }
    const pos = [], ends = [];
    const tri = (A, B, C) => {
      const up = (B[1] - A[1]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[1] - A[1]) > 0;
      for (const P of up ? [A, B, C] : [A, C, B]) pos.push(P[0], y, P[1]);
    };
    let run = 0;
    for (let i = 0; i < n - 1; i++) {
      const len = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      const m = Math.max(1, Math.ceil(len / piece));
      const at = (f, s) => [pts[i][0] + s * side[i][0] + (pts[i + 1][0] + s * side[i + 1][0] - pts[i][0] - s * side[i][0]) * f,
        pts[i][1] + s * side[i][1] + (pts[i + 1][1] + s * side[i + 1][1] - pts[i][1] - s * side[i][1]) * f];
      for (let j = 0; j < m; j++) {
        const L0 = at(j / m, 1), R0 = at(j / m, -1), L1 = at((j + 1) / m, 1), R1 = at((j + 1) / m, -1);
        tri(L0, R0, L1);
        tri(R0, R1, L1);
        ends.push(run + (len * (j + 1)) / m);
      }
      run += len;
    }
    return { pos, ends };
  };
  const flatGeometry = (pos) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const normal = new Float32Array(pos.length), uv = new Float32Array((pos.length / 3) * 2);
    for (let i = 0; i < pos.length / 3; i++) { normal[i * 3 + 1] = 1; uv[i * 2] = pos[i * 3] * 8; uv[i * 2 + 1] = pos[i * 3 + 2] * 8; }
    g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return g;
  };
  // The same polyline moved sideways by d, mitred (bundles of parallel tracks).
  const offsetLine = (pts, d) => pts.map((p, i) => {
    const dir = (a, b) => { const x = b[0] - a[0], z = b[1] - a[1], l = Math.hypot(x, z) || 1; return [x / l, z / l]; };
    const a = dir(pts[Math.max(0, i - 1)], pts[Math.max(1, i)]), b = dir(pts[Math.min(pts.length - 2, i)], pts[Math.min(pts.length - 1, i + 1)]);
    const mx = -a[1] - b[1], mz = a[0] + b[0], ml = Math.hypot(mx, mz) || 1, k = d / ((mx / ml) * -a[1] + (mz / ml) * a[0]);
    return [p[0] + (mx / ml) * k, p[1] + (mz / ml) * k];
  });
  cc.route = (a, b, { diagonalFirst = false } = {}) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], ax = Math.abs(dx), az = Math.abs(dz);
    if (ax < 1e-6 || az < 1e-6 || Math.abs(ax - az) < 1e-6) return [a, b];
    const m = Math.min(ax, az), ddx = Math.sign(dx) * m, ddz = Math.sign(dz) * m;
    return [a, diagonalFirst ? [a[0] + ddx, a[1] + ddz] : [b[0] - ddx, b[1] - ddz], b];
  };
  cc.track = (points, name, { width = 0.003, lit = true } = {}) => {
    const g = new THREE.Group();
    g.name = name;
    const gold = new THREE.Mesh(flatGeometry(strip(points, width, 0.0006).pos), M.gold);
    gold.name = `${name} copper`;
    gold.raycast = noHit;
    g.add(gold);
    const path = lookPath(THREE, points.map(([x, z]) => [x, 0.0006, z]));
    let light = () => {};
    if (lit) {
      const s = strip(points, width * 0.7, 0.0009);
      const glow = new THREE.Mesh(flatGeometry(s.pos), M.travelled);
      glow.name = `${name} travelled`;
      glow.raycast = noHit;
      glow.geometry.setDrawRange(0, 0);
      g.add(glow);
      const ends = s.ends;
      light = (u) => {
        const at = Math.max(0, Math.min(1, u)) * path.length + 1e-6;
        let c = 0;
        while (c < ends.length && ends[c] <= at) c++;
        glow.geometry.setDrawRange(0, c * 6);
      };
    }
    return { mesh: g, path, length: path.length, light };
  };
  const VIA = new THREE.RingGeometry(0.0011, 0.0023, 14);
  VIA.rotateX(-Math.PI / 2);
  cc.vias = (points, name) => {
    const mesh = kit.instances(VIA, M.tin, points.map(([x, z]) => [x, 0.0004, z]));
    mesh.name = name;
    return mesh;
  };

  // ---------------------------------------------------------------- buildings
  cc.chip = (w, d, name, { h = 0.008, sides = 'z', pitch = 0.0045, mark } = {}) => {
    const g = new THREE.Group();
    g.name = name;
    const body = new THREE.Mesh(kit.roundedBox(w, h - 0.001, d, 0.0012), M.epoxy);
    body.name = `${name} body`;
    body.position.y = 0.001 + (h - 0.001) / 2;
    g.add(body);
    const pins = [], pads = [];
    pinRows(0, 0, w, d, h, sideList(sides), pitch, pins, pads);
    if (pins.length) g.add(kit.instances(GULL, M.tin, pins), kit.instances(BOX, M.gold, pads));
    g.add(cc.outline(w + (sides.includes('x') ? 0.011 : 0.004), d + (sides.includes('z') ? 0.011 : 0.004), `${name} outline`));
    if (mark) {
      const m = cc.label(mark, `${name} mark`, { h: Math.min(0.007, d * 0.3), ink: 'etch', stretch: 1, width: w * 0.8 });
      m.position.y = h;
      g.add(m);
    }
    const glow = plates(BOX, [{ position: [0, 0.0005, 0], scale: [w + 0.009, 0.0008, d + 0.009] }]);
    g.add(glow.mesh);
    g.userData.top = h;
    g.userData.wake = (k) => glow.set(0, k);
    return g;
  };
  cc.cpu = (size, name, { cores = 4, h = 0.006 } = {}) => {
    const g = new THREE.Group();
    g.name = name;
    const sub = new THREE.Mesh(kit.roundedBox(size, h * 0.55, size, 0.001), M.substrate);
    sub.name = `${name} substrate`;
    sub.position.y = 0.001 + h * 0.275;
    g.add(sub);
    const pins = [], pads = [];
    pinRows(0, 0, size, size, h, ['+x', '-x', '+z', '-z'], 0.0045, pins, pads);
    g.add(kit.instances(GULL, M.tin, pins), kit.instances(BOX, M.gold, pads));
    const top = 0.001 + h * 0.55;
    const a = size / 2 - 0.003, b = size / 2 - 0.009;
    const frame = new THREE.Mesh(kit.extrude([[-a, -a], [a, -a], [a, a], [-a, a]], 0.0025, { holes: [[[-b, -b], [-b, b], [b, b], [b, -b]]] }), M.steel);
    frame.name = `${name} frame`;
    frame.rotation.x = -Math.PI / 2;
    frame.position.y = top + 0.00125;
    g.add(frame);
    // The dies: bare silicon, each a slightly different tint, with a lamp plate on top that the wave lights.
    const pitchD = (2 * b - 0.003) / cores, die = pitchD * 0.82, list = [], lit = [];
    for (let i = 0; i < cores; i++) for (let j = 0; j < cores; j++) {
      const x = (i - (cores - 1) / 2) * pitchD, z = (j - (cores - 1) / 2) * pitchD;
      list.push({ position: [x, top + 0.001, z] });
      lit.push({ position: [x, top + 0.0021, z], scale: [die * 0.86, 0.0002, die * 0.86] });
    }
    const dies = kit.instances(kit.roundedBox(die, 0.002, die, 0.0004), M.silicon, list);
    dies.name = `${name} dies`;
    const TINT = ['#59606e', '#566d6d', '#72688a', '#6a7180', '#7a7468'];
    for (let i = 0; i < list.length; i++) dies.setColorAt(i, tmp.set(TINT[Math.floor(lookHash3(i, 3, 7) * TINT.length)]));
    dies.instanceColor.needsUpdate = true;
    const wave = plates(BOX, lit, new THREE.Color('#ffc46a'));
    g.add(dies, wave.mesh, cc.outline(size + 0.012, size + 0.012, `${name} outline`));
    const glow = plates(BOX, [{ position: [0, 0.0005, 0], scale: [size + 0.01, 0.0008, size + 0.01] }]);
    g.add(glow.mesh);
    g.userData.top = top + 0.002;
    g.userData.wake = (k) => {
      glow.set(0, k);
      const spread = 0.35, span = Math.max(1, 2 * (cores - 1));
      for (let i = 0; i < cores; i++) for (let j = 0; j < cores; j++) {
        const d = (i + (cores - 1 - j)) / span;
        wave.set(i * cores + j, (k * (1 + spread) - d * 1) / spread);
      }
    };
    return g;
  };
  cc.memoryBank = (n, name, { w = 0.012, d = 0.03, gap = 0.006, h = 0.007 } = {}) => {
    const g = new THREE.Group();
    g.name = name;
    const bodies = [], pins = [], pads = [], silk = [], glows = [];
    const step = w + 0.008 + gap;
    for (let c = 0; c < n; c++) {
      const x = (c - (n - 1) / 2) * step;
      bodies.push({ position: [x, 0.001 + (h - 0.001) / 2, 0] });
      pinRows(x, 0, w, d, h, ['+x', '-x'], 0.0045, pins, pads);
      outlineInto(silk, x, 0, w + 0.011, d + 0.004);
      glows.push({ position: [x, 0.0005, 0], scale: [w + 0.009, 0.0008, d + 0.007] });
    }
    const body = kit.instances(kit.roundedBox(w, h - 0.001, d, 0.001), M.epoxy, bodies);
    body.name = `${name} chips`;
    g.add(body, kit.instances(GULL, M.tin, pins), kit.instances(BOX, M.gold, pads), kit.instances(BOX, M.silk, silk));
    const glow = plates(BOX, glows);
    g.add(glow.mesh);
    g.userData.top = h;
    g.userData.width = n * step - gap;
    g.userData.chipX = (c) => (c - (n - 1) / 2) * step;
    g.userData.wake = (k, i) => {
      if (i === undefined) for (let c = 0; c < n; c++) glow.set(c, k);
      else glow.set(i, k);
    };
    return g;
  };
  // Capacitor cans: a black base, a brushed aluminium can with a crimp, a scored cross on top. Unit can, scaled.
  const CAN = kit.lathe([[0, 0], [1, 0], [1, 0.1], [0.93, 0.13], [0.93, 0.18], [1, 0.21], [1, 0.97], [0.9, 1], [0, 1]], 32);
  const BASE = kit.roundedBox(1, 1, 1, 0.12);
  cc.towers = (list, name) => {
    const g = new THREE.Group();
    g.name = name;
    const bases = [], cans = [], cross = [], silk = [], glows = [];
    for (const [x, z, r, h] of list) {
      bases.push({ position: [x, 0.0015, z], scale: [2 * r + 0.003, 0.003, 2 * r + 0.003] });
      cans.push({ position: [x, 0.003, z], scale: [r, h, r] });
      cross.push({ position: [x, 0.003 + h + 0.0002, z], scale: [1.3 * r, 0.0005, 0.0008] }, { position: [x, 0.003 + h + 0.0002, z], rotation: [0, Math.PI / 2, 0], scale: [1.3 * r, 0.0005, 0.0008] });
      ringInto(silk, x, z, r + 0.0035);
      glows.push({ position: [x, 0.0005, z], scale: [r + 0.006, 0.0008, r + 0.006] });
    }
    const can = kit.instances(CAN, M.alu, cans);
    can.name = `${name} cans`;
    g.add(kit.instances(BASE, M.plastic, bases), can, kit.instances(BOX, M.plastic, cross), kit.instances(BOX, M.silk, silk));
    const glow = plates(DISC, glows);
    g.add(glow.mesh);
    g.userData.wake = (k, i) => {
      if (i === undefined) for (let c = 0; c < list.length; c++) glow.set(c, k);
      else glow.set(i, k);
    };
    return g;
  };
  cc.tower = (r, h, name) => cc.towers([[0, 0, r, h]], name);
  // Resistors (black) and ceramic capacitors (tan): small bricks with tinned ends on gold pads, 3 draw calls in all.
  const BRICK = kit.roundedBox(1, 1, 1, 0.15);
  const TAN = ['#8c6a48', '#7d5c3e', '#987650'];
  cc.smallParts = (list, name) => {
    const g = new THREE.Group();
    g.name = name;
    const bodies = [], caps = [], pads = [], kinds = [];
    for (const [x, z, a = 0, kind = 'c'] of list) {
      const len = 0.007, wid = 0.0035, h = kind === 'r' ? 0.0022 : 0.003;
      const c = Math.cos(a), s = Math.sin(a);
      bodies.push({ position: [x, 0.0004 + h / 2, z], rotation: [0, a, 0], scale: [len * 0.62, h, wid] });
      kinds.push(kind);
      for (const e of [-1, 1]) {
        caps.push({ position: [x + e * c * len * 0.39, 0.0004 + h / 2, z - e * s * len * 0.39], rotation: [0, a, 0], scale: [len * 0.24, h * 1.07, wid * 1.07] });
        pads.push({ position: [x + e * c * len * 0.44, 0.0002, z - e * s * len * 0.44], rotation: [0, a, 0], scale: [len * 0.4, 0.0004, wid * 1.25] });
      }
    }
    if (!bodies.length) return g;
    const body = kit.instances(BRICK, M.ceramic, bodies);
    kinds.forEach((k, i) => body.setColorAt(i, tmp.set(k === 'r' ? '#0b0b0c' : TAN[i % 3])));
    body.instanceColor.needsUpdate = true;
    g.add(body, kit.instances(BRICK, M.tin, caps), kit.instances(BOX, M.gold, pads));
    return g;
  };
  cc.scatter = (keep, { lines = [], count = 30, seed = 1, width = 0.4, depth = 0.28, margin = 0.014 } = {}) => {
    const out = [];
    const nearLine = (x, z) => lines.some((pts) => pts.some((p, i) => {
      if (i === 0) return false;
      const q = pts[i - 1], dx = p[0] - q[0], dz = p[1] - q[1], l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - q[0]) * dx + (z - q[1]) * dz) / l2));
      return Math.hypot(x - q[0] - t * dx, z - q[1] - t * dz) < 0.008;
    }));
    for (let i = 0; i < count * 40 && out.length < count; i++) {
      const x = (lookHash3(i, seed, 1) - 0.5) * (width - 2 * margin), z = (lookHash3(i, seed, 2) - 0.5) * (depth - 2 * margin);
      if (keep.some(([kx, kz, kw, kd]) => Math.abs(x - kx) < kw / 2 + 0.006 && Math.abs(z - kz) < kd / 2 + 0.006)) continue;
      if (out.some(([ox, oz]) => Math.hypot(ox - x, oz - z) < 0.011) || nearLine(x, z)) continue;
      out.push([x, z, lookHash3(i, seed, 3) < 0.5 ? 0 : Math.PI / 2, lookHash3(i, seed, 4) < 0.35 ? 'r' : 'c']);
    }
    return out;
  };
  // A metal port at the edge of the board: where the journey comes in or leaves.
  const FACE = { '+z': 0, '-z': Math.PI, '+x': Math.PI / 2, '-x': -Math.PI / 2 };
  const roundRect = (W, H, r) => {
    const pts = [];
    for (const [cx, cy, a0] of [[W / 2 - r, H / 2 - r, 0], [-W / 2 + r, H / 2 - r, Math.PI / 2], [-W / 2 + r, -H / 2 + r, Math.PI], [W / 2 - r, -H / 2 + r, 1.5 * Math.PI]]) {
      for (let k = 0; k <= 4; k++) pts.push([cx + Math.cos(a0 + (k / 4) * (Math.PI / 2)) * r, cy + Math.sin(a0 + (k / 4) * (Math.PI / 2)) * r]);
    }
    return pts;
  };
  cc.connector = (name, { face = '-x', w = 0.034, h = 0.013, d = 0.032 } = {}) => {
    const g = new THREE.Group();
    g.name = name;
    const body = new THREE.Group();
    body.rotation.y = FACE[face];
    g.add(body);
    const y = h / 2 + 0.0005;
    const shell = new THREE.Mesh(kit.extrude(roundRect(w, h, 0.003), d, { holes: [roundRect(w - 0.0016, h - 0.0016, 0.0024)] }), M.steel);
    shell.name = `${name} shell`;
    shell.position.y = y;
    const back = new THREE.Mesh(kit.roundedBox(w - 0.0016, h - 0.0016, 0.002, 0.0008), M.plastic);
    back.position.set(0, y, -d / 2 + 0.001);
    const tongue = new THREE.Mesh(kit.roundedBox(w * 0.7, h * 0.2, d * 0.75, 0.0006), M.plastic);
    tongue.position.set(0, y, -d * 0.1);
    const contactMat = lamp('#ffb25e', 0, '#d9a546');
    const contacts = [];
    for (let i = 0; i < 8; i++) contacts.push({ position: [(i - 3.5) * (w * 0.7) / 8, y + h * 0.1 + 0.0002, -d * 0.02], scale: [w * 0.045, 0.0004, d * 0.5] });
    const legs = [];
    for (let i = 0; i < 6; i++) legs.push({ position: [(i - 2.5) * 0.004, 0.0004, -d / 2], rotation: [0, SIDE['-z'], 0], scale: [0.0035, h * 0.25, 0.0018] });
    const spill = kit.glow('#ffb25e', 0.06, { opacity: 0 });
    spill.position.set(0, y, d / 2 + 0.006);
    const spillMat = spill.children[0].material;
    const silk = [];
    outlineInto(silk, 0, 0, w + 0.004, d + 0.004);
    body.add(shell, back, tongue, kit.instances(BOX, contactMat, contacts), kit.instances(GULL, M.tin, legs), kit.instances(BOX, M.silk, silk), spill);
    g.userData.top = h + 0.0005;
    g.userData.wake = (k) => { contactMat.emissiveIntensity = 3 * k; spillMat.opacity = 0.9 * Math.max(0, Math.min(1, k)); };
    return g;
  };
  cc.led = (colour, name) => {
    const g = new THREE.Group();
    g.name = name;
    const mat = kit.material('plastic', { color: '#d9dde0', roughness: 0.35, wear: 0, glow: 1 });
    mat.emissive.set(colour);
    mat.emissiveIntensity = 0;
    const body = new THREE.Mesh(kit.roundedBox(0.006, 0.0035, 0.0045, 0.0008), mat);
    body.position.y = 0.0004 + 0.00175;
    const ends = kit.instances(BRICK, M.tin, [{ position: [-0.0035, 0.0019, 0], scale: [0.0014, 0.003, 0.0047] }, { position: [0.0035, 0.0019, 0], scale: [0.0014, 0.003, 0.0047] }]);
    const halo = kit.glow(colour, 0.03, { opacity: 0 });
    halo.position.y = 0.004;
    const haloMat = halo.children[0].material;
    g.add(body, ends, halo);
    g.userData.wake = (k) => { mat.emissiveIntensity = 3 * k; haloMat.opacity = 0.85 * Math.max(0, Math.min(1, k)); };
    return g;
  };
  // A bar meter: lamp segments on a black body, green, then amber, then red. userData.set(k) lights k of it.
  cc.meter = (name, { segments = 10, w = 0.09 } = {}) => {
    const g = new THREE.Group();
    g.name = name;
    const body = new THREE.Mesh(kit.roundedBox(w, 0.005, 0.016, 0.0012), M.epoxy);
    body.position.y = 0.0035;
    const list = [], on = [], off = new THREE.Color('#1c2621');
    const segW = (w - 0.008) / segments;
    for (let i = 0; i < segments; i++) {
      list.push({ position: [-w / 2 + 0.004 + segW * (i + 0.5), 0.0064, 0], scale: [segW * 0.72, 0.0012, 0.009] });
      const f = (i + 0.5) / segments;
      on.push(new THREE.Color(f < 0.6 ? '#4dff88' : f < 0.85 ? '#ffb44a' : '#ff4a3a'));
    }
    const segs = kit.instances(BOX, new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), list);
    segs.name = `${name} segments`;
    for (let i = 0; i < segments; i++) segs.setColorAt(i, off);
    segs.instanceColor.needsUpdate = true;
    g.add(body, segs, cc.outline(w + 0.004, 0.02, `${name} outline`));
    let shown = -1;
    g.userData.set = (k) => {
      const n = Math.round(Math.max(0, Math.min(1, k)) * segments);
      if (n === shown) return;
      shown = n;
      for (let i = 0; i < segments; i++) segs.setColorAt(i, i < n ? on[i] : off);
      segs.instanceColor.needsUpdate = true;
    };
    return g;
  };

  // ---------------------------------------------------------------- the travelling light and the data it carries
  cc.pulse = (name = 'Pulse', { size = 0.032, trail = 3 } = {}) => {
    const g = new THREE.Group();
    g.name = name;
    const head = kit.glow('#ffb44a', size);
    const core = new THREE.Mesh(new THREE.SphereGeometry(size * 0.1, 12, 8), lamp('#fff2d8', 3, '#fff2d8'));
    core.raycast = noHit;
    const tail = [];
    for (let i = 0; i < trail; i++) tail.push(kit.glow('#ff9a3c', size * (0.72 - i * 0.16), { opacity: 0.75 - i * 0.18 }));
    g.add(head, core, ...tail);
    const lift = size * 0.12;
    return {
      mesh: g,
      // Put the pulse at u (0..1) of a track's path, its trail just behind it.
      follow(path, u) {
        path.at(u, head.position);
        head.position.y += lift;
        core.position.copy(head.position);
        for (let i = 0; i < tail.length; i++) {
          const back = u - ((i + 1) * size * 0.32) / path.length;
          tail[i].visible = back > 0;
          path.at(back, tail[i].position);
          tail[i].position.y += lift;
        }
      },
    };
  };
  cc.token = (texts, colours, name = 'Data') => {
    const g = new THREE.Group();
    g.name = name;
    const W = 0.044, H = 0.012, D = 0.03;
    const C = colours.map((c) => new THREE.Color(c));
    const mat = lamp(colours[0], 0.9, colours[0]);
    const puck = new THREE.Mesh(kit.roundedBox(W, H, D, 0.004), mat);
    puck.name = `${name} body`;
    puck.position.y = H / 2;
    const halo = kit.glow(colours[0], 0.085, { opacity: 0.5 });
    halo.position.y = H / 2;
    const haloMat = halo.children[0].material;
    const labels = texts.map((t, i) => {
      const l = cc.label(t, `${name}: ${t}`, { h: 0.009, ink: 'plastic', stretch: 1.15, width: W - 0.008 });
      l.position.y = H;
      l.visible = i === 0;
      return l;
    });
    g.add(puck, halo, ...labels);
    return {
      mesh: g,
      show(i) {
        for (let k = 0; k < labels.length; k++) labels[k].visible = k === i;
        const c = C[Math.min(i, C.length - 1)];
        mat.color.copy(c);
        mat.emissive.copy(c);
        haloMat.color.copy(c);
      },
    };
  };
  cc.wake = (object, k, i) => { if (object.userData.wake) object.userData.wake(k, i); };

  // ---------------------------------------------------------------- the board
  cc.set = ({ width = 0.42, depth = 0.3, traces = true } = {}) => {
    const set = new THREE.Group();
    set.name = 'Circuit board';
    const board = new THREE.Mesh(kit.roundedBox(width, 0.006, depth, 0.003), M.mask);
    board.position.y = 0.003;
    set.add(board);
    const pads = [];
    for (let i = 0; i < 16; i++) pads.push({ position: [-width / 2 + 0.03 + (i * (width - 0.06)) / 15, 0.0062, -depth / 2 + 0.008], scale: [0.009, 0.0004, 0.01] });
    const holes = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => ({ position: [x * (width / 2 - 0.012), 0.006, z * (depth / 2 - 0.012)], rotation: [Math.PI / 2, 0, 0] }));
    set.add(kit.instances(BOX, M.gold, pads), kit.instances(new THREE.TorusGeometry(0.005, 0.0015, 8, 20), M.gold, holes));
    // Copper under the mask: bundles of thin lines with 45-degree bends, a shade lighter than the board.
    if (traces) {
      const pos = [];
      const inside = (x, z) => Math.abs(x) < width / 2 - 0.015 && Math.abs(z) < depth / 2 - 0.02;
      for (let b = 0; b < 14; b++) {
        let x = (lookHash3(b, 1, 7) - 0.5) * (width - 0.06), z = (lookHash3(b, 2, 7) - 0.5) * (depth - 0.06);
        let dir = Math.floor(lookHash3(b, 3, 7) * 8);
        const pts = [[x, z]];
        for (let s = 0; s < 3; s++) {
          const l = 0.03 + lookHash3(b, s, 9) * 0.07;
          const nx = x + Math.cos((dir * Math.PI) / 4) * l, nz = z + Math.sin((dir * Math.PI) / 4) * l;
          if (!inside(nx, nz)) break;
          x = nx; z = nz;
          pts.push([x, z]);
          dir += lookHash3(b, s, 11) < 0.5 ? 1 : -1;
        }
        if (pts.length < 2) continue;
        const n = 2 + Math.floor(lookHash3(b, 5, 7) * 4);
        for (let k = 0; k < n; k++) pos.push(...strip(offsetLine(pts, (k - (n - 1) / 2) * 0.0035), 0.0013, 0.0061, 1).pos);
      }
      if (pos.length) {
        const copper = new THREE.Mesh(flatGeometry(pos), M.copper);
        copper.name = 'Copper under the mask';
        copper.raycast = noHit;
        set.add(copper);
      }
    }
    set.userData.top = 0.006;
    set.userData.width = width;
    set.userData.depth = depth;
    return set;
  };

  cc.demo = (subject) => {
    const port = cc.connector('Input port', { face: '-x' });
    port.position.set(-0.17, 0, 0.02);
    const chip = cc.chip(0.04, 0.03, 'Controller', { sides: 'xz', mark: 'U1' });
    chip.position.set(-0.07, 0, 0.02);
    const cpu = cc.cpu(0.07, 'Processor');
    cpu.position.set(0.07, 0, -0.01);
    const t = cc.track([[-0.17, 0.02], ...cc.route([-0.07, 0.02], [0.07, -0.01])], 'Track');
    t.light(0.4);
    const pulse = cc.pulse();
    pulse.follow(t.path, 0.4);
    const name = cc.label('CPU', 'Processor name');
    name.position.set(0.07, 0, 0.045);
    subject.add(port, chip, cpu, t.mesh, pulse.mesh, name);
    cc.wake(chip, 1);
    cc.wake(cpu, 0.6);
    return [{ object: port, press: true }, { object: chip, press: true }, { object: cpu, press: true }];
  };
  return cc;
}
