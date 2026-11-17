// Low-poly look for an XR lesson: a miniature faceted landscape on the desk (an island tile with mountains, rivers,
// fields, little buildings, vehicles and paper flags at the stages), where every triangle is one flat tone and
// neighbours differ a little, like cut paper or cut stone. Needs look-kit.js (lookFacets, lookFacetMaterial, lookHash3,
// lookNoise, lookPath, lookBack, lookSeg). new-lesson.mjs pastes it in.
//
// lowPolyLook(THREE, kit) returns (metres; things stand on y = 0 and face +z unless noted; colour = a PAL name):
//   PAL                                  the palette { name: '#hex' }; nothing in the scene uses another colour
//   facet(geometry, colour, name, { jitter, water, ground })   any geometry as flat facets of one palette colour
//   set({ width, depth, sea })           the island tile; sea 'none' | 'left' | 'right' | 'back'; never grabbable.
//                                        .userData: top, groundAt(x, z) (0 to -2 mm on land), isLand(x, z), seaLevel
//   terrain(outline, name, { height, paint, step })   ground over [[x, z], ...]: height(x, z) -> y,
//                                        paint(x, y, z, up) -> colour name per facet (up = how much it faces up)
//   water(outline, name, { colour, amp })   a patch of faceted water that heaves (look.update moves it)
//   mountain(r, h, name, { snow })   hill(r, h, colour, name)   rock(r, name)
//   river(points, name, { width })   road(points, name, { width, colour })   pipe(points, r, name, { colour })
//   arrow(points, name, { width, colour })    a flat paper arrow lying along the ground, head at the last point
//                                        (these four take [[x, y, z], ...]; .userData.path = lookPath of the centre line)
//   tree(name, { h, kind })   kind 'pine' | 'round' | 'autumn'      forest(spots [[x, z, scale]], name, { h, kind })
//   field(w, d, name, { crop, rows })    a ploughed patch with rows of a crop colour, along x
//   house(name, { w, d, h, wall, roof })   factory(name, { w, d, h }): .userData.chimney [x, y, z]
//   tank(r, h, name, { legs, colour })   an open tank (reservoir, water tower with legs): .userData.setLevel(0..1)
//   crate(s, name, { colour, fill })     a box of goods; fill colour shows what is in it (a separate child, .userData.fill)
//   pile(n, name, { shape, colour, size })   up to n items in one draw call ('crate' | 'sack' | 'gem' | 'log'):
//                                        .userData.show(k) shows the first k (amounts as piles)
//   vehicle(kind, name)                  'truck' | 'boat', faces +x; .userData.bed = top of its load bed
//   person(colour, name, { h })   cloud(name, { r, storm })   sun(r, name)   droplet(r, name)
//   drops(n, r, name, { colour })        n droplets in one draw call: .userData.place(i, x, y, z, scale) (0 hides)
//   number(text, colour, name, { h })    cut-paper digits 0-9 + - x = / . standing in XY, left at x = 0; .userData.width
//   flag(n, name, { colour, h })         a stage's paper flag with its number, a press target;
//                                        .userData.active(0..1) lifts and lights it (the current stage)
//   follow(object, path, u, dir)         put object at u (0..1) of the path facing along it (+x forward; dir -1 when
//                                        travelling back); no allocation, call it in update()
//   unfold(mesh, { from })               its facets open one by one from a point: returns { set(k) }, k 0 folded .. 1 open
//   pop(object, k)                       pops out of the ground with a bounce, k 0..1
//   merge(group)                         a group's static faceted meshes into one mesh per material (fewer draw calls)
//   update(time)                         heaves the water; call it every frame
//   demo(subject)                        a working sample (replace it)
function lowPolyLook(THREE, kit) {
  const PAL = {
    seaDeep: '#1f6a80', sea: '#2e8f9c', seaShallow: '#63bfb4', foam: '#e6f5ea', river: '#59b9cc',
    sand: '#ecd3a0', bed: '#c9b99a', grass: '#a5bf66', meadow: '#86ad5c', forest: '#5d9160', pine: '#3f7d62',
    leaf: '#74a857', ochre: '#e0a646', rock: '#a3929b', rockDark: '#857a8c', snow: '#fffbf4', trunk: '#7d5e4e',
    cloud: '#fff8ef', cloudSide: '#f4e7de', cloudBase: '#c8c4dc', paper: '#fff6e4', ink: '#22303c',
    accent: '#e9684a', sun: '#ffcf99',
  };
  const hex = (colour) => {
    if (!PAL[colour]) throw new Error(`lowPolyLook: no colour "${colour}". Palette: ${Object.keys(PAL).join(', ')}`);
    return PAL[colour];
  };
  const matte = lookFacetMaterial(THREE);
  const glossy = lookFacetMaterial(THREE, 0.35);
  const sunMat = matte.clone();
  sunMat.emissive = new THREE.Color(PAL.sun);
  sunMat.emissiveIntensity = 0.55;
  let seed = 1;
  const look = { name: 'low-poly', PAL };

  // ------------------------------------------------------------ facets
  const tone = new THREE.Color();
  const hsl = { h: 0, s: 0, l: 0 };
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  // Colour each triangle by paint(cx, cy, cz, up) -> palette name, nudged a little so neighbours differ.
  function painted(geometry, paint, s) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    g.computeVertexNormals();
    const p = g.attributes.position, n = g.attributes.normal;
    const colors = new Float32Array(p.count * 3);
    for (let t = 0; t < p.count; t += 3) {
      const cx = (p.getX(t) + p.getX(t + 1) + p.getX(t + 2)) / 3, cy = (p.getY(t) + p.getY(t + 1) + p.getY(t + 2)) / 3;
      const cz = (p.getZ(t) + p.getZ(t + 1) + p.getZ(t + 2)) / 3, up = n.getY(t);
      tone.set(hex(paint(cx, cy, cz, up)));
      tone.getHSL(hsl);
      const a = lookHash3(cx * 999, cy * 999, cz * 999 + s), b = lookHash3(cy * 999, cz * 999, cx * 999 + s), e = lookHash3(cz * 999, cx * 999, cy * 999 + s);
      tone.setHSL(hsl.h + (a - 0.5) * 0.025, clamp01(hsl.s + (b - 0.5) * 0.08), clamp01(hsl.l + (e - 0.5) * 0.09));
      for (let k = 0; k < 3; k++) colors.set([tone.r, tone.g, tone.b], (t + k) * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  }
  look.facet = (geometry, colour, name, { jitter = 0.002, water = false, ground = false } = {}) => {
    const mesh = new THREE.Mesh(lookFacets(THREE, geometry, hex(colour), { jitter, seed: seed++, keepBase: ground, baseY: 0 }), water ? glossy : matte);
    mesh.name = name;
    return mesh;
  };
  // Several colours on one piece: paint(x, y, z, up) picks the colour of each facet.
  const multi = (geometry, paint, name, { jitter = 0, ground = true, material = matte } = {}) => {
    const s = seed++;
    const mesh = new THREE.Mesh(painted(lookFacets(THREE, geometry, '#ffffff', { jitter, seed: s, keepBase: ground, baseY: 0 }), paint, s), material);
    mesh.name = name;
    return mesh;
  };

  // ------------------------------------------------------------ merging (keeps the facet colours; kit.merge does not)
  const _v = new THREE.Vector3(), _n3 = new THREE.Matrix3();
  function bake(geometry, matrix, out) {
    _n3.getNormalMatrix(matrix);
    const p = geometry.attributes.position, n = geometry.attributes.normal, c = geometry.attributes.color;
    const order = matrix.determinant() < 0 ? [0, 2, 1] : [0, 1, 2];
    for (let t = 0; t + 2 < p.count; t += 3) {
      for (const k of order) {
        const i = t + k;
        _v.fromBufferAttribute(p, i).applyMatrix4(matrix); out.pos.push(_v.x, _v.y, _v.z);
        _v.fromBufferAttribute(n, i).applyMatrix3(_n3).normalize(); out.nor.push(_v.x, _v.y, _v.z);
        out.col.push(c.getX(i), c.getY(i), c.getZ(i));
      }
    }
  }
  function meshOf(out, material, name) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(out.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(out.col, 3));
    const mesh = new THREE.Mesh(g, material);
    mesh.name = name;
    return mesh;
  }
  // Faceted parts (each placed with its own position/rotation/scale, no parent) -> one mesh.
  function fuse(name, parts, material = matte) {
    const out = { pos: [], nor: [], col: [] };
    for (const part of parts) { part.updateMatrix(); bake(part.geometry, part.matrix, out); }
    return meshOf(out, material, name);
  }
  look.merge = (group) => {
    group.updateMatrixWorld(true);
    const inverse = new THREE.Matrix4().copy(group.matrixWorld).invert();
    const local = new THREE.Matrix4();
    const buckets = new Map();
    const gone = [];
    group.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || !o.geometry.attributes.color || o.userData.heave || o.userData.keep) return;
      local.multiplyMatrices(inverse, o.matrixWorld);
      if (!buckets.has(o.material)) buckets.set(o.material, { pos: [], nor: [], col: [] });
      bake(o.geometry, local, buckets.get(o.material));
      gone.push(o);
    });
    gone.forEach((o) => o.removeFromParent());
    for (const [material, out] of buckets) group.add(meshOf(out, material, `${group.name} (merged)`));
    return group;
  };

  // ------------------------------------------------------------ ground: scattered points, Delaunay triangles
  function triangulate(pts) {
    const n = pts.length, P = pts.concat([[-40, -40], [40, -40], [0, 40]]);
    const circ = (a, b, c) => {
      const [ax, ay] = P[a], [bx, by] = P[b], [cx, cy] = P[c], d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
      const x = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
      const y = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
      return { a, b, c, x, y, r2: (ax - x) * (ax - x) + (ay - y) * (ay - y) };
    };
    let open = [circ(n, n + 1, n + 2)];
    const done = [];
    for (const i of pts.map((_, k) => k).sort((u, v) => P[u][0] - P[v][0])) {
      const [px, py] = P[i], edge = new Map(), keep = [];
      for (const t of open) {
        const dx = px - t.x, dy = py - t.y;
        if (dx > 0 && dx * dx > t.r2) { done.push(t); continue; }
        if (dx * dx + dy * dy >= t.r2) { keep.push(t); continue; }
        for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) { const k = u < v ? u * 1e6 + v : v * 1e6 + u; if (edge.has(k)) edge.delete(k); else edge.set(k, [u, v]); }
      }
      open = keep;
      for (const [u, v] of edge.values()) open.push(circ(u, v, i));
    }
    return done.concat(open).filter((t) => t.a < n && t.b < n && t.c < n).map((t) => [t.a, t.b, t.c]);
  }
  const inside = (poly, x, z) => {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i], [xj, zj] = poly[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
    }
    return hit;
  };
  const edgeDist = (poly, x, z) => {
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length], dx = x1 - x0, dz = z1 - z0;
      const k = clamp01(((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz || 1));
      best = Math.min(best, Math.hypot(x - x0 - dx * k, z - z0 - dz * k));
    }
    return best;
  };
  // The outline split every `step`, in order (the ground's edge and the island's sides share these points).
  const edgePoints = (poly, step) => {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length];
      const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / step));
      for (let k = 0; k < n; k++) out.push([x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n]);
    }
    return out;
  };
  // Irregular triangles filling a polygon [[x, z], ...], about `step` apart.
  function sheet(poly, step, s) {
    const pts = edgePoints(poly, step);
    const xs = poly.map((q) => q[0]), zs = poly.map((q) => q[1]);
    for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) {
      for (let z = Math.min(...zs) + step / 2; z < Math.max(...zs); z += step) {
        const jx = x + (lookHash3(x * 97, z * 31, s) - 0.5) * step * 0.7, jz = z + (lookHash3(z * 53, x * 71, s) - 0.5) * step * 0.7;
        if (inside(poly, jx, jz) && edgeDist(poly, jx, jz) > step * 0.4) pts.push([jx, jz]);
      }
    }
    return triangulate(pts).map((t) => t.map((i) => pts[i]))
      .filter(([a, b, c]) => inside(poly, (a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3));
  }
  // Triangles [[x, z] x 3] lifted by height(x, z), each turned to face up.
  function lift(tris, height) {
    const pos = [];
    for (const [a, b, c] of tris) {
      const up = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
      for (const q of up < 0 ? [a, c, b] : [a, b, c]) pos.push(q[0], height(q[0], q[1]), q[1]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return g;
  }
  look.terrain = (outline, name, { height = () => 0, paint = () => 'grass', step = 0.028 } = {}) => {
    const s = seed++;
    const mesh = new THREE.Mesh(painted(lift(sheet(outline, step, s), height), paint, s), matte);
    mesh.name = name;
    return mesh;
  };

  // ------------------------------------------------------------ water: heaves so its facets keep catching the light
  const waters = [];
  const wave = (x, z, t) => Math.sin(x * 55 + t * 1.35) * Math.cos(z * 45 - t * 1.1) * 0.6 + Math.sin(x * 120 - z * 100 + t * 2.3) * 0.4;
  const heave = (mesh, amp) => {
    const attr = mesh.geometry.attributes.position;
    waters.push({ attr, base: attr.array.slice(), amp });
    mesh.userData.heave = true;
    return mesh;
  };
  look.update = (time) => {
    for (const w of waters) {
      const a = w.attr.array, b = w.base;
      for (let i = 0; i < a.length; i += 3) a[i + 1] = b[i + 1] + w.amp * wave(b[i], b[i + 2], time);
      w.attr.needsUpdate = true;
    }
  };
  look.water = (outline, name, { colour = 'sea', amp = 0.0012, step = 0.032 } = {}) => {
    const s = seed++;
    const mesh = new THREE.Mesh(painted(lift(sheet(outline, step, s), () => 0), () => colour, s), glossy);
    mesh.name = name;
    return heave(mesh, amp);
  };

  // ------------------------------------------------------------ the island tile (the set)
  look.set = ({ width = 0.46, depth = 0.32, sea = 'none' } = {}) => {
    const set = new THREE.Group();
    set.name = 'Island';
    const TOP = 0.026, SEA = TOP - 0.004, BED = TOP - 0.011, hw = width / 2, hd = depth / 2;
    const outline = [];
    for (let i = 0; i < 13; i++) {
      const a = (i / 13) * Math.PI * 2 + 0.2, c = Math.cos(a), s = Math.sin(a);
      const r = Math.pow(Math.pow(Math.abs(c), 3) + Math.pow(Math.abs(s), 3), -1 / 3) * (0.93 + 0.07 * lookHash3(i, 2, 7));
      outline.push([c * r * hw, s * r * hd]);
    }
    const coasts = {
      none: () => 1,
      left: (x, z) => x + hw - 0.3 * width - 0.012 * Math.sin(z * 30 + 1),
      right: (x, z) => hw - 0.3 * width + 0.012 * Math.sin(z * 30 + 2) - x,
      back: (x, z) => z + hd - 0.36 * depth - 0.012 * Math.sin(x * 30 + 3),
    };
    const coast = coasts[sea];
    if (!coast) throw new Error("look.set: sea is 'none', 'left', 'right' or 'back'");
    // The land only dips (by up to 2 mm), so anything laid at y = 0 (a road, a field) is never under it.
    const relief = (x, z) => -0.0009 * (1 + lookNoise(x * 22, 3.3, z * 22));
    const height = (x, z) => BED + (TOP + relief(x, z) - BED) * clamp01((coast(x, z) + 0.015) / 0.035);
    const paint = (x, y, z) => (y < SEA + 0.0025 ? 'sand' : lookNoise(x * 12, 7, z * 12) > 0.15 ? 'meadow' : 'grass');
    const top = look.terrain(outline, 'Island ground', { height, paint });
    // The sides show the layers: sand (or the sea, seen from the side) over rock.
    const rim = edgePoints(outline, 0.028), pos = [];
    const quad = (x0, z0, x1, z1, y0, y1, y2, y3) => {
      const tris = [[[x0, y0, z0], [x1, y1, z1], [x1, y2, z1]], [[x0, y0, z0], [x1, y2, z1], [x0, y3, z0]]];
      for (const [a, b, c] of tris) {
        const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        const out = nx * (a[0] + b[0] + c[0]) + nz * (a[2] + b[2] + c[2]) > 0;
        pos.push(...a, ...(out ? b : c), ...(out ? c : b));
      }
    };
    for (let i = 0; i < rim.length; i++) {
      const [x0, z0] = rim[i], [x1, z1] = rim[(i + 1) % rim.length];
      const h0 = Math.max(height(x0, z0), SEA), h1 = Math.max(height(x1, z1), SEA), mid = TOP - 0.008;
      quad(x0, z0, x1, z1, h0, h1, mid, mid);
      quad(x0, z0, x1, z1, mid, mid, 0, 0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const side = multi(g, (x, y, z) => (y < TOP - 0.008 ? 'rockDark' : coast(x, z) < 0.004 ? 'seaDeep' : 'sand'), 'Island sides', { ground: false });
    set.add(fuse('Island', [top, side]));
    if (sea !== 'none') {
      // The water reaches a little under the land, so the coast is where the ground rises out of it.
      const wet = (x, z) => 0.012 - coast(x, z);
      const poly = [];
      for (let i = 0; i < outline.length; i++) {
        const p = outline[i], q = outline[(i + 1) % outline.length], fp = wet(p[0], p[1]), fq = wet(q[0], q[1]);
        if (fp >= 0) poly.push(p);
        if ((fp >= 0) !== (fq >= 0)) { const k = fp / (fp - fq); poly.push([p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k]); }
      }
      const water = look.water(poly, 'Sea', { colour: 'sea', amp: 0.0009 });
      water.position.y = SEA;
      set.add(water);
    }
    set.userData.top = TOP;
    set.userData.width = width;
    set.userData.depth = depth;
    set.userData.seaLevel = SEA - TOP;
    set.userData.groundAt = (x, z) => height(x, z) - TOP;
    set.userData.isLand = (x, z) => coast(x, z) > 0.01 && inside(outline, x, z);
    set.userData.outline = outline;
    return set;
  };

  // ------------------------------------------------------------ land forms
  look.mountain = (r, h, name, { snow = true } = {}) => {
    const g = new THREE.ConeGeometry(r, h, 7, 3);
    g.translate(0, h / 2, 0);
    return multi(g, (x, y, z, up) => (snow && y > h * 0.68 && up > 0.2 ? 'snow' : y < h * 0.2 ? 'meadow' : lookHash3(x * 500, y * 500, z * 500) > 0.45 ? 'rock' : 'rockDark'), name, { jitter: r * 0.09 });
  };
  look.hill = (r, h, colour, name) => {
    const g = new THREE.IcosahedronGeometry(r, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, (Math.max(0, p.getY(i)) * h) / r);
    return look.facet(g, colour, name, { jitter: r * 0.06, ground: true });
  };
  look.rock = (r, name) => {
    const g = new THREE.DodecahedronGeometry(r, 0);
    g.scale(1.2, 0.75, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, Math.max(0, p.getY(i) + r * 0.3));
    return multi(g, (x, y, z, up) => (up > 0.5 ? 'rock' : 'rockDark'), name, { jitter: r * 0.12 });
  };

  // ------------------------------------------------------------ things along a line: rivers, roads, pipes, arrows
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
  // A ribbon along points, `cuts` corners across (inner ones nudged), each triangle facing up.
  function ribbon(points, width, cuts, s) {
    const path = lookPath(THREE, points), rows = Math.max(2, Math.round(path.length / 0.018)), tris = [];
    const row = (k) => {
      const u = k / rows;
      path.at(u, _a); path.at(Math.min(1, u + 0.01), _b); path.at(Math.max(0, u - 0.01), _c);
      const tx = _b.x - _c.x, tz = _b.z - _c.z, l = Math.hypot(tx, tz) || 1, nx = -tz / l, nz = tx / l;
      return cuts.map((f, j) => {
        const inner = j > 0 && j < cuts.length - 1, w = inner ? (lookHash3(k, j, s) - 0.5) * width * 0.25 : 0;
        return [_a.x + nx * (f * width / 2) + (tx / l) * w, _a.y, _a.z + nz * (f * width / 2) + (tz / l) * w];
      });
    };
    let prev = row(0);
    for (let k = 1; k <= rows; k++) {
      const next = row(k);
      for (let j = 0; j + 1 < cuts.length; j++) {
        const a = prev[j], b = prev[j + 1], c = next[j], d = next[j + 1];
        if ((k + j) % 2) tris.push([a, b, c], [b, d, c]); else tris.push([a, b, d], [a, d, c]);
      }
      prev = next;
    }
    const pos = [];
    for (const [a, b, c] of tris) {
      const up = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      pos.push(...a, ...(up < 0 ? c : b), ...(up < 0 ? b : c));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return { g, path };
  }
  look.river = (points, name, { width = 0.028, colour = 'river' } = {}) => {
    const s = seed++, { g, path } = ribbon(points, width, [-1, -0.33, 0.33, 1], s);
    const mesh = new THREE.Mesh(painted(g, () => colour, s), glossy);
    mesh.name = name;
    mesh.position.y = 0.001;
    mesh.userData.path = path;
    return heave(mesh, 0.0005);
  };
  look.road = (points, name, { width = 0.02, colour = 'bed' } = {}) => {
    const s = seed++, { g, path } = ribbon(points, width, [-1, 0, 1], s);
    const mesh = new THREE.Mesh(painted(g, () => colour, s), matte);
    mesh.name = name;
    mesh.position.y = 0.001;
    mesh.userData.path = path;
    return mesh;
  };
  look.pipe = (points, r, name, { colour = 'rock' } = {}) => {
    const v = points.map((q) => new THREE.Vector3(q[0], q[1], q[2]));
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(v, false, 'centripetal'), Math.max(4, (v.length - 1) * 5), r, 5, false);
    const mesh = look.facet(tube, colour, name, { jitter: 0 });
    mesh.userData.path = lookPath(THREE, points);
    return mesh;
  };
  look.arrow = (points, name, { width = 0.012, colour = 'accent' } = {}) => {
    const s = seed++, path = lookPath(THREE, points);
    const head = Math.min(width * 1.8, path.length * 0.5);
    const neck = path.at(1 - head / path.length, new THREE.Vector3()), end = path.at(1, new THREE.Vector3());
    const shaft = [points[0], ...points.slice(1, -1).filter((q) => Math.hypot(q[0] - end.x, q[2] - end.z) > head * 1.2)];
    const { g } = ribbon([...shaft, [neck.x, neck.y, neck.z]], width, [-1, 1], s);
    const dx = end.x - neck.x, dz = end.z - neck.z, l = Math.hypot(dx, dz) || 1, nx = (-dz / l) * width * 1.1, nz = (dx / l) * width * 1.1;
    const a = [neck.x + nx, neck.y, neck.z + nz], c = [neck.x - nx, neck.y, neck.z - nz], b = [end.x, end.y, end.z];
    const up = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const tip = new THREE.BufferGeometry();
    tip.setAttribute('position', new THREE.Float32BufferAttribute(up < 0 ? [...a, ...c, ...b] : [...a, ...b, ...c], 3));
    const parts = [new THREE.Mesh(painted(g, () => colour, s), matte), new THREE.Mesh(painted(tip, () => colour, s), matte)];
    const mesh = fuse(name, parts);
    mesh.position.y = 0.002;
    mesh.userData.path = path;
    return mesh;
  };

  // ------------------------------------------------------------ trees and fields
  function treeParts(h, kind, s) {
    const parts = [];
    const trunk = new THREE.CylinderGeometry(h * 0.05, h * 0.08, h * 0.32, 5);
    trunk.translate(0, h * 0.16, 0);
    parts.push(look.facet(trunk, 'trunk', 'trunk', { jitter: 0 }));
    if (kind === 'pine') {
      [[0.3, 0.4, 0.17], [0.23, 0.36, 0.43], [0.15, 0.34, 0.66]].forEach(([r, l, y], i) => {
        const g = new THREE.ConeGeometry(r * h, l * h, 6, 1);
        g.rotateY(lookHash3(s, i, 4) * 6.28);
        g.translate(0, (y + l / 2) * h, 0);
        parts.push(look.facet(g, i === 2 ? 'forest' : 'pine', 'crown', { jitter: h * 0.02 }));
      });
    } else {
      [[0, 0.62, 0, 0.3], [0.14, 0.48, 0.06, 0.19]].forEach(([x, y, z, r]) => {
        const g = new THREE.IcosahedronGeometry(r * h, 0);
        g.translate(x * h, y * h, z * h);
        parts.push(look.facet(g, kind === 'autumn' ? 'ochre' : 'leaf', 'crown', { jitter: h * 0.03 }));
      });
    }
    return parts;
  }
  look.tree = (name, { h = 0.05, kind = 'pine' } = {}) => fuse(name, treeParts(h, kind, seed++));
  look.forest = (spots, name, { h = 0.04, kind = 'mixed' } = {}) => {
    const parts = [];
    spots.forEach(([x, z, sc = 1], i) => {
      const k = kind === 'mixed' ? ['pine', 'pine', 'round', 'autumn'][i % 4] : kind;
      for (const part of treeParts(h * sc, k, seed++)) { part.position.set(x, 0, z); part.rotation.y = i * 2.4; parts.push(part); }
    });
    return fuse(name, parts);
  };
  look.field = (w, d, name, { crop = 'ochre', rows = 5 } = {}) => {
    const soil = new THREE.BoxGeometry(w, 0.004, d);
    soil.translate(0, 0.002, 0);
    const parts = [look.facet(soil, 'trunk', 'soil', { jitter: 0.0008 })];
    for (let i = 0; i < rows; i++) {
      const g = new THREE.CylinderGeometry(d / rows * 0.42, d / rows * 0.42, w * 0.9, 3, 4);
      g.rotateZ(Math.PI / 2);
      const row = look.facet(g, crop, 'row', { jitter: 0.001 });
      row.position.set(0, 0.006, -d / 2 + (d / rows) * (i + 0.5));
      parts.push(row);
    }
    return fuse(name, parts);
  };

  // ------------------------------------------------------------ buildings
  const box = (w, h, d, colour, x = 0, y = 0, z = 0, jitter = 0.0006) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y + h / 2, z);
    return look.facet(g, colour, 'box', { jitter });
  };
  const prism = (w, rise, d, colour, x, y, z) => {
    const s = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, rise)]);
    const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
    g.translate(x, y, z - d / 2);
    return look.facet(g, colour, 'roof', { jitter: 0 });
  };
  look.house = (name, { w = 0.036, d = 0.03, h = 0.026, wall = 'paper', roof = 'accent' } = {}) => fuse(name, [
    box(w, h, d, wall),
    prism(w + 0.006, h * 0.6, d + 0.006, roof, 0, h, 0),
    box(w * 0.24, h * 0.5, 0.002, 'ink', 0, 0, d / 2),
  ]);
  look.factory = (name, { w = 0.07, d = 0.045, h = 0.03 } = {}) => {
    const parts = [box(w, h, d, 'paper'), box(w * 0.16, h * 0.55, 0.002, 'ink', -w * 0.25, 0, d / 2)];
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(w / 3, 0), new THREE.Vector2(w / 3, h * 0.45)]);
      const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
      g.translate(-w / 2 + (i * w) / 3, h, -d / 2);
      parts.push(look.facet(g, 'rock', 'roof', { jitter: 0 }));
    }
    const chimney = new THREE.CylinderGeometry(w * 0.06, w * 0.08, h * 1.4, 6);
    chimney.translate(w * 0.32, h + h * 0.7, -d * 0.25);
    parts.push(look.facet(chimney, 'accent', 'chimney', { jitter: 0 }));
    const mesh = fuse(name, parts);
    mesh.userData.chimney = [w * 0.32, h * 2.4, -d * 0.25];
    return mesh;
  };
  look.tank = (r, h, name, { legs = 0, colour = 'paper' } = {}) => {
    const g = new THREE.Group();
    g.name = name;
    const shell = [look.facet(kit.lathe([[0, 0], [r, 0], [r, h], [r * 0.86, h], [r * 0.86, 0.003], [0, 0.003]], 8), colour, 'shell', { jitter: 0 })];
    shell[0].position.y = legs;
    for (let i = 0; i < (legs > 0 ? 4 : 0); i++) {
      const leg = new THREE.CylinderGeometry(r * 0.08, r * 0.1, legs, 4);
      leg.translate(Math.cos(i * 1.571 + 0.785) * r * 0.8, legs / 2, Math.sin(i * 1.571 + 0.785) * r * 0.8);
      shell.push(look.facet(leg, 'rockDark', 'leg', { jitter: 0 }));
    }
    const body = fuse(`${name} body`, shell);
    const water = look.facet(new THREE.CylinderGeometry(r * 0.85, r * 0.85, 0.002, 8), 'river', `${name} water`, { jitter: 0, water: true });
    g.add(body, water);
    g.userData.setLevel = (k) => {
      water.visible = k > 0.001;
      water.position.y = legs + 0.004 + (h - 0.006) * clamp01(k);
    };
    g.userData.setLevel(0.6);
    g.userData.top = legs + h;
    return g;
  };

  // ------------------------------------------------------------ goods and amounts
  look.crate = (s, name, { colour = 'trunk', fill } = {}) => {
    const g = new THREE.Group();
    g.name = name;
    g.add(fuse(`${name} box`, [box(s, s * 0.7, s, colour, 0, 0, 0, s * 0.03), box(s * 1.02, s * 0.1, s * 1.02, 'rockDark', 0, s * 0.3, 0, 0)]));
    if (fill) {
      const mound = new THREE.IcosahedronGeometry(s * 0.44, 0);
      mound.scale(1, 0.4, 1);
      const m = look.facet(mound, fill, `${name} contents`, { jitter: s * 0.03 });
      m.position.y = s * 0.7;
      g.add(m);
      g.userData.fill = m;
    }
    return g;
  };
  const SHAPES = {
    crate: (z) => { const g = new THREE.BoxGeometry(z, z * 0.8, z * 0.9); g.translate(0, z * 0.4, 0); return [g, 'trunk', z * 0.8]; },
    sack: (z) => { const g = new THREE.IcosahedronGeometry(z * 0.55, 0); g.scale(1, 0.75, 0.8); g.translate(0, z * 0.4, 0); return [g, 'paper', z * 0.7]; },
    gem: (z) => { const g = new THREE.OctahedronGeometry(z * 0.5, 0); g.scale(1, 1.3, 1); g.translate(0, z * 0.65, 0); return [g, 'river', z * 0.9]; },
    log: (z) => { const g = new THREE.CylinderGeometry(z * 0.3, z * 0.3, z * 1.8, 6); g.rotateX(Math.PI / 2); g.translate(0, z * 0.3, 0); return [g, 'trunk', z * 0.55]; },
  };
  look.pile = (n, name, { shape = 'sack', colour, size = 0.02 } = {}) => {
    if (!SHAPES[shape]) throw new Error(`look.pile: shape is ${Object.keys(SHAPES).join(', ')}`);
    const [g, def, rise] = SHAPES[shape](size);
    const mesh = new THREE.InstancedMesh(lookFacets(THREE, g, hex(colour ?? def), { jitter: size * 0.03, seed: seed++ }), colour === 'river' || (!colour && def === 'river') ? glossy : matte, n);
    mesh.name = name;
    let base = 1;
    while ((base * (base + 1)) / 2 < n) base++;
    const m = new THREE.Matrix4();
    let i = 0;
    for (let layer = 0; layer < base && i < n; layer++) {
      for (let k = 0; k < base - layer && i < n; k++, i++) {
        m.makeRotationY((lookHash3(i, 3, 1) - 0.5) * 0.5);
        m.setPosition((k - (base - layer - 1) / 2) * size * 1.05, layer * rise, (lookHash3(i, 5, 2) - 0.5) * size * 0.15);
        mesh.setMatrixAt(i, m);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.show = (k) => { mesh.count = Math.max(0, Math.min(n, Math.round(k))); };
    mesh.userData.width = base * size * 1.05;
    return mesh;
  };

  // ------------------------------------------------------------ vehicles and people
  look.vehicle = (kind, name) => {
    if (kind === 'truck') {
      const parts = [box(0.044, 0.004, 0.022, 'ink', 0, 0.004), box(0.014, 0.016, 0.022, 'accent', 0.015, 0.006),
        box(0.002, 0.007, 0.016, 'river', 0.0225, 0.013), box(0.028, 0.006, 0.022, 'trunk', -0.007, 0.008)];
      for (const [x, z] of [[0.013, 0.011], [0.013, -0.011], [-0.012, 0.011], [-0.012, -0.011]]) {
        const w = new THREE.CylinderGeometry(0.0055, 0.0055, 0.004, 6);
        w.rotateX(Math.PI / 2);
        w.translate(x, 0.0055, z);
        parts.push(look.facet(w, 'ink', 'wheel', { jitter: 0 }));
      }
      const mesh = fuse(name, parts);
      mesh.userData.bed = 0.014;
      return mesh;
    }
    if (kind === 'boat') {
      const s = 0.07, P = { bow: [0.36, 0.13, 0], stern: [-0.36, 0.13, 0], l: [0, 0.11, 0.12], r: [0, 0.11, -0.12], keel: [0, -0.05, 0], mast: [0.02, 0.56, 0], s0: [-0.2, 0.14, 0], s1: [0.22, 0.14, 0] };
      const hull = [['bow', 'l', 'keel'], ['l', 'stern', 'keel'], ['stern', 'r', 'keel'], ['r', 'bow', 'keel'], ['bow', 'stern', 'l'], ['bow', 'r', 'stern']];
      const pos = [];
      for (const t of hull) {
        const [a, b, c] = t.map((k) => P[k].map((v) => v * s));
        const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        const out = nx * (a[0] + b[0] + c[0]) + ny * (a[1] + b[1] + c[1] - 0.18 * s) + nz * (a[2] + b[2] + c[2]) > 0;
        pos.push(...a, ...(out ? b : c), ...(out ? c : b));
      }
      for (const t of [['s0', 's1', 'mast'], ['s1', 's0', 'mast']]) for (const k of t) pos.push(...P[k].map((v) => v * s));
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.translate(0, 0.05 * s, 0);
      const mesh = multi(g, (x, y) => (y > 0.2 * s ? 'accent' : 'paper'), name, { ground: false });
      mesh.userData.bed = 0.13 * s;
      return mesh;
    }
    throw new Error("look.vehicle: kind is 'truck' or 'boat'");
  };
  look.person = (colour, name, { h = 0.03 } = {}) => {
    const body = new THREE.CylinderGeometry(h * 0.12, h * 0.2, h * 0.58, 5);
    body.translate(0, h * 0.29, 0);
    const head = new THREE.IcosahedronGeometry(h * 0.15, 0);
    head.translate(0, h * 0.74, 0);
    return fuse(name, [look.facet(body, colour, 'body', { jitter: 0 }), look.facet(head, 'sand', 'head', { jitter: 0 })]);
  };

  // ------------------------------------------------------------ sky and water drops
  look.cloud = (name, { r = 0.03, storm = false } = {}) => {
    const puffs = [[0, 0.3, 0, 1], [-1.05, 0.12, 0.1, 0.72], [1, 0.18, -0.05, 0.8], [0.25, 0.02, 0.55, 0.62], [-0.45, 0.72, -0.1, 0.55]];
    return fuse(name, puffs.map(([x, y, z, k], i) => {
      const g = new THREE.IcosahedronGeometry(r * k, 1);
      g.scale(1, 0.86, 0.92);
      g.translate(x * r, y * r, z * r);
      const p = g.attributes.position;
      for (let j = 0; j < p.count; j++) p.setY(j, Math.max(-0.0004 * i, p.getY(j)));
      return multi(g, (cx, cy, cz, up) => (up < -0.5 ? 'cloudBase' : storm ? (up > 0.3 ? 'cloudBase' : 'rock') : up > 0.3 ? 'cloud' : 'cloudSide'), 'puff', { jitter: r * k * 0.1, ground: false });
    }));
  };
  look.sun = (r, name) => {
    const parts = [look.facet(new THREE.IcosahedronGeometry(r, 0), 'sun', 'sun', { jitter: 0 })];
    for (let i = 0; i < 8; i++) {
      const ray = new THREE.ConeGeometry(r * 0.22, r * 0.55, 4);
      ray.translate(0, r * 1.45, 0);
      ray.rotateZ((i * Math.PI) / 4);
      parts.push(look.facet(ray, 'sun', 'ray', { jitter: 0 }));
    }
    return fuse(name, parts, sunMat);
  };
  const dropGeometry = (r, colour) => { const g = new THREE.OctahedronGeometry(1, 0); g.scale(r, r * 1.7, r); return lookFacets(THREE, g, hex(colour), { seed: seed++ }); };
  look.droplet = (r, name) => { const mesh = new THREE.Mesh(dropGeometry(r, 'river'), glossy); mesh.name = name; return mesh; };
  look.drops = (n, r, name, { colour = 'river' } = {}) => {
    const mesh = new THREE.InstancedMesh(dropGeometry(r, colour), glossy, n);
    mesh.name = name;
    const m = new THREE.Matrix4();
    mesh.userData.place = (i, x, y, z, s = 1) => {
      m.makeScale(s || 1e-4, s || 1e-4, s || 1e-4);
      m.setPosition(x, y, z);
      mesh.setMatrixAt(i, m);
      mesh.instanceMatrix.needsUpdate = true;
    };
    for (let i = 0; i < n; i++) mesh.userData.place(i, 0, 0, 0, 0);
    return mesh;
  };

  // ------------------------------------------------------------ words: numbers and flags
  const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g' };
  const LINES = { a: [0, 1, 1, 1], b: [1, 1, 1, 0.5], c: [1, 0.5, 1, 0], d: [0, 0, 1, 0], e: [0, 0.5, 0, 0], f: [0, 1, 0, 0.5], g: [0, 0.5, 1, 0.5] };
  look.number = (text, colour, name, { h = 0.03 } = {}) => {
    const w = h * 0.55, t = h * 0.16, parts = [];
    const bar = (x0, y0, x1, y1) => {
      const g = new THREE.BoxGeometry(Math.hypot(x1 - x0, y1 - y0) + t, t, t);
      const m = look.facet(g, colour, 'bar', { jitter: 0 });
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
      m.rotation.z = Math.atan2(y1 - y0, x1 - x0);
      parts.push(m);
    };
    let x = t / 2;
    for (const ch of String(text)) {
      if (ch === ' ') { x += w * 0.8; continue; }
      if (ch === '.') { bar(x, t / 2, x, t / 2); x += w * 0.5; continue; }
      if (SEG[ch]) for (const s of SEG[ch]) { const [a, b, c, d] = LINES[s]; bar(x + a * w, t / 2 + b * (h - t), x + c * w, t / 2 + d * (h - t)); }
      else if (ch === '+') { bar(x, h / 2, x + w, h / 2); bar(x + w / 2, h * 0.22, x + w / 2, h * 0.78); }
      else if (ch === '=') { bar(x, h * 0.33, x + w, h * 0.33); bar(x, h * 0.67, x + w, h * 0.67); }
      else if (ch === '/') bar(x, t / 2, x + w, h - t / 2);
      else if (ch === 'x') { bar(x, h * 0.2, x + w, h * 0.8); bar(x, h * 0.8, x + w, h * 0.2); }
      x += w * 1.55;
    }
    const mesh = parts.length ? fuse(name, parts) : new THREE.Group();
    mesh.name = name;
    mesh.userData.width = x - w * 0.55;
    return mesh;
  };
  look.flag = (n, name, { colour = 'accent', h = 0.09 } = {}) => {
    const g = new THREE.Group();
    g.name = name;
    const material = matte.clone();
    material.emissive = new THREE.Color(PAL.sun);
    material.emissiveIntensity = 0;
    const foot = new THREE.DodecahedronGeometry(0.013, 0);
    foot.scale(1.25, 0.55, 1.25);
    const pin = new THREE.CylinderGeometry(0.0022, 0.0022, h, 5);
    pin.translate(0, h / 2, 0);
    const knob = new THREE.IcosahedronGeometry(0.0055, 0);
    knob.translate(0, h + 0.003, 0);
    const cloth = new THREE.ExtrudeGeometry(new THREE.Shape([[0, 0], [0.05, 0], [0.04, 0.016], [0.05, 0.032], [0, 0.032]].map(([x, y]) => new THREE.Vector2(x, y))), { depth: 0.004, bevelEnabled: false });
    cloth.translate(0.002, h - 0.036, -0.002);
    const numeral = look.number(String(n), colour, 'numeral', { h: 0.02 });
    numeral.position.set(0.009, h - 0.03, 0.0035);
    const mesh = fuse(`${name} flag`, [
      look.facet(foot, 'rock', 'foot', { jitter: 0 }), look.facet(pin, 'ink', 'pin', { jitter: 0 }),
      look.facet(knob, colour, 'knob', { jitter: 0 }), look.facet(cloth, 'paper', 'cloth', { jitter: 0.0004 }), numeral,
    ], material);
    g.add(mesh);
    g.userData.number = n;
    g.userData.active = (k) => {
      material.emissiveIntensity = 0.5 * k;
      mesh.position.y = 0.012 * k;
    };
    return g;
  };

  // ------------------------------------------------------------ motion
  const _p = new THREE.Vector3(), _q = new THREE.Vector3();
  look.follow = (object, path, u, dir = 1) => {
    const a = clamp01(u);
    let b = clamp01(a + 0.004 * dir), sign = 1;
    if (b === a) { b = clamp01(a - 0.004 * dir); sign = -1; }
    path.at(a, _p);
    path.at(b, _q);
    object.position.copy(_p);
    const dx = (_q.x - _p.x) * sign, dz = (_q.z - _p.z) * sign;
    if (dx * dx + dz * dz > 1e-12) object.rotation.y = Math.atan2(-dz, dx);
    return object;
  };
  look.unfold = (mesh, { from = [0, 0, 0] } = {}) => {
    const attr = mesh.geometry.attributes.position, base = attr.array.slice(), tris = attr.count / 3;
    const born = new Float32Array(tris), cen = new Float32Array(tris * 3);
    let far = 1e-6;
    for (let t = 0; t < tris; t++) {
      for (let k = 0; k < 3; k++) cen[t * 3 + k] = (base[t * 9 + k] + base[t * 9 + 3 + k] + base[t * 9 + 6 + k]) / 3;
      born[t] = Math.hypot(cen[t * 3] - from[0], cen[t * 3 + 1] - from[1], cen[t * 3 + 2] - from[2]);
      far = Math.max(far, born[t]);
    }
    for (let t = 0; t < tris; t++) born[t] = (born[t] / far) * 0.92 + lookHash3(t, 1, 3) * 0.08;
    let shown = -1;
    return {
      set(k) {
        if (k === shown) return;
        shown = k;
        const a = attr.array;
        for (let t = 0; t < tris; t++) {
          const p = lookSeg(k, born[t] * 0.72, born[t] * 0.72 + 0.28), s = p >= 1 ? 1 : lookBack(p, 1.2);
          for (let i = t * 9; i < t * 9 + 9; i++) { const c = cen[t * 3 + (i % 3)]; a[i] = c + (base[i] - c) * s; }
        }
        attr.needsUpdate = true;
      },
    };
  };
  look.pop = (object, k) => {
    if (object.userData.popScale === undefined) object.userData.popScale = object.scale.x;
    const s = object.userData.popScale, y = k >= 1 ? 1 : lookBack(clamp01(k)), w = k >= 1 ? 1 : lookBack(lookSeg(k, 0.15, 1));
    object.visible = k > 0.001;
    object.scale.set(s * Math.max(0.001, w), s * Math.max(0.001, y), s * Math.max(0.001, w));
  };

  look.demo = (subject) => {
    const peak = look.mountain(0.06, 0.09, 'Mountain');
    peak.position.set(-0.1, 0, -0.07);
    const river = look.river([[-0.08, 0.004, -0.03], [-0.03, 0.002, 0], [0.04, 0, 0.02], [0.12, 0, 0.06]], 'River');
    const woods = look.forest([[0.05, -0.08], [0.09, -0.06, 0.8], [0.12, -0.09], [0.02, -0.06, 0.7]], 'Woods');
    const house = look.house('House');
    house.position.set(0.1, 0, -0.01);
    const flag = look.flag(1, 'Stop 1');
    flag.position.set(-0.05, 0, 0.06);
    subject.add(peak, river, woods, house, flag);
    return [{ object: flag, press: true }];
  };
  return look;
}
