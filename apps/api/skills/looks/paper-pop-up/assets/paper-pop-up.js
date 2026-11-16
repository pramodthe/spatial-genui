// Paper pop-up look for an XR lesson: an open pop-up book on the desk. Every scene is flat die-cut card in a few flat
// inks with the pale core on every cut edge, standing on real fold mechanisms (V-folds, parallel folds, pieces on paper
// arms) that are pressed flat under a turning page and pulled up out of the gutter on the next spread. Needs
// look-kit.js (lookSeg, lookBack). new-lesson.mjs pastes it in. Builders run in build(); book.update(time, delta) and
// the hand pieces' update() allocate nothing.
//
// paperPopUpLook(THREE, kit) returns:
//   PAL, CORE        the inks { name: '#hex' } (cream card navy coral pink yellow honey amber leaf sage deep sky; any
//                    '#rrggbb' works too) and the bare card every cut edge shows
//   shape            outlines [[x, y], ...] in metres: rect(x, y, w, h, r) circle(cx, cy, r) ellipse(cx, cy, rx, ry, rot)
//                    ridge(x0, x1, top) leaf(x, y, len, angle, width) drop(cx, cy, r) star(cx, cy, r1, r2, n)
//                    arrow(x0, y0, x1, y1, w) wave(x0, x1, y, amp, waves, depth) arc(cx, cy, r0, r1, a0, a1);
//                    move(o, dx, dy) scale(o, sx, sy, cx, cy) turn(o, a, cx, cy) flip(o, cx)
//   card(outline, colour, name, { thick, margin, holes })  a die-cut card standing in the XY plane, one mesh; place
//                    it with .position (and .rotation.z / .scale); margin: true adds a 2 mm cream rim behind it
//   flat(outline, colour, name, { thick, level })  a card lying on the page; outline [x, y] is page [x, z] (y toward
//                    you); level 1, 2 ... prints it on top of the level below
//   glue(group)      merge the cards in a group into one mesh (one draw call); they no longer move on their own.
//                    Tabs, flaps and wheels inside it are left alone (wheel.disc is glued with look.glue(wheel.disc))
//   number(text, colour, name, { h })  card digits 0-9 and + - = x / . : C E F H L P U, standing, left edge at x = 0
//   set({ spreads, width, depth })     the open book (the set, never grabbable); .userData.top
//       book.spreads[i] = { left, right, pop }: left/right are the pages of spread i (x < 0 / x > 0, y = 0 on the
//       paper, z toward you): flat prints, pull tabs, flaps and wheels go there; pop holds the fold mechanisms
//       book.next / book.back: corner tabs to press; book.turnTo(i); book.update(time, delta) every frame;
//       book.page (the spread open now), book.turning, book.open(i) (0 shut .. 1 open)
//   vFold(spread, { z, alpha, name }, cards)  a V-fold across the gutter. Draw its cards with x = 0 on the crease and
//                    y = 0 on the page; alpha 55-65 is a clear V, 75-88 almost a flat wall. { group, left, right }
//   box(spread, v, { side, depth, strap, name }, cards)   a parallel fold: a piece standing `depth` in front of one
//                    wing of v (side -1 left, 1 right), drawn in that wing's x (x < 0 on the left wing). { group }
//   float(spread, v, { side, at, gap, sway, name }, cards) a piece on a paper arm `gap` in front of a wing, glued at
//                    at = [x, y]; it trembles when the page lands. { group }
//   layer(spread, { x, z, name }, cards)  a plain layer hinged on one page at depth z; it rises after the V-folds
//   ribbon(spread, text, { z })           the spread's short line on a paper ribbon at the front
//   pullTab(page, { x, z, length, colour, name })  a thick tab in a slot, pulled along +x by hand:
//                    { object, k (0..1), set(k), update(isGrabbed, delta) }
//   flap(page, { x, z, w, d, colour, name })       a lid hinged at its back edge, pressed to lift:
//                    { object, top, under, open, toggle(), update(delta) }
//   wheel(page, { x, z, r, sectors: [{ colour, name }], colour, name })  a volvelle; a press turns one sector into
//                    the window: { object, disc, sector(i), index, next(), set(i), update(delta) }
//   fold(group, k)   stand a group hinged at its base: 0 lying back flat .. 1 standing
//   demo(subject)    a working sample spread (replace it)
function paperPopUpLook(THREE, kit) {
  const PAL = {
    card: '#f5ecd9', cream: '#fbf3df', navy: '#22364e', coral: '#e2604a', pink: '#f3ab99', yellow: '#f5bd35',
    honey: '#eba020', amber: '#cf7d22', leaf: '#74a25e', sage: '#a6c787', deep: '#2f6753', sky: '#cfe5df',
  };
  const CORE = '#fbf5e6';
  const look = { name: 'paper-pop-up', PAL, CORE };
  // One matt card stock for every piece; each piece carries its inks as vertex colours (printed faces, pale core on
  // the cut edge), so a whole layer of cards can be one mesh.
  const paper = kit.material('paper', { color: '#ffffff', roughness: 0.92, wear: 0.04 });
  paper.vertexColors = true;
  const cols = {};
  const rgb = (c) => {
    const hex = PAL[c] || c;
    if (!cols[hex]) {
      if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`paperPopUpLook: no ink "${c}". Inks: ${Object.keys(PAL).join(', ')} or '#rrggbb'.`);
      cols[hex] = new THREE.Color(hex);
    }
    return cols[hex];
  };
  const inks = {};
  look.ink = (c) => inks[c] || (inks[c] = lookInk(kit, PAL[c] || c));

  // ---------------------------------------------------------------- outlines
  const TAU = Math.PI * 2;
  const area = (o) => { let s = 0; for (let i = 0; i < o.length; i++) { const p = o[i], q = o[(i + 1) % o.length]; s += p[0] * q[1] - q[0] * p[1]; } return s / 2; };
  const arcPts = (out, cx, cy, r, a0, a1, n) => { for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return out; };
  const shape = {
    rect(x, y, w, h, r = 0) {
      if (r <= 0) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
      r = Math.min(r, w / 2, h / 2);
      const o = [];
      arcPts(o, x + w - r, y + r, r, -Math.PI / 2, 0, 4); arcPts(o, x + w - r, y + h - r, r, 0, Math.PI / 2, 4);
      arcPts(o, x + r, y + h - r, r, Math.PI / 2, Math.PI, 4); arcPts(o, x + r, y + r, r, Math.PI, 1.5 * Math.PI, 4);
      return o;
    },
    ellipse(cx, cy, rx, ry, rot = 0, n = 28) {
      const o = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU, x = rx * Math.cos(a), y = ry * Math.sin(a);
        o.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
      }
      return o;
    },
    circle(cx, cy, r, n = 28) { return shape.ellipse(cx, cy, r, r, 0, n); },
    // Ground, hills, a skyline: everything under top(x) from x0 to x1, down to y0.
    ridge(x0, x1, top, y0 = 0, step = 0.006) {
      const o = [[x0, y0]];
      for (let x = x0; x < x1; x += step) o.push([x, top(x)]);
      o.push([x1, top(x1)], [x1, y0]);
      return o;
    },
    // A pointed leaf (or petal, fin, flame) from (x, y), len long, pointing at `angle` (radians).
    leaf(x, y, len, angle, width = 0.35, n = 8) {
      const ex = x + Math.cos(angle) * len, ey = y + Math.sin(angle) * len, o = [];
      for (const side of [1, -1]) {
        const cx = x + Math.cos(angle + side * width * 2) * len * 0.62, cy = y + Math.sin(angle + side * width * 2) * len * 0.62;
        for (let i = 0; i < n; i++) {
          const t = side > 0 ? i / n : 1 - i / n;
          o.push([(1 - t) * (1 - t) * x + 2 * t * (1 - t) * cx + t * t * ex, (1 - t) * (1 - t) * y + 2 * t * (1 - t) * cy + t * t * ey]);
        }
      }
      return o;
    },
    // A drop pointing up, 2r tall, centred on (cx, cy): water, an egg, a seed.
    drop(cx, cy, r, n = 24) {
      const o = [];
      for (let i = 0; i < n; i++) { const t = (i / n) * TAU; o.push([cx + r * Math.sin(t) * Math.sin(t / 2), cy + r * Math.cos(t)]); }
      return o;
    },
    star(cx, cy, r1, r2, n = 5) {
      const o = [];
      for (let i = 0; i < 2 * n; i++) { const a = Math.PI / 2 + (i * Math.PI) / n, r = i % 2 ? r2 : r1; o.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
      return o;
    },
    // A flat arrow from (x0, y0) to its tip at (x1, y1), shaft w wide.
    arrow(x0, y0, x1, y1, w = 0.008) {
      const len = Math.hypot(x1 - x0, y1 - y0) || 1e-6, dx = (x1 - x0) / len, dy = (y1 - y0) / len, nx = -dy, ny = dx;
      const head = Math.min(len * 0.6, w * 2.2), bx = x1 - dx * head, by = y1 - dy * head, hw = w * 1.25;
      return [[x0 + nx * w / 2, y0 + ny * w / 2], [bx + nx * w / 2, by + ny * w / 2], [bx + nx * hw, by + ny * hw], [x1, y1],
        [bx - nx * hw, by - ny * hw], [bx - nx * w / 2, by - ny * w / 2], [x0 - nx * w / 2, y0 - ny * w / 2]];
    },
    // A strip with a wavy top at y: water, a stream, a pond's edge.
    wave(x0, x1, y, amp = 0.004, waves = 4, depth = 0.012) {
      const o = [[x0, y - depth]];
      const n = Math.max(8, waves * 8);
      for (let i = 0; i <= n; i++) { const x = x0 + ((x1 - x0) * i) / n; o.push([x, y + amp * Math.sin((i / n) * waves * TAU)]); }
      o.push([x1, y - depth]);
      return o;
    },
    // A ring sector (a wedge when r0 = 0) between angles a0 and a1.
    arc(cx, cy, r0, r1, a0, a1, n = 16) {
      const o = arcPts([], cx, cy, r1, a0, a1, n);
      if (r0 <= 0) o.push([cx, cy]);
      else arcPts(o, cx, cy, r0, a1, a0, n);
      return o;
    },
    move: (o, dx, dy) => o.map((p) => [p[0] + dx, p[1] + dy]),
    scale: (o, sx, sy = sx, cx = 0, cy = 0) => o.map((p) => [cx + (p[0] - cx) * sx, cy + (p[1] - cy) * sy]),
    turn: (o, a, cx = 0, cy = 0) => o.map((p) => [cx + (p[0] - cx) * Math.cos(a) - (p[1] - cy) * Math.sin(a), cy + (p[0] - cx) * Math.sin(a) + (p[1] - cy) * Math.cos(a)]),
    flip: (o, cx = 0) => o.map((p) => [2 * cx - p[0], p[1]]),
  };
  look.shape = shape;

  // The same outline pushed out by m metres all round: the cream rim a die leaves round a printed shape.
  function grow(o, m) {
    const k = area(o) > 0 ? 1 : -1, n = o.length;
    return o.map((p, i) => {
      const a = o[(i - 1 + n) % n], b = o[(i + 1) % n];
      let n1x = (p[1] - a[1]) * k, n1y = -(p[0] - a[0]) * k, n2x = (b[1] - p[1]) * k, n2y = -(b[0] - p[0]) * k;
      const l1 = Math.hypot(n1x, n1y) || 1, l2 = Math.hypot(n2x, n2y) || 1;
      n1x /= l1; n1y /= l1; n2x /= l2; n2y /= l2;
      let bx = n1x + n2x, by = n1y + n2y;
      const bl = Math.hypot(bx, by);
      if (bl < 1e-9) { bx = n1x; by = n1y; } else { bx /= bl; by /= bl; }
      const c = Math.max(0.35, bx * n1x + by * n1y);
      return [p[0] + (bx * m) / c, p[1] + (by * m) / c];
    });
  }
  // The part of an outline on one side of the crease (x = 0): side -1 keeps x <= 0, side 1 keeps x >= 0.
  function clipX(o, side) {
    const out = [];
    for (let i = 0; i < o.length; i++) {
      const a = o[i], b = o[(i + 1) % o.length], ina = side * a[0] >= 0, inb = side * b[0] >= 0;
      if (ina) out.push(a);
      if (ina !== inb) { const t = a[0] / (a[0] - b[0]); out.push([0, a[1] + t * (b[1] - a[1])]); }
    }
    return out;
  }

  // ---------------------------------------------------------------- cards
  const acc = (keep) => ({ p: [], n: [], uv: [], c: [], pieces: keep ? [] : null });
  // One card into an accumulator: faces printed in `colour`, the cut edge in CORE, `thick` thick, centred on z.
  function slab(A, outline, colour, thick, z = 0, holes = null) {
    if (A.pieces) A.pieces.push({ outline, colour, thick, z, holes });
    if (!outline || outline.length < 3 || Math.abs(area(outline)) < 1e-8) return;
    const sh = new THREE.Shape(outline.map((q) => new THREE.Vector2(q[0], q[1])));
    if (holes) for (const h of holes) sh.holes.push(new THREE.Path(h.map((q) => new THREE.Vector2(q[0], q[1]))));
    const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: false, curveSegments: 4 });
    const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
    const ink = rgb(colour), core = rgb(CORE);
    const groups = g.groups.length ? g.groups : [{ start: 0, count: pos.count, materialIndex: 0 }];
    for (const gr of groups) {
      const c = gr.materialIndex === 0 ? ink : core;
      for (let i = gr.start; i < gr.start + gr.count; i++) {
        A.p.push(pos.getX(i), pos.getY(i), pos.getZ(i) - thick / 2 + z);
        A.n.push(nor.getX(i), nor.getY(i), nor.getZ(i));
        A.uv.push(uv.getX(i), uv.getY(i));
        A.c.push(c.r, c.g, c.b);
      }
    }
    g.dispose();
  }
  function meshOf(A, name) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(A.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(A.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(A.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(A.c, 3));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, paper);
    m.name = name;
    if (A.pieces) m.userData.pieces = A.pieces;     // the outlines, so fold mechanisms can re-cut it at the crease
    return m;
  }
  look.card = (outline, colour, name, o = {}) => {
    if (typeof o === 'number') o = { thick: o };
    const thick = o.thick ?? 0.0015, margin = o.margin === true ? 0.002 : o.margin || 0;
    const A = acc(true);
    if (margin) slab(A, grow(outline, margin), 'cream', thick, -thick);
    slab(A, outline, colour, thick, 0, o.holes);
    return meshOf(A, name);
  };
  // Lying on the page: outline [x, y] -> page [x, z] (y toward the learner), resting on the paper.
  look.flat = (outline, colour, name, o = {}) => {
    const thick = typeof o === 'number' ? o : o.thick ?? 0.001;
    const m = look.card(outline, colour, name, { ...(typeof o === 'object' ? o : {}), thick });
    m.rotation.x = Math.PI / 2;
    m.position.y = thick / 2 + 0.0003 + (typeof o === 'object' ? o.level ?? 0 : 0) * 0.0012;
    return m;
  };
  look.glue = (group, name = group.name) => {
    group.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(group.matrixWorld).invert(), m = new THREE.Matrix4(), nm = new THREE.Matrix3();
    const v = new THREE.Vector3(), A = acc(), gone = [];
    const walk = (o) => {                                // hand pieces (tabs, flaps, wheels) keep moving: never glued
      for (const c of o.children) {
        if (c.userData.noGlue) continue;
        if (c.isMesh && c.material === paper && c.children.length === 0) gone.push(c);
        else walk(c);
      }
    };
    walk(group);
    if (gone.length < 2) return gone[0] || null;
    for (const o of gone) {
      m.multiplyMatrices(inv, o.matrixWorld);
      nm.getNormalMatrix(m);
      const g = o.geometry, pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv, col = g.attributes.color;
      const order = m.determinant() < 0 ? [0, 2, 1] : [0, 1, 2];
      for (let i = 0; i + 2 < pos.count; i += 3) {
        for (const k of order) {
          v.fromBufferAttribute(pos, i + k).applyMatrix4(m); A.p.push(v.x, v.y, v.z);
          v.fromBufferAttribute(nor, i + k).applyMatrix3(nm).normalize(); A.n.push(v.x, v.y, v.z);
          A.uv.push(uv.getX(i + k), uv.getY(i + k));
          A.c.push(col.getX(i + k), col.getY(i + k), col.getZ(i + k));
        }
      }
      o.removeFromParent();
      g.dispose();
    }
    const mesh = meshOf(A, name);
    group.add(mesh);
    return mesh;
  };
  // Card digits on a 7-segment grid, h tall, standing in the XY plane; .userData.width is the printed width.
  const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g', C: 'afed', E: 'afged', F: 'afge', H: 'fbgec', L: 'fed', P: 'abfge', U: 'fedcb' };
  const LINES = { a: [0, 1, 1, 1], b: [1, 1, 1, 0.5], c: [1, 0.5, 1, 0], d: [0, 0, 1, 0], e: [0, 0.5, 0, 0], f: [0, 1, 0, 0.5], g: [0, 0.5, 1, 0.5] };
  look.number = (text, colour, name, { h = 0.04, thick = 0.002 } = {}) => {
    const A = acc(true), w = h * 0.55, t = h * 0.15;
    const bar = (x0, y0, x1, y1) => {
      const len = Math.hypot(x1 - x0, y1 - y0) || 1e-6, dx = (x1 - x0) / len, dy = (y1 - y0) / len, nx = -dy * t / 2, ny = dx * t / 2;
      const ax = x0 + dx * t * 0.1, ay = y0 + dy * t * 0.1, bx = x1 - dx * t * 0.1, by = y1 - dy * t * 0.1, e = t / 2;
      slab(A, [[ax, ay], [ax + dx * e + nx, ay + dy * e + ny], [bx - dx * e + nx, by - dy * e + ny], [bx, by], [bx - dx * e - nx, by - dy * e - ny], [ax + dx * e - nx, ay + dy * e - ny]], colour, thick);
    };
    let x = t / 2;
    for (const ch of String(text).toUpperCase()) {
      if (ch === ' ') { x += w * 0.8; continue; }
      if (ch === '.' || ch === ':') {
        if (ch === ':') slab(A, shape.circle(x + t / 2, h * 0.7, t * 0.6, 12), colour, thick);
        slab(A, shape.circle(x + t / 2, ch === '.' ? t * 0.6 : h * 0.3, t * 0.6, 12), colour, thick);
        x += t * 2.2;
        continue;
      }
      if (SEG[ch]) for (const s of SEG[ch]) { const [a, b, c, d] = LINES[s]; bar(x + a * w, b * h, x + c * w, d * h); }
      else if (ch === '+') { bar(x, h * 0.5, x + w, h * 0.5); bar(x + w / 2, h * 0.22, x + w / 2, h * 0.78); }
      else if (ch === '=') { bar(x, h * 0.33, x + w, h * 0.33); bar(x, h * 0.67, x + w, h * 0.67); }
      else if (ch === '/') bar(x, 0, x + w, h);
      else if (ch === 'X') { bar(x, h * 0.15, x + w, h * 0.75); bar(x, h * 0.75, x + w, h * 0.15); }
      x += w + t * 1.6;
    }
    const m = meshOf(A, name);
    m.userData.width = x - t * 1.6;
    return m;
  };
  look.fold = (group, k) => { group.rotation.x = (-Math.PI / 2) * (1 - k); };

  // ---------------------------------------------------------------- the fold mechanisms (after the film's paper engineering)
  // The gutter is a hinge along z. With the left page lifted by aL and the right by aR (0 = flat on the desk), hinge()
  // gives the directions the mechanisms need: dL / dR run out across each page, nL / nR are the page normals, b points
  // between the pages and H.a is how far the spread is from flat (PI / 2 = shut).
  const V = () => new THREE.Vector3();
  const H = { a: 0, b: V(), x: V(), dL: V(), dR: V(), nL: V(), nR: V() };
  function hinge(aL, aR) {
    const psi = (Math.PI - aL + aR) / 2;
    H.a = Math.min((aL + aR) / 2, Math.PI / 2 - 0.004);
    const s = Math.sin(H.a), c = Math.cos(H.a);
    H.b.set(Math.cos(psi), Math.sin(psi), 0);
    H.x.set(Math.sin(psi), -Math.cos(psi), 0);
    H.dL.copy(H.x).multiplyScalar(-c).addScaledVector(H.b, s);
    H.dR.copy(H.x).multiplyScalar(c).addScaledVector(H.b, s);
    H.nL.copy(H.x).multiplyScalar(s).addScaledVector(H.b, c);
    H.nR.copy(H.x).multiplyScalar(-s).addScaledVector(H.b, c);
  }
  // A V-fold on that hinge: its glue lines leave the gutter at alpha on each page; the crease c is the one direction
  // that keeps the card square to both glue lines; uL / uR run from the crease out along each wing.
  const SV = { c: V(), uL: V(), uR: V(), gl: V() };
  function wingDir(d, out, sa, ca, point) {
    SV.gl.set(d.x * sa, d.y * sa, point * ca);
    out.copy(SV.gl).addScaledVector(SV.c, -SV.gl.dot(SV.c)).normalize();
  }
  function solveV(alpha, point) {
    const sa = Math.sin(alpha), ca = Math.cos(alpha), g = Math.atan2(sa * Math.sin(H.a), ca) + Math.PI / 2;
    SV.c.set(H.b.x * Math.sin(g), H.b.y * Math.sin(g), point * Math.cos(g));
    wingDir(H.dL, SV.uL, sa, ca, point);
    wingDir(H.dR, SV.uR, sa, ca, point);
  }
  const sZ = V(), m4 = new THREE.Matrix4();
  function seat(obj, X, Y, O) {
    sZ.crossVectors(X, Y);
    m4.makeBasis(X, Y, sZ);
    obj.quaternion.setFromRotationMatrix(m4);
    obj.position.copy(O);
  }
  // A look.card's outline, moved by its position, rotation.z and scale, into one accumulator (AR null) or split at
  // the crease into a left and a right one.
  function addCard(c, AL, AR) {
    const list = c.userData.pieces;
    if (!list) throw new Error(`paperPopUpLook: "${c.name}" is not a look.card or look.number: fold mechanisms take card pieces.`);
    const cz = Math.cos(c.rotation.z), sz = Math.sin(c.rotation.z), sx = c.scale.x, sy = c.scale.y;
    const place = (o) => o.map((q) => [c.position.x + q[0] * sx * cz - q[1] * sy * sz, c.position.y + q[0] * sx * sz + q[1] * sy * cz]);
    for (const d of list) {
      const o = place(d.outline), z = c.position.z + d.z;
      if (!AR) slab(AL, o, d.colour, d.thick, z, d.holes ? d.holes.map(place) : null);
      else { slab(AL, clipX(o, -1), d.colour, d.thick, z); slab(AR, clipX(o, 1), d.colour, d.thick, z); }
    }
    c.geometry.dispose();
  }
  const boundsX = (cards) => {
    let x0 = Infinity, x1 = -Infinity;
    for (const c of cards) for (const d of c.userData.pieces) for (const q of d.outline) { x0 = Math.min(x0, c.position.x + q[0] * c.scale.x); x1 = Math.max(x1, c.position.x + q[0] * c.scale.x); }
    return [x0, x1];
  };

  look.vFold = (sp, o = {}, cards = []) => {
    const name = o.name || 'V-fold', z = o.z ?? 0, alpha = ((o.alpha ?? 70) * Math.PI) / 180, point = o.point === 'back' ? 1 : -1;
    const group = new THREE.Group(), left = new THREE.Group(), right = new THREE.Group();
    group.name = name; left.name = `${name} left wing`; right.name = `${name} right wing`;
    group.add(left, right);
    sp.pop.add(group);
    const AL = acc(), AR = acc();
    for (const c of cards) addCard(c, AL, AR);
    if (AL.p.length) left.add(meshOf(AL, `${name} (left)`));
    if (AR.p.length) right.add(meshOf(AR, `${name} (right)`));
    const v = {
      kind: 'v', name, group, left, right, XL: V(), XR: V(), Y: V(), O: V(), nL: V(), nR: V(),
      pose() {
        solveV(alpha, point);
        v.XL.copy(SV.uL).negate(); v.XR.copy(SV.uR); v.Y.copy(SV.c); v.O.set(0, 0, z);
        v.nL.copy(H.nL); v.nR.copy(H.nR);
        seat(left, v.XL, v.Y, v.O);
        seat(right, v.XR, v.Y, v.O);
      },
    };
    sp.parts.push(v);
    sp.book.refresh();
    return v;
  };
  look.box = (sp, v, o = {}, cards = []) => {
    const name = o.name || 'Parallel fold', side = o.side ?? 1, depth = o.depth ?? 0.04, strapH = o.strap ?? 0.02;
    const group = new THREE.Group(), strap = new THREE.Group();
    group.name = name; strap.name = `${name} strap`;
    const [x0, x1] = boundsX(cards);
    const A = acc();
    for (const c of cards) addCard(c, A, null);
    group.add(meshOf(A, name));
    const S = acc(), sw = Math.min(0.02, (x1 - x0) * 0.5);
    slab(S, shape.rect((x0 + x1) / 2 - sw / 2, 0, sw, depth), 'card', 0.0012);
    strap.add(meshOf(S, `${name} strap`));
    sp.pop.add(group, strap);
    const p = {
      kind: 'box', group, out: V(), O2: V(), O3: V(), Ys: V(),
      pose() {
        const X = side < 0 ? v.XL : v.XR, n = side < 0 ? v.nL : v.nR;
        p.out.crossVectors(X, n).normalize();
        p.O2.copy(v.O).addScaledVector(p.out, depth);
        seat(group, X, v.Y, p.O2);
        p.Ys.copy(p.out).negate();
        p.O3.copy(p.O2).addScaledVector(v.Y, strapH);
        seat(strap, X, p.Ys, p.O3);
      },
    };
    sp.parts.push(p);
    sp.book.refresh();
    return p;
  };
  look.float = (sp, v, o = {}, cards = []) => {
    const name = o.name || 'Paper arm', side = o.side ?? 1, at = o.at || [side * 0.04, 0.06], gap = o.gap ?? 0.012, sway = o.sway ?? 1;
    const group = new THREE.Group();
    group.name = name;
    const A = acc();
    for (const c of cards) addCard(c, A, null);
    group.add(meshOf(A, name));
    sp.pop.add(group);
    const p = {
      kind: 'float', group, X2: V(), Y2: V(), Zc: V(), P: V(),
      pose(time, s) {
        const X = side < 0 ? v.XL : v.XR, n = side < 0 ? v.nL : v.nR;
        const lift = gap * Math.max(0, v.Y.dot(n)) + 0.0015 * Math.min(1, Math.max(0, (Math.PI / 2 - H.a) * 8));
        const dt = time - s.landed;
        const q = dt > 0 && dt < 4 ? 0.085 * sway * Math.sin(dt * 21) * Math.exp(-dt * 2.4) : 0;
        const cq = Math.cos(q), sq = Math.sin(q);
        p.X2.copy(X).multiplyScalar(cq).addScaledVector(v.Y, sq);
        p.Y2.copy(v.Y).multiplyScalar(cq).addScaledVector(X, -sq);
        p.Zc.crossVectors(X, v.Y);
        p.P.copy(v.O).addScaledVector(X, at[0]).addScaledVector(v.Y, at[1]).addScaledVector(p.X2, -at[0]).addScaledVector(p.Y2, -at[1]).addScaledVector(p.Zc, lift);
        seat(group, p.X2, p.Y2, p.P);
      },
    };
    sp.parts.push(p);
    sp.book.refresh();
    return p;
  };
  look.layer = (sp, o = {}, cards = []) => {
    const name = o.name || 'Layer', group = new THREE.Group();
    group.name = name;
    group.position.set(o.x ?? 0, 0, o.z ?? 0);
    const A = acc();
    for (const c of cards) addCard(c, A, null);
    group.add(meshOf(A, name));
    sp.pop.add(group);
    const d = Math.min(1, Math.max(0, ((o.z ?? 0) + 0.1) / 0.2));       // back layers rise first
    const p = { kind: 'layer', group, pose(time, s) { look.fold(group, lookBack(lookSeg(s.open, 0.3 + 0.4 * d, 0.6 + 0.4 * d), 1.2)); } };
    sp.parts.push(p);
    sp.book.refresh();
    return p;
  };
  look.ribbon = (sp, text, o = {}) => {
    const tag = kit.card(String(text), { color: PAL.navy });
    const size = new THREE.Box3().setFromObject(tag).getSize(new THREE.Vector3());
    const half = size.x / 2 + 0.016, h = Math.max(0.036, size.y + 0.012), tail = 0.012;
    const banner = [[-half - tail, 0], [-half - tail + 0.008, h / 2], [-half - tail, h], [half + tail, h], [half + tail - 0.008, h / 2], [half + tail, 0]];
    const top = look.card(shape.rect(-half, h - 0.0055, 2 * half, 0.0025), 'coral', 'Ribbon stripe');
    const bottom = look.card(shape.rect(-half, 0.003, 2 * half, 0.0025), 'coral', 'Ribbon stripe');
    top.position.z = bottom.position.z = 0.0013;
    const v = look.vFold(sp, { z: o.z ?? 0.075, alpha: 86, name: 'Ribbon' }, [look.card(banner, 'cream', 'Ribbon'), top, bottom]);
    tag.position.set(0, h / 2, 0.0045);                  // rides the right wing (4 degrees off flat), centred on the crease
    v.right.add(tag);
    return { group: v.group, v, tag };
  };

  // ---------------------------------------------------------------- hands: pull tab, flap, wheel
  look.pullTab = (page, o = {}) => {
    const x = o.x ?? 0.12, z = o.z ?? 0.075, L = o.length ?? 0.05, name = o.name || 'Pull tab', TH = 0.012;
    page.add(look.flat(shape.rect(x - 0.02, z - 0.0035, L + 0.04, 0.007, 0.0035), 'navy', `${name} slot`));
    const A = acc();
    slab(A, shape.rect(-0.0175, -0.015, 0.035, 0.03, 0.006), o.colour || 'coral', TH);
    for (const dx of [-0.006, 0.004]) slab(A, [[dx - 0.003, -0.007], [dx + 0.001, -0.007], [dx + 0.006, 0], [dx + 0.001, 0.007], [dx - 0.003, 0.007], [dx + 0.002, 0]], 'cream', 0.001, -TH / 2 - 0.0004);
    const grip = meshOf(A, name);
    grip.userData.noGlue = true;
    grip.rotation.x = Math.PI / 2;
    const y0 = TH / 2 + 0.0008;
    const tab = { object: grip, k: Math.min(1, Math.max(0, o.k ?? 0)), target: 0, held: false };
    tab.target = tab.k;
    grip.position.set(x + tab.k * L, y0, z);
    page.add(grip);
    const rest = grip.quaternion.clone();
    tab.set = (k) => { tab.target = Math.min(1, Math.max(0, k)); };
    tab.update = (isGrabbed, delta) => {
      tab.held = isGrabbed(grip);
      if (tab.held) {
        tab.k = Math.min(1, Math.max(0, (grip.position.x - x) / L));
        tab.target = tab.k;
        return;
      }
      const f = 1 - Math.exp(-14 * delta);                // let go: it settles back into its slot where it was pulled to
      grip.position.x += (x + tab.target * L - grip.position.x) * f;
      grip.position.y += (y0 - grip.position.y) * f;
      grip.position.z += (z - grip.position.z) * f;
      grip.quaternion.slerp(rest, f);
      tab.k = Math.min(1, Math.max(0, (grip.position.x - x) / L));
    };
    return tab;
  };
  look.flap = (page, o = {}) => {
    const x = o.x ?? 0.1, z = o.z ?? 0.06, w = o.w ?? 0.06, d = o.d ?? 0.05, name = o.name || 'Flap', angle = o.angle ?? 1.95, TH = 0.003;
    const hinge = new THREE.Group();
    hinge.name = name;
    hinge.userData.noGlue = true;
    hinge.position.set(x, 0.0012, z - d / 2);
    hinge.add(look.flat(shape.rect(-w / 2, 0, w, d, 0.004), o.colour || 'coral', `${name} lid`, { thick: TH }));
    const top = new THREE.Group();
    top.name = `${name} print`;
    top.position.y = TH;
    hinge.add(top);
    const under = new THREE.Group();
    under.name = `Under ${name}`;
    under.position.set(x, 0, z - d / 2);
    page.add(under, hinge);
    const f = { object: hinge, top, under, open: false, k: 0 };
    f.toggle = () => { f.open = !f.open; };
    f.update = (delta) => {
      const goal = f.open ? 1 : 0;
      f.k += Math.sign(goal - f.k) * Math.min(Math.abs(goal - f.k), delta / 0.45);
      hinge.rotation.x = -angle * (f.open ? lookBack(f.k, 1.4) : 1 - lookBack(1 - f.k, 1.4));
    };
    return f;
  };
  look.wheel = (page, o = {}) => {
    const x = o.x ?? -0.11, z = o.z ?? 0.05, r = o.r ?? 0.045, name = o.name || 'Wheel';
    const list = o.sectors || [{ colour: 'yellow', name: 'One' }, { colour: 'sage', name: 'Two' }, { colour: 'pink', name: 'Three' }, { colour: 'sky', name: 'Four' }];
    const n = list.length, step = TAU / n;
    const g = new THREE.Group();
    g.name = name;
    g.userData.noGlue = true;
    g.position.set(x, 0, z);
    page.add(g);
    const disc = new THREE.Group();
    disc.name = `${name} disc`;
    g.add(disc);
    const sectors = list.map((s, i) => {
      const sg = new THREE.Group();
      sg.name = s.name;
      sg.rotation.y = i * step;
      sg.add(look.flat(shape.arc(0, 0, 0, r, Math.PI / 2 - step / 2 + 0.01, Math.PI / 2 + step / 2 - 0.01), s.colour, s.name));
      disc.add(sg);
      return sg;
    });
    // The cover: a disc with a window at the front (toward the learner), riveted at the centre.
    const A = acc(), win = shape.arc(0, 0, r * 0.3, r * 0.94, Math.PI / 2 - step * 0.42, Math.PI / 2 + step * 0.42);
    slab(A, shape.circle(0, 0, r * 1.12, 36), o.colour || 'navy', 0.002, 0, [win]);
    slab(A, shape.circle(0, 0, 0.006, 12), 'yellow', 0.001, -0.0015);
    const cover = meshOf(A, `${name} cover`);
    cover.rotation.x = Math.PI / 2;
    cover.position.y = 0.0045;
    g.add(cover);
    const w = { object: cover, disc, index: 0, count: 0, from: 0, to: 0, p: 1 };
    w.sector = (i) => sectors[i];
    w.set = (i) => { w.from = disc.rotation.y; w.count = i; w.to = -i * step; w.p = 0; w.index = ((i % n) + n) % n; };
    w.next = () => w.set(w.count + 1);
    w.update = (delta) => {
      if (w.p >= 1) return;
      w.p = Math.min(1, w.p + delta / 0.6);
      disc.rotation.y = w.from + (w.to - w.from) * lookBack(w.p, 1.3);
    };
    return w;
  };

  // ---------------------------------------------------------------- the book
  let lastBook = null;
  look.set = ({ spreads = 3, width = 0.4, depth = 0.26 } = {}) => {
    const n = Math.max(1, Math.round(spreads)), PW = width / 2 - 0.012, PD = depth - 0.012;
    const BOARD = 0.008, BLOCK = 0.005, LT = 0.0012, TURN = 0.9, T = BOARD + BLOCK;
    const book = new THREE.Group();
    book.name = 'Pop-up book';
    const cloth = kit.material('fabric', { color: '#1f4a4b' });
    for (const side of [-1, 1]) {
      const b = new THREE.Mesh(kit.roundedBox(width / 2, BOARD, depth, 0.003), cloth);
      b.name = 'Book board';
      b.position.set((side * width) / 4, BOARD / 2, 0);
      book.add(b);
    }
    const blocks = new THREE.Group();
    blocks.name = 'Pages';
    for (const side of [-1, 1]) {
      const blk = look.flat(shape.rect(side < 0 ? -PW - 0.002 : 0.002, -PD / 2, PW, PD), 'cream', 'Pages', { thick: BLOCK });
      blk.position.y = BOARD + BLOCK / 2;
      blocks.add(blk);
    }
    book.add(blocks);
    look.glue(blocks, 'Pages');
    // Loose leaves turn about the gutter. Leaf j carries the right page of spread j - 1 on its front and the left page
    // of spread j on its back, so turning one leaf shuts a spread and opens the next in the same movement.
    const leaves = [];
    for (let j = 1; j < n; j++) {
      const pivot = new THREE.Group();
      pivot.name = `Leaf ${j}`;
      const sheet = look.flat(shape.rect(0.002, -PD / 2, PW, PD), 'cream', `Leaf ${j}`, { thick: LT });
      sheet.position.y = 0;
      const front = new THREE.Group(), back = new THREE.Group();
      front.position.y = LT / 2;
      back.position.y = -LT / 2;
      back.rotation.z = Math.PI;
      pivot.add(sheet, front, back);
      book.add(pivot);
      leaves.push({ pivot, front, back, phi: 0, side: 0, dir: 0, t0: 0, landed: -9 });
    }
    const fixedL = new THREE.Group(), fixedR = new THREE.Group();
    fixedL.position.y = fixedR.position.y = T;
    book.add(fixedL, fixedR);
    const sp = [];
    for (let s = 0; s < n; s++) {
      const pop = new THREE.Group();
      pop.name = `Spread ${s + 1}`;
      pop.position.y = Math.max(s === 0 ? T : T + s * LT, s === n - 1 ? T : T + (n - 1 - s) * LT);
      book.add(pop);
      const left = s === 0 ? fixedL : leaves[s - 1].back, right = s === n - 1 ? fixedR : leaves[s].front;
      left.name = `Spread ${s + 1} left page`;
      right.name = `Spread ${s + 1} right page`;
      sp.push({ index: s, left, right, pop, parts: [], aL: 0, aR: 0, open: 0, landed: s === 0 ? 0 : -9, book });
    }
    // The corner tabs that turn the page: thick card sticking out of the front edge, pressed with a finger.
    const corner = (side) => {
      const A = acc();
      slab(A, shape.rect(-0.024, -0.017, 0.048, 0.034, 0.008), 'coral', 0.008);
      slab(A, shape.arrow(-side * 0.011, 0, side * 0.013, 0, 0.006), 'cream', 0.001, -0.0045);
      const m = meshOf(A, side > 0 ? 'Next page' : 'Page back');
      m.rotation.x = Math.PI / 2;
      m.position.set(side * (PW - 0.035), BOARD + BLOCK / 2, depth / 2 + 0.01);
      book.add(m);
      return m;
    };
    let pos = 0, target = 0, moving = null, clock = 0;
    const flip = (u) => Math.PI * u * u * (2.2 - 1.2 * u);   // lifted slowly, swings over, lands with some speed left
    function pose(time) {
      leaves.forEach((L, i) => {
        L.pivot.rotation.z = L.phi;
        L.pivot.position.y = (L.phi < Math.PI / 2 ? T + (n - 2 - i) * LT : T + i * LT) + LT / 2;
      });
      for (const s of sp) {
        s.aL = s.index === 0 ? 0 : Math.PI - leaves[s.index - 1].phi;
        s.aR = s.index === n - 1 ? 0 : leaves[s.index].phi;
        const vis = s.aL + s.aR < Math.PI - 0.02;
        s.pop.visible = s.left.visible = s.right.visible = vis;
        hinge(s.aL, s.aR);
        s.open = vis ? 1 - H.a / (Math.PI / 2) : 0;
        for (const p of s.parts) p.pose(time, s);
      }
    }
    book.spreads = sp;
    book.next = corner(1);
    book.back = corner(-1);
    book.page = 0;
    book.turning = false;
    book.turnTo = (i) => { target = Math.max(0, Math.min(n - 1, Math.round(i))); };
    book.open = (i) => (sp[i] ? sp[i].open : 0);
    book.refresh = () => pose(clock);
    book.update = (time, delta) => {
      clock = time;
      if (moving && (time - moving.t0) / TURN >= 1) {
        moving.side = moving.dir > 0 ? 1 : 0;
        moving.landed = time;
        pos += moving.dir;
        sp[pos].landed = time;
        moving = null;
      }
      if (!moving && target !== pos) {
        moving = leaves[target > pos ? pos : pos - 1];
        moving.dir = target > pos ? 1 : -1;
        moving.t0 = time;
      }
      for (const L of leaves) {
        if (L === moving) {
          const u = Math.min(1, Math.max(0, (time - L.t0) / TURN));
          L.phi = L.dir > 0 ? flip(u) : Math.PI - flip(u);
        } else {
          const v = time - L.landed, bump = v >= 0 && v < 1.5 ? 0.034 * Math.abs(Math.sin(v * 11)) * Math.exp(-v * 6) : 0;
          L.phi = L.side ? Math.PI - bump : bump;
        }
      }
      book.page = pos;
      book.turning = moving !== null;
      pose(time);
    };
    pose(0);
    book.userData.top = T;
    book.userData.width = width;
    book.userData.depth = depth;
    book.userData.page = [PW, PD];
    lastBook = book;
    return book;
  };

  // A working sample on the first spread of the last book made: hills and a flower that rise from the gutter, a bee
  // on a paper arm, the spread's words on a ribbon and a pull tab. Replace it with the lesson's spreads.
  look.demo = () => {
    const book = lastBook || look.set();
    const sp = book.spreads[0];
    const S = shape;
    const sun = look.card(S.circle(0.07, 0.085, 0.022), 'yellow', 'Sun');
    sun.position.z = -0.0016;
    const near = look.card(S.ridge(-0.16, 0.16, (x) => 0.035 + 0.01 * Math.cos(x * 30 - 1)), 'leaf', 'Near hills');
    near.position.z = 0.0016;
    look.vFold(sp, { z: -0.06, alpha: 78, name: 'Hills' }, [look.card(S.ridge(-0.16, 0.16, (x) => 0.07 + 0.018 * Math.cos(x * 18 + 0.6)), 'sage', 'Far hills'), sun, near]);
    const petals = [];
    for (let i = 0; i < 7; i++) petals.push(look.card(S.leaf(0, 0.075, 0.03, (i / 7) * TAU, 0.3), 'coral', 'Petal'));
    const flower = look.vFold(sp, { z: 0.01, alpha: 60, name: 'Flower' }, [
      look.card(S.rect(-0.003, 0, 0.006, 0.075), 'deep', 'Stem'),
      look.card(S.leaf(0, 0.02, 0.035, 0.5), 'leaf', 'Leaf'), look.card(S.leaf(0, 0.03, 0.03, 2.6), 'sage', 'Leaf'),
      ...petals, look.card(S.circle(0, 0.075, 0.012), 'yellow', 'Heart'),
    ]);
    const bee = [look.card(S.ellipse(0.045, 0.1, 0.014, 0.01), 'yellow', 'Bee'), look.card(S.ellipse(0.04, 0.112, 0.008, 0.005, 0.6), 'sky', 'Wing')];
    look.float(sp, flower, { side: 1, at: [0.03, 0.09], gap: 0.012 }, bee);
    look.ribbon(sp, 'A flower opens');
    const tab = look.pullTab(sp.right, { x: 0.13, z: 0.06, length: 0.04 });
    return [{ object: tab.object, grab: true }, { object: flower.group, press: true }];
  };
  return look;
}
