// Exploded view look for an XR lesson: one object, enlarged, taken apart along its axis over a pale floor slab. Every
// part is a real finish, carries a numbered ink-blue callout, and has a place in the row that it seats back into with
// a click. Needs look-kit.js (lookSeg, lookBack, lookBounce, lookHash3). new-lesson.mjs pastes it in.
//
// explodedViewLook(THREE, kit) returns:
//   PAL                                    ink #1b2f8c, paper, floor #dedbd5, accent orange #e8742a
//   FINISHES, mat(name)                    real finishes by name, each made once: chrome brass steel satin gunmetal
//                                          copper gold rubber clear smoke milky orange black white cream grey pcb red
//                                          blue. One per part: neighbours in the row never share one. orange = the
//                                          one accent part.
//   mesh(geometry, finish)                 a mesh in a finish (name or material)
//   part(geometry, finish, name)           a part: a named Group holding one mesh. Build parts along +x (the axis),
//                                          centred on their own origin; add more meshes with part.add(look.mesh(...))
//   turned(profile, finish, name, { seg, bevel })   a turned part: profile [[x, r], ...] spun round the x axis.
//                                          Walk it front face up, along the outside, back face down (and back along
//                                          the bore for a hollow part), so every face points outwards
//   tube(rOut, rIn, len, finish, name)     a hollow body or barrel, open at both ends
//   cap(r, len, finish, name, { wall, closed })   a cup closed at one end ('back' = +x, default; or 'front')
//   spring(r, len, turns, { wire, dead, finish, name })   a coil spring wound as a true helix along x; scale.x squeezes it
//   thread(r, len, pitch, finish, name)    a screw thread (a helix) to add round a part's end
//   screw(r, len, { finish, name })        a pan-head screw, head at -x, threaded shank to +x
//   lens(r, thick, name, { dome })         a clear lens, flat at +x, domed at -x
//   reflector(rFront, rBack, len, name)    a chrome cup opening toward +x that turns an LED's light into a beam
//   battery(len, r, name, { wrap, band })  a round cell, + end at +x
//   led(r, name)                           an LED, dome toward +x, legs to -x; .userData.light = its own glowing
//                                          material (emissiveIntensity 0 = off, 2.5 = lit), .userData.halo a glow
//   gear(teeth, r, thick, finish, name)    a spur gear turning about x (kit.gear)
//   row(parts, { dir, gap, y, tilt, shadows })   THE EXPLODED ROW: the parts on one axis, assembly order = row order.
//     parts: [{ object, at?, length? }]: at = where the part's origin sits along the axis when assembled (default:
//     packed end to end; give it for parts that nest inside others), length = its size along the axis (default:
//     measured). Returns row:
//       row.place(k)     every part at once: 0 = assembled, 1 = apart (a slider)
//       row.go(k)        animate: apart, each part leaves in turn, overshoots and settles with a tilt of its own;
//                        together, in reverse, each seating with a click
//       row.hands(traits, isGrabbed, { onPress, onSeat, onOut })   every part grabbable and pressable: pull one out
//                        of the row, put it back near its place and it slides home (onSeat); left elsewhere it drops
//                        to the floor and stays out (onOut). A press lifts and lights the part (onPress)
//       row.focus(i)     lift part i toward the learner and light its callout (-1: none)
//       row.update(delta)   call every frame (motion, hands, shadows, callouts)
//       row.missing()    index of the first part out of the row (or held), -1 if none
//       row.parts[i]     { object, k (0..1 how far apart), out, held, seated, exploded, callout }
//       row.length       the row's length when apart (size the floor from it)
//   callout(n, text, part, { level, side })   a numbered ink-blue tag above a part (side 'right' for stacks) with an
//                                          ink leader line down to it; part = a row part or an Object3D
//   callouts(row, names)                   one callout per part, numbered in row order, heights alternated so no two
//                                          cards overlap. Shown while the row is apart, or the part is lifted or out
//   axis(row, { stands })                  the dash-dot centre line the parts sit on, held by two thin steel stands
//   powerPath(points, { colour, speed, radius })   a glowing path through the parts (current, force, air, light, ink)
//     with a bead running along it. points: [{ object, at: [x, y, z] }] in flow order, at in the object's own frame.
//     Add path.group to the same parent as the parts. path.update(time, stop, flow): stop = -1 draws it all the way
//     round; stop = i draws it up to point i, where the bead stops and blinks (a gap: nothing flows past it).
//     flow = false hides the bead: the route, with nothing moving along it yet (the parts are apart).
//     path.indexOf(object) = the first point on that object
//   set({ length, depth })                 the pale floor slab, 6 mm thick; never grabbable; .userData.top
//   demo(subject)                          a working sample (replace it)
function explodedViewLook(THREE, kit) {
  const PAL = { ink: '#1b2f8c', paper: '#fbf7ee', floor: '#dedbd5', accent: '#e8742a' };
  const FIN = {
    chrome: ['chrome', {}], brass: ['brass', {}], steel: ['steel', {}], satin: ['brushedMetal', {}],
    gunmetal: ['metal', { color: '#5d636b', roughness: 0.35 }], copper: ['copper', {}], gold: ['gold', {}],
    rubber: ['rubber', {}], clear: ['glass', { opacity: 0.35 }], smoke: ['glass', { color: '#59636e', opacity: 0.6 }],
    milky: ['plastic', { color: '#e4eaee', opacity: 0.8, wear: 0 }], orange: ['glossy', { color: PAL.accent }],
    black: ['plastic', { color: '#1c1d21' }], white: ['plastic', { color: '#ecebe6' }],
    cream: ['plastic', { color: '#efe9da', roughness: 0.45 }], grey: ['plastic', { color: '#8d929a' }],
    pcb: ['plastic', { color: '#1d6a46', roughness: 0.35, wear: 0 }], red: ['plastic', { color: '#c8312b' }],
    blue: ['plastic', { color: '#2f5fb3' }],
  };
  const mats = {};
  const inkMat = kit.material('plastic', { color: PAL.ink, wear: 0 });
  const ev = { name: 'exploded-view', PAL, FINISHES: Object.keys(FIN) };
  ev.mat = (name) => {
    if (name && name.isMaterial) return name;
    if (!FIN[name]) throw new Error(`explodedViewLook: no finish "${name}". Finishes: ${Object.keys(FIN).join(', ')}`);
    if (!mats[name]) mats[name] = kit.material(FIN[name][0], FIN[name][1]);
    return mats[name];
  };
  ev.mesh = (geometry, finish) => new THREE.Mesh(geometry, ev.mat(finish));
  ev.part = (geometry, finish, name) => {
    const g = new THREE.Group();
    g.name = name;
    if (geometry) { const m = ev.mesh(geometry, finish); m.name = name; g.add(m); }
    return g;
  };
  // Turned geometry round the x axis. Each straight run keeps its own flat normal, so steps and chamfers catch a crisp
  // highlight; a third value of 1 on a point makes the surface run smoothly through it. bevel chamfers hard corners.
  ev.turnedGeometry = (outline, { seg = 48, bevel = 0 } = {}) => {
    let P = outline.map((p) => ({ x: p[0], r: Math.max(0, p[1]), s: !!p[2] }));
    if (bevel) {
      const Q = [];
      P.forEach((p, i) => {
        const a = P[i - 1];
        const b = P[i + 1];
        if (!a || !b || p.s) { Q.push(p); return; }
        const cut = (q) => { const d = Math.hypot(q.x - p.x, q.r - p.r) || 1; const c = Math.min(bevel, d * 0.4); return { x: p.x + ((q.x - p.x) * c) / d, r: p.r + ((q.r - p.r) * c) / d, s: false }; };
        Q.push(cut(a), cut(b));
      });
      P = Q;
    }
    const n = P.length - 1;
    const N = [];
    const pos = [];
    const nor = [];
    const uv = [];
    const idx = [];
    for (let i = 0; i < n; i++) { const dx = P[i + 1].x - P[i].x; const dr = P[i + 1].r - P[i].r; const l = Math.hypot(dx, dr) || 1; N.push([-dr / l, dx / l]); }
    const mix = (a, b) => { const x = a[0] + b[0]; const r = a[1] + b[1]; const l = Math.hypot(x, r) || 1; return [x / l, r / l]; };
    let x0 = Infinity;
    let x1 = -Infinity;
    for (const p of P) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); }
    for (let i = 0; i < n; i++) {
      const ends = [[P[i], i > 0 && P[i].s ? mix(N[i - 1], N[i]) : N[i]], [P[i + 1], i < n - 1 && P[i + 1].s ? mix(N[i], N[i + 1]) : N[i]]];
      const base = pos.length / 3;
      for (const [p, m] of ends) {
        for (let k = 0; k <= seg; k++) {
          const a = (k / seg) * Math.PI * 2;
          const c = Math.cos(a);
          const s = Math.sin(a);
          pos.push(p.x, p.r * c, p.r * s);
          nor.push(m[0], m[1] * c, m[1] * s);
          uv.push(k / seg, (p.x - x0) / (x1 - x0 || 1));
        }
      }
      for (let k = 0; k < seg; k++) { const a = base + k; const b = a + 1; const c = base + seg + 1 + k; const d = c + 1; idx.push(a, b, c, b, d, c); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  };
  ev.turned = (profile, finish, name, o = {}) => ev.part(ev.turnedGeometry(profile, o), finish, name);
  ev.tube = (rOut, rIn, len, finish, name) => {
    const h = len / 2;
    return ev.turned([[-h, rIn], [-h, rOut], [h, rOut], [h, rIn], [-h, rIn]], finish, name, { bevel: Math.min(0.0008, (rOut - rIn) * 0.3) });
  };
  ev.cap = (r, len, finish, name, { wall = r * 0.12, closed = 'back' } = {}) => {
    const h = len / 2;
    const g = ev.turnedGeometry([[-h, r - wall], [-h, r], [h, r], [h, 0], [h - wall, 0], [h - wall, r - wall], [-h, r - wall]], { bevel: Math.min(0.0008, wall * 0.3) });
    if (closed === 'front') g.rotateY(Math.PI);
    return ev.part(g, finish, name);
  };
  // Points on a helix along x, centred: `dead` closed turns at each end, the rest open.
  const helix = (r, len, turns, wire, dead = 0) => {
    const pts = [];
    const n = Math.max(8, Math.round(turns * 12));
    const closedPitch = wire * 2.05;
    const open = Math.max(0.01, turns - 2 * dead);
    const pitch = Math.max(closedPitch, (len - 2 * dead * closedPitch - wire * 2) / open);
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * turns;
      const lead = Math.min(a, dead);
      const tail = Math.max(0, a - (turns - dead));
      const x = (lead + tail) * closedPitch + (a - lead - tail) * pitch;
      pts.push([x, r * Math.cos(a * Math.PI * 2), r * Math.sin(a * Math.PI * 2)]);
    }
    const shift = pts[pts.length - 1][0] / 2;
    for (const p of pts) p[0] -= shift;
    return pts;
  };
  ev.spring = (r, len, turns, { wire = r * 0.12, dead = 1, finish = 'steel', name = 'Spring' } = {}) =>
    ev.part(kit.tube(helix(r, len, turns, wire, dead), wire, { detail: 3, sides: 8 }), finish, name);
  ev.thread = (r, len, pitch, finish, name = 'Thread') => {
    const wire = pitch * 0.3;
    const g = ev.part(kit.tube(helix(r, len, Math.max(1, len / pitch), wire, 0), wire, { detail: 2, sides: 6 }), finish, name);
    return g;
  };
  ev.screw = (r, len, { finish = 'steel', name = 'Screw' } = {}) => {
    const headH = r * 1.3;
    const total = len + headH;
    const x0 = -total / 2;
    const g = ev.turned([[x0, 0], [x0, r * 1.7, 1], [x0 + headH * 0.55, r * 1.9, 1], [x0 + headH, r * 1.9], [x0 + headH, r * 0.8], [total / 2 - r * 0.5, r * 0.8], [total / 2, 0]], finish, name, { seg: 32, bevel: r * 0.08 });
    const thread = ev.thread(r * 0.82, len - r * 1.2, r * 0.6, finish, `${name} thread`);
    thread.position.x = x0 + headH + (len - r * 1.2) / 2 + r * 0.2;
    const slot = ev.mesh(new THREE.BoxGeometry(r * 0.5, r * 0.45, r * 3.4), 'black');
    slot.position.x = x0 + r * 0.1;
    g.add(thread, slot);
    return g;
  };
  ev.lens = (r, thick, name = 'Lens', { dome = 0.6 } = {}) => {
    const h = thick / 2;
    const prof = [];
    for (let i = 0; i <= 6; i++) { const u = i / 6; prof.push([-h - thick * dome * (1 - u * u), r * u, i > 0 && i < 6 ? 1 : 0]); }
    prof.push([h, r], [h, 0]);
    return ev.turned(prof, 'clear', name);
  };
  ev.reflector = (rFront, rBack, len, name = 'Reflector') => {
    const mat = ev.mat('chrome').clone();
    mat.side = THREE.DoubleSide;
    const prof = [];
    for (let i = 0; i <= 8; i++) { const u = i / 8; prof.push([-len / 2 + len * u * u, rBack + (rFront - rBack) * u, i > 0 && i < 8 ? 1 : 0]); }
    prof.push([len / 2, rFront * 1.06]);
    return ev.part(ev.turnedGeometry(prof), mat, name);
  };
  const wraps = {};
  ev.battery = (len, r, name = 'Battery', { wrap = '#2a2c31', band = '#c9a227' } = {}) => {
    const key = `${wrap}${band}`;
    if (!wraps[key]) wraps[key] = [kit.material('glossy', { color: wrap }), kit.material('glossy', { color: band })];
    const h = len / 2;
    const g = ev.part(ev.turnedGeometry([[-h + 0.0006, 0], [-h + 0.0006, r * 0.92], [-h + 0.0015, r], [h - len * 0.28, r], [h - len * 0.28, r * 0.995]], { bevel: 0.0004 }), wraps[key][0], name);
    const top = ev.mesh(ev.turnedGeometry([[h - len * 0.28, r * 0.995], [h - len * 0.28, r], [h - 0.0015, r], [h - 0.0006, r * 0.92], [h - 0.0006, 0]], { bevel: 0.0004 }), wraps[key][1]);
    const ends = ev.mesh(ev.turnedGeometry([[-h, 0], [-h, r * 0.85], [-h + 0.0007, r * 0.88]]), 'steel');
    const nub = ev.mesh(ev.turnedGeometry([[h - 0.0007, r * 0.4], [h + r * 0.12, r * 0.38], [h + r * 0.14, 0]], { seg: 24 }), 'steel');
    g.add(top, ends, nub);
    return g;
  };
  ev.led = (r, name = 'LED') => {
    const light = kit.material('light', { color: '#fff6dc', glow: 2.5 });
    light.emissiveIntensity = 0;
    const g = ev.part(ev.turnedGeometry([[-r * 0.6, 0], [-r * 0.6, r * 1.2], [-r * 0.35, r * 1.2], [-r * 0.35, r], [r * 0.9, r, 1], [r * 1.5, r * 0.8, 1], [r * 1.85, r * 0.45, 1], [r * 2, 0]], { seg: 32 }), light, name);
    for (const z of [-0.4, 0.4]) {
      const leg = ev.mesh(new THREE.CylinderGeometry(r * 0.09, r * 0.09, r * 2.4, 6).rotateZ(Math.PI / 2), 'steel');
      leg.position.set(-r * 1.8, 0, z * r);
      g.add(leg);
    }
    const halo = kit.glow('#fff1c8', r * 9, { opacity: 0.85 });
    halo.position.x = r * 1.2;
    halo.visible = false;
    g.add(halo);
    g.userData.light = light;
    g.userData.halo = halo;
    return g;
  };
  ev.gear = (teeth, r, thick, finish, name = 'Gear') => ev.part(kit.gear({ teeth, radius: r, thickness: thick }).rotateY(Math.PI / 2), finish, name);

  // The size of an object round its own origin, in its parent's axes (callouts, glows and sprites left out).
  const box = new THREE.Box3();
  const tmpBox = new THREE.Box3();
  const tmpM = new THREE.Matrix4();
  const tmpV = new THREE.Vector3();
  const measure = (object, own = false) => {
    object.updateWorldMatrix(true, true);
    const ref = own ? object.matrixWorld : object.parent ? object.parent.matrixWorld : null;
    const inv = ref ? new THREE.Matrix4().copy(ref).invert() : new THREE.Matrix4();
    const out = new THREE.Box3();
    object.traverse((o) => {
      if (!o.isMesh || o.userData.annotation) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      tmpBox.copy(o.geometry.boundingBox).applyMatrix4(tmpM.multiplyMatrices(inv, o.matrixWorld));
      out.union(tmpBox);
    });
    if (!own) out.translate(tmpV.copy(object.position).negate());
    return out;
  };

  // ---------------------------------------------------------------- the row
  ev.row = (list, o = {}) => {
    const dir = new THREE.Vector3(...(o.dir ?? [1, 0, 0])).normalize();
    const stack = Math.abs(dir.y) > 0.5;          // a stack rises from the floor; a row lies along it
    const gap = o.gap ?? 0.03;
    const parts = list.map((p, i) => {
      const b = measure(p.object);
      const size = b.getSize(new THREE.Vector3());
      const mid = b.getCenter(new THREE.Vector3());
      return {
        object: p.object, index: i, length: p.length ?? (stack ? size.y : size.x), at: p.at, size, off: stack ? mid.y : mid.x,
        rot0: p.object.rotation.clone(), q0: p.object.quaternion.clone(),
        // A slight tilt of its own while apart (2 to 6 degrees), never enough to touch a neighbour or the floor.
        tilt: Math.min(0.1, (gap * 0.6) / Math.max(0.01, stack ? size.z : size.x)) * (stack ? (i === 0 ? 0 : 0.6 + 0.4 * lookHash3(i, 7, 3)) : (lookHash3(i, 2, 9) < 0.5 ? -1 : 1) * (0.4 + 0.6 * lookHash3(i, 5, 1))),
        k: 1, from: 1, to: 1, delay: 0, lift: 0, liftTo: 0, out: false, held: false, snap: 0, callout: null, shadow: null,
      };
    });
    // Where each part's origin sits along the axis when assembled (`at`, default packed end to end) and when apart
    // (packed end to end with `gap` between), as distances from the axis origin. off = its box centre from its origin.
    let run = 0;
    for (const p of parts) { if (p.at == null) p.at = run + p.length / 2 - p.off; run = p.at + p.off + p.length / 2; }
    run = 0;
    for (const p of parts) { p.exp = run + p.length / 2 - p.off; run += p.length + gap; }
    const span = (key) => { let a = Infinity; let b = -Infinity; for (const p of parts) { a = Math.min(a, p[key] + p.off - p.length / 2); b = Math.max(b, p[key] + p.off + p.length / 2); } return [a, b]; };
    const [s0, s1] = span('at');
    const [e0, e1] = span('exp');
    for (const p of parts) {
      p.seat = stack ? p.at - s0 : p.at - (s0 + s1) / 2;
      p.exp = stack ? p.exp - e0 : p.exp - (e0 + e1) / 2;
    }
    let thick = 0;
    for (const p of parts) thick = Math.max(thick, stack ? p.size.x : Math.max(p.size.y, p.size.z));
    const origin = new THREE.Vector3(0, o.y ?? (stack ? 0.002 : thick / 2 + 0.02), 0);
    const row = { parts, dir, stack, origin, length: e1 - e0, seatedLength: s1 - s0, thick, target: 1, opening: true, clock: 0, focused: -1 };
    for (const p of parts) {
      p.seated = origin.clone().addScaledVector(dir, p.seat);
      p.exploded = origin.clone().addScaledVector(dir, p.exp);
    }
    // Soft contact shadows on the floor, one per part (one under a stack).
    const parent = parts[0] && parts[0].object.parent;
    if (parent && o.shadows !== false) {
      for (const p of parts) {
        if (stack && p.index > 0) continue;
        const s = kit.shadow(0.5, 0.32);
        s.scale.set(stack ? p.size.x * 1.3 : p.length * 1.15, 1, (stack ? p.size.z : Math.max(p.size.y, p.size.z)) * 1.3);
        parent.add(s);
        p.shadow = s;
      }
    }
    const pose = (p, out) => {
      out.copy(p.seated).lerp(p.exploded, p.k);
      if (p.lift > 0) { if (stack) out.z += 0.03 * p.lift; else { out.y += 0.014 * p.lift; out.z += 0.018 * p.lift; } }
      return out;
    };
    const euler = new THREE.Euler();
    const quat = new THREE.Quaternion();
    const at = new THREE.Vector3();
    const turn = (p) => {
      euler.copy(p.rot0);
      const t = p.tilt * Math.max(0, Math.min(1, p.k));
      if (stack) euler.x += t; else euler.z += t;
      if (p.callout) { if (stack) p.callout.group.rotation.x = -t; else p.callout.group.rotation.z = -t; }   // callouts stay upright
      return quat.setFromEuler(euler);
    };
    row.place = (k) => { for (const p of parts) { if (!p.out) { p.k = p.from = p.to = k; p.delay = 0; } } row.target = k; row.clock = 1e3; };
    row.go = (k) => {
      row.opening = k >= row.target;
      row.target = k;
      row.clock = 0;
      const n = parts.length;
      for (const p of parts) { p.from = p.k; p.to = k; p.delay = 0.09 * (row.opening ? p.index : n - 1 - p.index); }
    };
    row.focus = (i) => {
      row.focused = i;
      for (const p of parts) {
        p.liftTo = p.index === i ? 1 : 0;
        if (p.callout) p.callout.card.userData.setColor(p.index === i ? PAL.accent : PAL.ink);
      }
    };
    row.missing = () => { for (const p of parts) if (p.out || p.held) return p.index; return -1; };
    row.amount = () => row.target;
    // Every part grabbable (pull it out, put it back) and pressable (lift it, say what it does). After root.add.
    let hands = null;
    row.hands = function (traits, isGrabbed, h = {}) {
      hands = { isGrabbed, ...h };
      for (const p of parts) traits(p.object, { grab: true, onPress() { row.focus(p.index); if (h.onPress) h.onPress(p, p.index); } });
    };
    row.update = (delta) => {
      row.clock += delta;
      for (const p of parts) {
        const held = hands ? hands.isGrabbed(p.object) : false;
        if (held) {
          p.held = true;
          if (p.shadow) p.shadow.visible = false;
          if (p.callout) { p.callout.group.visible = p.callout.card.visible = true; if (p.callout.short) p.callout.short.visible = false; }
          continue;
        }
        if (p.held) {                                     // just let go: back in its place, or out of the row
          p.held = false;
          if (p.object.position.distanceTo(pose(p, at)) < (o.radius ?? 0.045)) {
            p.out = false; p.snap = 1;
            if (hands.onSeat) hands.onSeat(p, p.index);
          } else {
            p.out = true;
            if (hands.onOut) hands.onOut(p, p.index);
          }
        }
        if (p.out) {                                      // out of the row: it settles on the floor where it was left
          p.k = p.from = p.to = row.target;
          const rest = (stack ? p.size.y : Math.max(p.size.y, p.size.z)) / 2 + 0.001;
          const f = Math.min(1, delta * 8);
          p.object.position.y += (rest - p.object.position.y) * f;
          p.object.quaternion.slerp(p.q0, f);
        } else {
          if (row.clock < 5) {
            const u = lookSeg(row.clock, p.delay, p.delay + 0.7);
            p.k = p.from + (p.to - p.from) * (row.opening ? lookBack(u, 1.4) : lookBounce(u));
          }
          p.lift += (p.liftTo - p.lift) * Math.min(1, delta * 8);
          pose(p, at);
          if (p.snap > 0) {
            const f = 1 - Math.exp(-14 * delta);
            p.object.position.lerp(at, f);
            p.object.quaternion.slerp(turn(p), f);
            if (p.object.position.distanceTo(at) < 0.0008) p.snap = 0;
          } else {
            p.object.position.copy(at);
            p.object.quaternion.copy(turn(p));
          }
        }
        if (p.shadow) { p.shadow.visible = true; p.shadow.position.x = p.object.position.x; p.shadow.position.z = p.object.position.z; }
        if (p.callout) {
          const near = p.lift > 0.3 || p.out;
          p.callout.group.visible = p.k > 0.55 || near;
          if (p.callout.short) { p.callout.short.visible = !near; p.callout.card.visible = near; }
        }
      }
    };
    row.place(1);
    for (const p of parts) { pose(p, at); p.object.position.copy(at); p.object.quaternion.copy(turn(p)); if (p.shadow) p.shadow.position.set(at.x, 0, at.z); }
    return row;
  };

  // ---------------------------------------------------------------- words
  // base: the height (in the part's frame) the callout rises from at least; callouts() gives one row a common base so
  // its cards line up and alternate cleanly.
  ev.callout = (n, text, part, { level = 0, side = 'up', base = -Infinity } = {}) => {
    const object = part.object ?? part;
    const b = measure(object, true);
    const g = new THREE.Group();
    g.name = `Callout ${n}`;
    const card = kit.card(`${n}  ${text}`, { color: PAL.ink });
    const cb = measure(card, true);
    let w = cb.max.x - cb.min.x;
    const h = cb.max.y - cb.min.y;
    let short = null;
    const leader = new THREE.Mesh(new THREE.CylinderGeometry(0.0007, 0.0007, 1, 6), inkMat);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 10, 8), inkMat);
    g.add(card, leader, dot);
    g.traverse((c) => { c.userData.annotation = true; });
    g.userData.width = w;
    g.userData.height = h;
    // A number-only tag for a crowded row: the full card shows while the part is pressed, held or out.
    g.userData.addShort = () => {
      short = kit.card(String(n), { color: PAL.ink });
      const sb = measure(short, true);
      w = sb.max.x - sb.min.x;
      short.traverse((c) => { c.userData.annotation = true; });
      g.add(short);
      card.visible = false;
      if (part.object) part.callout.short = short;
      return w;
    };
    g.userData.setLevel = (lv) => {
      if (side === 'up') {
        const x = (b.min.x + b.max.x) / 2;
        const top = b.max.y;
        const cy = Math.max(top, base) + 0.03 + lv * (h + 0.009) + h / 2;
        card.position.set(x, cy, 0);
        if (short) short.position.set(x, cy, 0);
        dot.position.set(x, top, 0);
        leader.position.set(x, (top + cy - h / 2) / 2, 0);
        leader.scale.y = Math.max(0.001, cy - h / 2 - top);
        leader.rotation.z = 0;
      } else {
        const s = side === 'left' ? -1 : 1;
        const edge = s > 0 ? b.max.x : b.min.x;
        const y = (b.min.y + b.max.y) / 2;
        const cx = edge + s * (0.03 + lv * (w + 0.01) + w / 2);
        card.position.set(cx, y, 0);
        if (short) short.position.set(cx, y, 0);
        dot.position.set(edge, y, 0);
        leader.position.set((edge + cx - (s * w) / 2) / 2, y, 0);
        leader.scale.y = Math.max(0.001, Math.abs(cx - (s * w) / 2 - edge));
        leader.rotation.z = Math.PI / 2;
      }
    };
    g.userData.setLevel(level);
    object.add(g);
    if (part.object) part.callout = { group: g, card, short: null };
    return g;
  };
  ev.callouts = (row, names, o = {}) => {
    // Levels, left to right: a card never overlaps another card on its level, its leader never runs through a lower
    // card, and no higher leader runs through it. Where full names cannot all fit, the cards in the way become number
    // tags (their full name shows while the part is pressed, held or out) and the layout is tried again.
    const m = 0.006;
    let base = -Infinity;
    for (const p of row.parts) base = Math.max(base, measure(p.object, true).max.y);
    const side = o.side ?? (row.stack ? 'right' : 'up');
    const cs = [];
    let lastY = -Infinity;
    let flip = false;
    row.parts.forEach((p, i) => {
      if (!names[i]) return;
      let s = side;
      if (side !== 'up') {                            // a stack: cards beside their parts, swapping sides when two would touch
        const y = p.exploded.y + p.off;
        if (y - lastY < 0.036) flip = !flip;
        else flip = false;
        lastY = y;
        if (flip) s = side === 'left' ? 'right' : 'left';
      }
      const g = ev.callout(i + 1, names[i], p, { side: s, base: s === 'up' ? base : -Infinity });
      cs.push({ g, lx: p.exploded.x + p.off, w: g.userData.width, lv: 0, short: false });
    });
    if (side !== 'up') return;
    const hit = (a, b) => {
      const [lo, hi] = a.lv <= b.lv ? [a, b] : [b, a];
      if (a.lv === b.lv) return a.lx + a.w / 2 + m > b.lx - b.w / 2 && b.lx + b.w / 2 + m > a.lx - a.w / 2;
      return hi.lx > lo.lx - lo.w / 2 - m && hi.lx < lo.lx + lo.w / 2 + m;
    };
    for (let pass = 0; pass < 4; pass++) {
      const done = [];
      for (const c of cs) {
        let best = 0;
        let fewest = Infinity;
        for (let lv = 0; lv < 3 && fewest > 0; lv++) {
          c.lv = lv;
          const n = done.reduce((k, q) => k + (hit(c, q) ? 1 : 0), 0);
          if (n < fewest) { fewest = n; best = lv; }
        }
        c.lv = best;
        done.push(c);
      }
      let clashes = 0;
      for (const c of cs) {
        for (const q of cs) {
          if (q === c || !hit(c, q)) continue;
          clashes++;
          for (const r of [c, q]) if (!r.short) { r.short = true; r.w = r.g.userData.addShort(); }
        }
      }
      if (!clashes) break;
    }
    for (const c of cs) c.g.userData.setLevel(c.lv);
  };

  // ---------------------------------------------------------------- the axis, the path, the floor
  ev.axis = (row, { stands = !row.stack, extra = 0.025 } = {}) => {
    const g = new THREE.Group();
    g.name = 'Axis';
    const a = row.stack ? -0.002 : -row.length / 2 - extra;
    const b = row.stack ? row.length + extra : row.length / 2 + extra;
    const marks = [];
    const geo = new THREE.CylinderGeometry(0.0007, 0.0007, 1, 5).rotateZ(Math.PI / 2);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), row.dir);
    const e = new THREE.Euler().setFromQuaternion(q);
    for (let s = a; s < b; s += 0.022) {
      for (const [off, len] of [[0, 0.013], [0.0165, 0.0025]]) {
        const l = Math.min(len, b - s - off);
        if (l <= 0) continue;
        const c = row.origin.clone().addScaledVector(row.dir, s + off + l / 2);
        marks.push({ position: [c.x, c.y, c.z], rotation: [e.x, e.y, e.z], scale: [l, 1, 1] });
      }
    }
    const line = kit.instances(geo, inkMat, marks);
    line.name = 'Centre line';
    g.add(line);
    if (stands) {
      for (const x of [a - 0.004, b + 0.004]) {
        const rod = ev.mesh(new THREE.CylinderGeometry(0.0022, 0.0022, row.origin.y, 10), 'steel');
        rod.position.set(x, row.origin.y / 2, 0);
        const foot = ev.mesh(ev.turnedGeometry([[0, 0], [0, 0.011], [0.003, 0.009], [0.004, 0]], { seg: 24 }).rotateZ(Math.PI / 2), 'steel');
        foot.position.set(x, 0, 0);
        const cup = ev.mesh(new THREE.SphereGeometry(0.0042, 12, 8), 'steel');
        cup.position.set(x, row.origin.y, 0);
        g.add(rod, foot, cup);
      }
    }
    return g;
  };
  ev.powerPath = (points, { colour = '#ffb12e', speed = 0.08, radius = 0.0016 } = {}) => {
    const group = new THREE.Group();
    group.name = 'Power path';
    const mat = kit.material('light', { color: colour, glow: 1.8 });
    mat.depthTest = false;                            // drawn through the parts, like an x-ray of the route
    mat.transparent = true;
    mat.opacity = 0.9;
    const segGeo = new THREE.CylinderGeometry(radius, radius, 1, 6, 1, true);
    const segs = [];
    for (let i = 0; i < points.length - 1; i++) {
      const m = new THREE.Mesh(segGeo, mat);
      m.renderOrder = 20;
      m.name = `Path ${i + 1}`;
      m.scale.set(1, 1e-4, 1);                        // nothing until the first update: the host sizes the lesson at build
      m.visible = false;
      group.add(m);
      segs.push(m);
    }
    const bead = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(radius * 3, 12, 8), mat);
    core.renderOrder = 21;
    bead.add(core, kit.glow(colour, 0.035, { opacity: 0.9 }));
    bead.visible = false;
    group.add(bead);
    const P = points.map(() => new THREE.Vector3());
    const local = points.map((p) => new THREE.Vector3(...(p.at ?? [0, 0, 0])));
    const Y = new THREE.Vector3(0, 1, 0);
    const d = new THREE.Vector3();
    const path = { group, points, stopped: -1 };
    path.indexOf = (object) => points.findIndex((p) => p.object === object);
    path.update = (time, stop = -1, flow = true) => {
      group.updateWorldMatrix(true, false);
      for (let i = 0; i < points.length; i++) {
        const o = points[i].object;
        o.updateWorldMatrix(true, false);
        group.worldToLocal(o.localToWorld(P[i].copy(local[i])));
      }
      const last = stop >= 0 ? Math.min(stop, points.length - 1) : points.length - 1;
      let total = 0;
      for (let i = 0; i < segs.length; i++) {
        const m = segs[i];
        d.subVectors(P[i + 1], P[i]);
        const l = d.length();
        m.visible = i < last && l > 1e-4;
        if (!m.visible) continue;
        total += l;
        m.position.copy(P[i]).addScaledVector(d, 0.5);
        m.quaternion.setFromUnitVectors(Y, d.multiplyScalar(1 / l));
        m.scale.set(1, l, 1);
      }
      // The bead: round the loop at `speed` m/s; at a gap it waits there and blinks.
      let s = total > 0 ? (time * speed) % (total + (stop >= 0 ? 0.04 : 0)) : 0;
      bead.position.copy(P[0]);
      for (let i = 0; i < last; i++) {
        const l = P[i].distanceTo(P[i + 1]);
        if (s <= l) { bead.position.copy(P[i]).lerp(P[i + 1], l > 0 ? s / l : 0); s = -1; break; }
        s -= l;
      }
      if (s >= 0) bead.position.copy(P[last]);
      bead.visible = flow && (stop < 0 || s < 0 || Math.floor(time * 4) % 2 === 0);
      path.stopped = stop;
    };
    return path;
  };
  // The pale floor slab under the row: no longer than the row and its stands, 6 mm thick. Its top is set.userData.top.
  ev.set = ({ length = 0.46, depth = 0.12 } = {}) => {
    const set = new THREE.Group();
    set.name = 'Floor';
    const slab = new THREE.Mesh(kit.roundedBox(length, 0.006, depth, 0.003), kit.material('plastic', { color: PAL.floor, roughness: 0.95, wear: 0 }));
    slab.position.y = 0.003;
    set.add(slab);
    set.userData.top = 0.006;
    set.userData.length = length;
    set.userData.depth = depth;
    return set;
  };
  ev.demo = (subject) => {
    const cap = ev.cap(0.022, 0.04, 'rubber', 'Cap', { closed: 'front' });
    const spring = ev.spring(0.012, 0.05, 9, { name: 'Spring' });
    const body = ev.tube(0.02, 0.017, 0.1, 'clear', 'Body');
    const tip = ev.turned([[-0.02, 0.0005], [-0.02, 0.02], [0.02, 0.003], [0.02, 0]], 'brass', 'Tip', { bevel: 0.001 });
    subject.add(cap, spring, body, tip);
    const row = ev.row([{ object: cap }, { object: spring }, { object: body }, { object: tip }]);
    ev.callouts(row, ['Cap', 'Spring', 'Body', 'Tip']);
    subject.add(ev.axis(row));
    return row.parts.map((p) => ({ object: p.object, grab: true }));
  };
  return ev;
}
