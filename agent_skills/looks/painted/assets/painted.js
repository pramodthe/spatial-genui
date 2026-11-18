// Painted look for an XR lesson: a picture-book oil painting of a place. Brush dabs fixed to each thing, warm in the
// light and cool in the shadow, small warm lamps where the eye should go, on a painted ground with a ragged canvas
// edge. Needs look-kit.js (lookShade 'dabs', lookLumpy, lookPath, lookNoise, lookHash3). new-lesson.mjs pastes it in.
//
// paintedLook(THREE, kit) returns:
//   PAL                                   the paint box: { name: [lit (warm), shade (cool)] }
//   mat(colour, scale)                    one shared dab material per colour and dab size (metres per dab, 0.016)
//   own(colour, scale)                    a dab material of its own (to glow one thing, or tint it in update)
//   paint(geometry, colour, name, scale)  any geometry as a painted mesh
//   shine(object)                         gives object's painted parts their own materials; returns set(k), k 0..1 glow
//   blob(r, colour, name, { squash })     a lumpy round form: crowns, bushes, fleece, clouds, piles
//   lamp(size, name, { on })              a warm lit window / lantern; lamp.userData.set(k) turns it up (0..1)
//   sun(r, name)                          a low golden sun with a soft glow
//   house(name, { w, d, h, wall, roof, chimney })   cottage, bakery, barn; .userData.window (a lamp), .door, .top
//   windmill(name, { h })                 tower, cap, four sails; .userData.rotor (turn rotation.z), .lamp, .top
//   waterwheel(name, { r })               a paddle wheel facing +z; .userData.wheel (turn rotation.z)
//   tree(name, { h, kind })               'round' or 'poplar'; hedge(len, name, { h })
//   field(w, d, name, { n, colour, h })   a field of instanced stalks on a soil patch;
//                                         .userData.sway(time, wind) bends them (call in update), .userData.cut(k)
//   path(points, name, { width, colour }) a track on the ground, points [[x, z], ...]; .userData.route = lookPath
//   river(points, name, { width })        water the same way; .userData.route runs along its middle
//   cart(name, { len })                   a farm cart; .userData.wheels, .userData.load (a group on the bed)
//   boat(name, { len, sail })             a small boat, bow toward +x
//   sack(name, { h, open })               a flour sack; open: .userData.fill(k) raises the flour inside (0..1)
//   pile(name, { r, colour })             a heap (flour, grain, wool, earth); .userData.fill(k) grows it (0..1)
//   loaf(name, { len })                   a bread loaf with the baker's cuts
//   figure(name, { h, colour, hat })      a person as a big simple shape, feet at y = 0, faces +z
//   animal(name, { kind, len })           'sheep' | 'cow' | 'horse', feet at y = 0, faces +x
//   smoke(name, { n, h })                 rising puffs; .userData.rise(time, lean) in update
//   caption(lines, name, { width })       a signboard with one caption per step; .userData.show(i)
//   set({ width, depth, round })          the painted ground on its canvas; never grabbable; .userData.top
//   demo(subject)                         a working sample (replace it)
function paintedLook(THREE, kit) {
  const PAL = {
    meadow: ['#a3a83a', '#3c5a2e'], wheat: ['#efd07a', '#a5532f'], stubble: ['#d9b25a', '#7a5a5a'],
    earth: ['#e6c79c', '#6c68a4'], wall: ['#fff0cc', '#8f7aa8'], roof: ['#c8582c', '#4c3f6a'],
    tree: ['#7f9a34', '#1d4a3c'], bark: ['#8a5a3a', '#3a2438'], wood: ['#d69a5a', '#5a3440'],
    water: ['#8fc0d8', '#3f72c0'], stone: ['#e2c08c', '#5a5a7a'], cloth: ['#4f77a0', '#34557e'],
    wool: ['#fbf3e4', '#9d93b8'], linen: ['#f2e4c8', '#8f7f9a'], flour: ['#fff8ea', '#b8b0cc'],
    crust: ['#eba445', '#7a3a2c'], sail: ['#fff3d2', '#a89cb0'], skin: ['#f2c6a0', '#8a5a6a'],
    red: ['#e0552a', '#6a2a3a'], dark: ['#6a5a5a', '#2a2238'],
  };
  const mats = {};
  let seed = 1;
  const look = { name: 'painted', PAL };
  const known = (colour) => {
    if (!PAL[colour]) throw new Error(`paintedLook: no paint "${colour}". Paints: ${Object.keys(PAL).join(', ')}`);
  };
  look.mat = (colour, scale = 0.016) => {
    known(colour);
    const key = `${colour}:${scale}`;
    if (!mats[key]) mats[key] = lookShade(THREE, { mode: 'dabs', lit: PAL[colour][0], shade: PAL[colour][1], scale });
    return mats[key];
  };
  look.own = (colour, scale = 0.016) => {
    known(colour);
    return lookShade(THREE, { mode: 'dabs', lit: PAL[colour][0], shade: PAL[colour][1], scale });
  };
  // A painted object. Keep shapes big and simple: brush dabs need room (no part thinner than about 4 mm).
  look.paint = (geometry, colour, name, scale) => {
    const mesh = new THREE.Mesh(geometry, look.mat(colour, scale));
    mesh.name = name;
    return mesh;
  };
  // The active stop brightens: give its painted parts their own materials (once, in build) and get a setter.
  look.shine = (object) => {
    const copies = new Map();
    object.traverse((o) => {
      if (!o.isMesh || !o.material || !o.material.uniforms || !o.material.uniforms.uGlow) return;
      if (!copies.has(o.material)) copies.set(o.material, o.material.clone());
      o.material = copies.get(o.material);
    });
    const list = [...copies.values()];
    return (k) => { for (let i = 0; i < list.length; i++) list[i].uniforms.uGlow.value = k; };
  };
  // A lumpy round form; squash < 1 flattens it. The lumps are baked in, so dabs stay put on them.
  look.blob = (r, colour, name, { squash = 1, scale } = {}) => {
    const g = new THREE.SphereGeometry(r, 18, 12);
    g.scale(1, squash, 1);
    return look.paint(lookLumpy(THREE, g, r * 0.16, r * 0.9, seed++), colour, name, scale ?? Math.max(0.006, r * 0.5));
  };
  // A warm window, door or lantern: the eye goes to it. lamp.userData.set(k): 0 = dark, 1 = fully lit.
  look.lamp = (size, name, { on = 1 } = {}) => {
    const m = kit.material('light', { color: '#ffa23c', glow: 2 });
    const mesh = new THREE.Mesh(kit.roundedBox(size, size * 1.25, size * 0.3, size * 0.12), m);
    mesh.name = name;
    const halo = kit.glow('#ffb45a', size * 4, { opacity: 0.75 });
    mesh.add(halo);
    mesh.userData.set = (k) => {
      m.emissiveIntensity = 0.15 + 2.2 * k;
      halo.visible = k > 0.05;
      halo.scale.setScalar(0.5 + 0.7 * k);
    };
    mesh.userData.set(on);
    return mesh;
  };
  look.sun = (r = 0.022, name = 'Sun') => {
    const g = new THREE.Group();
    g.name = name;
    const disc = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), kit.material('light', { color: '#ffc45a', glow: 1.6 }));
    disc.name = `${name} disc`;
    g.add(disc, kit.glow('#ff9a3c', r * 7, { opacity: 0.6 }));
    return g;
  };
  // Buildings: one big silhouette each. The front (door, window) faces +z. Static parts are merged per paint.
  look.house = (name, { w = 0.08, d = 0.06, h = 0.055, wall = 'wall', roof = 'roof', chimney = true } = {}) => {
    const g = new THREE.Group();
    g.name = name;
    const body = look.paint(kit.roundedBox(w, h, d, 0.003), wall, `${name} walls`, 0.012);
    body.position.y = h / 2;
    const rh = h * 0.62;
    const top = look.paint(kit.extrude([[-w / 2 - 0.006, 0], [w / 2 + 0.006, 0], [0, rh]], d + 0.012, { bevel: 0.0015 }), roof, `${name} roof`, 0.012);
    top.position.y = h - 0.001;
    const door = look.paint(kit.roundedBox(w * 0.22, h * 0.5, 0.006, 0.0015), 'wood', `${name} door`, 0.008);
    door.position.set(-w * 0.2, h * 0.25, d / 2 + 0.001);
    g.add(body, top, door);
    if (chimney) {
      const c = look.paint(kit.roundedBox(0.012, rh * 0.8, 0.012, 0.002), 'stone', `${name} chimney`, 0.008);
      c.position.set(w * 0.24, h + rh * 0.55, -d * 0.15);
      g.add(c);
    }
    kit.merge(g);
    const win = look.lamp(Math.min(0.02, w * 0.24), `${name} window`, { on: 0.7 });
    win.position.set(w * 0.2, h * 0.55, d / 2 + 0.002);
    g.add(win);
    g.userData.window = win;
    g.userData.door = [-w * 0.2, 0, d / 2 + 0.004];
    g.userData.chimney = chimney ? [w * 0.24, h + rh * 0.95, -d * 0.15] : null;
    g.userData.top = h + rh;
    return g;
  };
  // A tower mill: eight-sided tower, cap, four broad sails on a rotor in front (turn rotor.rotation.z).
  look.windmill = (name, { h = 0.13, body = 'wall', cap = 'roof' } = {}) => {
    const g = new THREE.Group();
    g.name = name;
    const tower = look.paint(new THREE.CylinderGeometry(h * 0.17, h * 0.25, h, 8), body, `${name} tower`, 0.012);
    tower.position.y = h / 2;
    tower.rotation.y = Math.PI / 8;                // a flat face toward +z for the door
    const top = look.paint(new THREE.ConeGeometry(h * 0.22, h * 0.24, 8), cap, `${name} cap`, 0.01);
    top.position.y = h + h * 0.11;
    top.rotation.y = Math.PI / 8;
    const door = look.paint(kit.roundedBox(h * 0.16, h * 0.26, 0.006, 0.0015), 'wood', `${name} door`, 0.008);
    door.position.set(0, h * 0.13, h * 0.235);
    g.add(tower, top, door);
    kit.merge(g);
    const lamp = look.lamp(h * 0.09, `${name} window`, { on: 0.4 });
    lamp.position.set(0, h * 0.55, h * 0.205);
    g.add(lamp);
    const rotor = new THREE.Group();
    rotor.name = `${name} sails`;
    rotor.position.set(0, h * 0.88, h * 0.27 + 0.004);
    const L = h * 0.75;
    rotor.add(look.paint(new THREE.SphereGeometry(h * 0.045, 12, 8), 'wood', `${name} hub`, 0.008));
    for (let k = 0; k < 4; k++) {
      const arm = new THREE.Group();
      arm.rotation.z = (k * Math.PI) / 2;
      const spar = look.paint(kit.roundedBox(0.005, L, 0.005, 0.0015), 'wood', `${name} spar`, 0.008);
      spar.position.y = L / 2;
      const cloth = look.paint(kit.roundedBox(L * 0.3, L * 0.74, 0.003, 0.001), 'sail', `${name} sail`, 0.01);
      cloth.position.set(L * 0.17, L * 0.6, -0.003);
      arm.add(spar, cloth);
      rotor.add(arm);
    }
    kit.merge(rotor);
    g.add(rotor);
    g.userData.rotor = rotor;
    g.userData.lamp = lamp;
    g.userData.top = h + h * 0.23;
    return g;
  };
  // A paddle wheel facing +z (stand it at the river's edge); turn wheel.rotation.z.
  look.waterwheel = (name, { r = 0.04 } = {}) => {
    const g = new THREE.Group();
    g.name = name;
    const wheel = new THREE.Group();
    wheel.name = `${name} wheel`;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.014, 20, 1, true), look.own('wood', 0.008));
    rim.name = `${name} rim`;
    rim.material.side = THREE.DoubleSide;
    rim.rotation.x = Math.PI / 2;
    const hub = look.paint(new THREE.CylinderGeometry(r * 0.2, r * 0.2, 0.02, 10), 'bark', `${name} hub`, 0.008);
    hub.rotation.x = Math.PI / 2;
    wheel.add(rim, hub);
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const paddle = look.paint(kit.roundedBox(0.005, r * 0.42, 0.016, 0.0015), 'wood', `${name} paddle`, 0.008);
      paddle.position.set(Math.cos(a) * r * 0.86, Math.sin(a) * r * 0.86, 0);
      paddle.rotation.z = a - Math.PI / 2;
      const spoke = look.paint(kit.roundedBox(0.004, r * 0.8, 0.004, 0.001), 'bark', `${name} spoke`, 0.008);
      spoke.position.set(Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45, 0);
      spoke.rotation.z = a - Math.PI / 2;
      wheel.add(paddle, spoke);
    }
    kit.merge(wheel);
    wheel.position.y = r;
    g.add(wheel);
    g.userData.wheel = wheel;
    return g;
  };
  // Trees are a trunk and a few lumpy crowns, nothing more: the dabs do the leaves.
  look.tree = (name, { h = 0.08, kind = 'round', colour = 'tree' } = {}) => {
    const g = new THREE.Group();
    g.name = name;
    const trunk = look.paint(new THREE.CylinderGeometry(h * 0.045, h * 0.07, h * 0.5, 6), 'bark', `${name} trunk`, 0.008);
    trunk.position.y = h * 0.25;
    g.add(trunk);
    const crowns = kind === 'poplar' ? [[0, 0.62, 0, 0.17, 2.4]] : [[0, 0.66, 0, 0.3, 0.85], [-0.17, 0.52, 0.06, 0.2, 0.85], [0.17, 0.55, -0.05, 0.21, 0.85]];
    for (const [x, y, z, r, sq] of crowns) {
      const c = look.blob(h * r, colour, `${name} crown`, { squash: sq });
      c.position.set(x * h, y * h, z * h);
      g.add(c);
    }
    kit.merge(g);
    return g;
  };
  look.hedge = (len, name, { h = 0.025 } = {}) => {
    const g = new THREE.Group();
    g.name = name;
    const n = Math.max(2, Math.round(len / (h * 0.9)));
    for (let i = 0; i < n; i++) {
      const b = look.blob(h * (0.55 + 0.2 * lookHash3(i, 2, 7)), 'tree', `${name} bush`, { squash: 0.8 });
      b.position.set(-len / 2 + (i + 0.5) * (len / n), h * 0.45, (lookHash3(i, 5, 1) - 0.5) * 0.006);
      g.add(b);
    }
    kit.merge(g);
    return g;
  };
  // A field: a soil patch and n instanced stalks with ears. Call field.userData.sway(time, wind) every frame: wind
  // 0..1, the wave runs along +x (turn the field so +x points downwind). field.userData.cut(k) reaps the first k of
  // it (from -x) down to stubble. For grass: { colour: 'meadow', h: 0.02, ears: false }.
  look.field = (w, d, name, { n = 260, colour = 'wheat', h = 0.04, ears = true, soil = 'stubble' } = {}) => {
    const g = new THREE.Group();
    g.name = name;
    const patch = look.paint(kit.roundedBox(w, 0.004, d, 0.0015), soil, `${name} soil`, 0.014);
    patch.position.y = 0.002;
    g.add(patch);
    const k = h / 0.04;
    const profile = ears
      ? [[0.0014, 0], [0.0012, 0.6], [0.003, 0.7], [0.0036, 0.84], [0.0022, 0.96], [0, 1]]
      : [[0.003, 0], [0.0018, 0.5], [0, 1]];
    const stalks = new THREE.InstancedMesh(kit.lathe(profile.map(([r, y]) => [r * Math.max(1, k), y * h]), 5), look.mat(colour, 0.006), n);
    stalks.name = `${name} stalks`;
    const cols = Math.max(1, Math.round(Math.sqrt((n * w) / d)));
    const rows = Math.ceil(n / cols);
    const base = new Float32Array(n * 4);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const cx = i % cols, cz = Math.floor(i / cols);
      base[i * 4] = -w / 2 + ((cx + 0.2 + 0.6 * lookHash3(i, 1, 3)) / cols) * w;
      base[i * 4 + 1] = -d / 2 + ((cz + 0.2 + 0.6 * lookHash3(i, 4, 2)) / rows) * d;
      base[i * 4 + 2] = lookHash3(i, 7, 9) * Math.PI * 2;
      base[i * 4 + 3] = 0.8 + 0.4 * lookHash3(i, 3, 8);
      const t = 0.85 + 0.25 * lookHash3(i, 9, 5);
      stalks.setColorAt(i, c.setRGB(t, t, t * (0.92 + 0.1 * lookHash3(i, 2, 2))));
    }
    if (stalks.instanceColor) stalks.instanceColor.needsUpdate = true;
    g.add(stalks);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
    let reaped = 0;
    const sway = (time, wind = 0.2) => {
      for (let i = 0; i < n; i++) {
        const x = base[i * 4], z = base[i * 4 + 1], tall = base[i * 4 + 3];
        const cutHere = (x + w / 2) / w < reaped;
        const lean = cutHere ? 0 : (0.05 + 0.4 * wind) * (0.55 + 0.45 * Math.sin(time * 2.4 - x * 55 + z * 9));
        e.set(lean * 0.25, base[i * 4 + 2], -lean, 'ZYX');
        q.setFromEuler(e);
        p.set(x, 0.003, z);
        s.set(1, cutHere ? 0.14 : tall, 1);
        stalks.setMatrixAt(i, m4.compose(p, q, s));
      }
      stalks.instanceMatrix.needsUpdate = true;
    };
    sway(0, 0.2);
    if (stalks.computeBoundingSphere) stalks.computeBoundingSphere();
    g.userData.sway = sway;
    g.userData.cut = (k2) => { reaped = Math.max(0, Math.min(1, k2)); };
    g.userData.stalks = stalks;
    return g;
  };
  // A flat ribbon on the ground through points [[x, z], ...], with a painted (wobbly) edge.
  const ribbon = (points, width, y) => {
    const route = lookPath(THREE, points.map(([x, z]) => [x, y, z]));
    const N = Math.max(8, Math.round(route.length / 0.008));
    const pos = new Float32Array((N + 1) * 6);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), here = new THREE.Vector3();
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      route.at(Math.max(0, u - 0.01), a);
      route.at(Math.min(1, u + 0.01), b);
      route.at(u, here);
      const tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1;
      const nx = -tz / l, nz = tx / l;
      for (const [j, side] of [[0, -1], [1, 1]]) {
        const half = (width / 2) * (1 + 0.18 * lookNoise(u * 14, side * 3, 1.7));
        pos[(i * 2 + j) * 3] = here.x + nx * half * side;
        pos[(i * 2 + j) * 3 + 1] = y;
        pos[(i * 2 + j) * 3 + 2] = here.z + nz * half * side;
      }
    }
    const index = [];
    for (let i = 0; i < N; i++) { const k = i * 2; index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    return geo;
  };
  look.path = (points, name, { width = 0.024, colour = 'earth' } = {}) => {
    const mesh = look.paint(ribbon(points, width, 0.0015), colour, name, 0.01);
    mesh.userData.route = lookPath(THREE, points.map(([x, z]) => [x, 0.002, z]));
    return mesh;
  };
  look.river = (points, name, { width = 0.04 } = {}) => {
    const mesh = look.paint(ribbon(points, width, 0.002), 'water', name, 0.012);
    mesh.userData.route = lookPath(THREE, points.map(([x, z]) => [x, 0.004, z]));
    return mesh;
  };
  // A farm cart: a bed on two wheels with shafts toward +x. Put the load in cart.userData.load.
  look.cart = (name, { len = 0.06 } = {}) => {
    const g = new THREE.Group();
    g.name = name;
    const r = len * 0.22, wid = len * 0.55;
    const body = new THREE.Group();
    const bed = look.paint(kit.roundedBox(len, len * 0.2, wid, 0.002), 'wood', `${name} bed`, 0.01);
    bed.position.y = r + len * 0.1;
    body.add(bed);
    for (const side of [-1, 1]) {
      const shaft = look.paint(kit.roundedBox(len * 0.7, 0.005, 0.005, 0.0015), 'bark', `${name} shaft`, 0.008);
      shaft.position.set(len * 0.75, r * 0.75, side * wid * 0.32);
      shaft.rotation.z = -0.3;
      body.add(shaft);
    }
    kit.merge(body);
    g.add(body);
    const wheels = [];
    for (const side of [-1, 1]) {
      const wheel = look.paint(new THREE.CylinderGeometry(r, r, 0.006, 14), 'bark', `${name} wheel`, 0.008);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(0, r, side * (wid / 2 + 0.004));
      g.add(wheel);
      wheels.push(wheel);
    }
    const load = new THREE.Group();
    load.name = `${name} load`;
    load.position.y = r + len * 0.2;
    g.add(load);
    g.userData.wheels = wheels;
    g.userData.load = load;
    g.userData.top = r + len * 0.2;
    return g;
  };
  look.boat = (name, { len = 0.06, sail = true } = {}) => {
    const g = new THREE.Group();
    g.name = name;
    const hull = look.paint(kit.extrude([[-len / 2, len * 0.22], [len / 2, len * 0.25], [len * 0.36, 0], [-len * 0.38, 0]], len * 0.32, { bevel: 0.002 }), 'wood', `${name} hull`, 0.008);
    g.add(hull);
    if (sail) {
      const mast = look.paint(kit.roundedBox(0.004, len * 0.9, 0.004, 0.001), 'bark', `${name} mast`, 0.008);
      mast.position.set(0, len * 0.65, 0);
      const cloth = look.paint(kit.extrude([[0.003, len * 0.32], [0.003, len * 1.05], [len * 0.42, len * 0.32]], 0.003), 'sail', `${name} sail`, 0.01);
      g.add(mast, cloth);
    }
    kit.merge(g);
    return g;
  };
  // A flour sack (h tall). open: an open sack whose flour rises with sack.userData.fill(k).
  look.sack = (name, { h = 0.035, open = false, colour = 'linen' } = {}) => {
    const g = new THREE.Group();
    g.name = name;
    const s = h / 0.84;
    const shut = [[0, 0], [0.25, 0], [0.33, 0.1], [0.35, 0.32], [0.3, 0.54], [0.17, 0.68], [0.11, 0.73], [0.19, 0.84], [0, 0.82]];
    const wide = [[0, 0], [0.25, 0], [0.33, 0.1], [0.35, 0.32], [0.34, 0.56], [0.37, 0.62]];
    const bag = new THREE.Mesh(lookLumpy(THREE, kit.lathe((open ? wide : shut).map(([r, y]) => [r * s, y * s]), 14), h * 0.02, h * 0.5, seed++), open ? look.own(colour, 0.008) : look.mat(colour, 0.008));
    bag.name = `${name} cloth`;
    if (open) bag.material.side = THREE.DoubleSide;
    g.add(bag);
    if (open) {
      const flour = look.blob(0.33 * s, 'flour', `${name} flour`, { squash: 0.4 });
      g.add(flour);
      g.userData.fill = (k) => {
        const f = Math.max(0, Math.min(1, k));
        flour.visible = f > 0.02;
        flour.position.y = s * (0.05 + 0.55 * f);
      };
      g.userData.fill(1);
    }
    return g;
  };
  // A heap that grows with pile.userData.fill(k): flour under a spout, grain on a floor, fleece in a basket.
  look.pile = (name, { r = 0.03, colour = 'flour' } = {}) => {
    const geo = kit.lathe([[0, 0], [r, 0], [r * 0.8, r * 0.22], [r * 0.45, r * 0.5], [0, r * 0.62]], 16);
    const mesh = look.paint(lookLumpy(THREE, geo, r * 0.06, r * 0.5, seed++), colour, name, Math.max(0.006, r * 0.3));
    mesh.userData.fill = (k) => {
      const f = Math.max(0, Math.min(1, k));
      mesh.visible = f > 0.02;
      mesh.scale.set(0.35 + 0.65 * f, Math.max(0.02, f), 0.35 + 0.65 * f);
    };
    return mesh;
  };
  look.loaf = (name, { len = 0.03 } = {}) => {
    const g = new THREE.Group();
    g.name = name;
    const geo = new THREE.SphereGeometry(0.5, 18, 10);
    geo.scale(len, len * 0.55, len * 0.62);
    const crust = look.paint(lookLumpy(THREE, geo, len * 0.03, len * 0.4, seed++), 'crust', `${name} crust`, 0.007);
    crust.position.y = len * 0.2;
    g.add(crust);
    for (const x of [-0.25, 0, 0.25]) {
      const cut = look.paint(kit.roundedBox(len * 0.07, len * 0.04, len * 0.4, 0.0012), 'flour', `${name} cut`, 0.006);
      cut.position.set(x * len, len * 0.2 + len * 0.27 * Math.sqrt(1 - (x / 0.5) ** 2), 0);
      cut.rotation.y = 0.5;
      g.add(cut);
    }
    kit.merge(g);
    return g;
  };
  // People are big simple shapes: a coat as a cone, a round head, maybe a hat. Feet at y = 0, faces +z.
  look.figure = (name, { h = 0.06, colour = 'cloth', hat = false } = {}) => {
    const g = new THREE.Group();
    g.name = name;
    const coat = look.paint(kit.lathe([[0, 0], [h * 0.2, 0], [h * 0.17, h * 0.3], [h * 0.12, h * 0.6], [h * 0.07, h * 0.68], [0, h * 0.7]], 12), colour, `${name} coat`, 0.008);
    const head = look.blob(h * 0.12, 'skin', `${name} head`);
    head.position.y = h * 0.8;
    g.add(coat, head);
    if (hat) {
      const brim = look.paint(new THREE.CylinderGeometry(h * 0.2, h * 0.2, 0.004, 14), 'wheat', `${name} hat`, 0.008);
      brim.position.y = h * 0.88;
      const crown = look.paint(new THREE.CylinderGeometry(h * 0.09, h * 0.11, h * 0.08, 12), 'wheat', `${name} hat`, 0.008);
      crown.position.y = h * 0.92;
      g.add(brim, crown);
    }
    kit.merge(g);
    return g;
  };
  // Animals: a body, a head, four legs (merged). Faces +x. len is nose to tail.
  look.animal = (name, { kind = 'sheep', len = 0.045, colour } = {}) => {
    const g = new THREE.Group();
    g.name = name;
    const K = {
      sheep: { body: 'wool', head: 'dark', leg: 0.22, h: 0.55, neck: 0.1 },
      cow: { body: 'wall', head: 'wall', leg: 0.32, h: 0.5, neck: 0.12 },
      horse: { body: 'bark', head: 'bark', leg: 0.45, h: 0.38, neck: 0.35 },
    }[kind] ?? { body: 'wool', head: 'dark', leg: 0.22, h: 0.55, neck: 0.1 };
    const legH = len * K.leg;
    const bodyGeo = new THREE.SphereGeometry(0.5, 16, 10);
    bodyGeo.scale(len * 0.8, len * K.h, len * 0.45);
    const body = look.paint(lookLumpy(THREE, bodyGeo, len * (kind === 'sheep' ? 0.04 : 0.015), len * 0.3, seed++), colour ?? K.body, `${name} body`, Math.max(0.006, len * 0.2));
    body.position.y = legH + len * K.h * 0.4;
    const head = look.blob(len * 0.14, K.head, `${name} head`, { squash: 0.85 });
    head.position.set(len * 0.45, legH + len * K.h * 0.55 + len * K.neck, 0);
    head.scale.set(1.3, 1, 0.9);
    g.add(body, head);
    for (const [x, z] of [[-0.25, -0.12], [-0.25, 0.12], [0.25, -0.12], [0.25, 0.12]]) {
      const leg = look.paint(new THREE.CylinderGeometry(len * 0.05, len * 0.055, legH + len * 0.1, 6), K.head, `${name} leg`, 0.006);
      leg.position.set(x * len, (legH + len * 0.1) / 2, z * len);
      g.add(leg);
    }
    kit.merge(g);
    return g;
  };
  // Smoke or steam: n soft puffs. Call smoke.userData.rise(time, lean) every frame (lean = how far the wind takes it).
  look.smoke = (name, { n = 4, h = 0.06 } = {}) => {
    const g = new THREE.Group();
    g.name = name;
    const puffs = [];
    for (let i = 0; i < n; i++) {
      const p = look.blob(h * 0.12, 'wool', `${name} puff`, { squash: 0.8 });
      g.add(p);
      puffs.push(p);
    }
    g.userData.rise = (time, lean = 0.3) => {
      for (let i = 0; i < n; i++) {
        const k = (time * 0.18 + i / n) % 1;
        puffs[i].position.set(lean * h * k * k, h * k, 0.1 * h * Math.sin(time + i * 2));
        puffs[i].scale.setScalar((0.4 + 1.1 * k) * (1 - k * k * k * k));
      }
    };
    g.userData.rise(0);
    return g;
  };
  // One short caption per step on a painted signboard: caption.userData.show(i). Lines are plain ASCII, 2 to 6 words.
  look.caption = (lines, name, { width = 0.12 } = {}) => {
    const g = new THREE.Group();
    g.name = name;
    const frame = new THREE.Group();
    const board = look.paint(kit.roundedBox(width, 0.034, 0.006, 0.002), 'wood', `${name} board`, 0.01);
    board.position.y = 0.05;
    frame.add(board);
    for (const side of [-1, 1]) {
      const post = look.paint(kit.roundedBox(0.005, 0.05, 0.005, 0.0015), 'bark', `${name} post`, 0.008);
      post.position.set(side * width * 0.38, 0.025, -0.002);
      frame.add(post);
    }
    kit.merge(frame);
    g.add(frame);
    const cards = lines.map((line) => {
      const c = kit.card(line, { width: width * 0.94 });
      c.position.set(0, 0.05, 0.0045);
      c.visible = false;
      g.add(c);
      return c;
    });
    g.userData.show = (i) => { for (let k = 0; k < cards.length; k++) cards[k].visible = k === i; };
    g.userData.show(0);
    return g;
  };
  // The painted ground on its canvas: a band of bare linen shows round a ragged painted edge. Its top is
  // set.userData.top. round: true makes it an oval.
  look.set = ({ width = 0.42, depth = 0.3, round = false } = {}) => {
    const set = new THREE.Group();
    set.name = 'Painted ground';
    const linen = kit.material('fabric', { color: '#e8dcc0' });
    const canvas = round
      ? new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.014, 48), linen)
      : new THREE.Mesh(kit.roundedBox(width + 0.018, 0.014, depth + 0.018, 0.004), linen);
    if (round) canvas.scale.set(width + 0.018, 1, depth + 0.018);
    canvas.position.y = 0.007;
    canvas.name = 'Canvas';
    const outline = [];
    const N = 72;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const cx = Math.cos(a), cz = Math.sin(a);
      // rounded square: push the circle toward the corners
      const k = round ? 1 : 1 / Math.max(Math.abs(cx), Math.abs(cz)) ** 0.85;
      const ragged = 1 - 0.035 * (0.5 + 0.5 * lookNoise(cx * 3 + 1.3, cz * 3, 0.4)) - 0.012 * lookHash3(i, 3, 1);
      outline.push([Math.max(-1, Math.min(1, cx * k)) * (width / 2) * ragged, -Math.max(-1, Math.min(1, cz * k)) * (depth / 2) * ragged]);
    }
    const ground = look.paint(kit.extrude(outline, 0.004), 'meadow', 'Meadow', 0.024);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.016;
    set.add(canvas, ground);
    set.userData.top = 0.018;
    set.userData.width = width;
    set.userData.depth = depth;
    return set;
  };
  look.demo = (subject) => {
    const field = look.field(0.12, 0.08, 'Wheat field', { n: 120 });
    field.position.set(-0.11, 0, -0.05);
    const house = look.house('Cottage');
    house.position.set(0.09, 0, -0.06);
    const tree = look.tree('Oak', { h: 0.08 });
    tree.position.set(0.17, 0, 0.03);
    const track = look.path([[-0.18, 0.08], [-0.02, 0.04], [0.07, -0.02]], 'Track');
    const sheep = look.animal('Sheep', { kind: 'sheep', len: 0.05 });
    sheep.position.set(-0.04, 0, 0.09);
    subject.add(field, house, tree, track, sheep);
    return [{ object: sheep, grab: true }, { object: house, press: true }];
  };
  return look;
}
