// learning-game look: low-poly

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


// World kit: the land of a world around the player (references/world.md). Everything is in desk units, like the
// rest of the game; the headset shows a world 12 times bigger. The player stands at the origin, facing -Z.
//
//   const land = worldTerrain(THREE, { size: 2.4, height: 0.05, seed: 3,     a ground with gentle rises, flat where
//     flat: [{ x: 0, z: 0, r: 0.12 }, { x: 0, z: -0.3, r: 0.22 }],          the player starts and where the game is
//     hills: [{ x: -0.6, z: -0.9, r: 0.35, h: 0.18 }],                       a hill (h: its height)
//     valley: { from: [0.9, -1.1], to: [0.5, 0.9], width: 0.12, depth: 0.03 },   a riverbed (water: worldWater)
//     colors: { low: '#7fb069', high: '#a3c27a', rock: '#9b8f7a' } })
//   land.userData.heightAt(x, z)            the ground's height there: stand things on it
//   worldPath(THREE, land, [[0, 0], [0, -0.15], [0.1, -0.3]], { width: 0.03, color: '#d8c49a' })   a path on the ground
//   worldWater(THREE, land, { color: '#5aa9d6' })                   water filling the valley (or a pond: { x, z, r })
//   worldScatter(THREE, land, 'pine', { count: 40, from: 0.45, to: 1.1, avoid: [...flat spots], seed: 5 })
//                                           trees or rocks on the ground, one draw call each: 'pine', 'round', 'rock', 'bush'
//   worldEdge(THREE, { kind: 'mountains', color: '#8a9bb0', seed: 2 })   far mountains (or 'hills') all round the edge
//
// The land and paths are walkable (userData.walkable): in the headset the player walks over them. Keep slopes
// gentle where they walk. One mesh each, so a whole world costs a handful of draw calls.

function worldRandom(seed) {
  let s = (seed >>> 0) || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function worldNoise(seed) {
  const r = worldRandom(seed);
  const waves = Array.from({ length: 6 }, (_, i) => ({ fx: (r() - 0.5) * (3 + i * 3), fz: (r() - 0.5) * (3 + i * 3), p: r() * 6.283, a: 1 / (1 + i) }));
  const total = waves.reduce((sum, w) => sum + w.a, 0);
  return (x, z) => waves.reduce((sum, w) => sum + w.a * Math.sin(w.fx * x + w.fz * z + w.p), 0) / total;
}

function worldSmooth(t) {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

function worldTerrain(THREE, o = {}) {
  const size = o.size ?? 2.4;
  const segments = o.segments ?? 72;
  const height = o.height ?? 0.04;
  const flat = o.flat ?? [{ x: 0, z: 0, r: 0.12 }];
  const hills = o.hills ?? [];
  const valley = o.valley ?? null;
  const noise = worldNoise(o.seed ?? 1);
  const colors = { low: '#7fb069', high: '#a8c47c', rock: '#9b8f7a', bed: '#8f8463', ...(o.colors ?? {}) };
  const toValley = (x, z) => {
    if (!valley) return Infinity;
    const [ax, az] = valley.from;
    const [bx, bz] = valley.to;
    const dx = bx - ax, dz = bz - az;
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
  };
  const heightAt = (x, z) => {
    let y = noise(x, z) * height;
    for (const hill of hills) {
      const d = Math.hypot(x - hill.x, z - hill.z) / hill.r;
      y += hill.h * Math.exp(-2.2 * d * d);
    }
    if (valley) y -= valley.depth * (1 - worldSmooth(toValley(x, z) / valley.width));
    // Flat where the player starts and where the game stands, easing into the land around.
    let keep = 1;
    for (const spot of flat) keep = Math.min(keep, worldSmooth((Math.hypot(x - spot.x, z - spot.z) - spot.r) / (spot.r * 0.8 + 0.05)));
    // The land sinks to the host's ground at its edge, so it never ends in a wall.
    const rim = 1 - worldSmooth((Math.max(Math.abs(x), Math.abs(z)) - size * 0.36) / (size * 0.14));
    return y * keep * rim;
  };
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments).toNonIndexed();
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  const color = new Float32Array(position.count * 3);
  const low = new THREE.Color(colors.low), high = new THREE.Color(colors.high), rock = new THREE.Color(colors.rock), bed = new THREE.Color(colors.bed);
  const c = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), z = position.getZ(i);
    const y = heightAt(x, z);
    position.setY(i, y);
    const lift = Math.min(1, Math.max(0, y / Math.max(0.02, height * 3 + Math.max(0, ...hills.map((h) => h.h)) * 0.6)));
    c.copy(low).lerp(high, lift);
    if (lift > 0.75) c.lerp(rock, (lift - 0.75) * 4);
    if (valley && y < -valley.depth * 0.4) c.lerp(bed, 0.8);
    color.set([c.r, c.g, c.b], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: o.flatShading ?? true, roughness: 1 }));
  mesh.name = 'Land';
  mesh.userData.walkable = true;
  mesh.userData.heightAt = heightAt;
  mesh.userData.valley = valley;
  return mesh;
}

function worldPath(THREE, land, points, o = {}) {
  const width = o.width ?? 0.03;
  const heightAt = land.userData.heightAt;
  const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  const steps = Math.max(8, Math.round(curve.getLength() / 0.01));
  const at = [];
  const index = [];
  const side = new THREE.Vector3();
  for (let i = 0; i <= steps; i++) {
    const p = curve.getPointAt(i / steps);
    const t = curve.getTangentAt(i / steps);
    side.set(-t.z, 0, t.x).normalize().multiplyScalar(width / 2);
    for (const s of [-1, 1]) {
      const x = p.x + side.x * s, z = p.z + side.z * s;
      at.push(x, heightAt(x, z) + 0.0015, z);
    }
    if (i > 0) index.push(2 * i - 2, 2 * i, 2 * i - 1, 2 * i - 1, 2 * i, 2 * i + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(at, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: o.color ?? '#d8c49a', roughness: 1 }));
  mesh.name = 'Path';
  mesh.userData.walkable = true;
  return mesh;
}

function worldWater(THREE, land, o = {}) {
  const valley = land.userData.valley;
  const material = new THREE.MeshStandardMaterial({ color: o.color ?? '#5aa9d6', roughness: 0.25, metalness: 0.05, transparent: true, opacity: 0.85 });
  let mesh;
  if (o.r) {
    mesh = new THREE.Mesh(new THREE.CircleGeometry(o.r, 40), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(o.x ?? 0, (o.y ?? land.userData.heightAt(o.x ?? 0, o.z ?? 0)) + 0.002, o.z ?? 0);
  } else if (valley) {
    const [ax, az] = valley.from;
    const [bx, bz] = valley.to;
    const length = Math.hypot(bx - ax, bz - az);
    mesh = new THREE.Mesh(new THREE.PlaneGeometry(valley.width * 1.1, length + valley.width), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = -Math.atan2(bx - ax, bz - az);
    mesh.position.set((ax + bx) / 2, -valley.depth * 0.45, (az + bz) / 2);
  } else {
    throw new Error('worldWater(): give the land a valley, or pass { x, z, r } for a pond.');
  }
  mesh.name = 'Water';
  return mesh;
}

const WORLD_PIECES = {
  pine: (THREE) => {
    const trunk = new THREE.CylinderGeometry(0.004, 0.005, 0.03, 5).translate(0, 0.015, 0);
    const crown = new THREE.ConeGeometry(0.03, 0.09, 6).translate(0, 0.07, 0);
    return [trunk, crown, ['#6b4a2f', '#3f7d4e']];
  },
  round: (THREE) => {
    const trunk = new THREE.CylinderGeometry(0.004, 0.006, 0.035, 5).translate(0, 0.0175, 0);
    const crown = new THREE.IcosahedronGeometry(0.035, 0).translate(0, 0.06, 0);
    return [trunk, crown, ['#6b4a2f', '#5f9e4a']];
  },
  bush: (THREE) => [null, new THREE.IcosahedronGeometry(0.018, 0).translate(0, 0.012, 0), [null, '#5b8f3f']],
  rock: (THREE) => [null, new THREE.DodecahedronGeometry(0.02, 0).scale(1, 0.6, 1).translate(0, 0.006, 0), [null, '#8d877c']],
};

function worldScatter(THREE, land, kind, o = {}) {
  const make = WORLD_PIECES[kind];
  if (!make) throw new Error(`worldScatter(): no '${kind}'. Kinds: ${Object.keys(WORLD_PIECES).join(', ')}.`);
  const [base, top, defaults] = make(THREE);
  const colors = o.colors ?? defaults;
  const count = o.count ?? 30;
  const from = o.from ?? 0.4, to = o.to ?? 1.1;
  const avoid = o.avoid ?? [];
  const r = worldRandom(o.seed ?? 7);
  const [s0, s1] = o.scale ?? [0.7, 1.4];
  const group = new THREE.Group();
  group.name = `Scatter: ${kind}`;
  const parts = [[base, colors[0]], [top, colors[1]]].filter(([g]) => g);
  const meshes = parts.map(([geometry, color]) => {
    const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 1 }), count);
    group.add(mesh);
    return mesh;
  });
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let placed = 0;
  for (let tries = 0; placed < count && tries < count * 20; tries++) {
    const a = r() * Math.PI * 2, d = from + (to - from) * Math.sqrt(r());
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (avoid.some((spot) => Math.hypot(x - spot.x, z - spot.z) < spot.r + 0.03)) continue;
    if (land.userData.valley && land.userData.heightAt(x, z) < -land.userData.valley.depth * 0.3) continue;
    const k = s0 + (s1 - s0) * r();
    m.compose(p.set(x, land.userData.heightAt(x, z) - 0.002, z), q.setFromAxisAngle(up, r() * 6.283), s.set(k, k * (0.85 + r() * 0.3), k));
    for (const mesh of meshes) mesh.setMatrixAt(placed, m);
    placed++;
  }
  for (const mesh of meshes) {
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
  }
  return group;
}

function worldEdge(THREE, o = {}) {
  const kind = o.kind ?? 'mountains';
  const count = o.count ?? (kind === 'mountains' ? 22 : 30);
  const r = worldRandom(o.seed ?? 3);
  const [near, far] = o.radius ?? [4.2, 6.2];
  const geometry = kind === 'mountains' ? new THREE.ConeGeometry(0.6, 1, 5) : new THREE.IcosahedronGeometry(0.5, 0).scale(1, 0.45, 1);
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial({ color: o.color ?? (kind === 'mountains' ? '#8a9bb0' : '#6f9a5d'), flatShading: true, roughness: 1 }), count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + (r() - 0.5) * 0.25;
    const d = near + (far - near) * r();
    const h = kind === 'mountains' ? 0.6 + r() * 1.3 : 0.25 + r() * 0.35;
    const w = kind === 'mountains' ? 0.8 + r() * 1.2 : 1 + r() * 1.2;
    m.compose(p.set(Math.cos(a) * d, kind === 'mountains' ? h / 2 - 0.05 : 0, Math.sin(a) * d), q.setFromAxisAngle(up, r() * 6.283), s.set(w, h, w));
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.name = `Edge: ${kind}`;
  return mesh;
}

// ---- game.js: the game's own code (everything above is /work/kits.js) ----
// Game-specific data lives in this file; the generated shared parts remain untouched.
const IDENTITY = {
  title: 'Windwoven Heights', eyebrow: 'CATCH THE WIND',
  pitch: 'Take the handle, then tilt to fly your kite through six glowing hoops.',
  skin: { paper: '#fff6e4', ink: '#22303c', accent: '#1f6a80', button: '#e9684a', edge: '#a5bf66', round: 26 },
  resultSign: { paper: '#fff6e4', ink: '#1f6a80', edge: '#e0a646' },
};
const SOUNDS = {
  start: ['whoosh', { volume: .35 }], win: ['win', { volume: .7 }], miss: ['bad', { volume: .25 }],
  ambience: { clip: 'snd-fc895efa75', loop: true, volume: 0.24 },
  flutter: { clip: 'snd-e854f20fc6', volume: 0.22 },
  tension: { clip: 'snd-f0771a564e', volume: 0.12 },
  cheer: ['coin', { volume: 0.6 }], touch: ['click', { volume: 0.5 }],
};

export default function build(api) {
  const { THREE, kit, ui, hands, sound, isGrabbed } = api;
  const root = new THREE.Group();
  const WORLD = true;
  const game = playWorld(api);
  const look = lowPolyLook(THREE, kit);
  const sfx = playSounds(sound, SOUNDS);
  const clamp = THREE.MathUtils.clamp;
  const Round = game.component('Round', { phase: 'text', score: 'int', best: 'int', wins: 'int', time: 'number', command: 'text', taught: 'int', shown: 'number', event: 'text', flutter: 'number' });
  const Kite = game.component('Kite', { az: 'number', el: 'number', av: 'number', ev: 'number', wind: 'number', lift: 'number', pull: 'number', shift: 'number', previous: 'vec3' });
  const Handle = game.component('Handle', { active: 'bool', owner: 'text', bank: 'number', turn: 'number', was: 'bool' });
  const Hoop = game.component('Hoop', { index: 'int', az: 'number', el: 'number', radius: 'number', reached: 'bool' });
  const Airflow = game.component('Airflow');
  const Lift = game.component('Lift');
  const Cloud = game.component('Cloud', { home: 'number', speed: 'number' });
  const Display = game.component('Display');
  const round = game.spawn(null, Round, { phase: 'idle', score: 0, best: 0, wins: 0, time: 0, command: '', taught: 0, shown: -1, event: '', flutter: 0 });

  // An open hilltop, with gentle walkable slopes and no desktop plinth.
  const flats = [{ x: 0, z: 0, r: 0.22 }, { x: 0, z: -0.12, r: 0.21 }];
  const land = worldTerrain(THREE, {
    seed: 17, flat: flats,
    hills: [{ x: -.85, z: -.85, r: .75, h: .13 }, { x: .9, z: -.9, r: .8, h: .18 }, { x: -.9, z: .45, r: .5, h: .09 }],
    colors: { low: look.PAL.meadow, high: look.PAL.grass, rock: look.PAL.forest, bed: look.PAL.bed },
  });
  root.add(land);
  root.add(worldPath(THREE, land, [[.02, .12], [.07, .04], [.11, -.08], [.23, -.24], [.36, -.38]], { width: .035, color: look.PAL.bed }));
  const distant = new THREE.Group(); distant.name = 'Folded green ridges';
  for (let i = 0; i < 11; i++) {
    const a = i * .56;
    const ridge = look.hill(.42 + (i % 3) * .12, .18 + (i % 4) * .055, i % 2 ? 'forest' : 'meadow', 'Far grassy ridge');
    ridge.position.set(Math.cos(a) * 1.65, -.025, Math.sin(a) * 1.65 - .24);
    distant.add(ridge);
  }
  look.merge(distant); root.add(distant);
  root.add(worldScatter(THREE, land, 'rock', { count: 21, from: .3, to: 1.3, avoid: flats, seed: 23 }));
  // Low triangular tussocks: repeated geometry merged, all away from the clear standing area.
  const grasses = new THREE.Group(); grasses.name = 'Wind combed tussocks';
  for (let i = 0; i < 88; i++) {
    const a = i * 2.39996, r = .26 + ((i * 37) % 71) / 71 * .78;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    for (let j = 0; j < 3; j++) {
      const g = new THREE.ConeGeometry(.003, .018 + (i % 3) * .004, 3);
      const blade = look.facet(g, i % 3 ? 'pine' : 'forest', 'Pointed grass', { jitter: .0005 });
      blade.position.set(x + j * .004, land.userData.heightAt(x, z) + .008, z);
      blade.rotation.set(.12, a + j, -.2 - j * .1); grasses.add(blade);
    }
  }
  look.merge(grasses); root.add(grasses);
  // Two clouds, just as in the first-view composition, not a wall of scenery.
  for (let i = 0; i < 2; i++) {
    const cloud = look.cloud('Faceted fair weather cloud', { r: i ? .095 : .065 });
    cloud.position.set(i ? .62 : -.59, i ? .57 : .49, -.95);
    root.add(cloud); game.spawn(cloud, Cloud, { home: cloud.position.x, speed: i ? -.006 : .004 });
  }

  function box(parent, w, h, d, color, x, y, z, name) {
    const m = look.facet(new THREE.BoxGeometry(w, h, d), color, name, { jitter: .0003 });
    m.position.set(x, y, z); parent.add(m); return m;
  }
  const stool = new THREE.Group(); stool.name = 'Wooden kite handle stand'; stool.scale.setScalar(.88); stool.position.z = -.025;
  box(stool, .067, .006, .042, 'bed', 0, .061, -.09, 'Stool seat');
  box(stool, .06, .009, .034, 'trunk', 0, .054, -.09, 'Seat apron');
  for (let i = 0; i < 4; i++) {
    const sx = i % 2 ? 1 : -1, sz = i < 2 ? 1 : -1;
    const leg = box(stool, .005, .055, .005, 'trunk', sx * .023, .0275, -.09 + sz * .014, 'Splayed wooden leg');
    leg.rotation.z = -sx * .12; leg.rotation.x = sz * .09;
  }
  for (let i = -1; i <= 1; i += 2) {
    box(stool, .004, .016, .004, 'trunk', i * .017, .072, -.09, 'Handle cradle upright');
    box(stool, .009, .003, .014, 'bed', i * .017, .079, -.09, 'Handle cradle lip');
  }
  look.merge(stool); root.add(stool);

  const handle = new THREE.Group(); handle.name = 'TAKE HANDLE - tilt left or right';
  const bar = look.facet(new THREE.CylinderGeometry(.005, .005, .064, 6), 'seaDeep', 'Short two-line control bar', { jitter: .0002 });
  bar.rotation.z = Math.PI / 2; handle.add(bar);
  for (let i = -3; i <= 3; i++) {
    const wrap = look.facet(new THREE.CylinderGeometry(.0054, .0054, .0012, 6), i % 2 ? 'sea' : 'seaDeep', 'Grip bands', { jitter: 0 });
    wrap.rotation.z = Math.PI / 2; wrap.position.x = i * .008; handle.add(wrap);
  }
  for (let side = -1; side <= 1; side += 2) {
    const fitting = look.facet(new THREE.CylinderGeometry(.006, .006, .003, 6), 'paper', 'Pale bar end', { jitter: 0 });
    fitting.rotation.z = Math.PI / 2; fitting.position.x = side * .032; handle.add(fitting);
  }
  look.merge(handle);
  const home = new THREE.Vector3(0, .073, -.104);
  handle.position.copy(home); root.add(handle);
  const control = game.spawn(handle, Handle, { active: false, owner: '', bank: 0, turn: 0, was: false }, game.Grabbable);

  // Tall striped diamond, with a bowed cross-spar and two real bridle attachments.
  const kite = new THREE.Group(); kite.name = 'Striped windwoven diamond kite';
  const half = .047, top = .052, shoulder = .007, bottom = -.065;
  function triangle(a, b, c, color) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...c, ...b, ...a], 3));
    return look.facet(g, color, 'Alternating radial sail strip', { jitter: 0 });
  }
  const sail = new THREE.Group(); sail.name = 'Coral and teal sail';
  const stripes = 10;
  for (let i = 0; i < stripes; i++) {
    const x0 = -half + i * half * 2 / stripes, x1 = -half + (i + 1) * half * 2 / stripes;
    const color = i % 2 ? 'sea' : 'accent';
    const za = .005 * (1 - Math.abs(x0) / half), zb = .005 * (1 - Math.abs(x1) / half);
    sail.add(triangle([0, top, 0], [x0, shoulder, za], [x1, shoulder, zb], color));
    sail.add(triangle([x0, shoulder, za], [0, bottom, 0], [x1, shoulder, zb], color));
  }
  look.merge(sail); kite.add(sail);
  function strut(parent, points, radius, color, name) {
    const m = look.facet(kit.tube(points, radius), color, name, { jitter: 0 }); parent.add(m); return m;
  }
  strut(kite, [[0, top + .002, .001], [0, bottom - .002, .001]], .00105, 'paper', 'Full pale central spine');
  strut(kite, [[-half - .002, shoulder, .001], [-.021, .010, .006], [0, .012, .007], [.021, .010, .006], [half + .002, shoulder, .001]], .0009, 'paper', 'Bowed pale cross spar');
  strut(kite, [[0, top, -.0007], [-half, shoulder, -.0007], [0, bottom, -.0007], [half, shoulder, -.0007], [0, top, -.0007]], .00055, 'ink', 'Dark diamond edge');
  for (let s = -1; s <= 1; s += 2) {
    strut(kite, [[s * .027, .008, .006], [s * .009, -.026, .022], [0, -.05, .002]], .00023, 'paper', 'Twin kite bridle');
  }
  look.merge(kite); kite.position.set(-.16, .34, -.45); root.add(kite);
  const flight = game.spawn(kite, Kite, { az: -.43, el: .60, av: 0, ev: 0, wind: 7.3, lift: 17, pull: 15, shift: 0, previous: [kite.position.x, kite.position.y, kite.position.z] });
  const tether = .47;
  const origin = new THREE.Vector3().copy(home);
  const axis = new THREE.Vector3(1, 0, 0);
  const previous = new THREE.Vector3();
  const endpoint = new THREE.Vector3();
  const localEnd = new THREE.Vector3();
  const deltaSeg = new THREE.Vector3();
  const nearest = new THREE.Vector3();
  const linePositions = new Float32Array(12);
  const lineGeo = new THREE.BufferGeometry(); lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
  const lineMat = new THREE.LineBasicMaterial({ color: look.PAL.paper, transparent: true, opacity: .86 });
  const lines = new THREE.LineSegments(lineGeo, lineMat); lines.name = 'Two tensioned flying lines'; root.add(lines);
  game.spawn(lines, Display);

  const hoopSpecs = [[.40, .86, .070], [-.84, .63, .062], [.08, .92, .056], [1.06, .43, .050], [-1.04, .45, .046], [.30, .90, .041]];
  const hoopEntities = [];
  const haloMat = lookFacetMaterial(THREE); haloMat.transparent = true; haloMat.opacity = .12; haloMat.side = THREE.DoubleSide; haloMat.depthWrite = false;
  const ringMat = lookFacetMaterial(THREE); ringMat.emissive.set(look.PAL.paper); ringMat.emissiveIntensity = .9;
  for (let i = 0; i < 6; i++) {
    const [az, el, radius] = hoopSpecs[i];
    const h = new THREE.Group(); h.name = `Glowing hoop ${i + 1}`;
    const rim = look.facet(new THREE.TorusGeometry(radius, .0018, 5, 30), 'paper', 'Faceted luminous hoop rim', { jitter: 0 });
    rim.material = ringMat; h.add(rim);
    const halo = look.facet(new THREE.RingGeometry(radius - .004, radius + .009, 30), 'sun', 'Warm hoop glow', { jitter: 0 }); halo.material = haloMat; h.add(halo);
    h.position.set(home.x + tether * Math.cos(el) * Math.sin(az), home.y + tether * Math.sin(el), home.z - tether * Math.cos(el) * Math.cos(az));
    h.visible = i === 0; root.add(h);
    hoopEntities.push(game.spawn(h, Hoop, { index: i, az, el, radius, reached: false }));
  }

  // Continuous wide ribbons visibly bend DOWN after the sail. Dashes advect with measured airflow.
  const nRibbon = 5, nSeg = 18;
  let ribbonPositions = new Float32Array(nRibbon * nSeg * 6 * 3);
  const ribbonGeo = new THREE.BufferGeometry(); ribbonGeo.setAttribute('position', new THREE.BufferAttribute(ribbonPositions, 3));
  const ribbons = look.facet(ribbonGeo, 'foam', 'Faceted air ribbons', { jitter: 0 });
  const ribbonMat = ribbons.material.clone(); ribbonMat.transparent = true; ribbonMat.opacity = .27; ribbonMat.side = THREE.DoubleSide; ribbonMat.depthWrite = false; ribbons.material = ribbonMat; ribbons.name = 'Airflow bending down around sail'; ribbons.frustumCulled = false; root.add(ribbons);
  game.spawn(ribbons, Airflow); ribbonPositions = ribbons.geometry.attributes.position.array;
  let dashPositions = new Float32Array(5 * 3 * 6 * 3);
  const dashGeo = new THREE.BufferGeometry(); dashGeo.setAttribute('position', new THREE.BufferAttribute(dashPositions, 3));
  const dashes = look.facet(dashGeo, 'paper', 'Faceted airflow highlights', { jitter: 0 });
  const dashMat = dashes.material.clone(); dashMat.transparent = true; dashMat.opacity = .65; dashMat.side = THREE.DoubleSide; dashMat.depthWrite = false; dashes.material = dashMat; dashes.name = 'Moving airflow highlights'; dashes.frustumCulled = false; root.add(dashes); game.spawn(dashes, Display); dashPositions = dashes.geometry.attributes.position.array;
  function flowPoint(u, strand, edge, out, offset) {
    const t = clamp((u - .24) / .76, 0, 1);
    const bend = t * t * (3 - 2 * t);
    out[offset] = kite.position.x + (u - .25) * .31;
    out[offset + 1] = kite.position.y + (strand - 2) * .012 + edge - bend * .112;
    out[offset + 2] = kite.position.z - .009 - (u - .25) * .13;
  }
  function flowQuad(u, v, strand, thick, out, offset) {
    flowPoint(u, strand, -thick, out, offset); flowPoint(v, strand, -thick, out, offset + 3); flowPoint(v, strand, thick, out, offset + 6);
    flowPoint(u, strand, -thick, out, offset + 9); flowPoint(v, strand, thick, out, offset + 12); flowPoint(u, strand, thick, out, offset + 15);
  }
  const arrow = look.facet(kit.extrude([[-.003, 0], [.003, 0], [.003, .043], [.010, .043], [0, .060], [-.010, .043], [-.003, .043]], .0014), 'seaDeep', 'Upward lift arrow', { jitter: 0 });
  root.add(arrow); game.spawn(arrow, Lift);

  const pointer = playPointer(THREE, { size: .32 }); root.add(pointer); pointer.userData.at(handle); game.spawn(pointer, Display);
  const stars = playStars(THREE); stars.scale.setScalar(.36); stars.position.set(0, .20, -.19); root.add(stars); game.spawn(stars, Display);
  const burst = playBurst(THREE, root);
  const groundRing = playRing(THREE, root);
  const result = kit.sign('6 / 6 HOOPS', { width: .15, ...IDENTITY.resultSign, sub: '3 of 3 stars' });
  result.position.set(0, .15, -.21); result.visible = false; root.add(result); game.spawn(result, Display);
  const demo = new THREE.Group(); demo.name = 'Ghost bar showing a gentle tilt';
  const ghostBar = look.facet(new THREE.BoxGeometry(.054, .003, .003), 'paper', 'Gentle tilt demonstration', { jitter: 0 }); demo.add(ghostBar);
  demo.position.copy(home); demo.position.y += .028; root.add(demo); game.spawn(demo, Display);

  const MOVES = [
    { say: 'Tilt gently, then level the handle.', why: 'Small tilts turn the kite; a level bar stops the turn.', target: handle, done: () => Math.abs(flight.getValue(Kite, 'az') + .43) > .16 },
    { say: 'Steer across the middle of the downwind sky.', why: 'Faster air bends downward harder, so the kite gets more lift.', target: kite, done: () => Math.abs(flight.getValue(Kite, 'az') - flight.getValue(Kite, 'shift')) < .23 },
    { say: 'Ease toward an edge, then level to settle.', why: 'Weaker airflow at the edge reduces pull and helps you slow down.', target: kite, done: () => Math.abs(flight.getValue(Kite, 'az') - flight.getValue(Kite, 'shift')) > .73 },
  ];
  const CHALLENGE = { say: 'Cross all six hoops without touching the ground.', label: 'hoops', stars: [2, 4, 6], lowerIsBetter: false };
  const panel = kit.panel(ui, {
    width: .31, position: [.14, .13, -.02], rotationY: -.25, eyebrow: IDENTITY.eyebrow, title: IDENTITY.title, skin: IDENTITY.skin,
    items: [
      { text: IDENTITY.pitch, id: 'goal' },
      { status: 'Take the teal handle to start.', tone: 'neutral', id: 'state' },
      { text: 'Tilt left or right to turn. Level to stop turning.', id: 'controls' },
      { text: 'The kite pushes air down. The air pushes the kite up.', id: 'why' },
      { progress: 0, label: '0 / 6 hoops', id: 'hoops' },
      { stat: '7.3 m/s', label: 'airflow at kite', id: 'wind' },
      { stat: '17 N', label: 'lift', id: 'lift' },
      { text: 'Best: 0 / 6 hoops', id: 'best' },
      { buttons: [
        { label: 'Try again', id: 'again', onPress() { round.setValue(Round, 'command', 'reset'); } },
        { label: 'Show me', id: 'hint', onPress() { round.setValue(Round, 'command', 'hint'); } },
      ] },
    ],
  });
  root.add(panel.object3D); panel.show('again', false);

  // INPUT: actual bar roll comes from the grabbed object's hand-driven quaternion.
  // A missing hand never teleports the bar or takes away height.
  game.system('ReadHandle', { handles: [Handle] }, (q, dt) => {
    for (const e of q.handles) {
      const held = e.hasComponent(game.Held);
      if (held && !e.getValue(Handle, 'was')) {
        sfx.fire('touch');
        const dr = hands.right.tracked ? hands.right.tip.distanceToSquared(handle.position) : 999;
        const dl = hands.left.tracked ? hands.left.tip.distanceToSquared(handle.position) : 999;
        e.setValue(Handle, 'owner', dr <= dl ? 'right' : 'left');
        e.setValue(Handle, 'active', true);
        if (round.getValue(Round, 'phase') === 'idle') round.setValue(Round, 'command', 'start');
      }
      if (held) {
        axis.set(1, 0, 0).applyQuaternion(handle.quaternion);
        const roll = Math.atan2(axis.y, axis.x);
        const bank = clamp(-roll, -.65, .65);
        e.setValue(Handle, 'bank', bank);
        e.setValue(Handle, 'turn', Math.abs(bank) < .055 ? 0 : clamp(bank / .48, -1, 1));
        origin.copy(handle.position);
      } else {
        e.setValue(Handle, 'turn', 0);
        if (round.getValue(Round, 'phase') === 'idle' && !isGrabbed(handle)) {
          handle.position.lerp(home, Math.min(1, dt * 10));
          handle.quaternion.slerp(neutral, Math.min(1, dt * 10));
          origin.copy(handle.position);
        }
      }
      e.setValue(Handle, 'was', held);
    }
  });
  const neutral = new THREE.Quaternion();

  game.system('StartAndReset', { rounds: [Round] }, (q) => {
    for (const r of q.rounds) {
      const command = r.getValue(Round, 'command');
      if (command === 'hint') {
        r.setValue(Round, 'event', 'hint'); r.setValue(Round, 'flutter', -3);
        sfx.fire('touch');
      }
      if (command === 'reset' && r.getValue(Round, 'phase') === 'done') {
        r.setValue(Round, 'phase', 'idle'); r.setValue(Round, 'score', 0); r.setValue(Round, 'time', 0); r.setValue(Round, 'taught', 0);
        flight.setValue(Kite, 'az', -.43); flight.setValue(Kite, 'el', .60); flight.setValue(Kite, 'av', 0); flight.setValue(Kite, 'ev', 0);
        control.setValue(Handle, 'active', false); control.setValue(Handle, 'turn', 0);
        if (!isGrabbed(handle)) { handle.position.copy(home); handle.quaternion.copy(neutral); }
        origin.copy(handle.position);
        for (const h of hoopEntities) h.setValue(Hoop, 'reached', false);
        r.setValue(Round, 'event', 'reset'); sfx.fire('touch');
      }
      if ((command === 'start' || (r.getValue(Round, 'phase') === 'idle' && control.hasComponent(game.Held))) && r.getValue(Round, 'phase') === 'idle') {
        r.setValue(Round, 'phase', 'play'); r.setValue(Round, 'score', 0); r.setValue(Round, 'time', 0); r.setValue(Round, 'taught', 0); r.setValue(Round, 'event', 'start');
        sfx.fire('start'); sfx.fire('ambience'); sfx.fire('flutter');
      }
      r.setValue(Round, 'command', '');
    }
  });

  // FLIGHT: angular momentum on a taut spherical tether. Radial line tension removes
  // radial acceleration; projected wind/lift/weight change elevation, not a flight path.
  game.system('FlyInWind', { kites: [Kite] }, (q, dt, time) => {
    const playing = round.getValue(Round, 'phase') === 'play';
    for (const e of q.kites) {
      let az = e.getValue(Kite, 'az'), el = e.getValue(Kite, 'el');
      previous.copy(kite.position);
      const pv = e.getVectorView(Kite, 'previous'); pv[0] = previous.x; pv[1] = previous.y; pv[2] = previous.z;
      let shift = 0, gust = 0;
      if (round.getValue(Round, 'wins') > 0 && playing) {
        shift = .13 * Math.sin(round.getValue(Round, 'time') * .105);
        gust = .6 * Math.sin(round.getValue(Round, 'time') * .63) + .25 * Math.sin(round.getValue(Round, 'time') * 1.23);
      }
      const window = Math.max(0, Math.cos(az - shift));
      let wind = 2.9 + 5.2 * window * window + gust;
      const bank = control.getValue(Handle, 'turn');
      let av = e.getValue(Kite, 'av'), ev = e.getValue(Kite, 'ev');
      const apparent = Math.sqrt(wind * wind + Math.pow(av * tether * 12 * Math.cos(el), 2));
      const lift = .319 * apparent * apparent * (1 - .10 * Math.abs(bank));
      const drag = .16 * apparent * apparent;
      if (playing) {
        const edgeRestore = Math.abs(az - shift) > 1.4 ? -(az - shift) * .5 : 0;
        av += (bank * 1.65 * (.4 + .6 * window) - av * 3.9 + edgeRestore) * dt;
        az += av * dt;
        const tangent = (lift - 6.38) * Math.cos(el) - drag * Math.sin(el);
        ev += (tangent / (0.65 * tether * 12) - 2.6 * ev) * dt;
        el += ev * dt;
        if (el > 1.34) { el = 1.34; ev = Math.min(0, ev); }
        e.setValue(Kite, 'az', az); e.setValue(Kite, 'el', el); e.setValue(Kite, 'av', av); e.setValue(Kite, 'ev', ev);
        round.setValue(Round, 'time', round.getValue(Round, 'time') + dt);
      }
      e.setValue(Kite, 'wind', apparent); e.setValue(Kite, 'lift', lift); e.setValue(Kite, 'pull', Math.max(0, drag * Math.cos(el) + (lift - 6.38) * Math.sin(el))); e.setValue(Kite, 'shift', shift);
      const bob = playing || round.getValue(Round, 'phase') === 'done' ? 0 : Math.sin(time * 1.1) * .002;
      kite.position.set(origin.x + tether * Math.cos(el) * Math.sin(az), origin.y + tether * Math.sin(el) + bob, origin.z - tether * Math.cos(el) * Math.cos(az));
      kite.rotation.set(-.13, -az * .65, -control.getValue(Handle, 'bank') * .55 + Math.sin(time * 4.2) * .014);
      if (playing && kite.position.y + bottom <= land.userData.heightAt(kite.position.x, kite.position.z)) {
        round.setValue(Round, 'phase', 'done'); round.setValue(Round, 'event', 'ground');
      }
    }
  });

  game.system('CrossHoop', { hoops: [Hoop] }, (q) => {
    if (round.getValue(Round, 'phase') !== 'play') return;
    const current = round.getValue(Round, 'score');
    for (const e of q.hoops) {
      if (e.getValue(Hoop, 'index') !== current || e.getValue(Hoop, 'reached')) continue;
      const h = game.objectOf(e);
      // Swept centre distance: quick crossings still count, but the kite must actually reach the hoop.
      deltaSeg.subVectors(kite.position, previous);
      const len2 = deltaSeg.lengthSq();
      nearest.copy(h.position).sub(previous);
      const t = len2 > .000000001 ? clamp(nearest.dot(deltaSeg) / len2, 0, 1) : 0;
      nearest.copy(previous).addScaledVector(deltaSeg, t);
      if (nearest.distanceTo(h.position) < e.getValue(Hoop, 'radius') * .84) {
        e.setValue(Hoop, 'reached', true); round.setValue(Round, 'score', current + 1); round.setValue(Round, 'event', 'hoop');
        if (current + 1 === 6) { round.setValue(Round, 'phase', 'done'); round.setValue(Round, 'event', 'win'); round.setValue(Round, 'wins', round.getValue(Round, 'wins') + 1); }
      }
    }
  });

  game.system('TeachFlight', { rounds: [Round] }, (q) => {
    for (const r of q.rounds) {
      if (r.getValue(Round, 'phase') !== 'play') continue;
      const m = r.getValue(Round, 'taught');
      if (m < MOVES.length && MOVES[m].done()) {
        panel.set('why', MOVES[m].why); r.setValue(Round, 'taught', m + 1);
      }
    }
  });

  game.system('ShowFlightForces', { flows: [Airflow], arrows: [Lift] }, (q, dt, time) => {
    const v = flight.getValue(Kite, 'wind'), lift = flight.getValue(Kite, 'lift');
    for (const e of q.flows) {
      for (let s = 0; s < nRibbon; s++) for (let j = 0; j < nSeg; j++) flowQuad(j / nSeg, (j + 1) / nSeg, s, .0035, ribbonPositions, (s * nSeg + j) * 18);
      game.objectOf(e).geometry.attributes.position.needsUpdate = true;
      for (let s = 0; s < 5; s++) for (let j = 0; j < 3; j++) {
        const u = (time * v * .065 + j / 3 + s * .043) % 1;
        flowQuad(u, Math.min(1, u + .065), s, .00125, dashPositions, (s * 3 + j) * 18);
      }
      dashes.geometry.attributes.position.needsUpdate = true;
    }
    for (const e of q.arrows) {
      const a = game.objectOf(e); a.position.set(kite.position.x - .022, kite.position.y - .152, kite.position.z + .025);
      a.scale.y = clamp(lift / 15, .2, 1.6);
    }
    for (let i = 0; i < 2; i++) {
      localEnd.set(i ? .025 : -.025, 0, 0).applyQuaternion(handle.quaternion).add(handle.position);
      endpoint.set(i ? .009 : -.009, -.026, .022).applyEuler(kite.rotation).add(kite.position);
      const k = i * 6;
      linePositions[k] = localEnd.x; linePositions[k + 1] = localEnd.y; linePositions[k + 2] = localEnd.z;
      linePositions[k + 3] = endpoint.x; linePositions[k + 4] = endpoint.y; linePositions[k + 5] = endpoint.z;
    }
    lineGeo.attributes.position.needsUpdate = true; lineGeo.computeBoundingSphere();
  });

  game.system('ShowHoops', { hoops: [Hoop] }, (q, dt, time) => {
    const score = round.getValue(Round, 'score');
    for (const e of q.hoops) {
      const h = game.objectOf(e);
      h.visible = e.getValue(Hoop, 'index') === score && round.getValue(Round, 'phase') !== 'done';
      h.children[1].scale.setScalar(1 + .035 * Math.sin(time * 2.3));
    }
  });

  game.system('DriftClouds', { clouds: [Cloud] }, (q, dt, time) => {
    for (const e of q.clouds) game.objectOf(e).position.x = e.getValue(Cloud, 'home') + Math.sin(time * .08) * e.getValue(Cloud, 'speed') * 5;
  });

  game.system('AnswerFlight', { rounds: [Round] }, (q, dt, time) => {
    for (const r of q.rounds) {
      const event = r.getValue(Round, 'event');
      const phase = r.getValue(Round, 'phase');
      if (event === 'start') {
        pointer.userData.at(null); demo.visible = false; result.visible = false; stars.userData.hide(); panel.show('again', false);
        panel.set('state', 'Hoop 1 of 6 - gentle right tilt.', 'neutral'); panel.set('why', MOVES[0].why);
      }
      if (event === 'reset') {
        pointer.userData.at(handle); demo.visible = true; result.visible = false; stars.userData.hide(); panel.show('again', false);
        panel.set('state', 'Take the teal handle to start.', 'neutral'); panel.set('why', 'Cross the middle for lift. Use the edges to ease the pull.'); panel.set('hoops', 0, '0 / 6 hoops');
      }
      if (event === 'hoop' || event === 'win') {
        sfx.fire('cheer'); burst.fire(kite.position.x, kite.position.y, kite.position.z);
        const score = r.getValue(Round, 'score');
        panel.set('hoops', score / 6, `${score} / 6 hoops`);
        panel.set('state', score < 6 ? `Hoop ${score + 1} of 6 - ${score % 2 ? 'steer left' : 'steer right'}.` : 'All six hoops - flight complete!', 'good');
      }
      if (event === 'ground' || event === 'win') {
        const score = r.getValue(Round, 'score');
        const best = Math.max(r.getValue(Round, 'best'), score); r.setValue(Round, 'best', best);
        const k = playStarsFor(score, CHALLENGE.stars, false);
        stars.userData.show(k);
        result.userData.setText(`${score} / 6 HOOPS`, `${k} of 3 stars`); result.visible = true;
        sfx.stop('ambience'); sfx.stop('music'); sfx.fire(event === 'win' ? 'win' : 'miss');
        groundRing.at(kite.position.x, land.userData.heightAt(kite.position.x, kite.position.z) + .002, kite.position.z);
        panel.set('best', `Best: ${best} / 6 hoops`); panel.show('again', true);
        panel.set('state', event === 'win' ? 'You flew all six without grounding!' : 'Kite grounded - try again.', event === 'win' ? 'good' : 'neutral');
        panel.set('why', event === 'win' ? 'Air pushed down gave your kite the lift to finish.' : 'Return through the stronger middle airflow before you lose height.');
      }
      if (phase === 'idle') {
        demo.visible = true; demo.rotation.z = Math.sin(time * 2.3) * .26;
        demo.position.y = home.y + .028 + Math.sin(time * 2.3) * .001;
      }
      if (phase === 'play') {
        const next = r.getValue(Round, 'flutter') + dt; r.setValue(Round, 'flutter', next);
        if (next > 5) { r.setValue(Round, 'flutter', 0); sfx.fire('flutter'); }
        if (r.getValue(Round, 'taught') >= 3 && Math.floor(r.getValue(Round, 'time') * 2) !== r.getValue(Round, 'shown')) {
          const centered = Math.abs(flight.getValue(Kite, 'az') - flight.getValue(Kite, 'shift')) < .5;
          panel.set('why', centered ? 'Strong middle airflow: more air bends down, so lift grows.' : 'At the edge, airflow and pull weaken. Level early to settle.');
        }
      }
      if (event === 'hint') { demo.visible = true; panel.set('controls', 'Copy the pale bar: small tilt to turn, level to stop.'); }
      r.setValue(Round, 'event', '');
    }
    pointer.userData.update(time); stars.userData.update(dt); burst.update(dt); groundRing.update(dt); look.update(time);
  });
  game.system('UpdateScoreboard', { rounds: [Round] }, (q) => {
    for (const r of q.rounds) {
      const tick = Math.floor(r.getValue(Round, 'time') * 4);
      if (r.getValue(Round, 'shown') === tick) continue;
      r.setValue(Round, 'shown', tick);
      panel.set('wind', `${flight.getValue(Kite, 'wind').toFixed(1)} m/s`);
      panel.set('lift', `${Math.round(flight.getValue(Kite, 'lift'))} N`);
    }
  });

  return { root, mode: 'world', sky: 'day', ground: 'grass', update(time, delta) { game.update(time, Math.min(delta, .04)); } };
}
