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
// ---- parts (from /work/parts, joined by scripts/assemble.mjs: edit the part files, not this block) ----
// The game's identity: its name, pitch, goal and colours. The ui-designer's part (references/team.md); data only.
// The panel wears `skin` and the result sign its own colours; the kit keeps text readable whatever is picked. The
// app shows the title as the game's opening title card.
const IDENTITY = {
  title: 'River Dam',
  eyebrow: 'WATER PRESSURE',
  pitch: 'Plug the dam with blocks and find out why deep water pushes hardest.',
  skin: { paper: '#17323a', ink: '#f4fbff', accent: '#ffb86b', button: '#ffb86b', edge: '#59b9cc', round: 28 },
  resultSign: { paper: '#17323a', ink: '#ffb86b', edge: '#59b9cc' },
};

// The game's sounds: what each game event plays. The sound-designer's part (references/team.md); data only.
// An entry is [effect, { pitch, volume }] (effects: pop, click, tick, good, bad, coin, bounce, win, whoosh, splash),
// { note: 'C4', seconds }, or { tone: 440, seconds, type, glide }; a list of entries plays them all.
const SOUNDS = {
  touch: { clip: 'snd-4e9f1aaae2', volume: 0.5 }, // wood-knock: a block picked up
  place: [{ clip: 'snd-e8265ae9e2', volume: 0.7 }, { clip: 'snd-23d5e2b90b', volume: 0.5 }], // stone-thud + block-snap
  cheer: { clip: 'snd-5745be6b26', volume: 0.6 }, // chime-good: a gap sealed
  start: { clip: 'snd-ae44cff8e4', volume: 0.6 }, // whoosh: the flood comes
  burst: { clip: 'snd-16d0231974', volume: 0.8 }, // splash-big: a gap gives way
  win: [{ clip: 'snd-b9fd9aad68', volume: 0.7 }, ['win', { volume: 0.6 }]],
  miss: { clip: 'snd-2c9f851c14', volume: 0.5 }, // knock-soft-miss: that gap is full
  ambient: { clip: 'snd-bf5d153ae5', loop: true, volume: 0.3 }, // river-flow, from the first block picked up
  birds: { clip: 'snd-662d8efa2e', loop: true, volume: 0.18 }, // forest-birds
};
// ---- end of parts ----

// River Dam: a world game (mode: world) on a forest river. The player carries gold blocks into the gaps of a dam and
// sees the idea in the scene: the deeper a gap, the longer the push arrow, the farther its jet, the more blocks it
// takes to hold. Learn on three gaps (1, 2, 3 blocks), then a flood: ten blocks for four gaps, metres held.
//
// ECS (/skills/common/ecs): every game thing is an entity (the round, the four dam rows, the four blocks), its data is
// in components, every behaviour is one system.
export default function build(api) {
  const { THREE, kit, traits, ui, isGrabbed, sound } = api;
  const root = new THREE.Group();
  const WORLD = true;
  const sfx = playSounds(sound, SOUNDS);
  const look = lowPolyLook(THREE, kit);
  const game = playWorld(api);

  // ---------------------------------------------------------------- the numbers
  // The model is in desk units (1 cm = 12 cm in the world). One row of the dam is 0.4 m of depth; water pushes
  // 9.8 kPa for every metre of depth; one block holds back 4 kPa.
  const ROW = 0.034;
  const ROW_M = 0.4;
  const KPA = 9.8;
  const HOLD = 4;
  const ROWS = 4;
  const CELLS = 4;
  const LEARN_ROWS = 3;
  const LEARN_LEVEL = 1.2;
  const FLOOD = 1.6;
  const RISE = 0.16;
  const BUDGET = 10;
  const LEN_K = 0.0075; // arrow length per kPa
  // Where things stand (the player stands at 0, 0 facing -Z): the pond on the left, the dam's wall growing to the right.
  const X0 = 0.05;
  const Z_FRONT = -0.2;
  const Z_BACK = -0.35;
  const Z_MID = -0.275;
  const POND = 0.25;
  const toDesk = (m) => (m * ROW) / ROW_M;
  const rowY = (j) => ROW * (j + 0.5);
  const cellX = (k) => X0 + ROW * (k + 0.5);
  const needFor = (depth) => (depth > 0 ? Math.ceil((KPA * depth) / HOLD - 1e-6) : 0);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const NAMES = ['bottom', 'second', 'third', 'top'];

  const MOVES = [
    { row: 2, say: 'Carry a block to the top gap, where the water is shallow.', why: 'Shallow water pushes gently, so one block holds it.' },
    { row: 1, say: 'Fill the middle gap. Add blocks until the leak stops.', why: 'Twice as deep means twice the push, so it took two blocks.' },
    { row: 0, say: 'Now the bottom gap, where the water is deepest.', why: 'The deepest water pushes hardest, so a dam is thickest at the bottom.' },
  ];
  const CHALLENGE = { say: 'Flood coming! Place 10 blocks, most where the push is biggest.', label: 'm held', stars: [0.4, 1.2, 1.6] };

  // ---------------------------------------------------------------- components: what things are
  const Round = game.component('Round', {
    phase: 'text', level: 'number', timer: 'number', demo: 'number', idle: 'number', stones: 'int', move: 'int',
    best: 'number', failAt: 'number', failRow: 'int', go: 'bool', showMe: 'bool', ambient: 'bool', shown: 'number',
  });
  const Row = game.component('Row', { index: 'int', blocks: 'int', depth: 'number', push: 'number', strain: 'number', view: 'object' });
  const Block = game.component('Block', { home: 'object', seat: 'object', was: 'bool' });
  const Built = game.component('Built');
  const Leaking = game.component('Leaking');
  const Sealed = game.component('Sealed');

  // ---------------------------------------------------------------- the place
  const gold = new THREE.BoxGeometry(0.03, 0.03, 0.03);
  const makeBlock = () => look.facet(gold.clone(), 'ochre', 'Dam block', { jitter: 0 });
  const ghostOf = (mesh, opacity) => {
    mesh.material = mesh.material.clone();
    mesh.material.transparent = true;
    mesh.material.opacity = opacity;
    mesh.material.depthWrite = false;
    mesh.raycast = () => {};
    return mesh;
  };

  // The stone bench: the blocks wait here at hand height, the first thing the player sees to do.
  const BENCH = 0.05;
  const BENCH_Z = -0.1;
  const bench = look.facet(new THREE.BoxGeometry(0.25, BENCH, 0.06), 'rock', 'Stone bench', { jitter: 0.001 });
  bench.position.set(0.17, BENCH / 2, BENCH_Z);
  root.add(bench);

  // The rock behind the dam and the cliff the stream falls from.
  const back = look.facet(new THREE.BoxGeometry(POND + 0.27, 0.17, 0.02), 'rockDark', 'Back rock', { jitter: 0.001 });
  back.position.set(X0 - POND / 2 + 0.065, 0.085, Z_BACK - 0.01);
  const cliff = look.facet(new THREE.BoxGeometry(0.07, 0.17, 0.17), 'rock', 'Cliff', { jitter: 0.002 });
  cliff.position.set(X0 - POND - 0.035, 0.085, Z_MID - 0.01);
  const topRock = look.rock(0.04, 'Cliff rock');
  topRock.position.set(X0 - POND - 0.04, 0.165, Z_MID - 0.025);
  const fall = look.facet(new THREE.BoxGeometry(0.022, 0.15, 0.012), 'river', 'Waterfall', { jitter: 0, water: true });
  fall.position.set(X0 - POND + 0.011, 0.093, Z_MID);
  fall.raycast = () => {};
  const posts = [X0 - POND + 0.005, X0 - 0.004].map((x) => {
    const post = look.facet(new THREE.BoxGeometry(0.012, 0.15, 0.012), 'trunk', 'Frame post', { jitter: 0.0004 });
    post.position.set(x, 0.075, Z_FRONT + 0.004);
    return post;
  });
  root.add(back, cliff, topRock, fall, ...posts);

  // The pond: a see-through block of water, so the player sees its depth; the flood line shows how high it comes.
  const pondGeo = new THREE.BoxGeometry(POND, toDesk(FLOOD), Z_FRONT - Z_BACK);
  pondGeo.translate(X0 - POND / 2, toDesk(FLOOD) / 2, Z_MID);
  const pond = ghostOf(look.facet(pondGeo, 'river', 'Pond', { jitter: 0, water: true }), 0.5);
  const surface = look.water([[X0 - POND, Z_BACK], [X0, Z_BACK], [X0, Z_FRONT], [X0 - POND, Z_FRONT]], 'Pond surface', { colour: 'seaShallow', amp: 0.0008 });
  surface.raycast = () => {};
  const floodLine = look.facet(new THREE.BoxGeometry(POND + 0.01, 0.003, 0.004), 'accent', 'Flood line', { jitter: 0 });
  floodLine.position.set(X0 - POND / 2, toDesk(FLOOD) + 0.002, Z_FRONT + 0.002);
  floodLine.raycast = () => {};
  const unitCard = kit.card('push in kPa', { width: 0.075 });
  unitCard.position.set(X0 - POND / 2 + 0.02, 0.15, Z_FRONT - 0.004);
  root.add(pond, surface, floodLine, unitCard);

  // One row of the dam: the slot where the next block goes, the blocks laid so far, the push arrow, its label and the jet.
  const arrowShaft = new THREE.BoxGeometry(1, 0.007, 0.007);
  const arrowHead = new THREE.ConeGeometry(0.0095, 0.016, 5);
  arrowHead.rotateZ(-Math.PI / 2);
  const slabGeo = new THREE.BoxGeometry(ROW * 0.94, ROW * 0.94, Z_FRONT - Z_BACK - 0.004);
  const slotGeo = new THREE.BoxGeometry(ROW * 0.92, ROW * 0.92, 0.012);
  const pushLearn = (j) => KPA * (LEARN_LEVEL - ROW_M * j);
  const pushFlood = (j) => KPA * (FLOOD - ROW_M * j);
  function label(kpa, j, len) {
    const text = look.number(String(Math.round(kpa)), 'paper', `Push ${Math.round(kpa)}`, { h: 0.02 });
    text.position.set(X0 - 0.003 - len - 0.012 - (text.userData.width ?? 0.03), rowY(j) - 0.01, Z_FRONT - 0.02);
    text.visible = false;
    text.raycast = () => {};
    return text;
  }
  function makeRow(j) {
    const group = new THREE.Group();
    group.name = `Dam row ${j + 1}`;
    const slabs = [];
    for (let k = 0; k < CELLS; k++) {
      const slab = look.facet(slabGeo.clone(), 'ochre', 'Block laid', { jitter: 0.0008 });
      slab.position.set(cellX(k), rowY(j), (Z_FRONT + Z_BACK) / 2 + 0.002);
      slab.visible = false;
      slab.raycast = () => {};
      slabs.push(slab);
    }
    const slot = ghostOf(look.facet(slotGeo.clone(), 'foam', 'Next block goes here', { jitter: 0 }), 0.6);
    slot.visible = false;
    const shaft = look.facet(arrowShaft.clone(), 'accent', 'Push shaft', { jitter: 0 });
    const head = look.facet(arrowHead.clone(), 'accent', 'Push head', { jitter: 0 });
    head.material = shaft.material = shaft.material.clone();
    shaft.material.transparent = true;
    shaft.raycast = head.raycast = () => {};
    const arrow = new THREE.Group();
    arrow.name = `Push ${j + 1}`;
    arrow.add(shaft, head);
    arrow.position.set(X0 - 0.003, rowY(j), Z_FRONT - 0.035);
    arrow.visible = false;
    const jets = look.drops(15, 0.0034, `Leak ${j + 1}`);
    jets.frustumCulled = false;
    jets.raycast = () => {};
    const labelLearn = j < LEARN_ROWS ? label(pushLearn(j), j, pushLearn(j) * LEN_K) : null;
    const labelFlood = label(pushFlood(j), j, pushFlood(j) * LEN_K);
    group.add(...slabs, slot, arrow, jets, labelFlood);
    if (labelLearn) group.add(labelLearn);
    return { group, slabs, slot, shaft, head, arrow, jets, jetOn: false, pop: [0, 0, 0, 0], labelLearn, labelFlood, rowPop: 1 };
  }

  // The blocks the player carries.
  const homes = [0.095, 0.17, 0.245].map((x) => new THREE.Vector3(x, BENCH + 0.015, BENCH_Z));
  const blockMeshes = homes.map((home, i) => {
    const mesh = makeBlock();
    mesh.name = `Block ${i + 1}`;
    mesh.position.copy(home);
    root.add(mesh);
    return mesh;
  });
  const ghost = ghostOf(makeBlock(), 0.55);
  ghost.name = 'Block shown';
  ghost.visible = false;
  root.add(ghost);

  // ---------------------------------------------------------------- entities: the things the game talks about
  const round = game.spawn(null, Round, { phase: 'learn', level: LEARN_LEVEL, stones: 99, best: -1, failRow: -1, idle: 5, failAt: FLOOD });
  const rows = [];
  for (let j = 0; j < ROWS; j++) {
    const view = makeRow(j);
    root.add(view.group);
    const entity = game.spawn(view.group, Row, { index: j, view });
    if (j < LEARN_ROWS) entity.addComponent(Built);
    else view.rowPop = 0;
    rows.push(entity);
  }
  const blocks = blockMeshes.map((mesh, i) => {
    const seat = lookSeat(THREE, mesh, isGrabbed, { returnAfter: 0.9 });
    return game.spawn(mesh, Block, { home: homes[i], seat }, game.Grabbable);
  });

  // ---------------------------------------------------------------- the panel and the rewards
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const big = Math.max(size.x, size.y, size.z);
  const panel = kit.panel(ui, {
    width: 0.3, position: [Math.max(1.06 * big, box.max.x + 0.05), 0.6 * big, 0], rotationY: -0.3, eyebrow: IDENTITY.eyebrow, title: IDENTITY.title, skin: IDENTITY.skin,
    items: [
      { text: IDENTITY.pitch, id: 'goal' },
      { status: MOVES[0].say, tone: 'neutral', id: 'state' },
      { text: 'Each block holds back 4 kPa of push. The arrows show the push.', id: 'why' },
      { progress: 0, label: `0 of ${MOVES.length}`, id: 'moves' },
      { stat: '-', label: CHALLENGE.label, id: 'result' },
      { stat: '-', label: 'best', id: 'best' },
      { buttons: [
        { label: 'Start', id: 'start', onPress() { round.setValue(Round, 'go', true); } },
        { label: 'Try again', id: 'again', onPress() { round.setValue(Round, 'go', true); } },
        { label: 'Show me', id: 'hint', onPress() { round.setValue(Round, 'showMe', true); } },
      ] },
    ],
  });
  root.add(panel.object3D);
  panel.show('start', false);
  panel.show('again', false);

  const stars = playStars(THREE);
  stars.position.set(X0 - 0.07, 0.2, Z_FRONT);
  root.add(stars);
  const burst = playBurst(THREE, root);
  const pops = playPop();
  const pointer = playPointer(THREE, WORLD ? { size: 0.4 } : {});
  root.add(pointer);
  const ring = playRing(THREE, root);
  const resultSign = kit.sign('3 OF 3 STARS', { width: 0.16, ...IDENTITY.resultSign, sub: CHALLENGE.label });
  resultSign.visible = false;
  resultSign.position.set(X0 + 0.27, 0.085, Z_FRONT + 0.02);
  root.add(resultSign);
  const startButton = playStartButton(THREE, WORLD ? { size: 0.025 } : {});
  startButton.position.set(X0 + 0.33, 0, -0.1);
  startButton.visible = false;
  root.add(startButton);
  traits(startButton, { onPress() { if (startButton.visible) { startButton.userData.press(); round.setValue(Round, 'go', true); } } });

  const say = (text, tone = 'neutral') => panel.set('state', text, tone);
  const phaseOf = () => round.getValue(Round, 'phase');
  const levelOf = () => round.getValue(Round, 'level');
  const faceX = (n) => X0 + ROW * n;

  // ---------------------------------------------------------------- the round: what happens when
  function prepareFlood() {
    rows.forEach((row, j) => {
      row.setValue(Row, 'blocks', 0);
      if (!row.hasComponent(Built)) row.addComponent(Built);
      row.getValue(Row, 'view').slabs.forEach((s, k) => { row.getValue(Row, 'view').pop[k] = 0; });
    });
    rows[LEARN_ROWS].getValue(Row, 'view').rowPop = 0.001;
    round.setValue(Round, 'phase', 'ready');
    round.setValue(Round, 'level', 0);
    round.setValue(Round, 'stones', BUDGET);
    round.setValue(Round, 'failRow', -1);
    round.setValue(Round, 'idle', 0);
    stars.userData.hide();
    resultSign.visible = false;
    startButton.visible = true;
    panel.show('start', true);
    panel.show('again', false);
    panel.set('why', 'Each block holds back 4 kPa. A longer arrow needs more blocks.');
    panel.set('result', '-');
    say(`${CHALLENGE.say} Then press Start.`, 'good');
  }

  function beginFlood() {
    // Where the dam gives way: gap j holds until the water is (j x 0.4 m) + (blocks x 4 kPa / 9.8) deep.
    let failAt = FLOOD;
    let failRow = -1;
    rows.forEach((row, j) => {
      const holds = ROW_M * j + (HOLD * row.getValue(Row, 'blocks')) / KPA;
      if (holds < failAt) { failAt = holds; failRow = j; }
    });
    round.setValue(Round, 'failAt', failAt);
    round.setValue(Round, 'failRow', failRow);
    round.setValue(Round, 'phase', 'play');
    round.setValue(Round, 'level', 0);
    round.setValue(Round, 'shown', 0);
    startButton.visible = false;
    ghost.visible = false;
    panel.show('start', false);
    panel.set('result', '0.0');
    panel.set('why', 'Watch the arrows grow as the water gets deeper.');
    say('The flood is rising...');
    sfx.fire('start');
  }

  function finishFlood(held, failRow) {
    const result = Math.floor(held * 10 + 1e-6) / 10;
    const best = Math.max(round.getValue(Round, 'best'), result);
    const k = playStarsFor(result, CHALLENGE.stars, false);
    round.setValue(Round, 'phase', 'done');
    round.setValue(Round, 'best', best);
    round.setValue(Round, 'level', failRow >= 0 ? Math.min(held + 0.25, FLOOD + 0.15) : FLOOD); // a gap that gave way leaks hard
    stars.userData.show(k);
    resultSign.userData.setText(`${k} OF 3 STARS`, `${result.toFixed(1)} ${CHALLENGE.label}`);
    resultSign.visible = true;
    pops.pop(resultSign, 0.3);
    if (failRow >= 0) {
      const n = rows[failRow].getValue(Row, 'blocks');
      sfx.fire('burst');
      burst.fire(faceX(n), rowY(failRow), Z_FRONT);
      ring.at(X0 + 0.1, 0, Z_FRONT + 0.04);
      say(`The ${NAMES[failRow]} gap gave way at ${result.toFixed(1)} m.`, k >= 2 ? 'neutral' : 'poor');
      panel.set('why', `Water ${result.toFixed(1)} m deep pushes harder than ${rows[failRow].getValue(Row, 'blocks')} block${n === 1 ? '' : 's'} hold. Deeper gaps need more.`);
    } else {
      sfx.fire('win');
      burst.fire(X0 + 0.07, 0.07, Z_FRONT, true);
      ring.at(X0 + 0.1, 0, Z_FRONT + 0.04);
      say('Three stars! 4, 3, 2, 1: thickest where the water is deepest.', 'good');
      panel.set('why', 'Every 0.4 m deeper adds 4 kPa of push, so it needs one more block.');
    }
    if (k === 0) sfx.fire('miss');
    panel.set('result', result.toFixed(1));
    panel.set('best', best.toFixed(1));
    panel.show('again', true);
    startButton.visible = true;
  }

  game.system('Round', { rounds: [Round] }, (q, dt) => {
    const phase = phaseOf();
    if (round.getValue(Round, 'showMe')) {
      round.setValue(Round, 'showMe', false);
      if (phase === 'learn' || phase === 'ready') round.setValue(Round, 'demo', 0.001);
    }
    if (round.getValue(Round, 'go')) {
      round.setValue(Round, 'go', false);
      if (phase === 'ready') beginFlood();
      else if (phase === 'done') prepareFlood();
    }
    if (phase === 'raise') {
      round.setValue(Round, 'timer', round.getValue(Round, 'timer') + dt);
      if (round.getValue(Round, 'timer') > 3) prepareFlood();
    }
    if (phase === 'play') {
      const level = Math.min(FLOOD, levelOf() + RISE * dt);
      const failAt = round.getValue(Round, 'failAt');
      if (level >= failAt) finishFlood(failAt, round.getValue(Round, 'failRow'));
      else if (level >= FLOOD) finishFlood(FLOOD, -1);
      else {
        round.setValue(Round, 'level', level);
        const shown = round.getValue(Round, 'shown') + dt;
        if (shown >= 0.1) { round.setValue(Round, 'shown', 0); panel.set('result', level.toFixed(1)); } else round.setValue(Round, 'shown', shown);
      }
    }
  });

  // ---------------------------------------------------------------- the hands: pick up a block, let go over the dam
  function release(block, mesh) {
    const phase = phaseOf();
    const home = block.getValue(Block, 'home');
    const p = mesh.position;
    const over = p.x > X0 - 0.07 && p.x < X0 + 0.21 && p.z > Z_BACK - 0.02 && p.z < Z_FRONT + 0.05 && p.y > -0.02 && p.y < 0.22;
    if (!over || (phase !== 'learn' && phase !== 'ready')) return; // let go elsewhere: it slides home by itself
    const j = clamp(Math.floor(p.y / ROW), 0, (phase === 'learn' ? LEARN_ROWS : ROWS) - 1);
    const row = rows[j];
    const n = row.getValue(Row, 'blocks');
    const full = phase === 'learn' ? row.hasComponent(Sealed) : n >= CELLS || round.getValue(Round, 'stones') <= 0;
    mesh.position.copy(home);
    pops.pop(mesh, 0.12);
    if (full) { sfx.fire('miss'); return; }
    row.setValue(Row, 'blocks', n + 1);
    sfx.fire('place');
    burst.fire(cellX(n), rowY(j), Z_FRONT);
    if (phase === 'ready') {
      const left = round.getValue(Round, 'stones') - 1;
      round.setValue(Round, 'stones', left);
      say(left > 0 ? `${left} block${left === 1 ? '' : 's'} left. Press Start when you are ready.` : 'All 10 blocks placed. Press Start!', 'neutral');
    }
  }

  game.system('Drop', { blocks: [Block] }, (q) => {
    for (const block of q.blocks) {
      const held = block.hasComponent(game.Held);
      const was = block.getValue(Block, 'was');
      if (held && !was) {
        block.setValue(Block, 'was', true);
        round.setValue(Round, 'idle', 0);
        sfx.fire('touch');
        if (!round.getValue(Round, 'ambient')) { round.setValue(Round, 'ambient', true); sfx.fire('ambient'); sfx.fire('birds'); }
      } else if (!held && was) {
        block.setValue(Block, 'was', false);
        release(block, game.objectOf(block));
      }
    }
  });

  game.system('Seat', { blocks: [Block] }, (q, dt) => {
    for (const block of q.blocks) block.getValue(Block, 'seat').update(dt);
  });

  // ---------------------------------------------------------------- the water: push against what holds
  game.system('Pressure', { rows: [Row, Built] }, (q) => {
    const level = levelOf();
    const phase = phaseOf();
    for (const row of q.rows) {
      const j = row.getValue(Row, 'index');
      const n = row.getValue(Row, 'blocks');
      const depth = Math.max(0, level - ROW_M * j);
      const push = KPA * depth;
      const leaking = push > HOLD * n + 1e-6;
      const sealed = depth > 0 && !leaking;
      row.setValue(Row, 'depth', depth);
      row.setValue(Row, 'push', push);
      row.setValue(Row, 'strain', n > 0 ? push / (HOLD * n) : push > 0 ? 9 : 0);
      if (leaking && !row.hasComponent(Leaking)) row.addComponent(Leaking);
      else if (!leaking && row.hasComponent(Leaking)) row.removeComponent(Leaking);
      if (sealed && !row.hasComponent(Sealed)) {
        row.addComponent(Sealed);
        if (phase === 'learn') {
          sfx.fire('cheer');
          burst.fire(X0 + ROW * (n / 2), rowY(j), Z_FRONT);
        }
      } else if (!sealed && row.hasComponent(Sealed)) row.removeComponent(Sealed);
    }
  });

  // The learn moves: each is done when its gap stops leaking.
  game.system('Learn', { rounds: [Round] }, () => {
    if (phaseOf() !== 'learn') return;
    const m = round.getValue(Round, 'move');
    if (!rows[MOVES[m].row].hasComponent(Sealed)) return;
    round.setValue(Round, 'move', m + 1);
    round.setValue(Round, 'idle', 0);
    panel.set('why', MOVES[m].why);
    panel.set('moves', (m + 1) / MOVES.length);
    if (m + 1 < MOVES.length) { say(MOVES[m + 1].say); return; }
    round.setValue(Round, 'phase', 'raise');
    round.setValue(Round, 'timer', 0);
    pointer.userData.at(null);
    say('The dam holds! Now a flood is coming...', 'good');
  });

  // ---------------------------------------------------------------- what the player sees
  game.system('Water', { rounds: [Round] }, (q, dt, time) => {
    const level = levelOf();
    const phase = phaseOf();
    const d = toDesk(level);
    pond.visible = surface.visible = level > 0.01;
    pond.scale.y = Math.max(0.001, d / toDesk(FLOOD));
    surface.position.y = d + 0.0008;
    floodLine.visible = phase === 'ready' || phase === 'play' || phase === 'done';
    fall.scale.x = 1 + 0.18 * Math.sin(time * 7);
    fall.scale.z = 1 + 0.25 * Math.sin(time * 5.3 + 1);
  });

  game.system('Slabs', { rows: [Row] }, (q, dt, time) => {
    const play = phaseOf() === 'play';
    for (const row of q.rows) {
      const view = row.getValue(Row, 'view');
      const built = row.hasComponent(Built);
      const n = row.getValue(Row, 'blocks');
      const shake = play && row.getValue(Row, 'strain') > 0.85 && n > 0;
      view.rowPop = clamp(view.rowPop + (built ? dt * 2 : -dt * 2), 0, 1);
      for (let k = 0; k < CELLS; k++) {
        const slab = view.slabs[k];
        const target = built && k < n ? 1 : 0;
        view.pop[k] = clamp(view.pop[k] + clamp(target - view.pop[k], -dt * 5, dt * 5), 0, 1);
        look.pop(slab, view.pop[k]);
        slab.position.x = cellX(k) + (shake ? Math.sin(time * 55 + k * 2 + row.getValue(Row, 'index')) * 0.0007 : 0);
      }
    }
  });

  game.system('Slots', { rows: [Row, Built] }, (q, dt, time) => {
    const phase = phaseOf();
    const move = round.getValue(Round, 'move');
    const target = phase === 'learn' && move < MOVES.length ? MOVES[move].row : -1;
    const open = phase === 'learn' || (phase === 'ready' && round.getValue(Round, 'stones') > 0);
    for (const row of q.rows) {
      const view = row.getValue(Row, 'view');
      const j = row.getValue(Row, 'index');
      const n = row.getValue(Row, 'blocks');
      const show = open && n < CELLS && !(phase === 'learn' && row.hasComponent(Sealed));
      view.slot.visible = show;
      if (!show) continue;
      const pulse = 1 + (j === target ? 0.14 : 0.05) * Math.sin(time * 5);
      view.slot.position.set(cellX(n), rowY(j), Z_FRONT + 0.004);
      view.slot.scale.set(pulse, pulse, 1);
    }
  });

  game.system('Arrows', { rows: [Row] }, (q, dt, time) => {
    const phase = phaseOf();
    const learn = phase === 'learn' || phase === 'raise';
    const level = phase === 'ready' ? FLOOD : levelOf();
    for (const row of q.rows) {
      const view = row.getValue(Row, 'view');
      const j = row.getValue(Row, 'index');
      const built = row.hasComponent(Built);
      const len = built ? KPA * Math.max(0, level - ROW_M * j) * LEN_K : 0;
      const on = len > 0.03;
      view.arrow.visible = on;
      if (view.labelLearn) view.labelLearn.visible = built && learn;
      view.labelFlood.visible = built && !learn && view.rowPop > 0.9;
      if (!on) continue;
      view.shaft.scale.x = len - 0.014;
      view.shaft.position.x = -0.014 - (len - 0.014) / 2;
      view.head.position.x = -0.008;
      view.shaft.material.opacity = phase === 'ready' ? 0.45 : 1;
      const strained = phase === 'play' && row.getValue(Row, 'strain') > 0.85;
      const throb = strained ? 1 + 0.35 * Math.sin(time * 18) : 1;
      view.arrow.scale.set(1, throb, throb);
    }
  });

  // The leaks: water shoots out of a gap that is not held. Deeper means faster and farther (speed grows with the square root of depth).
  game.system('Jets', { rows: [Row] }, (q, dt, time) => {
    for (const row of q.rows) {
      const view = row.getValue(Row, 'view');
      const leaking = row.hasComponent(Built) && row.hasComponent(Leaking);
      if (!leaking) {
        if (view.jetOn) { for (let i = 0; i < 15; i++) view.jets.userData.place(i, 0, 0, 0, 0); view.jetOn = false; }
        continue;
      }
      view.jetOn = true;
      const j = row.getValue(Row, 'index');
      const n = row.getValue(Row, 'blocks');
      const push = row.getValue(Row, 'push');
      const left = clamp((push - HOLD * n) / push, 0.15, 1);
      const reach = 0.1 * Math.sqrt(row.getValue(Row, 'depth')) * (0.45 + 0.55 * left);
      const x0 = faceX(n);
      const y0 = rowY(j);
      for (let i = 0; i < 15; i++) {
        const c = i % 5;
        const u = (time * 0.85 + Math.floor(i / 5) / 3 + c * 0.06) % 1;
        view.jets.userData.place(i, x0 + reach * u, Math.max(0.003, y0 - 0.06 * u * u), Z_FRONT - 0.02 - c * 0.03, (0.55 + 0.45 * (1 - u)) * (0.6 + 0.4 * left));
      }
    }
  });

  // ---------------------------------------------------------------- the guide: the first move is shown, the next thing bounces
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  let pointerKey = -1;
  let nudge = 0;
  // The arrow over the next thing to touch moves only when that thing changes (the key says which).
  const pointAt = (key, object) => { if (key !== pointerKey) { pointerKey = key; pointer.userData.at(object); } };
  game.system('Guide', { rounds: [Round] }, (q, dt) => {
    const phase = phaseOf();
    const learning = phase === 'learn' || phase === 'ready';
    let carrying = false;
    for (const b of blocks) if (b.hasComponent(game.Held)) carrying = true;
    const move = round.getValue(Round, 'move');
    const targetRow = phase === 'learn' && move < MOVES.length ? MOVES[move].row : 0;
    const slot = rows[targetRow].getValue(Row, 'view').slot;
    const stones = round.getValue(Round, 'stones');
    if (phase === 'learn') {
      if (carrying) pointAt(10 + move * 10 + rows[targetRow].getValue(Row, 'blocks'), slot);
      else pointAt(1, blockMeshes[0]);
    } else if (phase === 'ready') {
      if (stones > 0) pointAt(1, blockMeshes[0]);
      else pointAt(2, startButton);
    } else if (phase === 'done') pointAt(2, startButton);
    else pointAt(0, null);
    // The hero does the move by itself: a block flies from the yard to the gap.
    let demo = round.getValue(Round, 'demo');
    let idle = round.getValue(Round, 'idle');
    if (learning && !carrying && demo === 0) idle += dt;
    if (idle > 6 && demo === 0) { demo = 0.001; idle = 0; }
    round.setValue(Round, 'idle', idle);
    if (demo > 0) {
      demo += dt;
      const u = demo / 1.8;
      if (u >= 1 || !learning) { ghost.visible = false; demo = 0; if (u >= 1) pops.pop(slot, 0.15); }
      else {
        from.copy(homes[0]);
        to.copy(slot.position);
        ghost.position.lerpVectors(from, to, u);
        ghost.position.y += Math.sin(Math.PI * u) * 0.06;
        ghost.visible = true;
      }
    }
    round.setValue(Round, 'demo', demo);
    nudge -= dt;
    if (learning && !carrying && nudge <= 0) { nudge = 2.5; pops.pop(blockMeshes[0], 0.06); }
  });

  // ---------------------------------------------------------------- the land: a forest river you can walk along
  if (WORLD) {
    const river = [[0.19, 0, Z_MID], [0.3, 0, -0.28], [0.5, 0, -0.33], [0.7, 0, -0.41], [0.9, 0, -0.51], [1.05, 0, -0.65]];
    const flats = [
      { x: 0, z: 0, r: 0.12 }, { x: 0.02, z: -0.25, r: 0.3 },
      ...river.slice(2).map(([x, , z]) => ({ x, z, r: 0.12 })),
      { x: -0.4, z: 0.05, r: 0.06 }, { x: -0.7, z: 0.05, r: 0.06 }, { x: 0.55, z: -0.12, r: 0.07 }, { x: 0.8, z: -0.27, r: 0.07 }, { x: 1.0, z: -0.4, r: 0.07 },
    ];
    const land = worldTerrain(THREE, { seed: 3, height: 0.012, flat: flats, hills: [{ x: -0.7, z: -0.8, r: 0.35, h: 0.16 }, { x: 0.9, z: -0.9, r: 0.3, h: 0.12 }], colors: { low: '#6fa05b', high: '#9bbd73' } });
    const stream = look.river(river, 'Forest river', { width: 0.15 });
    root.add(
      land,
      stream,
      worldPath(THREE, land, [[-0.7, 0.05], [-0.35, 0.05], [0, 0.02], [0.35, 0], [0.55, -0.12], [0.8, -0.27], [1.0, -0.4]], { width: 0.03, color: '#d8c49a' }),
      worldScatter(THREE, land, 'pine', { count: 34, from: 0.35, to: 1.1, avoid: flats, seed: 5 }),
      worldScatter(THREE, land, 'round', { count: 14, from: 0.4, to: 1.0, avoid: flats, seed: 11 }),
      worldScatter(THREE, land, 'bush', { count: 12, from: 0.3, to: 0.9, avoid: flats, seed: 7 }),
      worldScatter(THREE, land, 'rock', { count: 8, from: 0.3, to: 1.0, avoid: flats, seed: 9 }),
      worldEdge(THREE, { kind: 'mountains' }),
    );
  }

  return {
    root,
    ...(WORLD ? { mode: 'world', sky: 'day', ground: 'grass' } : {}),
    update(time, delta) {
      const dt = Math.min(delta, 0.05);
      look.update(time);
      game.update(time, dt);
      pops.update(dt);
      burst.update(dt);
      stars.userData.update(dt);
      ring.update(dt);
      startButton.userData.update(dt);
      pointer.userData.update(time);
    },
  };
}
