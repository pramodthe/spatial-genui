// learning-game look: ink-toon

// The kits a learning game uses, ready as they are: every function here is in scope in game.js. Their APIs are in

// the skills (the look kit and the look: /skills/looks; the play kit: assets/play-kit.js; the ECS kit: /skills/common/ecs).

// ---- look kit: the helpers every look shares (skills/looks/<look>). A look's scripts/new-lesson.mjs pastes this file,
// then the look's module, above the lesson's `export default function build`, so the lesson can call them directly.
// Every function takes THREE (and kit where it needs it) as its first arguments. All of them run inside build();
// none of them allocates in update().

// ---------------------------------------------------------------- motion
// Progress of `t` through [a, b], 0..1.
function lookSeg(t, a, b) { return t <= a ? 0 : t >= b ? 1 : (t - a) / (b - a); }
// Ease out with an overshoot: arrives, goes a little past, settles. s = 1.7 is a clear overshoot.
function lookBack(x, s = 1.7) { const u = x - 1; return 1 + (s + 1) * u * u * u + s * u * u; }
// Drop and bounce once on arrival (cubes, clay, cards landing).
function lookBounce(x) { if (x < 0.72) return (x / 0.72) * (x / 0.72); const u = (x - 0.86) / 0.14; return 1 - 0.06 * (1 - u * u); }
// Stop-motion time: hold each pose for 1/fps s ("on twos" is 15). Pass it to the motion, never to the panel.
function lookTwos(time, fps = 15) { return Math.floor(time * fps) / fps; }

// ---------------------------------------------------------------- a path to travel
// A polyline you can sample by distance: a pulse along a track, a river, wind across a field, a route between stops.
// const path = lookPath(THREE, [[x, y, z], ...]); path.at(u, out) puts the point at u (0..1 of the length) in `out`.
function lookPath(THREE, points) {
  const pts = points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const length = acc[acc.length - 1];
  return {
    points: pts,
    length,
    at(u, out) {
      const s = Math.min(Math.max(u, 0), 1) * length;
      let i = 1;
      while (i < acc.length - 1 && acc[i] < s) i++;
      const k = acc[i] > acc[i - 1] ? (s - acc[i - 1]) / (acc[i] - acc[i - 1]) : 0;
      return out.copy(pts[i - 1]).lerp(pts[i], k);
    },
  };
}

// ---------------------------------------------------------------- noise for shapes
function lookHash3(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
// Smooth value noise, about -1..1.
function lookNoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  const h = (dx, dy, dz) => lookHash3(ix + dx, iy + dy, iz + dz);
  return 2 * l(
    l(l(h(0, 0, 0), h(1, 0, 0), ux), l(h(0, 1, 0), h(1, 1, 0), ux), uy),
    l(l(h(0, 0, 1), h(1, 0, 1), ux), l(h(0, 1, 1), h(1, 1, 1), ux), uy),
    uz,
  ) - 1;
}
// Push a geometry's surface in and out along its normals, so a form is a little lopsided (clay, rock, cloud).
// amount in metres (0.002-0.006 at desk size), size = metres per bump. Vertices at the same place move together.
function lookLumpy(THREE, geometry, amount = 0.003, size = 0.03, seed = 1) {
  const p = geometry.attributes.position;
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  const n = geometry.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = amount * (lookNoise(x / size + seed * 13.1, y / size, z / size) + 0.5 * lookNoise(x / size * 2.3, y / size * 2.3 + seed, z / size * 2.3));
    p.setXYZ(i, x + n.getX(i) * k, y + n.getY(i) * k, z + n.getZ(i) * k);
  }
  geometry.computeVertexNormals();
  return geometry;
}

// ---------------------------------------------------------------- drawn looks: ink, halftone, pencil, paint
// The headset has no lamps in the scene (only a soft environment), so a toon, Lambert or hatching material that
// waits for a light comes out black there. lookShade lights itself from a fixed key light (upper left, in front),
// so it looks the same in the photos and on the desk. Patterns are laid in the object's own space: they stay on
// the object as it moves and both eyes see the same lines.
//
// lookShade(THREE, {
//   mode: 'cel' | 'halftone' | 'hatch' | 'dabs',
//   lit, shade, deep,   // colours: lit side, shadow side, deepest shadow (optional; cel and halftone)
//   ink,                // line colour: hatching (pencil) and the halftone's dark dots
//   gloss,              // a hard white glint on glossy things (cel, halftone)
//   band,               // where light turns to shadow, 0..1 (default 0.45; hatch 0.72: faces toward the learner get one layer)
//   scale,              // metres per dot / hatch line / dab (defaults 0.007 / 0.006 / 0.016)
//   key,                // light direction [x, y, z] (default upper left, in front)
// })
// material.uniforms.uGlow.value (0..1) brightens it: use that to highlight the active part.
function lookShade(THREE, o = {}) {
  const MODES = { cel: 0, halftone: 1, hatch: 2, dabs: 3 };
  const mode = MODES[o.mode ?? 'cel'];
  if (mode === undefined) throw new Error("lookShade: mode is 'cel', 'halftone', 'hatch' or 'dabs'");
  const lit = o.lit ?? '#ffffff';
  const scale = o.scale ?? [0.006, 0.007, 0.006, 0.016][mode];
  const key = new THREE.Vector3(...(o.key ?? [-0.5, 0.75, 0.45])).normalize();
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uLit: { value: new THREE.Color(lit) },
      uShade: { value: new THREE.Color(o.shade ?? lit).multiplyScalar(o.shade ? 1 : 0.55) },
      uDeep: { value: new THREE.Color(o.deep ?? o.shade ?? lit).multiplyScalar(o.deep ? 1 : 0.7) },
      uInk: { value: new THREE.Color(o.ink ?? '#1c1622') },
      uGloss: { value: new THREE.Color(o.gloss ?? '#ffffff') },
      uKey: { value: key },
      uBand: { value: o.band ?? (mode === 2 ? 0.72 : 0.45) },
      uScale: { value: scale },
      uMode: { value: mode },
      uDeepOn: { value: o.deep ? 1 : 0 },
      uGlossOn: { value: o.gloss ? 1 : 0 },
      uGlow: { value: 0 },
    },
    vertexShader: `
      varying vec3 vObj; varying vec3 vObjN; varying vec3 vN; varying vec3 vView;
      #ifdef USE_INSTANCING_COLOR
        varying vec3 vTint;
      #endif
      void main() {
        vec4 p = vec4(position, 1.0);
        vec3 n = normal;
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
          n = mat3(instanceMatrix) * n;
        #endif
        #ifdef USE_INSTANCING_COLOR
          vTint = instanceColor;
        #endif
        vObj = position;
        vObjN = normal;
        vec4 w = modelMatrix * p;
        vN = normalize(mat3(modelMatrix) * n);
        vView = cameraPosition - w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform vec3 uLit, uShade, uDeep, uInk, uGloss, uKey;
      uniform float uBand, uScale, uMode, uDeepOn, uGlossOn, uGlow;
      varying vec3 vObj; varying vec3 vObjN; varying vec3 vN; varying vec3 vView;
      #ifdef USE_INSTANCING_COLOR
        varying vec3 vTint;
      #endif
      float aastep(float edge, float x) { float w = max(fwidth(x) * 0.75, 1e-4); return smoothstep(edge - w, edge + w, x); }
      float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      vec2 onPlane(vec3 p, vec3 n) { vec3 a = abs(n); return a.x > a.y && a.x > a.z ? p.zy : (a.y > a.z ? p.xz : p.xy); }
      float strokes(vec2 q, vec2 dir, float width) {
        vec2 side = vec2(-dir.y, dir.x);
        float s = dot(q, dir) + 0.18 * sin(dot(q, side) * 0.9);
        float f = abs(fract(s) - 0.5) * 2.0;
        float weight = 0.65 + 0.35 * hash2(vec2(floor(s), 3.0));
        return (1.0 - aastep(width, f)) * weight;
      }
      void main() {
        vec3 N = normalize(vN);
        if (!gl_FrontFacing) N = -N;
        float d = dot(N, uKey) * 0.5 + 0.5;
        vec3 lit = uLit, shade = uShade, deep = uDeep;
        #ifdef USE_INSTANCING_COLOR
          lit *= vTint; shade *= vTint; deep *= vTint;
        #endif
        vec2 q = onPlane(vObj, vObjN) / uScale;
        vec3 c;
        if (uMode < 0.5) {
          c = mix(shade, lit, aastep(uBand, d));
          if (uDeepOn > 0.5) c = mix(deep, c, aastep(uBand * 0.55, d));
        } else if (uMode < 1.5) {
          // Halftone: dots grow toward the terminator from the lit side; darker dots in the deep shadow.
          vec2 cell = fract(q + vec2(0.5 * floor(mod(q.y, 2.0)), 0.0)) - 0.5;
          float r = length(cell);
          float nearBand = clamp((uBand + 0.2 - d) / 0.2, 0.0, 1.0);
          float dotLit = 1.0 - aastep(0.6 * sqrt(nearBand), r);
          float intoDark = clamp((uBand - d) / max(uBand, 0.05), 0.0, 1.0);
          float dotDark = 1.0 - aastep(0.62 * sqrt(intoDark), r);
          vec3 dark = uDeepOn > 0.5 ? deep : uInk;
          c = mix(mix(shade, dark, dotDark * (uDeepOn > 0.5 ? 1.0 : 0.6)), mix(lit, shade, dotLit), aastep(uBand, d));
        } else if (uMode < 2.5) {
          // Pencil: lit faces stay bare paper; each step darker adds a layer of hatching in a new direction.
          float tone = 1.0 - d;
          float g = 0.0;
          g += 0.62 * strokes(q, normalize(vec2(0.8, 0.6)), 0.3) * aastep(1.0 - uBand, tone);
          g += 0.58 * strokes(q * 1.05, normalize(vec2(-0.55, 0.83)), 0.28) * aastep(1.0 - uBand + 0.17, tone);
          g += 0.55 * strokes(q * 1.7 + 0.37, normalize(vec2(0.97, -0.24)), 0.32) * aastep(1.0 - uBand + 0.32, tone);
          c = mix(lit, uInk, clamp(g, 0.0, 0.9));
        } else {
          // Paint: irregular dabs, each with its own angle, tilt of the light and warm or cool lean.
          vec2 cell = floor(q), f = fract(q);
          float best = 9.0; vec2 id = cell; vec2 off = vec2(0.0);
          for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
            vec2 g = vec2(float(i), float(j));
            vec2 ctr = g + vec2(hash2(cell + g), hash2(cell + g + 7.7)) - f;
            float dd = dot(ctr, ctr);
            if (dd < best) { best = dd; id = cell + g; off = ctr; }
          }
          float h1 = hash2(id + 1.3), h2 = hash2(id + 17.9), h3 = hash2(id + 41.1);
          float tilt = d + (h1 - 0.5) * 0.24;
          c = mix(shade, lit, smoothstep(uBand - 0.1, uBand + 0.1, tilt));
          c *= 0.9 + 0.2 * h2;
          c += (h3 - 0.5) * vec3(0.07, 0.0, -0.07);
          float ang = h1 * 6.2832;
          c *= 1.0 + 0.08 * sin(dot(off, vec2(-sin(ang), cos(ang))) * 38.0);
        }
        if (uGlossOn > 0.5) {
          vec3 R = reflect(-uKey, N);
          c = mix(c, uGloss, aastep(0.93, dot(R, normalize(vView))));
        }
        c = mix(c, vec3(1.0, 0.96, 0.85), uGlow * 0.35);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    toneMapped: false,
  });
  material.name = `look:${o.mode ?? 'cel'}`;
  return material;
}

// An ink line round a mesh: a slightly larger copy drawn inside out (the "inverted hull"). width in metres
// (0.0015-0.003 at desk size). It is one more draw call per mesh, so outline the few things that matter, or kit.merge
// static pieces first and outline the merged mesh. Normals are averaged so boxes do not crack at their corners.
function lookOutline(THREE, mesh, o = {}) {
  const geometry = mesh.geometry;
  if (!geometry.attributes.aLine) {
    const p = geometry.attributes.position, n = geometry.attributes.normal;
    const sums = new Map();
    const keyOf = (i) => `${Math.round(p.getX(i) * 1e4)},${Math.round(p.getY(i) * 1e4)},${Math.round(p.getZ(i) * 1e4)}`;
    for (let i = 0; i < p.count; i++) {
      const k = keyOf(i);
      const s = sums.get(k) || [0, 0, 0];
      s[0] += n.getX(i); s[1] += n.getY(i); s[2] += n.getZ(i);
      sums.set(k, s);
    }
    const line = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const s = sums.get(keyOf(i));
      const l = Math.hypot(s[0], s[1], s[2]) || 1;
      line[i * 3] = s[0] / l; line[i * 3 + 1] = s[1] / l; line[i * 3 + 2] = s[2] / l;
    }
    geometry.setAttribute('aLine', new THREE.BufferAttribute(line, 3));
  }
  const hull = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
    uniforms: { uWidth: { value: o.width ?? 0.002 }, uColor: { value: new THREE.Color(o.color ?? '#1c1622') } },
    vertexShader: `
      attribute vec3 aLine;
      uniform float uWidth;
      void main() {
        vec4 p = vec4(position + aLine * uWidth, 1.0);
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * p;
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      void main() {
        gl_FragColor = vec4(uColor, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    toneMapped: false,
  }));
  hull.raycast = () => {};
  mesh.add(hull);
  return mesh;
}

// ---------------------------------------------------------------- low-poly facets
// Turn any geometry into flat facets, each triangle one tone of `color`, nudged a little in hue, saturation and
// lightness so neighbours differ (cut paper, not plastic). jitter (metres) moves the corners first so the shape is
// irregular; corners at the same place move together, so no cracks. Use with lookFacetMaterial.
function lookFacets(THREE, geometry, color, o = {}) {
  let g = geometry;
  const jitter = o.jitter ?? 0;
  const seed = o.seed ?? 1;
  if (jitter > 0) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const kx = Math.round(x * 1e4), ky = Math.round(y * 1e4), kz = Math.round(z * 1e4);
      p.setXYZ(i,
        x + (lookHash3(kx, ky, kz + seed) - 0.5) * 2 * jitter,
        y + (lookHash3(ky, kz, kx + seed) - 0.5) * 2 * jitter * (o.keepBase && y <= (o.baseY ?? 0) + 1e-4 ? 0 : 1),
        z + (lookHash3(kz, kx, ky + seed) - 0.5) * 2 * jitter);
    }
  }
  if (g.index) g = g.toNonIndexed();
  g.computeVertexNormals();
  const p = g.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const base = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  const c = new THREE.Color();
  const amount = o.amount ?? 1;
  for (let t = 0; t < p.count; t += 3) {
    const cx = (p.getX(t) + p.getX(t + 1) + p.getX(t + 2)) * 333;
    const cy = (p.getY(t) + p.getY(t + 1) + p.getY(t + 2)) * 333;
    const cz = (p.getZ(t) + p.getZ(t + 1) + p.getZ(t + 2)) * 333;
    const a = lookHash3(cx, cy, cz + seed), b = lookHash3(cy, cz, cx + seed), e = lookHash3(cz, cx, cy + seed);
    c.setHSL(hsl.h + (a - 0.5) * 0.025 * amount, Math.min(1, Math.max(0, hsl.s + (b - 0.5) * 0.08 * amount)), Math.min(1, Math.max(0, hsl.l + (e - 0.5) * 0.09 * amount)));
    for (let k = 0; k < 3; k++) { colors[(t + k) * 3] = c.r; colors[(t + k) * 3 + 1] = c.g; colors[(t + k) * 3 + 2] = c.b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}
// One material for every faceted piece: matte, flat-shaded, colour from the facets. Water: lookFacetMaterial(THREE, 0.35).
function lookFacetMaterial(THREE, roughness = 0.9) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness, metalness: 0 });
  m.envMapIntensity = 1.4;
  m.name = 'look:facets';
  return m;
}

// ---------------------------------------------------------------- voxels
// A cube with chamfered edges (44 triangles), edge `size`, chamfer `cut` (default 12% of the edge).
function lookCube(THREE, size, cut) {
  const h = size / 2, a = h - (cut ?? size * 0.12);
  const tris = [];
  const push = (v0, v1, v2) => {
    // wind every triangle to face away from the centre
    const ux = v1[0] - v0[0], uy = v1[1] - v0[1], uz = v1[2] - v0[2];
    const vx = v2[0] - v0[0], vy = v2[1] - v0[1], vz = v2[2] - v0[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const out = nx * (v0[0] + v1[0] + v2[0]) + ny * (v0[1] + v1[1] + v2[1]) + nz * (v0[2] + v1[2] + v2[2]) > 0;
    tris.push(...v0, ...(out ? v1 : v2), ...(out ? v2 : v1));
  };
  const at = (axis, s, u, v) => { const r = [0, 0, 0]; r[axis] = s; r[(axis + 1) % 3] = u; r[(axis + 2) % 3] = v; return r; };
  for (let axis = 0; axis < 3; axis++) {
    for (const s of [-h, h]) {
      // the face
      push(at(axis, s, -a, -a), at(axis, s, a, -a), at(axis, s, a, a));
      push(at(axis, s, -a, -a), at(axis, s, a, a), at(axis, s, -a, a));
      // the chamfer toward the next axis, on both of its sides
      for (const t of [-1, 1]) {
        const p0 = at(axis, s, t * a, -a), p1 = at(axis, s, t * a, a);
        const q0 = at(axis, Math.sign(s) * a, t * h, -a), q1 = at(axis, Math.sign(s) * a, t * h, a);
        push(p0, p1, q1); push(p0, q1, q0);
      }
    }
  }
  // the 8 corners
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    push([sx * h, sy * a, sz * a], [sx * a, sy * h, sz * a], [sx * a, sy * a, sz * h]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris), 3));
  g.computeVertexNormals();
  return g;
}
// A voxel model as one InstancedMesh. cells: [[x, y, z, colour], ...] on a whole-number grid (x right, y up, z toward
// the learner); colour is a hex or a name in o.palette. Each cube is nudged a shade lighter or darker (o.shade, default
// 0.07) so a surface looks hand-placed. Cubes hidden on all six sides are left out. size = metres per cube.
// Returns the mesh; mesh.userData.cells keeps { x, y, z, index } for animation (setMatrixAt + instanceMatrix.needsUpdate).
function lookVoxels(THREE, kit, cells, o = {}) {
  const size = o.size ?? 0.012;
  const filled = new Set(cells.map((c) => `${c[0]},${c[1]},${c[2]}`));
  const open = (x, y, z) => !filled.has(`${x},${y},${z}`);
  const keep = cells.filter(([x, y, z]) => open(x + 1, y, z) || open(x - 1, y, z) || open(x, y + 1, z) || open(x, y - 1, z) || open(x, y, z + 1) || open(x, y, z - 1));
  const material = o.material ?? kit.material('plastic', { color: '#ffffff', roughness: 0.78, wear: 0 });
  const mesh = new THREE.InstancedMesh(lookCube(THREE, size * 0.985), material, keep.length);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  const shade = o.shade ?? 0.07;
  mesh.userData.cells = [];
  keep.forEach(([x, y, z, colour], i) => {
    m.makeTranslation(x * size, y * size + size / 2, z * size);
    mesh.setMatrixAt(i, m);
    c.set((o.palette && o.palette[colour]) || colour || '#cccccc');
    c.multiplyScalar(1 + (lookHash3(x * 1.7, y * 2.3, z * 3.1) - 0.5) * 2 * shade);
    mesh.setColorAt(i, c);
    mesh.userData.cells.push({ x, y, z, index: i });
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}
// A word spelled in cubes, 3 x 5 cells per letter with a gap of 1: A-Z, 0-9, space, - . %. Returns cells for
// lookVoxels, standing in the XY plane at z = 0, starting at x = 0, bottom at y = 0. Width = 4 * letters - 1 cells.
function lookVoxelWord(text, colour, z = 0) {
  const F = {
    A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
    F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
    K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
    P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
    U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
    Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
    4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010', 8: '111101111101111',
    9: '111101111001110', '-': '000000111000000', '.': '000000000000010', '%': '101001010100101', ' ': '000000000000000',
  };
  const cells = [];
  [...String(text).toUpperCase()].forEach((ch, i) => {
    const bits = F[ch] ?? F[' '];
    for (let r = 0; r < 5; r++) for (let k = 0; k < 3; k++) if (bits[r * 3 + k] === '1') cells.push([i * 4 + k, 4 - r, z, colour]);
  });
  return cells;
}

// ---------------------------------------------------------------- clay
// Plasticine: matte and waxy with a velvet sheen, a second colour streaked through (o.streak), fingerprints and pits
// as bumps. Pair with lookLumpy on the geometry so the forms are a little lopsided. Make one per colour and reuse it.
function lookClay(THREE, kit, color, o = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    roughness: o.roughness ?? 0.62,
    metalness: 0,
    sheen: 0.45,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.25),
  });
  const streak = '#' + new THREE.Color(color).lerp(new THREE.Color(o.streak ?? color), 0.6).getHexString();
  m.map = kit.texture('bands', { colors: [color, color, color, streak, color], count: 3, warp: 0.45, seed: o.seed ?? 1 });
  m.bumpMap = kit.texture('noise', { colors: ['#5a5a5a', '#8a8a8a', '#a0a0a0', '#ffffff'], scale: 5, octaves: 4, warp: 0.6, seed: (o.seed ?? 1) + 3 });
  m.bumpScale = o.bump ?? 0.8;
  m.envMapIntensity = 1.3;
  m.userData.kitTile = o.tile ?? 0.09; // finalize() lays the textures at this many metres per tile
  m.name = 'look:clay';
  return m;
}

// ---------------------------------------------------------------- paper card
// A die-cut card: a flat shape `thick` thick whose faces are printed in `ink` (a material) and whose cut edge shows
// the pale core. outline [[x, y], ...] in metres, standing in the XY plane, centred on z.
function lookCard(THREE, kit, outline, ink, core, thick = 0.0012) {
  const mesh = new THREE.Mesh(kit.extrude(outline, thick), [ink, core]);
  return mesh;
}
// Card stock: printed flat colour, matt, with a little fibre. Make one per ink and one core, reuse them.
function lookInk(kit, color) { return kit.material('paper', { color, roughness: 0.92, wear: 0.04 }); }

// ---------------------------------------------------------------- hands: put it back
// A part the learner can pick up and put back. Call after traits(object, { grab: true }); call seat.update(delta) in
// update(). When the part is let go within `radius` of its place it slides home (onHome runs); let go elsewhere it
// stays (onAway runs) and, with `returnAfter` seconds, slides home on its own later. seat.placed is true while home.
function lookSeat(THREE, object, isGrabbed, o = {}) {
  const home = object.position.clone();
  const homeQ = object.quaternion.clone();
  let was = false;
  let away = 0;
  let returning = false;
  const seat = {
    home,
    placed: true,
    update(delta) {
      const held = isGrabbed(object);
      const off = object.position.distanceTo(home);
      if (was && !held) {
        if (off < (o.radius ?? 0.03)) { returning = true; if (o.onHome) o.onHome(); }
        else { away = 0; if (o.onAway) o.onAway(); }
      }
      if (!held && !returning && o.returnAfter && off > 1e-4) {
        away += delta;
        if (away > o.returnAfter) returning = true;
      }
      if (!held && returning) {
        const k = 1 - Math.exp(-10 * delta);
        object.position.lerp(home, k);
        object.quaternion.slerp(homeQ, k);
        if (object.position.distanceTo(home) < 5e-4) { object.position.copy(home); object.quaternion.copy(homeQ); returning = false; }
      }
      seat.placed = !held && object.position.distanceTo(home) < 5e-4;
      was = held;
    },
  };
  return seat;
}


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


// ---------------------------------------------------------------- play kit: rewards and feel for learning games
// Pasted in by scripts/new-game.mjs, after the look kit and the look. Everything here lights itself (lookShade), so
// it reads the same in every look and on the headset, and none of it catches a pinch except the Start button (the
// game makes it pressable). It sits above `export default` on purpose: the look's rules judge the game's own code,
// not these helpers. Hidden pieces still count toward the scene's draw calls, so the kit is a few meshes in all.
//
//   playStars(THREE, { n, size })        a row of n stars standing in XY, facing +z, hidden until earned:
//                                        .userData.show(k) pops them in (k gold, the rest grey), .userData.hide(),
//                                        .userData.update(delta) every frame
//   playStarsFor(value, [one, two, three], lowerIsBetter)   how many stars a result earns (0 to 3)
//   playBurst(THREE, parent, { colour, shade, count, size })   bits that fly out of a point and shrink away:
//                                        .fire(x, y, z) in parent's space; .fire(x, y, z, true) is the win:
//                                        confetti (the same bits, further, in coral, teal and gold); .update(delta)
//   playStartButton(THREE, { size })     a chunky round button with a play triangle, to stand on the playfield:
//                                        traits(button, { onPress }) yourself; .userData.press() sinks it,
//                                        .userData.update(delta) every frame
//   playPointer(THREE, { colour })       a bouncing arrow over the next thing to touch: .userData.at(object) moves it
//                                        there (null hides it), .userData.update(time) every frame
//   playSounds(sound, SOUNDS)            plays the sound-designer's map (parts/sounds.js): .fire(event) plays what
//                                        SOUNDS[event] lists, and nothing for an event it does not list; a looping
//                                        clip (music) plays until .stop(event); silent without a host sound
//   playRing(THREE, parent, { colour })  a ring that spreads on the ground where a result happened (the landing
//                                        point, the catch): .at(x, y, z) in parent's space, .update(delta)
//   playPop()                            a squash-and-stretch bounce on any object: .pop(object, amount),
//                                        .update(delta) every frame; the object keeps its own scale

function playStarShape(THREE, outer, inner) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? inner : outer;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  shape.closePath();
  return shape;
}

function playStars(THREE, o = {}) {
  const n = o.n ?? 3;
  const size = o.size ?? 0.024;
  const gap = o.gap ?? size * 2.4;
  const geometry = new THREE.ExtrudeGeometry(playStarShape(THREE, size, size * 0.45), {
    depth: size * 0.25, bevelEnabled: true, bevelThickness: size * 0.08, bevelSize: size * 0.06, bevelSegments: 1,
  });
  geometry.center();
  const gold = lookShade(THREE, { lit: '#ffd54a', shade: '#e8a21f', deep: '#b8740e', gloss: '#fff6d0' });
  const grey = lookShade(THREE, { lit: '#cfc9bf', shade: '#9a958d' });
  const group = new THREE.Group();
  group.name = 'Stars';
  const stars = [];
  for (let i = 0; i < n; i++) {
    const mesh = new THREE.Mesh(geometry, gold);
    mesh.name = `Star ${i + 1}`;
    mesh.position.x = (i - (n - 1) / 2) * gap;
    mesh.visible = false;
    mesh.raycast = () => {};
    group.add(mesh);
    stars.push({ mesh, t: 1 });
  }
  group.userData.show = (k) => {
    stars.forEach((s, i) => {
      s.mesh.material = i < k ? gold : grey;
      s.mesh.visible = true;
      s.mesh.scale.setScalar(0.001);
      s.t = -0.25 * i; // one after another
    });
  };
  group.userData.hide = () => { for (const s of stars) { s.mesh.visible = false; s.t = 1; } };
  group.userData.update = (delta) => {
    for (const s of stars) {
      if (!s.mesh.visible || s.t >= 1) continue;
      s.t = Math.min(1, s.t + delta * 2.2);
      const k = Math.max(0, s.t);
      s.mesh.scale.setScalar(Math.max(0.001, lookBack(k)));
      s.mesh.rotation.y = (1 - k) * Math.PI;
    }
  };
  return group;
}

function playStarsFor(value, thresholds, lowerIsBetter = false) {
  let stars = 0;
  for (const t of thresholds) if (lowerIsBetter ? value <= t : value >= t) stars++;
  return stars;
}

function playBurst(THREE, parent, o = {}) {
  const count = o.count ?? 8;
  const geometry = new THREE.OctahedronGeometry(o.size ?? 0.006, 0);
  const material = lookShade(THREE, { lit: o.colour ?? '#ffd54a', shade: o.shade ?? '#e8a21f' });
  const party = [
    lookShade(THREE, { lit: '#ff7a59', shade: '#d4502f' }),
    lookShade(THREE, { lit: '#3ec6b4', shade: '#23917f' }),
    lookShade(THREE, { lit: '#ffd54a', shade: '#e8a21f' }),
  ];
  const LIFE = 0.6;
  const bits = [];
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Burst';
    mesh.visible = false;
    mesh.raycast = () => {};
    parent.add(mesh);
    bits.push({ mesh, v: new THREE.Vector3(), life: 0, full: LIFE });
  }
  return {
    fire(x, y, z, win = false) {
      bits.forEach((b, i) => {
        const a = (i / count) * Math.PI * 2 + (win ? i * 0.7 : 0);
        const speed = win ? 0.32 + 0.1 * (i % 3) : 0.22;
        b.mesh.position.set(x, y, z);
        b.mesh.material = win ? party[i % party.length] : material;
        b.v.set(Math.cos(a) * speed, (win ? 0.6 : 0.32) + 0.12 * (i % 2), Math.sin(a) * speed);
        b.full = win ? LIFE * 2.2 : LIFE;
        b.life = b.full;
        b.mesh.visible = true;
      });
    },
    update(delta) {
      for (const b of bits) {
        if (b.life <= 0) continue;
        b.life -= delta;
        b.v.y -= 1.4 * delta;
        b.mesh.position.addScaledVector(b.v, delta);
        b.mesh.rotation.x += delta * 9;
        b.mesh.scale.setScalar(Math.max(0.001, b.life / b.full));
        if (b.life <= 0) b.mesh.visible = false;
      }
    },
  };
}

function playPop() {
  const live = new Map();
  return {
    pop(object, amount = 0.18) {
      const was = live.get(object);
      live.set(object, { base: was ? was.base : object.scale.clone(), k: 1, amount });
    },
    update(delta) {
      for (const [object, p] of live) {
        p.k = Math.max(0, p.k - delta * 3);
        object.scale.copy(p.base).multiplyScalar(1 + p.amount * Math.sin(p.k * Math.PI));
        if (p.k === 0) live.delete(object);
      }
    },
  };
}

function playStartButton(THREE, o = {}) {
  const size = o.size ?? 0.06;
  const group = new THREE.Group();
  group.name = 'Start button';
  const base = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.62, size * 0.66, size * 0.22, 32), lookShade(THREE, { lit: '#2b3a4a', shade: '#1b2632' }));
  base.position.y = size * 0.11;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.5, size * 0.5, size * 0.18, 32), lookShade(THREE, { lit: '#4cd38a', shade: '#2e9e63', gloss: '#e8fff2' }));
  cap.position.y = size * 0.29;
  const play = new THREE.Shape();
  play.moveTo(-size * 0.14, -size * 0.17);
  play.lineTo(size * 0.2, 0);
  play.lineTo(-size * 0.14, size * 0.17);
  play.closePath();
  const triangle = new THREE.Mesh(new THREE.ExtrudeGeometry(play, { depth: size * 0.04, bevelEnabled: false }), lookShade(THREE, { lit: '#ffffff', shade: '#dfe8e3' }));
  triangle.rotation.x = -Math.PI / 2;
  triangle.position.y = size * 0.38;
  group.add(base, cap, triangle);
  let k = 0;
  group.userData.press = () => { k = 1; };
  group.userData.update = (delta) => {
    if (k <= 0) return;
    k = Math.max(0, k - delta * 4);
    const sink = Math.sin(k * Math.PI) * size * 0.1;
    cap.position.y = size * 0.29 - sink;
    triangle.position.y = size * 0.38 - sink;
  };
  return group;
}

function playPointer(THREE, o = {}) {
  // size 1 on the desk; a world shows the game 12 times bigger, so the starter makes it smaller there.
  const size = o.size ?? 1;
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.017 * size, 0.042 * size, 4), lookShade(THREE, { lit: o.colour ?? '#ffd54a', shade: '#e8a21f' }));
  arrow.name = 'Next to touch';
  arrow.rotation.x = Math.PI; // points down
  arrow.visible = false;
  arrow.raycast = () => {};
  const box = new THREE.Box3();
  const top = new THREE.Vector3();
  arrow.userData.at = (object) => {
    if (!object) { arrow.visible = false; return; }
    box.setFromObject(object);
    if (box.isEmpty()) { arrow.visible = false; return; }
    box.getCenter(top);
    top.y = box.max.y;
    if (arrow.parent) arrow.parent.worldToLocal(top);
    top.y += 0.045 * size;
    arrow.visible = true;
  };
  arrow.userData.update = (time) => {
    if (!arrow.visible) return;
    arrow.position.set(top.x, top.y + Math.abs(Math.sin(time * 4)) * 0.018 * size, top.z);
    arrow.rotation.y = time * 1.5;
  };
  return arrow;
}

function playRing(THREE, parent, o = {}) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.003, 6, 40), lookShade(THREE, { lit: o.colour ?? '#ffd54a', shade: '#e8a21f' }));
  ring.name = 'Result ring';
  ring.rotation.x = Math.PI / 2;
  ring.visible = false;
  ring.raycast = () => {};
  parent.add(ring);
  let t = 1;
  return {
    at(x, y, z) { ring.position.set(x, y + 0.003, z); t = 0; ring.visible = true; },
    update(delta) {
      if (t >= 1) return;
      t = Math.min(1, t + delta / 1.4);
      ring.scale.setScalar(1 + ((t * 2) % 1) * 2.2); // spreads twice
      if (t >= 1) ring.visible = false;
    },
  };
}

function playSounds(sound, map = {}) {
  const loops = new Map();
  const clipsOf = (entry) => (Array.isArray(entry) && typeof entry[0] !== 'string' ? entry.flatMap(clipsOf) : typeof entry?.clip === 'string' ? [entry.clip] : []);
  // Generated clips are fetched now, so the first play is on time.
  if (sound?.load) for (const entry of Object.values(map)) for (const id of clipsOf(entry)) sound.load(id);
  const play = (entry, event) => {
    if (!sound || !entry) return;
    if (Array.isArray(entry) && typeof entry[0] === 'string') { sound.play(entry[0], entry[1]); return; }
    if (Array.isArray(entry)) { for (const one of entry) play(one, event); return; }
    if (typeof entry.clip === 'string') {
      if (!sound.clip) return; // a host without generated clips plays nothing for them
      if (entry.loop) { loops.get(event)?.stop(); loops.set(event, sound.clip(entry.clip, entry)); } else sound.clip(entry.clip, entry);
    } else if (typeof entry.note === 'string') sound.note(entry.note, entry);
    else if (typeof entry.tone === 'number') sound.tone(entry.tone, entry);
  };
  return {
    fire(event) { play(map[event], event); },
    stop(event) { loops.get(event)?.stop(); loops.delete(event); },
    hum(id, o) { if (sound) sound.hum(id, o); },
  };
}


// ECS kit: the game as a world of entities, components and systems (EliCS, the ECS Meta's IWSDK is built on;
// skills/common/ecs). An entity is one thing in the game; a component is what the thing is, with its data; a
// system is one thing that happens, run every frame over the entities its query finds. The world runs from the
// game's update(); build() only creates the things.
//
//   const game = playWorld(api)                  api: build()'s argument (it carries ecs, traits, isGrabbed)
//   const Boat = game.component('Boat', { speed: 'number', cargo: 'int', sail: 'object' })
//   game.system('Sail', { boats: [Boat, game.Held] }, (q, delta, time) => {
//     for (const boat of q.boats) boat.setValue(Boat, 'speed', boat.getValue(Boat, 'speed') + delta);
//   })
//   const raft = game.spawn(mesh, Boat, { speed: 0 }, game.Grabbable)   an entity for a 3D object
//   game.objectOf(raft)                            its THREE object
//   raft.getValue(Boat, 'speed'), raft.setValue(Boat, 'speed', 2), raft.hasComponent(game.Held)
//   raft.addComponent(Sinking), raft.removeComponent(Sinking), game.remove(raft)   (hides its object)
//   game.find(Boat, Sinking)                       the entities that have every listed component, now
//   game.update(time, delta)                       call it from update(); runs the systems in their order
//
// Field types: 'number', 'int', 'bool', 'text', 'vec3', 'color', 'object' (any value: a THREE object, a list),
// 'entity', or an EliCS field { type: game.Types.Float32, default: 1 }. A 'vec3' field is read and changed in place
// with entity.getVectorView(C, 'field'). Built in: Thing (every spawned entity; its object), Grabbable (the hands
// may pick it up; it has Held while one does), Pressable (a hand press; it has Pressed for that one frame), Held,
// Pressed. Grabbable and Pressable work on things spawned in build(); spawn later only what the hands do not touch.

function playWorld(api) {
  const ecs = api.ecs;
  if (!ecs) throw new Error('playWorld(api): this host has no ECS (api.ecs).');
  const world = new ecs.World();
  // Component names are global in EliCS; each game (and each reopening of it) gets its own.
  const prefix = `g${Math.random().toString(36).slice(2, 8)}`;
  const T = ecs.Types;
  const SHORT = {
    number: { type: T.Float32, default: 0 },
    int: { type: T.Int32, default: 0 },
    bool: { type: T.Boolean, default: false },
    text: { type: T.String, default: '' },
    vec3: { type: T.Vec3, default: [0, 0, 0] },
    color: { type: T.Color, default: [1, 1, 1, 1] },
    object: { type: T.Object, default: null },
    entity: { type: T.Entity, default: null },
  };
  const all = new Set();
  const pressedNow = new Set();

  function component(name, fields = {}) {
    const schema = {};
    for (const [key, field] of Object.entries(fields)) {
      if (typeof field === 'string') {
        if (!SHORT[field]) throw new Error(`game.component('${name}'): field '${key}' has type '${field}'. Types: ${Object.keys(SHORT).join(', ')}.`);
        schema[key] = { ...SHORT[field] };
      } else schema[key] = field;
    }
    const made = ecs.createComponent(`${prefix}:${name}`, schema, name);
    world.registerComponent(made);
    made.label = name;
    return made;
  }

  const Thing = component('Thing', { object: 'object' });
  const Grabbable = component('Grabbable');
  const Held = component('Held');
  const Pressable = component('Pressable');
  const Pressed = component('Pressed');

  function system(name, queries, run) {
    const config = {};
    for (const [key, query] of Object.entries(queries)) config[key] = Array.isArray(query) ? { required: query } : query;
    const Made = class extends ecs.createSystem(config) {
      update(delta, time) {
        const found = {};
        // A copy of each list: a system may add or remove components while it walks it.
        for (const key of Object.keys(config)) found[key] = [...this.queries[key].entities];
        run(found, delta, time);
      }
    };
    Object.defineProperty(Made, 'name', { value: name });
    world.registerSystem(Made);
    return Made;
  }

  // The hands, first every frame, so the game's systems see Held and Pressed as they are now.
  system('Hands', { grabbable: [Grabbable], pressed: [Pressed] }, (q) => {
    for (const e of q.pressed) e.removeComponent(Pressed);
    for (const e of pressedNow) if (e.active !== false && !e.hasComponent(Pressed)) e.addComponent(Pressed);
    pressedNow.clear();
    for (const e of q.grabbable) {
      const held = Boolean(api.isGrabbed?.(e.getValue(Thing, 'object')));
      if (held && !e.hasComponent(Held)) e.addComponent(Held);
      else if (!held && e.hasComponent(Held)) e.removeComponent(Held);
    }
  });

  function spawn(object, ...items) {
    const e = world.createEntity();
    e.addComponent(Thing, { object });
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const next = items[i + 1];
      const values = next && typeof next === 'object' && !next.schema && !Array.isArray(next) ? next : undefined;
      if (values) i++;
      if (!item || !item.schema) throw new Error(`game.spawn(): ${String(item?.label ?? item)} is not a component (make it with game.component).`);
      e.addComponent(item, values);
    }
    if (object && e.hasComponent(Grabbable)) api.traits(object, { grab: true });
    if (object && e.hasComponent(Pressable)) api.traits(object, { onPress: () => pressedNow.add(e) });
    all.add(e);
    return e;
  }

  return {
    world,
    Types: T,
    Thing, Grabbable, Held, Pressable, Pressed,
    component,
    system,
    spawn,
    objectOf: (e) => e.getValue(Thing, 'object'),
    find(...components) {
      return [...all].filter((e) => e.active !== false && components.every((c) => e.hasComponent(c)));
    },
    remove(e) {
      const object = e.getValue(Thing, 'object');
      if (object) object.visible = false;
      all.delete(e);
      e.destroy();
    },
    update(time, delta) {
      world.update(delta, time);
    },
  };
}

// ---- game.js: the game's own code (everything above is /work/kits.js) ----
// ---- parts (from /work/parts, joined by scripts/assemble.mjs: edit the part files, not this block) ----
// The game's identity: its name, pitch, goal and colours. The ui-designer's part (references/team.md); data only.
// The panel wears `skin` and the result sign its own colours; the kit keeps text readable whatever is picked. The
// app shows the title as the game's opening title card.
const IDENTITY = {
  title: 'Paper dart',
  eyebrow: 'FOLD AND FLY',
  pitch: 'Fold the sheet, then throw the plane as far as you can.',
  skin: { paper: '#f7ecd6', ink: '#1c1622', accent: '#ee5a36', button: '#ee5a36', edge: '#1c1622', round: 14 },
  resultSign: { paper: '#fffdf6', ink: '#ee5a36', edge: '#1c1622' },
};

// The game's sounds: what each game event plays. The sound-designer's part (references/team.md); data only.
// An entry is [effect, { pitch, volume }] (effects: pop, click, tick, good, bad, coin, bounce, win, whoosh, splash),
// { note: 'C4', seconds }, { tone: 440, seconds, type, glide } or { clip: id, volume, loop } from the sound library
// (/skills/common/sound/references/library.md); a list of entries plays them all.
const SOUNDS = {
  touch: { clip: 'snd-8b70a4ffa5', volume: 0.35 },               // paper-rustle: a pinch on the paper
  fold: { clip: 'snd-8b70a4ffa5', volume: 0.8 },                 // paper-rustle: a flap lands
  crease: [{ clip: 'snd-8b70a4ffa5', volume: 0.8 }, ['tick', { volume: 0.6 }]],
  cheer: { clip: 'snd-5745be6b26', volume: 0.6 },                // chime-good: a move is done
  start: { clip: 'snd-ae44cff8e4', volume: 0.5 },                // whoosh: the plane lifts to the tee
  throw: { clip: 'snd-92d728b1f0', volume: 0.9 },                // paper-throw: let go
  land: ['pop', { volume: 0.5 }],
  win: [{ clip: 'snd-b9fd9aad68', volume: 0.7 }, ['win', { volume: 0.7 }]],
  miss: { clip: 'snd-2c9f851c14', volume: 0.5 },                 // knock-soft-miss
  music: { clip: 'snd-fc895efa75', loop: true, volume: 0.12 },   // wind-hill: air for the flight
};
// ---- end of parts ----

// Paper dart: a Build it game that ends as a Test it game (references/design.md). The player folds one orange sheet
// with their hands (crease, nose, edges, wings), then throws it; how far it glides depends on the V of the wings and
// on both wings being even. Entities: the sheet, two wings, five flaps, three pinch balls, the Start button and the
// round. Systems run in the order they are made below: hands first, then the rules, then what the player sees.
export default function build(api) {
  const { THREE, kit, ui, sound } = api;
  const root = new THREE.Group();
  const sfx = playSounds(sound, SOUNDS);
  const look = inkToonLook(THREE, kit);
  const game = playWorld(api);

  // The desk sheet of the look. Never grabbable.
  const set = look.set();
  root.add(set);
  const TOP = set.userData.top;
  const subject = new THREE.Group();
  subject.name = 'Subject';
  subject.userData.subject = true;
  subject.position.y = TOP;
  root.add(subject);

  // ------------------------------------------------------------------ numbers (metres on the desk)
  const W = 0.147, D = 0.208, HW = W / 2, HD = D / 2;   // an A4 sheet at 0.7 scale
  const PT = 0.0008;                                    // one layer of paper
  const Y0 = 0.002;                                     // the wings turn about this height above the desk sheet
  const BZ = 1.2071 * W, CX = 0.2071 * W;               // the second fold: where it ends on the edge, and where it crosses the first
  const BENCH_Z = 0.02;                                 // the sheet's centre while it is folded
  const TEE = { y: 0.07, z: 0.14 };                     // where the plane is held to throw it, near the player
  const K = 26;                                         // metres in the air for each metre on the desk
  const IDEAL = 0.44;                                   // 25 degrees: the wing angle the V shows
  const REACH = 0.0615, LIFT = 0.019;                   // where a wing's pinch ball sits: along the wing, above it
  const BALL = Math.hypot(REACH, LIFT), BIAS = Math.atan2(LIFT, REACH);
  const GRIP = { y: 0.012, z: HD + 0.04 };              // the tail ball sits behind the plane

  // ------------------------------------------------------------------ the paper
  // A flat piece of paper: orange face on top, white back under it. list = [[x, z], ...] seen from above, mirrored by s.
  // Its top face is at y = 0 of its group, so a flap that turns about y = 0 lands exactly on top of what is under it.
  const outline = (list, s) => list.map(([x, z]) => [s * x, -z]);
  function leaf(list, s, face, back, name) {
    const g = new THREE.Group();
    g.name = name;
    const top = look.cutout(outline(list, s), PT, face, name, { flat: true, line: 0.001 });
    top.position.y = -PT;
    g.add(top);
    if (back) {
      const under = look.cutout(outline(list, s), PT, back, `${name} back`, { flat: true, outline: false });
      under.position.y = -2 * PT;
      g.add(under);
    }
    return g;
  }
  const sheet = new THREE.Group();
  sheet.name = 'Paper plane';
  sheet.rotation.order = 'YXZ';
  sheet.position.set(0, 0, BENCH_Z);
  subject.add(sheet);

  // One wing: three states of the same half sheet (flat, nose folded in, edges folded in) and the two flaps that
  // change one state into the next. One state shows at a time; a flap keeps its folded pose.
  function buildWing(s) {
    const group = new THREE.Group();
    group.name = s < 0 ? 'Left wing' : 'Right wing';
    group.position.y = Y0;
    sheet.add(group);
    const put = (o, x, y, z) => { o.position.set(x, y, z); group.add(o); return o; };
    const half = put(leaf([[0, -HD], [HW, -HD], [HW, HD], [0, HD]], s, 'persimmon', s < 0 ? 'white' : null, `${group.name} sheet`), 0, 0, 0);
    // after the nose fold: the body, and the corner that turns over on a hinge along the slanted line
    const body1 = put(leaf([[0, -HD], [HW, -HD + HW], [HW, HD], [0, HD]], s, 'persimmon', null, `${group.name} body`), 0, 0, 0);
    const noseHinge = put(new THREE.Group(), 0, 0, -HD);
    noseHinge.name = `${group.name} nose fold`;
    noseHinge.add(leaf([[0, 0], [HW, 0], [HW, HW]], s, 'persimmon', 'white', `${group.name} corner`));
    // after the edge fold: the narrower body, the nose layer left on top, and the strip that turns over
    const body2 = put(leaf([[0, -HD], [HW, -HD + BZ], [HW, HD], [0, HD]], s, 'persimmon', null, `${group.name} narrow body`), 0, 0, 0);
    const nose2 = put(leaf([[0, 0], [0, HW], [CX, HW]], s, 'white', 'persimmon', `${group.name} nose layer`), 0, 2 * PT, -HD);
    const edgeHinge = put(new THREE.Group(), 0, 2 * PT, -HD);
    edgeHinge.name = `${group.name} edge fold`;
    const strip = leaf([[0, 0], [HW, HW], [HW, BZ]], s, 'persimmon', 'white', `${group.name} strip`);
    strip.position.y = -2 * PT;
    edgeHinge.add(strip, leaf([[0, 0], [HW, HW], [CX, HW]], s, 'white', 'persimmon', `${group.name} strip layer`));
    const stages = [[half], [body1, noseHinge], [body2, nose2, edgeHinge]];
    return { s, group, stages, noseHinge, edgeHinge, noseAxis: new THREE.Vector3(s, 0, 1).normalize(), edgeAxis: new THREE.Vector3(s * HW, 0, BZ).normalize() };
  }
  const wingParts = [buildWing(-1), buildWing(1)];   // left, right
  function showStage(n) {
    for (const w of wingParts) w.stages.forEach((list, i) => list.forEach((o) => { o.visible = i === n; }));
  }
  showStage(0);
  const crease = look.mark([[[[0, -HD], [0, HD]], 0.0016, 'none']], 'ink', { name: 'Crease' });
  crease.rotation.x = -Math.PI / 2;
  crease.position.y = Y0 + 0.0004;
  crease.visible = false;
  sheet.add(crease);
  const shadow = look.shadow(0.085, 0.12, 'Plane shadow');
  shadow.position.set(0.025, shadow.position.y, BENCH_Z - 0.02);
  subject.add(shadow);

  // ------------------------------------------------------------------ the pinch balls
  const pinchBall = (name) => look.ball(0.017, 'mustard', name, { own: true, halftone: true });
  const balls = [pinchBall('Left pinch ball'), pinchBall('Right pinch ball')];
  const gripBall = pinchBall('Tail ball');
  subject.add(balls[0], balls[1], gripBall);
  balls[1].visible = false;
  gripBall.visible = false;

  // ------------------------------------------------------------------ marks that show what to do
  // A curved arrow over each fold: where the pinch ball goes. One for the crease, a pair for each flap fold.
  const arrow = (r, from, to, x, y, z, flip) => {
    const a = look.motionArc(r, from, to, { width: 0.004 });
    a.position.set(x, y, z);
    if (flip) a.scale.x = -1;
    a.visible = false;
    sheet.add(a);
    return a;
  };
  const arrows = [
    [arrow(0.07, Math.PI - 0.35, 0.35, 0, Y0 + 0.01, 0.0, false)],
    [arrow(0.022, 2.7, 0.45, -0.039, Y0 + 0.03, -HD + 0.03, true), arrow(0.022, 2.7, 0.45, 0.039, Y0 + 0.03, -HD + 0.03, false)],
    [arrow(0.022, 2.7, 0.45, -0.039, Y0 + 0.03, -HD + 0.093, true), arrow(0.022, 2.7, 0.45, 0.039, Y0 + 0.03, -HD + 0.093, false)],
  ];
  // The V to copy: two yellow lines at the wing angle, standing in front of the sheet.
  const guide = look.mark([
    [[[0, 0], [HW * Math.cos(IDEAL), HW * Math.sin(IDEAL)]], 0.005, 'none'],
    [[[0, 0], [-HW * Math.cos(IDEAL), HW * Math.sin(IDEAL)]], 0.005, 'none'],
  ], 'mustard', { name: 'Wing V' });
  guide.position.set(0, Y0, HD + 0.016);
  guide.visible = false;
  sheet.add(guide);
  // One lettered word per step, low at the front, beside the hero.
  const words = ['CREASE', 'NOSE', 'EDGES', 'WINGS', 'THROW!'].map((w, i) => {
    const card = look.stepWord(w, { h: 0.014, n: i + 1 });
    card.position.set(0.135, 0, 0.115);
    card.visible = i === 0;
    subject.add(card);
    return card;
  });
  // The ruler for the throw: a line across the desk at 2, 4 and 6 metres from the tee.
  const ruler = new THREE.Group();
  ruler.name = 'Ruler';
  for (const m of [2, 4, 6]) {
    const z = TEE.z - m / K;
    const line = look.mark([[[[-0.15, 0], [0.15, 0]], 0.0014, 'none']], 'ink', { name: `${m} metre line` });
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.0006, z);
    const label = look.letters(`${m} M`, { h: 0.011, face: 'white', block: 'teal', name: `${m} metres` });
    label.rotation.x = -Math.PI / 2;
    label.position.set(-0.19, 0.0008, z + 0.014);
    ruler.add(line, label);
  }
  ruler.visible = false;
  subject.add(ruler);
  // Effects for the throw: streaks behind the plane in the air, ticks where it lands.
  const streaksTurn = new THREE.Group();
  const streaks = look.speedLines(0.06, { n: 3, gap: 0.014 });
  streaks.rotation.x = -Math.PI / 2;
  streaksTurn.add(streaks);
  streaksTurn.visible = false;
  subject.add(streaksTurn);
  const thump = look.impact(7, 0.02, 0.014, { ry: 0.01, from: 0, to: Math.PI, name: 'Landing ticks' });
  thump.visible = false;
  subject.add(thump);

  // ------------------------------------------------------------------ components: what things are
  const RoundC = game.component('Round', { phase: 'text', move: 'int', demoT: 'number', idle: 'number', nudge: 'number', best: 'number', request: 'text', shown: 'text' });
  const Plane = game.component('Plane', {
    mode: 'text', t: 'number', heading: 'number', speed: 'number', sink: 'number', turn: 'number', wobble: 'number',
    x0: 'number', y0: 'number', z0: 'number', dist: 'number', build: 'number', even: 'number', push: 'number',
  });
  const Wing = game.component('Wing', { side: 'int', angle: 'number', demo: 'number', sweet: 'bool' });
  const Flap = game.component('Flap', { side: 'int', move: 'int', t: 'number', goal: 'number', demo: 'number', hold: 'number', drag: 'bool', told: 'bool' });
  const Handle = game.component('Handle', { index: 'int', role: 'text', was: 'bool' });
  const Grip = game.component('Grip', { was: 'bool' });
  const StartPad = game.component('StartPad');
  const Folded = game.component('Folded');
  const Creased = game.component('Creased');

  // ------------------------------------------------------------------ entities: the things
  const round = game.spawn(null, RoundC, { phase: 'learn', demoT: -1, idle: 6.5, nudge: 0, best: -1 });
  const planeE = game.spawn(sheet, Plane, { mode: 'bench', z0: BENCH_Z });
  const wingE = wingParts.map((w) => game.spawn(w.group, Wing, { side: w.s }));
  const flapE = [
    [game.spawn(wingParts[0].group, Flap, { side: -1, move: 0 })],
    wingParts.map((w) => game.spawn(w.noseHinge, Flap, { side: w.s, move: 1 })),
    wingParts.map((w) => game.spawn(w.edgeHinge, Flap, { side: w.s, move: 2 })),
  ];
  const handleE = balls.map((b, i) => game.spawn(b, Handle, { index: i, role: i === 0 ? 'fold' : 'off' }, game.Grabbable));
  const gripE = game.spawn(gripBall, Grip, game.Grabbable);

  // Where each pinch ball waits on its flap, and the straight line the hand carries it along (sheet coordinates).
  const reflect = (px, pz, dx, dz) => { const l = Math.hypot(dx, dz); const ux = dx / l, uz = dz / l, d = px * ux + pz * uz; return [2 * d * ux - px, 2 * d * uz - pz]; };
  const lineOf = (x, z, qx, qz) => { const dx = qx - x, dz = qz - z, len = Math.hypot(dx, dz); return { x, z, ux: dx / len, uz: dz / len, len }; };
  const noseLine = (s) => { const p = [s * (HW - 0.016), 0.02], q = reflect(p[0], p[1], s, 1); return lineOf(p[0], p[1] - HD, q[0], q[1] - HD); };
  const edgeLine = (s) => { const p = [s * (HW - 0.016), 0.085], q = reflect(p[0], p[1], s * HW, BZ); return lineOf(p[0], p[1] - HD, q[0], q[1] - HD); };
  const DRAG = [[lineOf(-HW + 0.016, 0.01, HW - 0.016, 0.01)], [noseLine(-1), noseLine(1)], [edgeLine(-1), edgeLine(1)]];
  const FOLD_Y = Y0 + 0.02;
  // Every ball starts where it will first be used, so nothing waits on top of another.
  balls[0].position.set(DRAG[0][0].x, FOLD_Y, BENCH_Z + DRAG[0][0].z);
  balls[1].position.set(DRAG[1][1].x, FOLD_Y, BENCH_Z + DRAG[1][1].z);

  // ------------------------------------------------------------------ small helpers
  const SP = sheet.position;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const R = (k) => round.getValue(RoundC, k);
  const setR = (k, v) => round.setValue(RoundC, k, v);
  const P = (k) => planeE.getValue(Plane, k);
  const setP = (k, v) => planeE.setValue(Plane, k, v);
  const angleOf = (i) => wingE[i].getValue(Wing, 'angle');
  const ask = (what) => setR('request', what);
  const heldAny = () => handleE.some((h) => h.hasComponent(game.Held)) || gripE.hasComponent(game.Held);
  const gripOffset = new THREE.Vector3(0, GRIP.y, GRIP.z);
  let dd = 0;           // seconds that passed on the twos clock this frame (a pose is held for two frames)
  let live = 0;         // seconds that really passed
  let now = 0;
  let thumpT = 0;
  let lastTq = 0;

  // ------------------------------------------------------------------ the panel, rewards and Start button
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const big = Math.max(size.x, size.y, size.z);
  const MOVES = [
    { say: 'Pinch the yellow ball and carry the left half over the right.', why: 'The centre crease keeps both wings the same size, so it flies straight.', done: () => flapE[0][0].hasComponent(Creased) },
    { say: 'Carry each top corner to the centre line.', why: 'A pointed nose cuts the air and puts the weight at the front.', done: () => flapE[1].every((f) => f.hasComponent(Folded)) },
    { say: 'Carry each slanted edge in to the centre line again.', why: 'A narrow, heavy nose keeps the plane from tipping up and stalling.', done: () => flapE[2].every((f) => f.hasComponent(Folded)) },
    { say: 'Lift each wing until it matches the yellow V.', why: 'Wings in a V right themselves, so the plane glides straight.', done: () => !heldAny() && [0, 1].every((i) => angleOf(i) > 0.2 && angleOf(i) < 0.75) },
  ];
  const CHALLENGE = { say: 'Pinch the tail ball, swing forward and let go.', label: 'metres', stars: [1.5, 3, 4.5], lowerIsBetter: false };
  const panel = kit.panel(ui, {
    width: 0.3, position: [Math.max(1.06 * big, box.max.x + 0.05), 0.6 * big, 0], rotationY: -0.3, eyebrow: IDENTITY.eyebrow, title: IDENTITY.title, skin: IDENTITY.skin,
    items: [
      { text: IDENTITY.pitch, id: 'goal' },
      { status: MOVES[0].say, tone: 'neutral', id: 'state' },
      { text: 'Do it with your hands: the why shows up here.', id: 'why' },
      { progress: 0, label: `0 of ${MOVES.length}`, id: 'moves' },
      { stat: '-', label: CHALLENGE.label, id: 'result' },
      { stat: '-', label: 'best', id: 'best' },
      { buttons: [
        { label: 'Start', id: 'start', onPress() { ask('start'); } },
        { label: 'Try again', id: 'again', onPress() { ask('start'); } },
        { label: 'Show me', id: 'hint', onPress() { ask('hint'); } },
      ] },
    ],
  });
  root.add(panel.object3D);
  panel.show('start', false);
  panel.show('again', false);
  const stars = playStars(THREE);
  stars.position.set((box.min.x + box.max.x) / 2, box.max.y + 0.04, box.min.z + 0.02);
  root.add(stars);
  const burst = playBurst(THREE, root);
  const pops = playPop();
  const pointer = playPointer(THREE);
  root.add(pointer);
  const ring = playRing(THREE, root);
  const resultSign = kit.sign('3 OF 3 STARS', { width: 0.16, ...IDENTITY.resultSign, sub: CHALLENGE.label });
  resultSign.visible = false;
  root.add(resultSign);
  const startButton = playStartButton(THREE);
  startButton.position.set(box.min.x + 0.06, TOP, 0.1);
  gripBall.position.set(0, TEE.y + GRIP.y, TEE.z + GRIP.z);   // after the box is measured: the tee is in the air in front of the sheet
  startButton.visible = false;
  root.add(startButton);
  game.spawn(startButton, StartPad, game.Pressable);
  const at = new THREE.Vector3();
  function cheer(object) {
    pops.pop(object);
    object.getWorldPosition(at);
    root.worldToLocal(at);
    burst.fire(at.x, at.y, at.z);
  }
  const showWord = (n) => { words.forEach((w, i) => { w.visible = i === n; }); pops.pop(words[n], 0.2); };
  const nextBall = () => (R('move') === 0 ? balls[0] : balls[1]);

  // ------------------------------------------------------------------ the moves, the round and the throw
  function setupMove(n) {
    panel.set('state', MOVES[n].say, 'neutral');
    if (n >= 1 && n <= 2) showStage(n);
    handleE.forEach((h, i) => h.setValue(Handle, 'role', n === 3 ? 'tilt' : n === 0 && i === 1 ? 'off' : 'fold'));
    arrows.forEach((set2, k) => set2.forEach((a) => { a.visible = k === n; }));
    guide.visible = n === 3;
    showWord(n);
    setR('demoT', -1);
    setR('idle', 6.5);
    pointer.userData.at(n === 0 ? balls[0] : balls[1]);
  }
  function nextMove() {
    const m = R('move');
    sfx.fire('cheer');
    cheer(sheet);
    panel.set('why', MOVES[m].why);
    setR('move', m + 1);
    panel.set('moves', (m + 1) / MOVES.length);
    if (m + 1 < MOVES.length) { setupMove(m + 1); return; }
    setR('phase', 'ready');
    arrows.forEach((set2) => set2.forEach((a) => { a.visible = false; }));
    startButton.visible = true;
    pointer.userData.at(startButton);
    panel.set('state', 'Tilt the wings if you like. Press Start to throw.', 'good');
    panel.show('start', true);
  }
  // Start and Try again: the plane lifts to the tee in front of the player.
  function begin() {
    sfx.fire('start');
    sfx.fire('music');
    setP('mode', 'toTee');
    setP('t', 0);
    setP('x0', SP.x); setP('y0', SP.y); setP('z0', SP.z);
    setP('heading', -sheet.rotation.y);
    setR('phase', 'play');
    stars.userData.hide();
    resultSign.visible = false;
    startButton.visible = false;
    thump.visible = false;
    ruler.visible = true;
    guide.visible = false;
    showWord(4);
    pointer.userData.at(null);
    panel.set('state', CHALLENGE.say, 'neutral');
    panel.set('result', '0.0');
    panel.show('start', false);
    panel.show('again', false);
  }
  function finish() {
    setR('phase', 'done');
    sfx.stop('music');
    const dist = P('dist');
    const best = R('best') < 0 ? dist : Math.max(R('best'), dist);
    setR('best', best);
    const k = playStarsFor(dist, CHALLENGE.stars, false);
    stars.userData.show(k);
    sfx.fire('land');
    sfx.fire(k > 0 ? 'win' : 'miss');
    ring.at(SP.x, TOP, SP.z);
    resultSign.userData.setText(`${k} OF 3 STARS`, `${dist.toFixed(1)} ${CHALLENGE.label}`);
    resultSign.position.set(SP.x, TOP + 0.09, SP.z + 0.02);
    resultSign.visible = true;
    pops.pop(resultSign, 0.3);
    thump.position.set(SP.x, 0.002, SP.z);
    thump.visible = true;
    thumpT = 0.14;
    if (k === 3) burst.fire(SP.x, TOP + 0.05, SP.z, true);
    startButton.visible = true;
    pointer.userData.at(startButton);
    panel.set('result', dist.toFixed(1));
    panel.set('best', best.toFixed(1));
    const uneven = Math.abs(angleOf(0) - angleOf(1)) > 0.15, off = Math.abs((angleOf(0) + angleOf(1)) / 2 - IDEAL) > 0.2;
    panel.set('why', uneven ? 'One wing sat higher, so the plane curved. Make both wings match.'
      : off ? 'Wings flat or too steep wobble and drop. Match the yellow V.'
      : P('push') < 0.85 ? 'Good wings. A firmer, level throw goes farther.'
      : 'Even wings in a V: that is why a dart flies straight and far.');
    panel.set('state', k === 3 ? 'Three stars!' : `${k} of 3 stars. Try again to beat ${best.toFixed(1)}.`, k >= 2 ? 'good' : 'neutral');
    panel.show('again', true);
  }
  function placeAtTee() {
    sheet.position.set(0, TEE.y, TEE.z);
    sheet.rotation.set(0, 0, 0);
    gripBall.position.copy(sheet.position).add(gripOffset);
  }
  // The plane leaves the hand: how well it was built decides how it glides; how it was thrown adds a little.
  const samples = new Float32Array(8 * 4);
  let sampleN = 0;
  function launch(vx, vy, vz) {
    const hv = Math.hypot(vx, vz);
    const speedN = clamp((hv - 0.5) / 2.5, 0, 1);
    const pitch0 = Math.atan2(vy, hv);
    const a0 = angleOf(0), a1 = angleOf(1);
    const dh = clamp(1 - Math.abs((a0 + a1) / 2 - IDEAL) / 0.4, 0, 1);       // wings near the V
    const even = clamp(1 - Math.abs(a0 - a1) / 0.3, 0, 1);                    // both wings the same
    const built = dh * (0.5 + 0.5 * even);
    const thrown = (0.82 + 0.18 * speedN) * clamp(1 - 1.2 * Math.abs(pitch0 - 0.1), 0.65, 1);
    const glide = (0.55 + 2.45 * built) * thrown;
    const v0 = 0.08 + 0.04 * speedN;
    sheet.position.y = clamp(sheet.position.y, 0.06, 0.09);
    setP('mode', 'flying');
    setP('t', 0);
    setP('heading', clamp(Math.atan2(vx, -vz), -0.4, 0.4));
    setP('speed', v0);
    setP('sink', v0 / glide);
    setP('turn', (a0 - a1) * 1.2);
    setP('wobble', (1 - dh) * 0.5 + (1 - even) * 0.2);
    setP('x0', SP.x); setP('z0', SP.z);
    setP('build', built); setP('even', even); setP('push', thrown);
    sfx.fire('throw');
    gripBall.visible = false;
    pointer.userData.at(null);
    panel.set('state', 'Flying...', 'neutral');
  }
  function release() {
    const n = Math.min(sampleN, 8), last = ((sampleN - 1) % 8) * 4;
    let old = last;
    for (let k = 1; k < n; k++) {
      const j = (((sampleN - 1 - k) % 8) + 8) % 8 * 4;
      if (samples[last] - samples[j] > 0.12) break;
      old = j;
    }
    const span = samples[last] - samples[old];
    let vx = 0, vy = 0, vz = 0;
    if (span > 0.02) {
      vx = (samples[last + 1] - samples[old + 1]) / span;
      vy = (samples[last + 2] - samples[old + 2]) / span;
      vz = (samples[last + 3] - samples[old + 3]) / span;
    }
    sampleN = 0;
    if (-vz < 0.4) {   // not a throw: it goes back to the tee
      placeAtTee();
      sfx.fire('miss');
      panel.set('state', 'Swing your hand forward, then let go.', 'neutral');
      pointer.userData.at(gripBall);
      return;
    }
    launch(vx, vy, vz);
  }

  // ------------------------------------------------------------------ systems: what happens, in this order
  // Carry: a pinch ball in a hand turns into a fold, or a wing angle. Letting go decides: past half way it finishes.
  game.system('Carry', { handles: [Handle] }, (q) => {
    const move = R('move');
    for (const h of q.handles) {
      const o = game.objectOf(h), i = h.getValue(Handle, 'index'), role = h.getValue(Handle, 'role');
      const held = h.hasComponent(game.Held), was = h.getValue(Handle, 'was');
      if (held && !was) { sfx.fire('touch'); setR('idle', 0); }
      if (role === 'fold') {
        const f = flapE[move]?.[i], g = DRAG[move]?.[i];
        if (f && g && !f.hasComponent(Folded)) {
          if (held) {
            const t = clamp(((o.position.x - SP.x - g.x) * g.ux + (o.position.z - SP.z - g.z) * g.uz) / g.len, 0, 1);
            f.setValue(Flap, 't', t);
            f.setValue(Flap, 'goal', t);
            f.setValue(Flap, 'drag', true);
          } else if (was) {
            f.setValue(Flap, 'drag', false);
            f.setValue(Flap, 'goal', f.getValue(Flap, 't') > 0.5 ? 1 : 0);
          }
        }
      } else if (role === 'tilt' && held) {
        const dx = (o.position.x - SP.x) * (i === 0 ? -1 : 1), dy = o.position.y - SP.y - Y0;
        wingE[i].setValue(Wing, 'angle', clamp(Math.atan2(dy, Math.max(0.004, dx)) - BIAS, 0, 1.15));
      }
      h.setValue(Handle, 'was', held);
    }
  });

  // Fold: a flap that is not in a hand swings to where it was heading. The crease lies flat a moment, then opens.
  game.system('Fold', { flaps: [Flap] }, (q) => {
    for (const f of q.flaps) {
      if (f.getValue(Flap, 'drag')) continue;
      let t = f.getValue(Flap, 't');
      const goal = f.getValue(Flap, 'goal');
      if (t !== goal) {
        t += (goal - t) * Math.min(1, dd * 12);
        if (Math.abs(goal - t) < 0.01) t = goal;
        f.setValue(Flap, 't', t);
      }
      const isCrease = f.getValue(Flap, 'move') === 0;
      if (t === 1 && !f.hasComponent(Folded)) f.addComponent(Folded);
      if (isCrease && t === 1 && goal === 1) {
        const hold = f.getValue(Flap, 'hold') + dd;
        f.setValue(Flap, 'hold', hold);
        if (hold > 0.5) { f.setValue(Flap, 'goal', 0); f.setValue(Flap, 'hold', -1); }
      }
      if (isCrease && t === 0 && f.getValue(Flap, 'hold') === -1 && !f.hasComponent(Creased)) f.addComponent(Creased);
    }
  });

  // Demo: when the player has been still a while, the next fold does itself half way and back. Show me does it now.
  game.system('Demo', { rounds: [RoundC] }, () => {
    const phase = R('phase'), move = R('move');
    let demoT = R('demoT');
    const idle = R('idle') + live;
    if (demoT < 0 && idle > 7 && (phase === 'learn' || phase === 'ready')) { demoT = 0; setR('idle', 0); } else setR('idle', idle);
    if (demoT >= 0) { demoT += dd; if (demoT > 1.4) demoT = -1; }
    setR('demoT', demoT);
    const pulse = demoT >= 0 ? Math.sin(Math.PI * demoT / 1.4) : 0;
    for (const list of flapE) for (const f of list) {
      const on = phase === 'learn' && f.getValue(Flap, 'move') === move && !f.hasComponent(Folded);
      f.setValue(Flap, 'demo', on ? pulse * 0.45 : 0);
    }
    for (const w of wingE) w.setValue(Wing, 'demo', (phase === 'learn' && move === 3) || phase === 'ready' ? pulse * 0.3 : 0);
    let nudge = R('nudge') - live;
    if (nudge <= 0) {
      nudge = 2.5;
      if (phase === 'learn') pops.pop(nextBall(), 0.06);
    }
    setR('nudge', nudge);
  });

  // Throw: the plane rides to the tee; there the tail ball carries it, and letting go throws it at the hand's speed.
  game.system('Throw', { grips: [Grip] }, () => {
    const mode = P('mode');
    const held = gripE.hasComponent(game.Held), was = gripE.getValue(Grip, 'was');
    if (mode === 'toTee') {
      const t = P('t') + dd;
      setP('t', t);
      const e = lookBack(lookSeg(t, 0, 0.5), 1.5);
      sheet.position.set(P('x0') * (1 - e), P('y0') + (TEE.y - P('y0')) * e, P('z0') + (TEE.z - P('z0')) * e);
      sheet.rotation.set(0, -P('heading') * (1 - e), 0);
      if (t >= 0.5) {
        setP('mode', 'tee');
        placeAtTee();
        gripBall.visible = true;
        pops.pop(gripBall, 0.15);
        pointer.userData.at(gripBall);
      }
    } else if (mode === 'tee') {
      if (held) {
        if (!was) { sfx.fire('touch'); sampleN = 0; }
        sheet.position.copy(gripBall.position).sub(gripOffset);
        const k = (sampleN % 8) * 4;
        samples[k] = now; samples[k + 1] = gripBall.position.x; samples[k + 2] = gripBall.position.y; samples[k + 3] = gripBall.position.z;
        sampleN++;
        pointer.userData.at(null);
      } else if (was) release();
    }
    gripE.setValue(Grip, 'was', held);
  });

  // Fly: it glides on a line that sinks as fast as the build allows; uneven wings turn it, flat wings make it wobble.
  game.system('Fly', { planes: [Plane] }, () => {
    if (P('mode') !== 'flying') return;
    const t = P('t') + dd;
    setP('t', t);
    const psi = P('heading') + P('turn') * dd;
    setP('heading', psi);
    sheet.position.x += Math.sin(psi) * P('speed') * dd;
    sheet.position.z -= Math.cos(psi) * P('speed') * dd;
    sheet.position.y -= P('sink') * dd;
    const wob = P('wobble') * Math.sin(t * 9);
    sheet.rotation.set(-Math.atan2(P('sink'), P('speed')) * 0.7 + wob * 0.3, -psi, -P('turn') * 0.8 + wob);
    streaksTurn.visible = Math.floor(t * 15) % 2 === 0;
    streaksTurn.position.set(SP.x - Math.sin(psi) * 0.12, SP.y + 0.012, SP.z + Math.cos(psi) * 0.12);
    streaksTurn.rotation.y = -Math.PI / 2 - psi;
    if (sheet.position.y <= 0) {
      sheet.position.y = 0;
      sheet.rotation.set(0, -psi, 0);
      streaksTurn.visible = false;
      setP('dist', Math.hypot(SP.x - P('x0'), SP.z - P('z0')) * K);
      setP('mode', 'landed');
    }
  });

  // Round: the panel's buttons, Start, the moves one after another, and the end of a throw.
  game.system('Round', { rounds: [RoundC], presses: [StartPad, game.Pressed] }, (q) => {
    const phase = R('phase');
    let req = R('request');
    if (q.presses.length) { startButton.userData.press(); req = 'start'; }
    if (req) {
      setR('request', '');
      if (req === 'start' && (phase === 'ready' || phase === 'done')) begin();
      else if (req === 'hint') { setR('demoT', 0); setR('idle', 0); pops.pop(phase === 'learn' ? nextBall() : phase === 'play' ? gripBall : startButton, 0.2); }
    }
    const now2 = R('phase');
    if (now2 === 'learn' && MOVES[R('move')].done()) nextMove();
    else if (now2 === 'play') {
      const mode = P('mode');
      if (mode === 'landed') finish();
      else if (mode === 'flying') {
        const text = (Math.hypot(SP.x - P('x0'), SP.z - P('z0')) * K).toFixed(1);
        if (text !== R('shown')) { setR('shown', text); panel.set('result', text); }
      }
    }
  });

  // Pose: draw the state: wings and flaps at their angles, the pinch balls where the hands should go.
  game.system('Pose', { flaps: [Flap], wings: [Wing] }, () => {
    const phase = R('phase'), move = R('move'), mode = P('mode');
    for (let i = 0; i < 2; i++) {
      const w = wingParts[i], a = angleOf(i) + wingE[i].getValue(Wing, 'demo');
      const c = flapE[0][0];
      w.group.rotation.z = w.s * a - (i === 0 ? Math.PI * Math.max(c.getValue(Flap, 't'), c.getValue(Flap, 'demo')) : 0);
      for (const [list, hinge, axis] of [[flapE[1], w.noseHinge, w.noseAxis], [flapE[2], w.edgeHinge, w.edgeAxis]]) {
        const f = list[i];
        hinge.quaternion.setFromAxisAngle(axis, w.s * Math.PI * Math.max(f.getValue(Flap, 't'), f.getValue(Flap, 'demo')));
      }
    }
    crease.visible = flapE[0][0].hasComponent(Creased);
    for (let i = 0; i < 2; i++) {
      const h = handleE[i], o = balls[i], role = h.getValue(Handle, 'role');
      if (h.hasComponent(game.Held)) continue;
      if (role === 'fold') {
        const f = flapE[move]?.[i], g = DRAG[move]?.[i];
        const open = phase === 'learn' && f && g && !f.hasComponent(move === 0 ? Creased : Folded) && f.getValue(Flap, 't') < 0.02;
        o.visible = Boolean(open);
        if (open) o.position.set(SP.x + g.x, SP.y + FOLD_Y, SP.z + g.z);
      } else if (role === 'tilt') {
        o.visible = (phase === 'learn' && move === 3) || phase === 'ready' || (phase === 'play' && mode === 'tee');
        const a = angleOf(i) + BIAS, s = wingParts[i].s;
        o.position.set(SP.x + s * BALL * Math.cos(a), SP.y + Y0 + BALL * Math.sin(a), SP.z + 0.03);
        const sweet = Math.abs(angleOf(i) - IDEAL) < 0.1;
        if (sweet !== wingE[i].getValue(Wing, 'sweet')) { wingE[i].setValue(Wing, 'sweet', sweet); look.glow(o, sweet ? 0.9 : 0); }
      } else o.visible = false;
    }
    shadow.position.x = SP.x + 0.025;
    shadow.position.z = SP.z - 0.02;
    shadow.scale.setScalar(1 - 0.5 * clamp(SP.y / 0.1, 0, 1));
  });

  // Feedback: a landed fold sounds, pops and bursts once.
  game.system('Feedback', { flaps: [Flap] }, (q) => {
    for (const f of q.flaps) {
      const isCrease = f.getValue(Flap, 'move') === 0;
      if (f.hasComponent(Folded) && !f.getValue(Flap, 'told')) {
        f.setValue(Flap, 'told', true);
        sfx.fire('fold');
        pops.pop(sheet, 0.04);
      }
      if (isCrease && f.hasComponent(Creased) && f.getValue(Flap, 'hold') === -1) {
        f.setValue(Flap, 'hold', -2);
        sfx.fire('crease');
        pops.pop(crease, 0.3);
      }
    }
  });

  setupMove(0);

  return {
    root,
    update(time, delta) {
      live = Math.min(delta, 0.05);
      now += live;
      const tq = lookTwos(time);
      dd = clamp(tq - lastTq, 0, 0.12);
      lastTq = tq;
      if (look.update) look.update(time);
      game.update(time, live);
      if (thumpT > 0) { thumpT -= live; if (thumpT <= 0) thump.visible = false; }
      pops.update(live);
      burst.update(live);
      stars.userData.update(live);
      ring.update(live);
      startButton.userData.update(live);
      pointer.userData.update(time);
    },
  };
}
