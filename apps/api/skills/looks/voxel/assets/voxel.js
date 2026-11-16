// Voxel look for an XR lesson: everything built from small chamfered cubes, like a hand-made voxel model on a smooth
// off-white plinth, with the step's word spelled in cubes on the plinth's front. Needs look-kit.js (lookVoxels,
// lookVoxelWord, lookHash3, lookNoise, lookPath, lookSeg, lookBounce). new-lesson.mjs pastes it in.
//
// voxelLook(THREE, kit) returns:
//   PAL                                   the palette: { name: '#hex' }; cells name a colour from it (or a '#hex')
//   size                                  metres per cube (0.012): pick it so the model is 0.25-0.35 m across
// Cells - plain arrays [x, y, z, colour, ...extra] on a whole-number grid (x right, y up, z toward the learner).
// `colour` can be a function (x, y, z) -> name, for bands, checks and speckle:
//   cells(fn)                             fn(put): put(x, y, z, colour, ...extra) sets a cell, a later put replaces it,
//                                         put(x, y, z, null) carves it out. Returns the cells
//   box(x0, y0, z0, x1, y1, z1, colour)   a filled box, corners inclusive
//   ball(cx, cy, cz, r, colour)           a ball; r = [rx, ry, rz] for an egg, a cloud lobe, a leaf (colour fn gets offsets)
//   disc(cx, cy, cz, r, colour, axis)     a round plate one cube thick: axis 'y' lies flat, 'z' stands facing the learner
//   column(x, z, y0, h, colour)           h cubes up from y0          line([x, y, z], [x, y, z], colour)  a straight run
//   picture(rows, legend)                 text rows, top row first, as cubes in the XY plane; an array of row lists is
//                                         slices, back to front. legend { char: colour }; other chars are empty
//   ground(hx, hz, depth)                 earth from x -hx..hx, z -hz..hz: grass on top (y = depth - 1), soil in bands
// Meshes - one draw call each; one mesh per thing that moves or that the hand picks:
//   model(cells, name, { size, shade, sealed })   the cells as one mesh; sealed: it sits on something, so cubes
//                                         buried under it are dropped. .userData.cells [{ x, y, z, index, src }]
//   label(text, colour, name, { size })   a short word or number in cubes, standing, centred on x = 0, bottom y = 0
//   word(text, set, { colour, x })        the step's word on the plinth's front face (dark on the off-white plinth)
//   counter(digits, colour, name, { size })   a number in cubes: counter.userData.set(n) shows n (no allocation)
//   arrow(len, colour, name, { size })    an arrow of cubes, len cubes long, from x = 0 along +x in the XY plane
//   flow(points, colour, name, { count, size, speed })   cubes hopping cell to cell along a path (metres): water up
//                                         a stem, cars on a road. Call flow.userData.update(time). Never grabbable
// Motion - the cubes do the animating, nothing slides or fades:
//   stages(mesh, stageOf, { order, gap, drop, dur })      build a model up in stages (see below)
//   glow(mesh, k)                         light a model up, 0..1: feedback for a lifted or pressed part
//   set({ width, depth })                 the plinth: a Group, never grabbable; .userData.top, .userData.front
//   demo(subject)                         a working sample (replace it)
function voxelLook(THREE, kit) {
  const PAL = {
    // ground and earth
    grass: '#86b84f', grassB: '#74a945', tuft: '#a5cf5c', soilA: '#8a5a38', soilB: '#74482c', soilC: '#5f3a25',
    stone: '#a9a297', stoneB: '#8f887f', sand: '#e2c27e', sandDark: '#c9a05c', sandLight: '#efdcab', snow: '#f4f7fa',
    water: '#3fa0ee', waterDeep: '#2a78c4', ice: '#bfe6f5',
    // plants
    seed: '#f6dc98', root: '#f3ead8', stem: '#5c9a3a', sprout: '#9bd45a', leaf: '#3f8f3d', leafLight: '#72b947',
    leafDark: '#2f7a37', petal: '#ffd94a', petalDeep: '#f2b22f', flower: '#fff0a8',
    // things people make
    wood: '#d3a468', woodB: '#c08f55', woodDark: '#9c6f42', brick: '#c45a3c', roof: '#8e3b2e', metal: '#b9c0c4',
    glass: '#9fd3ea', paper: '#f3ead8',
    // colours for parts and meaning
    red: '#e5352b', orange: '#f2952f', yellow: '#ffd94a', pink: '#f39ab0', purple: '#8a5bb8', blue: '#3f6fd8',
    skin: '#e8b48f', hair: '#4a3020', white: '#f7f4ee', black: '#2b2b2e',
    // weather
    cloud: '#ffffff', cloudBase: '#dfe9f3', storm: '#8fa3bd', sun: '#ffc531', sunCore: '#ffe487', ray: '#ffad2b',
    // words and numbers on the off-white plinth: always dark
    letter: '#2f7a37', ink: '#24315e',
  };
  const plinthMat = kit.material('plastic', { color: '#f6f1e7', roughness: 0.45, wear: 0 });
  const colourOf = (c, x, y, z) => {
    const v = typeof c === 'function' ? c(x, y, z) : c;
    if (typeof v === 'string' && !v.startsWith('#') && !PAL[v]) throw new Error(`voxelLook: no colour "${v}". Use a '#hex' or one of: ${Object.keys(PAL).join(', ')}`);
    return v;
  };
  const look = { name: 'voxel', PAL, size: 0.012 };

  // ---------------------------------------------------------------- cells
  look.cells = (fn) => {
    const map = new Map();
    fn((x, y, z, c, ...extra) => {
      const key = `${x},${y},${z}`;
      if (c == null) map.delete(key);
      else map.set(key, [x, y, z, colourOf(c, x, y, z), ...extra]);
    });
    return [...map.values()];
  };
  look.box = (x0, y0, z0, x1, y1, z1, colour) => {
    const cells = [];
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) cells.push([x, y, z, colourOf(colour, x, y, z)]);
    }
    return cells;
  };
  look.ball = (cx, cy, cz, r, colour) => {
    const [rx, ry, rz] = Array.isArray(r) ? r : [r, r, r];
    const cells = [];
    for (let x = -Math.ceil(rx); x <= Math.ceil(rx); x++) for (let y = -Math.ceil(ry); y <= Math.ceil(ry); y++) {
      for (let z = -Math.ceil(rz); z <= Math.ceil(rz); z++) {
        if ((x / rx) ** 2 + (y / ry) ** 2 + (z / rz) ** 2 <= 1) cells.push([cx + x, cy + y, cz + z, colourOf(colour, x, y, z)]);
      }
    }
    return cells;
  };
  look.disc = (cx, cy, cz, r, colour, axis = 'y') => {
    const cells = [];
    const R = Math.ceil(r);
    for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) {
      if (a * a + b * b > r * r) continue;
      const [x, y, z] = axis === 'y' ? [cx + a, cy, cz + b] : axis === 'z' ? [cx + a, cy + b, cz] : [cx, cy + a, cz + b];
      cells.push([x, y, z, colourOf(colour, a, b, Math.hypot(a, b))]);
    }
    return cells;
  };
  look.column = (x, z, y0, h, colour) => look.box(x, y0, z, x, y0 + h - 1, z, colour);
  look.line = (a, b, colour) => {
    const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2]), 1);
    return look.cells((put) => {
      for (let i = 0; i <= n; i++) {
        const x = Math.round(a[0] + ((b[0] - a[0]) * i) / n), y = Math.round(a[1] + ((b[1] - a[1]) * i) / n), z = Math.round(a[2] + ((b[2] - a[2]) * i) / n);
        put(x, y, z, colour);
      }
    });
  };
  look.picture = (rows, legend) => {
    const slices = Array.isArray(rows[0]) ? rows : [rows];
    const cells = [];
    slices.forEach((slice, z) => slice.forEach((row, r) => [...row].forEach((ch, x) => {
      if (legend[ch]) cells.push([x, slice.length - 1 - r, z, colourOf(legend[ch], x, slice.length - 1 - r, z)]);
    })));
    return cells;
  };
  look.ground = (hx, hz, depth = 3) => look.box(-hx, 0, -hz, hx, depth - 1, hz, (x, y, z) => {
    const h = lookHash3(x, y, z);
    const edge = Math.abs(x) === hx || Math.abs(z) === hz;
    if (y === depth - 1) return lookNoise(x * 0.3, 1.7, z * 0.3) > 0.1 ? 'grassB' : 'grass';
    if (y === depth - 2 && edge && h < 0.3) return 'grass';              // grass hanging over the edge
    if (h > 0.96) return h > 0.985 ? 'stone' : 'stoneB';
    const band = depth - 1 - y + (lookNoise(x * 0.2, 3.1, z * 0.2) > 0.15 ? 1 : 0);
    return band <= 2 ? 'soilA' : band <= 4 ? 'soilB' : 'soilC';
  });

  // ---------------------------------------------------------------- meshes
  look.model = (cells, name, o = {}) => {
    const opt = typeof o === 'number' ? { size: o } : o;
    const size = opt.size ?? look.size;
    let list = cells;
    if (opt.sealed) {
      // it stands on something: a bottom cube with neighbours on four sides and above can never be seen
      const has = new Set(cells.map((c) => `${c[0]},${c[1]},${c[2]}`));
      const f = (x, y, z) => has.has(`${x},${y},${z}`);
      const minY = Math.min(...cells.map((c) => c[1]));
      list = cells.filter(([x, y, z]) => !(y === minY && f(x + 1, y, z) && f(x - 1, y, z) && f(x, y, z + 1) && f(x, y, z - 1) && f(x, y + 1, z)));
    }
    const material = kit.material('plastic', { color: '#ffffff', roughness: 0.78, wear: 0 });
    material.emissive.set('#fff3dc');
    material.emissiveIntensity = 0;
    const mesh = lookVoxels(THREE, kit, list, { size, palette: PAL, shade: opt.shade ?? 0.07, material });
    mesh.name = name;
    mesh.userData.size = size;
    const byKey = new Map(list.map((c) => [`${c[0]},${c[1]},${c[2]}`, c]));
    for (const c of mesh.userData.cells) c.src = byKey.get(`${c.x},${c.y},${c.z}`);
    // measured with every cube at home, so the hands and the host see the whole model even while it builds
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    return mesh;
  };
  look.label = (text, colour, name, { size = 0.006 } = {}) => {
    const w = String(text).length * 4 - 1;
    const cells = lookVoxelWord(text, colour).map(([x, y, z, c]) => [x - (w - 1) / 2, y, z, c]);
    const mesh = look.model(cells, name, { size, shade: 0.03 });
    mesh.userData.width = w * size;
    return mesh;
  };
  look.word = (text, set, { colour = 'letter', x = 0 } = {}) => {
    const size = 0.005;
    const mesh = look.label(text, colour, `Word ${text}`, { size });
    mesh.position.set(x, 0.0025, set.userData.front + size / 2);
    return mesh;
  };
  look.counter = (digits, colour, name, { size = 0.006 } = {}) => {
    const w = digits * 4 - 1;
    const cells = [];
    for (let i = 0; i < digits; i++) for (let k = 0; k < 3; k++) for (let y = 0; y < 5; y++) cells.push([i * 4 + k - (w - 1) / 2, y, 0, colour, i, `${k},${y}`]);
    const mesh = look.model(cells, name, { size, shade: 0.03 });
    const n = mesh.userData.cells.length;
    const slot = new Uint8Array(n);
    const on = [];                                    // on[d][i]: cube i is lit when its slot shows digit d
    for (let d = 0; d < 10; d++) {
      const lit = new Set(lookVoxelWord(String(d), colour).map(([x, y]) => `${x},${y}`));
      on.push(Uint8Array.from(mesh.userData.cells, (c) => (lit.has(c.src[5]) ? 1 : 0)));
    }
    mesh.userData.cells.forEach((c, i) => { slot[i] = c.src[4]; });
    const m = new THREE.Matrix4();
    let shown = -1;
    mesh.userData.width = w * size;
    mesh.userData.set = (value) => {
      const v = Math.max(0, Math.min(10 ** digits - 1, Math.round(value)));
      if (v === shown) return;
      shown = v;
      for (let i = 0; i < n; i++) {
        const c = mesh.userData.cells[i];
        const place = 10 ** (digits - 1 - slot[i]);
        const d = Math.floor(v / place) % 10;
        const blank = v < place && slot[i] < digits - 1;   // no leading zeros
        if (!blank && on[d][i]) m.makeTranslation(c.x * size, c.y * size + size / 2, c.z * size);
        else m.makeScale(0, 0, 0);
        mesh.setMatrixAt(c.index, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    };
    mesh.userData.set(0);
    return mesh;
  };
  look.arrow = (len, colour, name, { size = look.size } = {}) => {
    const L = Math.max(4, Math.round(len));
    const cells = look.cells((put) => {
      for (let x = 0; x <= L - 3; x++) put(x, 0, 0, colour);
      for (let y = -2; y <= 2; y++) put(L - 3, y, 0, colour);
      for (let y = -1; y <= 1; y++) put(L - 2, y, 0, colour);
      put(L - 1, 0, 0, colour);
    });
    return look.model(cells, name, { size });
  };
  look.flow = (points, colour, name, { count = 8, size = look.size, speed = 0.04 } = {}) => {
    const path = lookPath(THREE, points);
    const cells = [];
    for (let i = 0; i < count; i++) cells.push([i * 2, 0, 0, colour]);
    const mesh = look.model(cells, name, { size });
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    mesh.userData.update = (time) => {
      for (let i = 0; i < count; i++) {
        const u = (((time * speed) / path.length + i / count) % 1 + 1) % 1;
        path.at(u, p);
        // snapped to the grid: the cube hops from cell to cell instead of gliding
        m.makeTranslation(Math.round(p.x / size) * size, Math.round(p.y / size) * size, Math.round(p.z / size) * size);
        mesh.setMatrixAt(mesh.userData.cells[i].index, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    };
    mesh.userData.update(0);
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    mesh.frustumCulled = false;
    return mesh;
  };

  // ---------------------------------------------------------------- motion
  // look.stages(mesh, stageOf, o) -> b. Each cube gets a stage, stageOf(cell) -> a whole number (cell = { x, y, z,
  // src }, src is the cell array you built, extra fields included), and an arrival time in its stage from o.order:
  // 'layer' (bottom up), 'column' (left to right), 'top' (top down), 'wave' (out from the front middle) or
  // (cell) => seconds. b.go(n) puts stages below n at home and drops stage n in cube by cube, each falling o.drop
  // metres (default 3 cubes) and bouncing once (o.dur 0.3 s; o.gap 0.06 s between rows); stages above n are hidden,
  // and a mesh with nothing to show is hidden so no hand can catch it. b.go(n, true) shows stage n at once;
  // b.go(n, false, wait) starts after `wait` seconds. Call b.update(delta) every frame. b.arrived = cubes that have
  // landed (count those for a true number); b.count(n) = cubes in stages up to n; b.moving while cubes are falling.
  look.stages = (mesh, stageOf = () => 0, o = {}) => {
    const s = mesh.userData.size;
    const cells = mesh.userData.cells;
    const n = cells.length;
    const gap = o.gap ?? 0.06, drop = o.drop ?? 3 * s, dur = o.dur ?? 0.3;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const c of cells) { x0 = Math.min(x0, c.x); x1 = Math.max(x1, c.x); y0 = Math.min(y0, c.y); y1 = Math.max(y1, c.y); z1 = Math.max(z1, c.z); }
    const j = (c) => lookHash3(c.x * 1.3, c.y * 2.1, c.z * 0.7);
    const ORDERS = {
      layer: (c) => (c.y - y0) * gap + j(c) * gap * 0.8,
      column: (c) => (c.x - x0) * gap + (c.y - y0) * gap * 0.25 + j(c) * gap * 0.5,
      top: (c) => (y1 - c.y) * gap + j(c) * gap * 0.8,
      wave: (c) => Math.hypot(c.x - (x0 + x1) / 2, c.z - z1) * gap + (c.y - y0) * gap * 0.3 + j(c) * gap * 0.5,
    };
    const orderOf = typeof o.order === 'function' ? o.order : ORDERS[o.order ?? 'layer'];
    if (!orderOf) throw new Error(`look.stages: order is ${Object.keys(ORDERS).join(', ')} or a function`);
    const stage = new Int32Array(n), at = new Float32Array(n);
    const first = new Map(), last = new Map();
    cells.forEach((c, i) => {
      stage[i] = Math.round(stageOf(c) ?? 0);
      at[i] = orderOf(c);
      first.set(stage[i], Math.min(first.get(stage[i]) ?? Infinity, at[i]));
    });
    cells.forEach((c, i) => {
      at[i] -= first.get(stage[i]);                   // every stage starts at 0
      last.set(stage[i], Math.max(last.get(stage[i]) ?? 0, at[i]));
    });
    const levels = [...first.keys()].sort((a, b) => a - b);
    const upTo = levels.map((k) => stage.filter((v) => v <= k).length);
    const m = new THREE.Matrix4();
    let t = 0;
    const b = {
      stage: levels[levels.length - 1],
      arrived: n,
      moving: false,
      count(k) {
        let c = 0;
        for (let i = 0; i < levels.length; i++) if (levels[i] <= k) c = upTo[i];
        return c;
      },
      go(k, now = false, wait = 0) {
        b.stage = k;
        t = now ? 1e9 : -wait;
        b.moving = !now;
        mesh.visible = k >= levels[0];
        pose();
      },
      update(delta) {
        if (!b.moving) return;
        t += delta;
        pose();
        if (t > (last.get(b.stage) ?? 0) + dur) b.moving = false;
      },
    };
    function pose() {
      let arrived = 0;
      for (let i = 0; i < n; i++) {
        const c = cells[i];
        const k = stage[i] < b.stage ? 1 : stage[i] > b.stage ? 0 : lookSeg(t, at[i], at[i] + dur);
        if (k <= 0) m.makeScale(0, 0, 0);
        else {
          const grow = Math.min(1, k * 4);
          m.makeScale(grow, grow, grow).setPosition(c.x * s, c.y * s + s / 2 + drop * (1 - lookBounce(k)), c.z * s);
        }
        if (k >= 0.72) arrived++;                     // lookBounce lands at 0.72, then bounces once
        mesh.setMatrixAt(c.index, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
      b.arrived = arrived;
    }
    return b;
  };
  look.glow = (mesh, k) => { mesh.material.emissiveIntensity = 0.45 * k; };

  // ---------------------------------------------------------------- the plinth
  // A smooth off-white display base, about as wide as the model. The model's own ground is cubes on top of it.
  look.set = ({ width = 0.3, depth = 0.2 } = {}) => {
    const set = new THREE.Group();
    set.name = 'Plinth';
    const slab = new THREE.Mesh(kit.roundedBox(width, 0.03, depth, 0.006), plinthMat);
    slab.name = 'Plinth slab';
    slab.position.y = 0.015;
    set.add(slab);
    set.userData.top = 0.03;
    set.userData.front = depth / 2;
    set.userData.width = width;
    set.userData.depth = depth;
    return set;
  };
  look.demo = (subject) => {
    const s = look.size;
    const ground = look.model(look.ground(6, 4, 2), 'Ground', { sealed: true });
    const trunk = look.model(look.box(-1, 2, -1, 1, 8, 1, (x, y) => (y % 3 ? 'wood' : 'woodDark')), 'Trunk');
    const crown = look.model(look.ball(0, 13, 0, 5.2, (x, y) => (y > 1 ? 'leafLight' : 'leaf')), 'Crown');
    const apple = look.model(look.ball(0, 0, 0, 1.6, 'red'), 'Apple');
    apple.position.set(4 * s, 10 * s, 6 * s);
    subject.add(ground, trunk, crown, apple);
    return [{ object: apple, grab: true }, { object: crown, press: true }];
  };
  return look;
}
