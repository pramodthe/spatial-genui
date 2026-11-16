// Ink and toon look for an XR lesson: real 3D that reads as a hand-inked animation cel - flat colour in two tones, an
// ink line round every shape, halftone dots where light turns to shadow, hatching in cast shadows, effects drawn in
// (speed lines, impact ticks, steam), a big lettered word per step, all printed on warm paper. Needs look-kit.js
// (lookShade, lookOutline, lookBack, lookHash3). new-lesson.mjs pastes it in.
//
// inkToonLook(THREE, kit) returns:
//   PAL, INK                    the print: paper, one ink and spot colours { name: { lit, shade, deep?, gloss? } }
//   mat(colour, { halftone, flat, own })   one cel material per colour and kind, made once; own: a fresh one (to glow alone)
//   ink(geometry, colour, name, { halftone, outline, line, own })   any geometry inked: two tones and an ink line
//   turned(profile, colour, name, o)       [[radius, y], ...] bottom to top, corners softened, spun round y (cups, kettles)
//   box(w, h, d, colour, name, o)  ball(r, colour, name, o)  rod(r, len, colour, name, o)  (centred; rod along y)
//   tube(points, r, colour, name, o)       a bent tube through [[x, y, z], ...] (handles, hoses, spouts, stems)
//   cutout(outline, thick, colour, name, o)  a flat shape [[x, y], ...] standing in XY; o.flat lays it on the paper
//   crease(parent, r, y, from, to)         a thin inner ink line part way round a turned shape (degrees, 90 = front)
//   shadow(rx, rz, name)                   a hatched cast shadow lying on the paper; set its x and z
//   mark(strokes, colour, o)               brush marks in the XY plane: [[[x, y], ...], width, taper], ...
//   speedLines(len, o)  impact(n, r, len, o)  steam(h, o)  motionArc(r, from, to, o)   effects drawn in
//   arrow(len, colour, name, o)  stretch(arrow, len)   a solid inked arrow along +y from its base; stretch resizes it
//   letters(text, o)                       comic lettering (A-Z 0-9 ! ? - + = . , : / %) as one flat mesh in XY
//   stepWord(text, o)                      the step's big word lettered on a paper card that stands on the sheet
//   flip(group, n)  squash(object, s, base)  glow(object, v)  pop(x, d)  wobble(x, f, k)   for update(); no allocation
//   set({ width, depth })                  the warm paper sheet with a ruled ink border; never grabbable; .userData.top
//   demo(subject)                          a working sample (replace it)
function inkToonLook(THREE, kit) {
  const INK = '#1c1622';
  // Paper, one ink and a few spot colours. Every colour has a hand-picked shadow partner shifted in hue toward cool
  // teal, not just darker: that pair is what makes flat shading look drawn. Pick 4 or 5 per lesson.
  const PAL = {
    paper: { lit: '#f7ecd6', shade: '#e6d6b8' },                       // the sheet
    white: { lit: '#fffdf6', shade: '#c9dcd4' },                       // paper things: cards, filters, a paper plane
    cream: { lit: '#f7e8cc', shade: '#b3c9bd' },                       // ceramics, bread, skin of a cartoon hand
    teal: { lit: '#2a9d94', shade: '#1c7376', deep: '#12565c' },
    persimmon: { lit: '#ee5a36', shade: '#ae2f33', gloss: '#ffd2bd' }, // the hero colour
    mustard: { lit: '#f6b63c', shade: '#c9722c', gloss: '#fff1c4' },
    navy: { lit: '#3b4568', shade: '#222641', gloss: '#b4c0e6' },      // metal parts, tools
    charcoal: { lit: '#4a4552', shade: '#2a2630', gloss: '#a9a3b6' },  // rubber, tyres, cast iron, handles
    leaf: { lit: '#7fae4a', shade: '#3f7a5c' },                         // plants
    bean: { lit: '#6a3d27', shade: '#3c221b' },                         // coffee, soil, wood, chocolate
    water: { lit: '#effbf6', shade: '#9fd8cf' },                        // water and glass: never transparent
    ink: { lit: INK, shade: INK },                                      // inner lines, spokes, needles, marks
  };
  const mats = {};
  const look = { name: 'ink-toon', PAL, INK };
  const noHit = () => {};

  look.mat = (colour, o = {}) => {
    if (typeof o === 'boolean') o = { halftone: o };
    const c = PAL[colour];
    if (!c) throw new Error(`inkToonLook: no colour "${colour}". Colours: ${Object.keys(PAL).join(', ')}`);
    const kind = o.flat ? 'flat' : o.halftone ? 'halftone' : 'cel';
    const key = `${colour}:${kind}`;
    if (!o.own && mats[key]) return mats[key];
    let m;
    if (kind === 'flat') {
      m = lookShade(THREE, { mode: 'cel', lit: c.lit, shade: c.lit });
      m.side = THREE.DoubleSide;
    } else {
      m = lookShade(THREE, { mode: kind, lit: c.lit, shade: c.shade, deep: kind === 'halftone' ? c.deep || c.shade : undefined, gloss: c.gloss, scale: 0.0045 });
    }
    if (!o.own) mats[key] = m;
    return m;
  };
  // An inked object: flat two-tone colour and an ink line round it. outline: false for small or many parts (each
  // outline is one more draw call); line is its width in metres (0.002 default, 0.0015 for small props).
  look.ink = (geometry, colour, name, o = {}) => {
    const mesh = new THREE.Mesh(geometry, look.mat(colour, o));
    mesh.name = name;
    if (o.outline !== false) lookOutline(THREE, mesh, { width: o.line ?? 0.002, color: INK });
    return mesh;
  };

  // ---------------------------------------------------------------- shapes
  const soften = (pts, n) => {
    for (; n > 0; n--) {
      const q = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      q.push(pts[pts.length - 1]);
      pts = q;
    }
    return pts;
  };
  // Draw the profile from the axis at the bottom, out, up the outside, over the lip and down the inside, so it closes.
  look.turned = (profile, colour, name, o = {}) => look.ink(kit.lathe(soften(profile, o.soft ?? 2), o.segments ?? 40), colour, name, o);
  look.box = (w, h, d, colour, name, o = {}) => look.ink(kit.roundedBox(w, h, d, o.radius ?? Math.min(w, h, d) * 0.25, 2), colour, name, o);
  look.ball = (r, colour, name, o = {}) => look.ink(new THREE.SphereGeometry(r, 24, 16), colour, name, o);
  look.rod = (r, len, colour, name, o = {}) => look.ink(new THREE.CylinderGeometry(r, r, len, o.sides ?? 16), colour, name, o);
  look.tube = (points, r, colour, name, o = {}) => look.ink(kit.tube(points, r, { sides: o.sides ?? 10, closed: o.closed, detail: o.detail ?? 6 }), colour, name, o);
  look.cutout = (outline, thick, colour, name, o = {}) => {
    const g = kit.extrude(outline, thick, { bevel: o.bevel ?? (thick >= 0.004 ? 0.001 : 0) });
    if (o.flat) { g.rotateX(-Math.PI / 2); g.translate(0, thick / 2, 0); }   // outline y -> away from the learner (-z)
    return look.ink(g, colour, name, o);
  };
  // An inner line round a turned shape at height y, drawn only part of the way (degrees, 0 = +x, 90 = toward the
  // learner) so it breaks off on the lit side. Thinner than the outline on purpose.
  look.crease = (parent, r, y, from = -70, to = 105, w = 0.0008) => {
    const pts = [];
    for (let i = 0; i <= 20; i++) { const a = ((from + ((to - from) * i) / 20) * Math.PI) / 180; pts.push([Math.cos(a) * r, y, Math.sin(a) * r]); }
    const m = new THREE.Mesh(kit.tube(pts, w, { sides: 5, detail: 2 }), look.mat('ink'));
    m.name = 'Crease';
    m.raycast = noHit;
    parent.add(m);
    return m;
  };
  // A cast shadow on the paper, hatched in ink. The key light is upper left in front, so put it to the right of and
  // behind the thing that casts it (x + 0.3 x its height, z - 0.2 x its height).
  const shadowMat = lookShade(THREE, { mode: 'hatch', lit: PAL.paper.shade, ink: INK, band: 0.95, scale: 0.0035 });
  look.shadow = (rx, rz, name = 'Shadow') => {
    const g = new THREE.CircleGeometry(1, 36);
    g.rotateX(-Math.PI / 2);
    g.scale(rx, 1, rz);
    const m = new THREE.Mesh(g, shadowMat);
    m.name = name;
    m.position.y = 0.0008;
    m.raycast = noHit;
    return m;
  };

  // ---------------------------------------------------------------- marks: brush strokes as flat geometry
  // strokes: [[points [[x, y], ...], width, taper], ...] in the XY plane; taper 'both' | 'head' (thick at the first
  // point) | 'tail' (thick at the last) | 'none'. grow widens every stroke (for the ink edge under a coloured mark).
  const strokeGeometry = (list, grow = 0) => {
    const pos = [], idx = [];
    for (const [input, w, taper = 'both'] of list) {
      let pts = input;
      while (pts.length < 5) pts = pts.flatMap((p, i) => (i ? [[(p[0] + pts[i - 1][0]) / 2, (p[1] + pts[i - 1][1]) / 2], p] : [p]));
      const n = pts.length, base = pos.length / 3;
      for (let i = 0; i < n; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, u = i / (n - 1);
        const k = taper === 'both' ? Math.pow(Math.sin(Math.PI * u), 0.5) : taper === 'head' ? Math.pow(1 - u, 0.6) : taper === 'tail' ? Math.pow(u, 0.6) : 1;
        const hw = (w * k + grow * Math.min(1, k * 3)) / 2;
        pos.push(pts[i][0] - (dy / l) * hw, pts[i][1] + (dx / l) * hw, 0, pts[i][0] + (dy / l) * hw, pts[i][1] - (dx / l) * hw, 0);
        if (i < n - 1) idx.push(base + 2 * i, base + 2 * i + 1, base + 2 * i + 2, base + 2 * i + 1, base + 2 * i + 3, base + 2 * i + 2);
      }
    }
    return flatGeometry(pos, idx);
  };
  const flatGeometry = (pos, idx) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));
    g.setIndex(idx);
    return g;
  };
  const flatMesh = (geometry, colour) => {
    const m = new THREE.Mesh(geometry, look.mat(colour, { flat: true }));
    m.raycast = noHit;
    return m;
  };
  // An ink mark, or (with a spot colour) a coloured mark with an ink edge. Faces +z; marks never catch a pinch.
  look.mark = (list, colour = 'ink', o = {}) => {
    const g = new THREE.Group();
    g.name = o.name ?? 'Mark';
    if (colour === 'ink') { g.add(flatMesh(strokeGeometry(list), 'ink')); return g; }
    g.add(flatMesh(strokeGeometry(list, (o.edge ?? 0.0012) * 2), 'ink'));
    const top = flatMesh(strokeGeometry(list), colour);
    top.position.z = 0.0005;
    g.add(top);
    return g;
  };
  // Speed lines: n tapered ink lines along +x from x = 0 (thick at the part, thin away from it). Turn the group so +x
  // points back along the path the part came from (a part moving down: rotation.z = Math.PI / 2, lines above it).
  look.speedLines = (len, o = {}) => {
    const n = o.n ?? 3, gap = o.gap ?? len * 0.3, w = o.width ?? Math.max(0.0012, len * 0.06), list = [];
    for (let i = 0; i < n; i++) {
      const y = (i - (n - 1) / 2) * gap, x0 = len * 0.08 * (i % 2);
      list.push([[[x0, y], [x0 + len * [1, 0.72, 0.86][i % 3], y]], w, 'head']);
    }
    return look.mark(list, 'ink', { name: o.name ?? 'Speed lines' });
  };
  // Impact ticks: n short radial ink strokes round an ellipse (rx = r, ry = o.ry), from angle o.from to o.to (radians,
  // default all round; 0 to Math.PI is the upper half for a hit on the table). Show it for two drawings, then hide it.
  look.impact = (n, r, len, o = {}) => {
    const ry = o.ry ?? r, from = o.from ?? 0, to = o.to ?? Math.PI * 2, w = o.width ?? len * 0.3, seed = o.seed ?? 1, list = [];
    const whole = Math.abs(to - from) > 6.2;
    for (let i = 0; i < n; i++) {
      const j = lookHash3(i, seed, 3) - 0.5;
      const a = from + (to - from) * (whole ? (i + 0.5 + j * 0.5) / n : n === 1 ? 0.5 : (i + 0.5 + j * 0.4) / n);
      const l = len * (0.6 + 0.65 * lookHash3(i, seed, 7)), c = Math.cos(a), s = Math.sin(a);
      list.push([[[c * r, s * ry], [c * (r + l * 0.5), s * (ry + l * 0.5)], [c * (r + l), s * (ry + l)]], w, 'head']);
    }
    return look.mark(list, 'ink', { name: o.name ?? 'Impact' });
  };
  // Steam: three drawings of o.n wisps rising h from y = 0, white with an ink edge. Cycle them on twos in update with
  // look.flip(steam, Math.floor(drawing / 3)): hand-drawn steam boils, it never slides.
  look.steam = (h, o = {}) => {
    const n = o.n ?? 2, amp = o.width ?? h * 0.12, sw = o.line ?? h * 0.1, g = new THREE.Group();
    g.name = o.name ?? 'Steam';
    for (let k = 0; k < 3; k++) {
      const list = [];
      for (let i = 0; i < n; i++) {
        const pts = [], ph = k * 2.1 + i * 1.7, x0 = (i - (n - 1) / 2) * amp * 2.6;
        for (let s = 0; s <= 21; s++) { const u = s / 21; pts.push([x0 + Math.sin(u * 6.6 + ph) * amp * (0.35 + u), u * h * (1 - 0.15 * i)]); }
        list.push([pts, sw]);
      }
      g.add(look.mark(list, o.colour ?? 'white', { name: `${g.name} ${k + 1}`, edge: 0.001 }));
    }
    look.flip(g, 0);
    return g;
  };
  // A motion arc: a curved arrow round the origin in the XY plane, radius r, from angle `from` to `to` (radians), head
  // at `to`. Use it for a turn, a tilt, a swing or a throw path. Lay it flat (rotation.x = -Math.PI / 2) for a stir.
  look.motionArc = (r, from, to, o = {}) => {
    const w = o.width ?? r * 0.12, head = o.head ?? w * 3.2, dir = Math.sign(to - from) || 1, pts = [];
    for (let i = 0; i <= 28; i++) { const a = from + ((to - from) * i) / 28; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
    const tx = -Math.sin(to) * dir, ty = Math.cos(to) * dir, ex = Math.cos(to) * r, ey = Math.sin(to) * r;
    return look.mark([[pts, w, 'tail'], [[[ex - tx * w * 0.3, ey - ty * w * 0.3], [ex + tx * head, ey + ty * head]], head * 0.9, 'head']], o.colour ?? 'mustard', { name: o.name ?? 'Motion arc' });
  };
  // A solid inked arrow, len long along +y from y = 0 (a force, a push, a flow). Point it with rotation; resize it in
  // update with look.stretch(arrow, newLen), which keeps the head's size and allocates nothing.
  look.arrow = (len, colour = 'persimmon', name = 'Arrow', o = {}) => {
    const w = o.width ?? 0.008, thick = o.thick ?? 0.004, headLen = w * 2.2, headW = w * 2.6;
    const built = Math.max(0.002, len - headLen);
    const g = new THREE.Group();
    g.name = name;
    const sg = kit.roundedBox(w, built, thick, Math.min(w, thick) * 0.3, 2);
    sg.translate(0, built / 2, 0);
    const shaft = look.ink(sg, colour, `${name} shaft`, { line: 0.0015 });
    const head = look.cutout([[-headW / 2, 0], [headW / 2, 0], [0, headLen]], thick, colour, `${name} head`, { line: 0.0015 });
    head.position.y = built - 0.0005;
    g.add(shaft, head);
    g.userData = { shaft, head, built, headLen, len };
    return g;
  };
  look.stretch = (arrow, len) => {
    const d = arrow.userData, s = Math.max(0.001, len - d.headLen);
    d.shaft.scale.y = s / d.built;
    d.head.position.y = s - 0.0005;
    d.len = len;
  };

  // ---------------------------------------------------------------- lettering
  // Comic block capitals as centre-lines on a grid 4 wide and 6 high (y up); '|' starts a new stroke.
  const FONT = {
    A: '0,0 0,4 2,6 4,4 4,0|0,2.6 4,2.6', B: '0,0 0,6 3,6 4,5 4,4 3,3 0,3|3,3 4,2 4,1 3,0 0,0', C: '4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1',
    D: '0,0 0,6 2.5,6 4,4.5 4,1.5 2.5,0 0,0', E: '4,6 0,6 0,0 4,0|0,3 3,3', F: '4,6 0,6 0,0|0,3 3,3',
    G: '4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,3 2,3', H: '0,0 0,6|4,0 4,6|0,3 4,3', I: '0,6 2,6|1,6 1,0|0,0 2,0',
    J: '4,6 4,1 3,0 1,0 0,1', K: '0,0 0,6|4,6 0,2|1.4,3.4 4,0', L: '0,6 0,0 4,0', M: '0,0 0,6 2,3 4,6 4,0',
    N: '0,0 0,6 4,0 4,6', O: '1,0 0,1 0,5 1,6 3,6 4,5 4,1 3,0 1,0', P: '0,0 0,6 3,6 4,5 4,4 3,3 0,3',
    Q: '1,0 0,1 0,5 1,6 3,6 4,5 4,1 3,0 1,0|2.6,1.4 4,-0.4', R: '0,0 0,6 3,6 4,5 4,4 3,3 0,3|2,3 4,0',
    S: '4,5 3,6 1,6 0,5 0,4 1,3 3,3 4,2 4,1 3,0 1,0 0,1', T: '0,6 4,6|2,6 2,0', U: '0,6 0,1 1,0 3,0 4,1 4,6',
    V: '0,6 2,0 4,6', W: '0,6 1,0 2,4 3,0 4,6', X: '0,0 4,6|0,6 4,0', Y: '0,6 2,3 4,6|2,3 2,0', Z: '0,6 4,6 0,0 4,0',
    0: '1,0 0,1 0,5 1,6 3,6 4,5 4,1 3,0 1,0|1,1.2 3,4.8', 1: '0.5,5 1.5,6 1.5,0|0.5,0 2.5,0', 2: '0,5 1,6 3,6 4,5 4,4 0,0 4,0',
    3: '0,5 1,6 3,6 4,5 4,4 3,3 1.5,3|3,3 4,2 4,1 3,0 1,0 0,1', 4: '3,0 3,6 0,2 4,2', 5: '4,6 0.5,6 0,3 3,3 4,2 4,1 3,0 0,0',
    6: '4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,2 3,3 0,3', 7: '0,6 4,6 1.5,0', 8: '1,3 0,4 0,5 1,6 3,6 4,5 4,4 3,3 1,3 0,2 0,1 1,0 3,0 4,1 4,2 3,3',
    9: '4,3 1,3 0,4 0,5 1,6 3,6 4,5 4,1 3,0 1,0 0,1', '!': '0,6 0,2|0,0.2 0,0', '?': '0,5 1,6 3,6 4,5 4,4 2,3 2,2|2,0.2 2,0',
    '-': '0.5,3 3.5,3', '+': '0.5,3 3.5,3|2,1.5 2,4.5', '=': '0.5,2 3.5,2|0.5,4 3.5,4', '.': '0,0.2 0,0', ',': '0.6,0.6 0,-1',
    ':': '0,4.2 0,4|0,0.2 0,0', '/': '0,0 4,6', '%': '0,6 0.8,6 0.8,5 0,5 0,6|4,6 0,0|3.2,1 4,1 4,0 3.2,0 3.2,1', ' ': '',
  };
  const glyphs = {};
  const glyph = (ch) => {
    if (!glyphs[ch]) {
      const lines = (FONT[ch] ?? '').split('|').filter(Boolean).map((s) => s.trim().split(/\s+/).map((p) => p.split(',').map(Number)));
      glyphs[ch] = { lines, w: FONT[ch] === undefined || ch === ' ' ? 2 : Math.max(0, ...lines.flat().map((p) => p[0])) };
    }
    return glyphs[ch];
  };
  // Round-ended ribbons of half-width hw along the centre-lines, offset by (ox, oy), at depth z.
  const ribbons = (lines, hw, ox, oy, z, pos, idx) => {
    for (const pts of lines) {
      for (let i = 0; i < pts.length; i++) {
        const x = pts[i][0] + ox, y = pts[i][1] + oy, c = pos.length / 3;
        pos.push(x, y, z);
        for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; pos.push(x + Math.cos(a) * hw, y + Math.sin(a) * hw, z); }
        for (let k = 0; k < 10; k++) idx.push(c, c + 1 + k, c + 1 + ((k + 1) % 10));
        if (i > 0) {
          const px = pts[i - 1][0] + ox, py = pts[i - 1][1] + oy, l = Math.hypot(x - px, y - py) || 1, nx = (-(y - py) / l) * hw, ny = ((x - px) / l) * hw, b = pos.length / 3;
          pos.push(px + nx, py + ny, z, px - nx, py - ny, z, x + nx, y + ny, z, x - nx, y - ny, z);
          idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
        }
      }
    }
  };
  // Lettering like a comic sound effect: slanted capitals, a face colour, a heavy ink edge and a solid colour block
  // dropped behind (block: null for plain inked letters). One mesh in the XY plane facing +z: left edge x = 0,
  // baseline y = 0, h = capital height. .userData.width. Build each word or number once; show the one you need.
  look.letters = (text, o = {}) => {
    const h = o.h ?? 0.028, u = h / 6, SK = 0.13, lines = [];
    let x = 0;
    for (const ch of String(text).toUpperCase()) {
      const gl = glyph(ch);
      for (const l of gl.lines) lines.push(l.map(([gx, gy]) => [(x + gx + SK * gy) * u, gy * u]));
      x += gl.w + 2;
    }
    const hw = 0.62 * u, edge = 0.42 * u, bx = 0.55 * u, by = -0.75 * u, dz = 0.0004, block = o.block === undefined ? 'persimmon' : o.block;
    const pos = [], idx = [], groups = [];
    let a = 0;
    for (const k of block ? [0, 1 / 3, 2 / 3, 1] : [0]) ribbons(lines, hw + edge, bx * k, by * k, 0, pos, idx);
    if (block) ribbons(lines, hw + edge, 0, 0, 2 * dz, pos, idx);
    groups.push([a, idx.length - a, 0]);
    a = idx.length;
    if (block) { for (const k of [1 / 3, 2 / 3, 1]) ribbons(lines, hw, bx * k, by * k, dz, pos, idx); groups.push([a, idx.length - a, 1]); a = idx.length; }
    ribbons(lines, hw, 0, 0, 3 * dz, pos, idx);
    groups.push([a, idx.length - a, 2]);
    const g = flatGeometry(pos, idx);
    for (const [start, count, m] of groups) g.addGroup(start, count, m);
    const mesh = new THREE.Mesh(g, [look.mat('ink', { flat: true }), look.mat(block || 'ink', { flat: true }), look.mat(o.face ?? 'mustard', { flat: true })]);
    mesh.name = o.name ?? `Letters ${text}`;
    mesh.userData.width = Math.max(0, x - 2) * u + SK * h + hw + edge;
    return mesh;
  };
  // The step's word, lettered big on a white paper card that stands on the sheet leaning back (bottom centre at the
  // origin, facing +z). o: h (capital height, 0.028), face, block, card colours, n (a step number in a starburst).
  // .userData.width / .height. Put it low at the front, beside the hero, never in front of it.
  look.stepWord = (text, o = {}) => {
    const h = o.h ?? 0.028, word = look.letters(text, { h, face: o.face, block: o.block, name: `${text} lettering` });
    const W = word.userData.width + h * 1.1, H = h * 2.1, T = 0.003;
    const g = new THREE.Group();
    g.name = o.name ?? `Step word ${text}`;
    const lean = new THREE.Group();
    lean.rotation.x = -0.28;
    const card = look.box(W, H, T, o.card ?? 'white', `${g.name} card`, { radius: 0.001, line: 0.0015 });
    card.position.y = H / 2;
    word.position.set(-word.userData.width / 2 + h * 0.05, H / 2 - h * 0.38, T / 2 + 0.0004);
    lean.add(card, word);
    if (o.n !== undefined) {
      const R = H * 0.34, star = [];
      for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, r = i % 2 ? R * 0.72 : R; star.push([Math.cos(a) * r, Math.sin(a) * r]); }
      const badge = look.cutout(star, 0.002, o.badge ?? 'teal', `${g.name} badge`, { line: 0.0012 });
      const num = look.letters(String(o.n), { h: R * 0.9, face: 'white', block: null });
      num.position.set(-num.userData.width / 2, -R * 0.45, 0.0015);
      badge.add(num);
      badge.position.set(-W / 2 + R * 0.35, H - R * 0.25, T / 2 + 0.002);
      badge.rotation.z = 0.2;
      lean.add(badge);
    }
    const strut = look.box(0.006, H * 0.7, T, o.card ?? 'white', `${g.name} stand`, { outline: false });
    strut.position.set(0, H * 0.3, -H * 0.24);
    strut.rotation.x = 0.55;
    g.add(lean, strut);
    g.userData.width = W;
    g.userData.height = H;
    return g;
  };

  // ---------------------------------------------------------------- motion helpers (allocate nothing)
  // Show child n of a group of drawings (steam, splashes, a wobbling mark), cycling.
  look.flip = (group, n) => {
    const c = group.children, k = ((n % c.length) + c.length) % c.length;
    for (let i = 0; i < c.length; i++) c[i].visible = i === k;
  };
  // Squash (s < 1) or stretch (s > 1) keeping the volume: the toon hit. Put the object's origin where it touches.
  look.squash = (object, s, base = 1) => object.scale.set(base / Math.sqrt(s), base * s, base / Math.sqrt(s));
  let glowValue = 0;
  const glowOne = (o) => { if (o.material && o.material.uniforms && o.material.uniforms.uGlow) o.material.uniforms.uGlow.value = glowValue; };
  // Brighten an object's look materials (0..1). Materials are shared per colour: build a part with { own: true } to
  // light it alone.
  look.glow = (object, v) => { glowValue = v; object.traverse(glowOne); };
  // A pose that lands with an overshoot: 0 before x = 0, then up past 1 and back, d seconds long. Feed it on-twos time.
  look.pop = (x, d = 0.25) => (x < 0 ? 0 : lookBack(Math.min(1, x / d), 2.2));
  // The settle after a hit: a decaying shake, 0 before x = 0.
  look.wobble = (x, f = 3.4, k = 9) => (x <= 0 ? 0 : Math.exp(-k * x) * Math.sin(x * 2 * Math.PI * f));

  // ---------------------------------------------------------------- the set
  // A sheet of warm paper as the table, inked round its edge, with a ruled ink border printed just inside it.
  look.set = ({ width = 0.42, depth = 0.3 } = {}) => {
    const set = new THREE.Group();
    set.name = 'Paper sheet';
    const sheet = look.ink(kit.roundedBox(width, 0.006, depth, 0.002), 'paper', 'Paper', { line: 0.0025 });
    sheet.position.y = 0.003;
    const m = 0.014, hw = width / 2 - m, hd = depth / 2 - m;
    const rule = look.mark([[[[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd], [-hw, -hd]], 0.0016, 'none']], 'ink', { name: 'Ruled border' });
    rule.rotation.x = -Math.PI / 2;
    rule.position.y = 0.0068;
    set.add(sheet, rule);
    set.userData.top = 0.006;
    set.userData.width = width;
    set.userData.depth = depth;
    return set;
  };
  look.demo = (subject) => {
    const mug = look.turned([[0, 0], [0.034, 0], [0.037, 0.075], [0.032, 0.075], [0.029, 0.006], [0, 0.006]], 'persimmon', 'Mug', { halftone: true });
    mug.position.set(-0.06, 0, 0);
    mug.add(look.tube([[0.03, 0.062, 0], [0.056, 0.058, 0], [0.06, 0.032, 0], [0.033, 0.018, 0]], 0.006, 'persimmon', 'Mug handle'));
    look.crease(mug, 0.0372, 0.068);
    const ball = look.ball(0.03, 'teal', 'Ball', { halftone: true });
    ball.position.set(0.08, 0.03, 0.03);
    const s1 = look.shadow(0.045, 0.03, 'Mug shadow');
    s1.position.set(-0.04, s1.position.y, -0.012);
    const s2 = look.shadow(0.035, 0.022, 'Ball shadow');
    s2.position.set(0.095, s2.position.y, 0.02);
    subject.add(s1, s2, mug, ball);
    return [{ object: ball, grab: true }, { object: mug, press: true }];
  };
  return look;
}
