// The paintbox for agent-written lessons ("kit"): procedural materials and textures, shape helpers and
// small effects, so generated 3D can look crafted without image files (generated code has no network and
// no DOM). It holds no ready-made objects: the agent still designs and builds everything.
//
// One source for both sides: the server's dry run imports this file (dry: true skips the pixel work) and
// the headset fetches it from GET /api/kit.js. Plain JavaScript with no imports: THREE is passed in.

export const KIT_VERSION = 1;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const smoothstep = (a, b, x) => smooth(clamp01((x - a) / (b - a)));
const wrap = (v, p) => ((v % p) + p) % p;

/** Integer lattice hash (32 bits). */
function hashInt(ix, iy, iz, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(iz, 1440662683) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Lattice hash to [0, 1). */
const hash = (ix, iy, iz, seed) => hashInt(ix, iy, iz, seed) / 4294967296;

/** The dot product of a lattice point's gradient (one of 12 edge directions) with the offset to the sample. */
function gradient(ix, iy, iz, seed, dx, dy, dz) {
  const h = hashInt(ix, iy, iz, seed) >>> 28;
  const u = h < 8 ? dx : dy;
  const v = h < 4 ? dy : h === 12 || h === 14 ? dx : dz;
  return (h & 1 ? -u : u) + (h & 2 ? -v : v);
}

/**
 * Smooth gradient (Perlin) noise in 3D, about 0.15..0.85 around 0.5: no grid look, unlike value noise.
 * Periods (px, py, pz > 0) wrap the lattice so the result tiles.
 */
function noise3(x, y, z, seed, px, py, pz) {
  let x0 = Math.floor(x);
  let y0 = Math.floor(y);
  let z0 = Math.floor(z);
  const dx = x - x0;
  const dy = y - y0;
  const dz = z - z0;
  const fx = dx * dx * dx * (dx * (dx * 6 - 15) + 10);
  const fy = dy * dy * dy * (dy * (dy * 6 - 15) + 10);
  const fz = dz * dz * dz * (dz * (dz * 6 - 15) + 10);
  let x1 = x0 + 1;
  let y1 = y0 + 1;
  let z1 = z0 + 1;
  if (px) { x0 = wrap(x0, px); x1 = wrap(x1, px); }
  if (py) { y0 = wrap(y0, py); y1 = wrap(y1, py); }
  if (pz) { z0 = wrap(z0, pz); z1 = wrap(z1, pz); }
  const a = lerp(gradient(x0, y0, z0, seed, dx, dy, dz), gradient(x1, y0, z0, seed, dx - 1, dy, dz), fx);
  const b = lerp(gradient(x0, y1, z0, seed, dx, dy - 1, dz), gradient(x1, y1, z0, seed, dx - 1, dy - 1, dz), fx);
  const c = lerp(gradient(x0, y0, z1, seed, dx, dy, dz - 1), gradient(x1, y0, z1, seed, dx - 1, dy, dz - 1), fx);
  const d = lerp(gradient(x0, y1, z1, seed, dx, dy - 1, dz - 1), gradient(x1, y1, z1, seed, dx - 1, dy - 1, dz - 1), fx);
  return 0.5 + 0.5 * lerp(lerp(a, b, fy), lerp(c, d, fy), fz);
}

/** Layered noise, 0..1 (values cluster around 0.5; callers stretch the contrast). */
function fbm(x, y, z, seed, octaves, px = 0, py = 0, pz = 0) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise3(x, y, z, seed + o * 101, px, py, pz);
    norm += amp;
    amp *= 0.5;
    x *= 2; y *= 2; z *= 2;
    px *= 2; py *= 2; pz *= 2;
  }
  return sum / norm;
}

/** Cell (Worley) noise: distances to the nearest and second-nearest feature point, and the nearest cell's id. */
function cellNoise(x, y, z, seed, px, py, pz, volume, out) {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const cz = Math.floor(z);
  let f1 = 9;
  let f2 = 9;
  let id = 0;
  for (let dz = volume ? -1 : 0; dz <= (volume ? 1 : 0); dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const gx = cx + dx;
        const gy = cy + dy;
        const gz = cz + dz;
        const hx = px ? wrap(gx, px) : gx;
        const hy = py ? wrap(gy, py) : gy;
        const hz = pz ? wrap(gz, pz) : gz;
        const ox = gx + hash(hx, hy, hz, seed) - x;
        const oy = gy + hash(hx, hy, hz, seed + 31) - y;
        const oz = volume ? gz + hash(hx, hy, hz, seed + 67) - z : 0;
        const d = ox * ox + oy * oy + oz * oz;
        if (d < f1) { f2 = f1; f1 = d; id = hash(hx, hy, hz, seed + 113); } else if (d < f2) f2 = d;
      }
    }
  }
  out[0] = Math.sqrt(f1);
  out[1] = Math.sqrt(f2);
  out[2] = id;
}

/** "#rgb", "#rrggbb", a number or [r, g, b] (0-255) as sRGB bytes. */
function colorBytes(value) {
  if (Array.isArray(value)) return [value[0] | 0, value[1] | 0, value[2] | 0];
  if (typeof value === 'number') return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  let s = String(value).trim().replace(/^#/, '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = parseInt(s, 16);
  if (s.length !== 6 || Number.isNaN(n)) throw new Error(`kit: write colors as "#rrggbb" (got ${JSON.stringify(value)}).`);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A color ramp: colors evenly spaced, or [position 0..1, color] stops. Returns ramp(t, data, offset). */
function makeRamp(colors) {
  if (!Array.isArray(colors) || colors.length === 0) throw new Error('kit: colors must be a list such as ["#223355", "#aaccee"].');
  const stops = colors.map((c, i) => (Array.isArray(c) && c.length === 2 && typeof c[0] === 'number' && typeof c[1] !== 'number'
    ? { at: c[0], rgb: colorBytes(c[1]) }
    : { at: colors.length === 1 ? 0 : i / (colors.length - 1), rgb: colorBytes(c) }));
  stops.sort((a, b) => a.at - b.at);
  const ramp = (t, data, offset) => {
    let i = 0;
    while (i < stops.length - 2 && t > stops[i + 1].at) i++;
    const a = stops[i];
    const b = stops[Math.min(i + 1, stops.length - 1)];
    const k = b.at > a.at ? clamp01((t - a.at) / (b.at - a.at)) : 0;
    data[offset] = a.rgb[0] + (b.rgb[0] - a.rgb[0]) * k;
    data[offset + 1] = a.rgb[1] + (b.rgb[1] - a.rgb[1]) * k;
    data[offset + 2] = a.rgb[2] + (b.rgb[2] - a.rgb[2]) * k;
    data[offset + 3] = 255;
  };
  const mid = [0, 0, 0, 255];
  ramp(0.5, mid, 0);
  ramp.mid = mid;
  ramp.stops = stops;
  return ramp;
}

const vec3 = (v, what) => {
  if (Array.isArray(v) && v.length >= 3) return [Number(v[0]), Number(v[1]), Number(v[2])];
  if (v && typeof v.x === 'number') return [v.x, v.y, v.z ?? 0];
  throw new Error(`kit: ${what} must be [x, y, z] (got ${JSON.stringify(v)}).`);
};

export function createKit(THREE, options = {}) {
  const dry = options.dry === true;
  const owned = new Set(); // textures, materials and geometries disposed with the lesson
  const jobs = []; // textures still being painted, a few milliseconds per frame
  const cache = new Map(); // textures by recipe
  const own = (thing) => (owned.add(thing), thing);
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  // --- Textures -------------------------------------------------------------------------------------------

  /** A texture filled row by row. Big ones are painted over the next frames (pump), so nothing stalls. */
  function paint(width, height, shadeRow, o = {}) {
    const data = new Uint8Array(width * height * 4);
    const base = o.base || [128, 128, 128, 255];
    for (let i = 0; i < data.length; i += 4) {
      data[i] = base[0]; data[i + 1] = base[1]; data[i + 2] = base[2]; data[i + 3] = base[3] ?? 255;
    }
    const tex = own(new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType));
    tex.colorSpace = o.data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    tex.wrapS = o.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    tex.wrapT = o.clamp || o.sphere ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 4;
    tex.userData.kitSphere = Boolean(o.sphere);
    tex.needsUpdate = true;
    if (dry) return tex;
    const job = { tex, data, width, height, shadeRow, row: 0 };
    if (width * height <= 4096) {
      while (job.row < height) shadeRow(job.row++, data, width, height);
      tex.needsUpdate = true;
    } else {
      jobs.push(job);
    }
    return tex;
  }

  /** Unit direction on the sphere for a texel, matching THREE.SphereGeometry's UVs (v = 1 at the +Y pole). */
  const sphereDir = (u, v, out) => {
    const lon = u * Math.PI * 2;
    const lat = (v - 0.5) * Math.PI;
    const c = Math.cos(lat);
    out[0] = -Math.cos(lon) * c;
    out[1] = Math.sin(lat);
    out[2] = Math.sin(lon) * c;
  };

  const dims = (o) => {
    const size = Math.min(1024, Math.max(16, Math.round(o.size ?? 256)));
    return o.sphere ? [size, size / 2] : [size, size];
  };
  const stretch = (n, contrast) => clamp01(0.5 + (n - 0.5) * 2.2 * contrast);

  const TEXTURES = {
    /** Cloudy noise through a color ramp: rock, clouds, continents, rust, marble, terrain. */
    noise(o) {
      const [width, height] = dims(o);
      const sphere = Boolean(o.sphere);
      const scale = sphere ? o.scale ?? 2.5 : Math.max(1, Math.round(o.scale ?? 4));
      const [sx, sy] = o.stretch || [1, 1];
      const px = sphere ? 0 : Math.max(1, Math.round(scale * sx));
      const py = sphere ? 0 : Math.max(1, Math.round(scale * sy));
      const octaves = o.octaves ?? 5;
      const seed = o.seed ?? 1;
      const warp = o.warp ?? 0;
      const contrast = o.contrast ?? 1;
      const ramp = makeRamp(o.colors || ['#30343a', '#d8dce2']);
      // Polar caps on a sphere, e.g. { color: '#ffffff', size: 0.15 } (size = share of the way from pole to equator).
      const caps = sphere && o.caps ? { rgb: colorBytes(o.caps.color ?? '#ffffff'), size: o.caps.size ?? 0.15 } : null;
      const dir = [0, 0, 0];
      return paint(width, height, (y, data) => {
        const v = (y + 0.5) / height;
        for (let x = 0; x < width; x++) {
          const u = (x + 0.5) / width;
          let n;
          if (sphere) {
            sphereDir(u, v, dir);
            let qx = dir[0] * scale;
            let qy = dir[1] * scale;
            let qz = dir[2] * scale;
            if (warp) {
              qx += warp * 2 * (fbm(qx + 5.2, qy + 1.3, qz + 9.1, seed + 17, 3) - 0.5);
              qy += warp * 2 * (fbm(qx + 2.7, qy + 8.4, qz + 3.3, seed + 29, 3) - 0.5);
              qz += warp * 2 * (fbm(qx + 7.1, qy + 4.6, qz + 6.2, seed + 43, 3) - 0.5);
            }
            n = fbm(qx, qy, qz, seed, octaves);
          } else {
            let qx = u * px;
            let qy = v * py;
            if (warp) {
              const w = fbm(qx, qy, 0, seed + 17, 3, px, py) - 0.5;
              const w2 = fbm(qx, qy, 0, seed + 29, 3, px, py) - 0.5;
              qx += warp * 2 * w;
              qy += warp * 2 * w2;
            }
            n = fbm(qx, qy, 0, seed, octaves, px, py);
          }
          n = stretch(n, contrast);
          const at = (y * width + x) * 4;
          ramp(n, data, at);
          if (caps) {
            const k = smoothstep(1 - caps.size - 0.05, 1 - caps.size + 0.03, Math.abs(v - 0.5) * 2 + (n - 0.5) * 0.12);
            if (k > 0) {
              data[at] += (caps.rgb[0] - data[at]) * k;
              data[at + 1] += (caps.rgb[1] - data[at + 1]) * k;
              data[at + 2] += (caps.rgb[2] - data[at + 2]) * k;
            }
          }
        }
      }, { base: ramp.mid, sphere });
    },

    /** Soft irregular bands with turbulence: gas giants, rock strata, agate, sunsets. */
    bands(o) {
      const [width, height] = dims(o);
      const sphere = Boolean(o.sphere);
      const count = o.count ?? 9;
      const seed = o.seed ?? 1;
      const warp = o.warp ?? 0.12;
      const across = o.direction === 'u';
      const ramp = makeRamp(o.colors || ['#c9b08a', '#8a5a3a', '#e8d9b5', '#a0703f']);
      const dir = [0, 0, 0];
      const period = Math.max(1, Math.round(o.scale ?? 4));
      return paint(width, height, (y, data) => {
        const v = (y + 0.5) / height;
        for (let x = 0; x < width; x++) {
          const u = (x + 0.5) / width;
          let turbulence;
          if (sphere) {
            sphereDir(u, v, dir);
            turbulence = fbm(dir[0] * 3, dir[1] * 9, dir[2] * 3, seed + 5, 4) - 0.5;
          } else {
            turbulence = fbm(u * period, v * period, 0, seed + 5, 4, period, period) - 0.5;
          }
          const t = (across ? u : v) + warp * turbulence;
          // Two layers of smooth 1D noise pick the band color; fine turbulence breaks up the edges.
          const band = 0.65 * noise3(t * count, 0.5, 0.5, seed, 0, 0, 0) + 0.35 * noise3(t * count * 2.7, 3.5, 0.5, seed + 9, 0, 0, 0);
          ramp(clamp01(0.5 + (band - 0.5) * 2 + turbulence * 0.25), data, (y * width + x) * 4);
        }
      }, { base: ramp.mid, sphere });
    },

    /** Cells: scales, pebbles, cracked mud, craters, plant or skin tissue, honeycomb-like mosaics. */
    cells(o) {
      const [width, height] = dims(o);
      const sphere = Boolean(o.sphere);
      const scale = sphere ? o.scale ?? 5 : Math.max(1, Math.round(o.scale ?? 6));
      const seed = o.seed ?? 1;
      const flat = o.mode === 'flat'; // one color per cell instead of shading by distance from its centre
      const edge = o.edge ?? 0.06;
      const ramp = makeRamp(o.colors || ['#e7e2d6', '#8c8676']);
      const edgeRgb = o.edgeColor ? colorBytes(o.edgeColor) : null;
      const dir = [0, 0, 0];
      const cell = [0, 0, 0];
      return paint(width, height, (y, data) => {
        const v = (y + 0.5) / height;
        for (let x = 0; x < width; x++) {
          const u = (x + 0.5) / width;
          if (sphere) {
            sphereDir(u, v, dir);
            cellNoise(dir[0] * scale, dir[1] * scale, dir[2] * scale, seed, 0, 0, 0, true, cell);
          } else {
            cellNoise(u * scale, v * scale, 0, seed, scale, scale, 0, false, cell);
          }
          const at = (y * width + x) * 4;
          ramp(flat ? cell[2] : clamp01(cell[0] / 0.75), data, at);
          if (edgeRgb) {
            const k = 1 - smoothstep(edge * 0.4, edge, cell[1] - cell[0]);
            data[at] += (edgeRgb[0] - data[at]) * k;
            data[at + 1] += (edgeRgb[1] - data[at + 1]) * k;
            data[at + 2] += (edgeRgb[2] - data[at + 2]) * k;
          }
        }
      }, { base: ramp.mid, sphere });
    },

    /** Even stripes cycling through the colors (direction 'v' = stacked along the height of a lathe or cylinder). */
    stripes(o) {
      const size = Math.min(512, Math.max(16, Math.round(o.size ?? 128)));
      const count = Math.max(1, Math.round(o.count ?? 6));
      const colors = (o.colors || ['#d43a2f', '#f4f1ea']).map(colorBytes);
      const along = o.direction === 'u';
      return paint(size, size, (y, data, width, height) => {
        for (let x = 0; x < width; x++) {
          const t = (along ? (x + 0.5) / width : (y + 0.5) / height) * count;
          const i = Math.floor(t);
          const f = t - i;
          const a = colors[i % colors.length];
          const b = colors[(i + 1) % colors.length];
          const k = smoothstep(1 - Math.min(0.5, (1.5 * count) / size), 1, f); // a soft edge so stripes don't shimmer
          const at = (y * width + x) * 4;
          data[at] = a[0] + (b[0] - a[0]) * k;
          data[at + 1] = a[1] + (b[1] - a[1]) * k;
          data[at + 2] = a[2] + (b[2] - a[2]) * k;
          data[at + 3] = 255;
        }
      }, { base: [...colors[0], 255] });
    },

    checker(o) {
      const size = Math.min(512, Math.max(16, Math.round(o.size ?? 128)));
      const count = Math.max(1, Math.round(o.count ?? 8));
      const colors = (o.colors || ['#22262c', '#e9ecef']).map(colorBytes);
      return paint(size, size, (y, data, width, height) => {
        for (let x = 0; x < width; x++) {
          const c = colors[(Math.floor(((x + 0.5) / width) * count) + Math.floor(((y + 0.5) / height) * count)) % 2 ? 1 : 0];
          const at = (y * width + x) * 4;
          data[at] = c[0]; data[at + 1] = c[1]; data[at + 2] = c[2]; data[at + 3] = 255;
        }
      }, { base: [...colors[0], 255] });
    },

    /** A smooth blend along 'v' (default), 'u', or 'radial' from the centre. */
    gradient(o) {
      const ramp = makeRamp(o.colors || ['#10203a', '#7fb6ff']);
      const radial = o.direction === 'radial';
      const along = o.direction === 'u';
      return paint(64, 64, (y, data, width, height) => {
        for (let x = 0; x < width; x++) {
          const u = (x + 0.5) / width;
          const v = (y + 0.5) / height;
          ramp(radial ? clamp01(Math.hypot(u - 0.5, v - 0.5) * 2) : along ? u : v, data, (y * width + x) * 4);
        }
      }, { base: ramp.mid, clamp: true });
    },

    /** Brick or tile courses with mortar. */
    bricks(o) {
      const size = Math.min(512, Math.max(32, Math.round(o.size ?? 256)));
      const rows = Math.max(1, Math.round(o.rows ?? 8));
      const columns = Math.max(1, Math.round(o.columns ?? 4));
      const gap = o.gap ?? 0.07;
      const seed = o.seed ?? 1;
      const ramp = makeRamp(o.colors || ['#8f4a32', '#b0613f', '#7a3e2b']);
      const mortar = colorBytes(o.mortar ?? '#cfc8ba');
      return paint(size, size, (y, data, width, height) => {
        const v = ((y + 0.5) / height) * rows;
        const row = Math.floor(v);
        const fv = v - row;
        for (let x = 0; x < width; x++) {
          const u = ((x + 0.5) / width) * columns + (row % 2 ? 0.5 : 0);
          const column = Math.floor(u);
          const fu = u - column;
          const at = (y * width + x) * 4;
          const side = (gap * columns) / rows / 2; // the same thickness as the mortar between courses
          const inMortar = fv < gap || fu < side || fu > 1 - side;
          if (inMortar) {
            data[at] = mortar[0]; data[at + 1] = mortar[1]; data[at + 2] = mortar[2]; data[at + 3] = 255;
          } else {
            const grain = fbm(u * 6, v * 6, 0, seed, 3) - 0.5;
            ramp(clamp01(hash(wrap(column, columns), row, 0, seed) + grain * 0.5), data, at);
          }
        }
      }, { base: ramp.mid });
    },

    /** Wood grain running along v. */
    wood(o) {
      const size = Math.min(512, Math.max(32, Math.round(o.size ?? 256)));
      const rings = o.rings ?? 7;
      const seed = o.seed ?? 1;
      const ramp = makeRamp(o.colors || ['#7b4f2c', '#a9713f', '#c4925a']);
      return paint(size, size, (y, data, width, height) => {
        const v = (y + 0.5) / height;
        for (let x = 0; x < width; x++) {
          const u = (x + 0.5) / width;
          const wobble = fbm(u * 3, v * 2, 0, seed, 3, 3, 2) - 0.5;
          const ring = 0.5 + 0.5 * Math.sin((u + wobble * 0.35) * rings * Math.PI * 2);
          const grain = fbm(u * 48, v * 4, 0, seed + 7, 2, 48, 4) - 0.5;
          ramp(clamp01(ring * 0.75 + 0.12 + grain * 0.5), data, (y * width + x) * 4);
        }
      }, { base: ramp.mid });
    },
  };

  function texture(kind, o = {}) {
    const recipe = TEXTURES[kind];
    if (!recipe) throw new Error(`kit.texture: unknown kind '${kind}'. Kinds: ${Object.keys(TEXTURES).join(', ')}.`);
    const key = `${kind}:${JSON.stringify(o)}`;
    if (!cache.has(key)) cache.set(key, recipe(o));
    return cache.get(key);
  }

  /** Shared grey detail maps: fine grain for bumps, soft blotches for uneven roughness, streaks for brushed metal. */
  function detail(which) {
    const key = `detail:${which}`;
    if (cache.has(key)) return cache.get(key);
    const size = 128;
    const recipe = {
      fine: (u, v) => fbm(u * 24, v * 24, 0, 11, 3, 24, 24),
      coarse: (u, v) => 0.62 + 0.38 * stretch(fbm(u * 4, v * 4, 0, 23, 4, 4, 4), 1),
      streaks: (u, v) => fbm(u * 2, v * 96, 0, 37, 2, 2, 96),
    }[which];
    const tex = paint(size, size, (y, data, width, height) => {
      for (let x = 0; x < width; x++) {
        const g = Math.round(clamp01(recipe((x + 0.5) / width, (y + 0.5) / height)) * 255);
        const at = (y * width + x) * 4;
        data[at] = g; data[at + 1] = g; data[at + 2] = g; data[at + 3] = 255;
      }
    }, { data: true, base: [200, 200, 200, 255] });
    cache.set(key, tex);
    return tex;
  }

  /** A near-white map with darker blotches, multiplied into a material's color: wear and grime. */
  function grime(wear) {
    const level = Math.round(clamp01(wear) * 10) / 10;
    const dark = Math.round(255 * (1 - 0.55 * level));
    const mid = Math.round((dark + 255) / 2);
    return texture('noise', { colors: [[0, [dark, dark, dark]], [0.35, [mid, mid, mid]], [0.6, '#ffffff'], [1, '#ffffff']], scale: 5, octaves: 6, warp: 0.5, seed: 7, size: 256 });
  }

  // --- Materials ------------------------------------------------------------------------------------------

  // tile: metres one texture tile covers (textures are laid on at real-world scale by finalize()).
  const PRESETS = {
    plastic: { roughness: 0.5, wear: 0.05, bump: 0.2, tile: 0.2 },
    glossy: { roughness: 0.16, clearcoat: 0.7, wear: 0.03, tile: 0.25 },
    rubber: { color: '#1b1c1f', roughness: 0.93, wear: 0.2, bump: 1, tile: 0.05 },
    paintedMetal: { roughness: 0.55, metalness: 0.3, wear: 0.25, bump: 0.35, tile: 0.12 },
    metal: { color: '#aeb4bd', roughness: 0.4, metalness: 1, wear: 0.12, bump: 0.25, tile: 0.14 },
    brushedMetal: { color: '#c2c7cf', roughness: 0.45, metalness: 1, wear: 0.05, bump: 0.6, streaks: true, tile: 0.1 },
    chrome: { color: '#eef1f5', roughness: 0.07, metalness: 1, wear: 0, plain: true },
    steel: { color: '#8b93a0', roughness: 0.42, metalness: 1, wear: 0.15, bump: 0.25, tile: 0.14 },
    iron: { color: '#55595f', roughness: 0.65, metalness: 0.6, wear: 0.3, bump: 0.6, tile: 0.1 },
    gold: { color: '#e3b04b', roughness: 0.24, metalness: 1, wear: 0.05, tile: 0.2 },
    copper: { color: '#c7774a', roughness: 0.3, metalness: 1, wear: 0.12, tile: 0.2 },
    brass: { color: '#c8a24c', roughness: 0.3, metalness: 1, wear: 0.1, tile: 0.2 },
    rust: { map: ['noise', { colors: ['#3a2016', '#74391c', '#b4612c', '#8a4a22', '#4b2a1b'], scale: 5, octaves: 5 }], roughness: 0.92, metalness: 0.25, bump: 1, tile: 0.12 },
    glass: { color: '#cfeaf5', roughness: 0.05, opacity: 0.3, plain: true },
    wood: { map: ['wood', {}], roughness: 0.68, bump: 0.3, tile: 0.22 },
    stone: { map: ['noise', { colors: ['#6f6d69', '#9a968f', '#b9b4aa', '#85817a'], scale: 5, octaves: 5 }], roughness: 0.95, bump: 1.2, tile: 0.15 },
    rock: { map: ['noise', { colors: ['#3f3a35', '#6b6258', '#8d8273', '#574e45'], scale: 4, octaves: 6, warp: 0.4 }], roughness: 1, bump: 1.6, tile: 0.14 },
    concrete: { map: ['noise', { colors: ['#a7a59f', '#c2c0b9', '#b3b1aa'], scale: 8, octaves: 4 }], roughness: 0.95, bump: 0.8, tile: 0.2 },
    brick: { map: ['bricks', {}], roughness: 0.9, bump: 0.8, tile: 0.25 },
    sand: { map: ['noise', { colors: ['#c9ab7c', '#e2c896', '#d6b987'], scale: 10, octaves: 4 }], roughness: 1, bump: 0.9, tile: 0.12 },
    soil: { map: ['noise', { colors: ['#3b2a1e', '#5c4330', '#4a3526'], scale: 8, octaves: 5 }], roughness: 1, bump: 1.2, tile: 0.12 },
    grass: { map: ['noise', { colors: ['#2f5f2a', '#4f8a3a', '#6aa84a', '#3d7231'], scale: 12, octaves: 4 }], roughness: 1, bump: 1, tile: 0.1 },
    snow: { map: ['noise', { colors: ['#e3ebf3', '#ffffff'], scale: 5, octaves: 4 }], roughness: 0.85, bump: 0.5, tile: 0.2 },
    ice: { color: '#cfeefc', roughness: 0.12, opacity: 0.75, wear: 0.1, tile: 0.2 },
    water: { color: '#2f7fc0', roughness: 0.08, opacity: 0.7, plain: true },
    lava: { map: ['noise', { colors: ['#1a0d08', '#5a1a08', '#ff5a10', '#ffd24a'], scale: 4, octaves: 5, warp: 0.6 }], roughness: 0.9, bump: 1, glow: 1.4, tile: 0.14 },
    fabric: { roughness: 0.95, wear: 0.12, bump: 1.4, tile: 0.03 },
    leather: { map: ['cells', { colors: ['#6b4530', '#4f3222'], scale: 14 }], roughness: 0.7, bump: 0.9, tile: 0.08 },
    paper: { color: '#f1ece0', roughness: 0.95, wear: 0.08, bump: 0.4, tile: 0.1 },
    ceramic: { color: '#f2f2ee', roughness: 0.2, clearcoat: 0.5, wear: 0.03, tile: 0.25 },
    skin: { color: '#d9a98a', roughness: 0.6, wear: 0.1, bump: 0.4, tile: 0.08 },
    tissue: { map: ['cells', { colors: ['#e9a6a0', '#c96f6f'], scale: 9, edgeColor: '#a94f55', edge: 0.08 }], roughness: 0.55, bump: 0.6, tile: 0.1 },
    leaf: { map: ['noise', { colors: ['#2d6a2b', '#4c9a3c', '#3a7f31'], scale: 6, octaves: 4 }], roughness: 0.7, bump: 0.5, tile: 0.1 },
    bone: { color: '#e9e2cf', roughness: 0.75, wear: 0.15, bump: 0.6, tile: 0.1 },
    light: { color: '#ffffff', roughness: 0.4, glow: 2, plain: true },
  };

  /**
   * A finished material: material('paintedMetal', { color: '#5b6236', wear: 0.5 }).
   * Options: color, colors (ramp of a textured preset), wear 0..1, roughness, metalness, opacity, glow
   * (emissive strength), map (your own kit.texture), scale (metres per texture tile), seed.
   */
  function material(preset = 'plastic', o = {}) {
    const p = PRESETS[preset];
    if (!p) throw new Error(`kit.material: unknown preset '${preset}'. Presets: ${Object.keys(PRESETS).join(', ')}.`);
    if (o === null || typeof o !== 'object') throw new Error("kit.material: options must be an object, e.g. kit.material('metal', { color: '#888888' }).");
    const physical = p.clearcoat != null;
    const m = own(new (physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial)({
      roughness: o.roughness ?? p.roughness ?? 0.6,
      metalness: o.metalness ?? p.metalness ?? 0,
    }));
    if (physical) { m.clearcoat = p.clearcoat; m.clearcoatRoughness = 0.12; }
    // The app's room light is soft (the real room shows through), so shiny surfaces get a stronger share of
    // the environment; without it metals render nearly black.
    m.envMapIntensity = o.env ?? p.env ?? (m.metalness > 0.5 ? 3 : physical ? 2 : 1.2);
    const ownMap = o.map ?? (p.map ? texture(p.map[0], { ...p.map[1], ...(o.colors ? { colors: o.colors } : {}), ...(o.seed != null ? { seed: o.seed } : {}) }) : null);
    // A textured preset shows its own colors; `color` then tints it.
    m.color.set(o.color ?? (ownMap ? '#ffffff' : p.color ?? '#b8bcc4'));
    const native = Boolean(ownMap?.userData?.kitSphere) || o.uv === 'native';
    if (ownMap) m.map = ownMap;
    else if (!p.plain) {
      const wear = o.wear ?? p.wear ?? 0.1;
      if (wear > 0.01) m.map = grime(wear);
    }
    if (!p.plain && !native) {
      if (p.bump) { m.bumpMap = detail(p.streaks ? 'streaks' : 'fine'); m.bumpScale = p.bump * (o.bump ?? 1); }
      m.roughnessMap = detail('coarse');
    }
    const glow = o.glow ?? p.glow;
    if (glow) {
      m.emissive.set(o.color ?? p.color ?? '#ffffff');
      if (m.map && p.map) { m.emissiveMap = m.map; m.emissive.set('#ffffff'); }
      m.emissiveIntensity = glow;
    }
    const opacity = o.opacity ?? p.opacity;
    if (opacity != null && opacity < 1) { m.transparent = true; m.opacity = opacity; m.depthWrite = false; }
    if (!native && !p.plain) m.userData.kitTile = o.scale ?? p.tile ?? 0.2;
    m.name = `kit:${preset}`;
    // Two materials made by the same call are interchangeable: merge() fuses their meshes together.
    m.userData.kitRecipe = o.map ? null : `${preset}:${JSON.stringify(o)}`;
    return m;
  }

  // --- Shapes ---------------------------------------------------------------------------------------------

  /** A box with rounded edges (after three.js RoundedBoxGeometry, MIT). */
  function roundedBox(width = 0.1, height = 0.1, depth = 0.1, radius, segments = 2) {
    const r = Math.max(0, Math.min(radius ?? Math.min(width, height, depth) * 0.12, width / 2, height / 2, depth / 2));
    if (r < 1e-6 || segments < 1) return own(new THREE.BoxGeometry(width, height, depth));
    const steps = Math.round(segments) * 2 + 1;
    const g = own(new THREE.BoxGeometry(1, 1, 1, steps, steps, steps).toNonIndexed());
    const positions = g.attributes.position.array;
    const normals = g.attributes.normal.array;
    const hx = width / 2 - r;
    const hy = height / 2 - r;
    const hz = depth / 2 - r;
    const half = 0.5 / steps;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const y = positions[i + 1];
      const z = positions[i + 2];
      let nx = x - Math.sign(x) * half;
      let ny = y - Math.sign(y) * half;
      let nz = z - Math.sign(z) * half;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      positions[i] = hx * Math.sign(x) + nx * r;
      positions[i + 1] = hy * Math.sign(y) + ny * r;
      positions[i + 2] = hz * Math.sign(z) + nz * r;
      normals[i] = nx; normals[i + 1] = ny; normals[i + 2] = nz;
    }
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }

  const outline2 = (points, what) => {
    if (!Array.isArray(points) || points.length < 3) throw new Error(`kit.${what}: give at least 3 [x, y] points.`);
    return points.map((p) => {
      if (!Array.isArray(p) && !(p && typeof p.x === 'number')) throw new Error(`kit.${what}: points are [x, y] pairs.`);
      return new THREE.Vector2(Array.isArray(p) ? p[0] : p.x, Array.isArray(p) ? p[1] : p.y);
    });
  };

  /**
   * A flat outline ([[x, y], ...], metres) given thickness along z, centred on z = 0: hull and body side
   * profiles, wings, brackets, letters, leaves. Options: bevel (edge rounding, metres), holes ([[...], ...]).
   */
  function extrude(outline, depth = 0.02, o = {}) {
    const shape = new THREE.Shape(outline2(outline, 'extrude'));
    for (const hole of o.holes || []) shape.holes.push(new THREE.Path(outline2(hole, 'extrude')));
    const bevel = Math.max(0, Math.min(o.bevel ?? 0, depth / 2 - 1e-5));
    const g = own(new THREE.ExtrudeGeometry(shape, {
      depth: depth - 2 * bevel,
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelOffset: -bevel, // keep the outline's size: the bevel cuts in instead of growing out
      bevelSegments: 2,
      curveSegments: 12,
    }));
    g.translate(0, 0, -(depth - 2 * bevel) / 2);
    return g;
  }

  /** A profile ([[radius, y], ...] from bottom to top) spun around the Y axis: barrels, wheels, towers, vases, domes. */
  function lathe(profile, segments = 40) {
    if (!Array.isArray(profile) || profile.length < 2) throw new Error('kit.lathe: give at least 2 [radius, y] points, bottom to top.');
    const points = profile.map((p) => new THREE.Vector2(Math.max(0, Array.isArray(p) ? p[0] : p.x), Array.isArray(p) ? p[1] : p.y));
    const g = own(new THREE.LatheGeometry(points, Math.max(3, Math.round(segments))));
    // Spread v evenly along the profile's length (three.js spaces it by point count), so stripes and
    // bands keep their width however the points are spaced.
    const lengths = [0];
    for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + points[i].distanceTo(points[i - 1]));
    const total = lengths[lengths.length - 1] || 1;
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, lengths[i % points.length] / total);
    return g;
  }

  const curveOf = (points, closed, what) => {
    if (!Array.isArray(points) || points.length < 2) throw new Error(`kit.${what}: give at least 2 [x, y, z] points.`);
    return new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...vec3(p, `${what} points`))), Boolean(closed), 'centripetal');
  };

  /** A round tube through the points: pipes, cables, handles, vines, vessels, rails. Options: closed, sides. */
  function tube(points, radius = 0.005, o = {}) {
    const curve = curveOf(points, o.closed, 'tube');
    return own(new THREE.TubeGeometry(curve, Math.max(8, points.length * (o.detail ?? 8)), radius, o.sides ?? 10, Boolean(o.closed)));
  }

  /**
   * A spur gear, axis along z. Two gears mesh when radius / teeth is the same for both and their centres
   * are radius1 + radius2 apart.
   */
  function gear(o = {}) {
    const teeth = Math.max(4, Math.round(o.teeth ?? 12));
    const radius = o.radius ?? 0.04; // pitch radius
    const thickness = o.thickness ?? 0.01;
    const module_ = (2 * radius) / teeth;
    const outer = radius + module_;
    const rootR = radius - 1.25 * module_;
    const points = [];
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * Math.PI * 2;
      const step = (Math.PI * 2) / teeth;
      // root, flank up, tip, flank down (fractions of one tooth pitch; the tooth is centred at 0.5)
      for (const [f, r] of [[0.0, rootR], [0.16, rootR], [0.39, outer], [0.61, outer], [0.84, rootR]]) {
        points.push([Math.cos(a + f * step) * r, Math.sin(a + f * step) * r]);
      }
    }
    const hole = o.hole ?? radius * 0.25;
    const holes = hole > 0 ? [Array.from({ length: 24 }, (_, i) => [Math.cos((-i / 24) * Math.PI * 2) * hole, Math.sin((-i / 24) * Math.PI * 2) * hole])] : [];
    return extrude(points, thickness, { bevel: Math.min(thickness * 0.12, module_ * 0.15), holes });
  }

  /** Many copies of one shape in one draw call: wheels, bolts, rivets, windows, leaves, teeth. */
  function instances(geometry, mat, placements) {
    if (!Array.isArray(placements) || placements.length === 0) throw new Error('kit.instances: placements is a non-empty list of [x, y, z] or { position, rotation, scale }.');
    const mesh = new THREE.InstancedMesh(geometry, mat, placements.length);
    const dummy = new THREE.Object3D();
    placements.forEach((p, i) => {
      const position = vec3(Array.isArray(p) || typeof p?.x === 'number' ? p : p.position, 'a placement position');
      dummy.position.set(position[0], position[1], position[2]);
      const rotation = p && !Array.isArray(p) && p.rotation ? vec3(p.rotation, 'a placement rotation') : [0, 0, 0];
      dummy.rotation.set(rotation[0], rotation[1], rotation[2]);
      const s = p && !Array.isArray(p) ? p.scale : undefined;
      if (typeof s === 'number') dummy.scale.setScalar(s);
      else if (s) dummy.scale.set(...vec3(s, 'a placement scale'));
      else dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    return mesh;
  }

  /**
   * Copies of one shape spaced evenly along a path and turned to follow it: track links, chains, belts,
   * fences, beads. A copy's local x runs along the path and its local y points out of the loop.
   * Options: count, closed.
   */
  function along(geometry, mat, points, o = {}) {
    const closed = o.closed !== false;
    const curve = curveOf(points, closed, 'along');
    const count = Math.max(1, Math.round(o.count ?? 24));
    const list = points.map((p) => new THREE.Vector3(...vec3(p, 'along points')));
    // The loop's plane (Newell normal) and centre decide which way is "out".
    const normal = new THREE.Vector3();
    const centre = new THREE.Vector3();
    list.forEach((p, i) => {
      const q = list[(i + 1) % list.length];
      normal.x += (p.y - q.y) * (p.z + q.z);
      normal.y += (p.z - q.z) * (p.x + q.x);
      normal.z += (p.x - q.x) * (p.y + q.y);
      centre.add(p);
    });
    centre.divideScalar(list.length);
    if (normal.lengthSq() < 1e-12) normal.set(0, 0, 1);
    normal.normalize();
    const mesh = new THREE.InstancedMesh(geometry, mat, count);
    const tangent = new THREE.Vector3();
    const out = new THREE.Vector3();
    const side = new THREE.Vector3();
    const at = new THREE.Vector3();
    const basis = new THREE.Matrix4();
    let flip = 0;
    for (let i = 0; i < count; i++) {
      const t = closed ? i / count : count === 1 ? 0.5 : i / (count - 1);
      curve.getPointAt(t, at);
      curve.getTangentAt(t, tangent).normalize();
      out.crossVectors(tangent, normal).normalize();
      if (!flip) flip = out.dot(side.subVectors(at, centre)) < 0 ? -1 : 1;
      out.multiplyScalar(flip);
      side.crossVectors(tangent, out).normalize();
      basis.makeBasis(tangent, out, side).setPosition(at);
      mesh.setMatrixAt(i, basis);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    return mesh;
  }

  /**
   * Fuse a group's static meshes into one mesh per material (one draw call each). Use it for detail that
   * never moves on its own; the group can still be moved, grabbed or animated as a whole.
   */
  function merge(group) {
    if (!group || !group.isObject3D) throw new Error('kit.merge: pass a THREE.Group whose children are finished.');
    group.updateMatrixWorld(true);
    const inverse = new THREE.Matrix4().copy(group.matrixWorld).invert();
    const buckets = new Map();
    const gone = [];
    const local = new THREE.Matrix4();
    const normalMatrix = new THREE.Matrix3();
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    group.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || o === group || Array.isArray(o.material) || !o.geometry?.attributes?.position) return;
      local.multiplyMatrices(inverse, o.matrixWorld);
      normalMatrix.getNormalMatrix(local);
      const mirrored = local.determinant() < 0;
      const g = o.geometry;
      const position = g.attributes.position;
      const normal = g.attributes.normal;
      const uv = g.attributes.uv;
      const index = g.index;
      const count = index ? index.count : position.count;
      const key = o.material.userData?.kitRecipe ?? o.material;
      let bucket = buckets.get(key);
      if (!bucket) buckets.set(key, (bucket = { material: o.material, positions: [], normals: [], uvs: [] }));
      for (let i = 0; i + 2 < count; i += 3) {
        // A mirrored part (negative scale) needs its triangles turned to face out again.
        for (const k of mirrored ? [0, 2, 1] : [0, 1, 2]) {
          const vi = index ? index.getX(i + k) : i + k;
          p.fromBufferAttribute(position, vi).applyMatrix4(local);
          bucket.positions.push(p.x, p.y, p.z);
          if (normal) n.fromBufferAttribute(normal, vi).applyMatrix3(normalMatrix).normalize();
          else n.set(0, 1, 0);
          bucket.normals.push(n.x, n.y, n.z);
          bucket.uvs.push(uv ? uv.getX(vi) : 0, uv ? uv.getY(vi) : 0);
        }
      }
      gone.push(o);
    });
    for (const o of gone) o.removeFromParent();
    for (const bucket of buckets.values()) {
      const mat = bucket.material;
      const g = own(new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.Float32BufferAttribute(bucket.positions, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(bucket.normals, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(bucket.uvs, 2));
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = group.name ? `${group.name} (merged)` : 'merged';
      group.add(mesh);
    }
    return group;
  }

  // Dressing is never a pointing target: a hand ray passes through it. (A sprite also throws when the
  // host's pointer ray tests it without a camera.)
  const noHit = () => {};

  // --- Effects --------------------------------------------------------------------------------------------

  /** A soft round dot, white with falling alpha: sprites, particles, shadows. */
  function dot() {
    if (cache.has('dot')) return cache.get('dot');
    const tex = paint(64, 64, (y, data, width, height) => {
      for (let x = 0; x < width; x++) {
        const r = Math.hypot((x + 0.5) / width - 0.5, (y + 0.5) / height - 0.5) * 2;
        const at = (y * width + x) * 4;
        data[at] = 255; data[at + 1] = 255; data[at + 2] = 255;
        data[at + 3] = Math.round(255 * Math.pow(clamp01(1 - r), 2));
      }
    }, { clamp: true, base: [255, 255, 255, 0] });
    cache.set('dot', tex);
    return tex;
  }

  /** A dark disc that stays solid to a third of its radius and then fades out: contact shadows. */
  function shade() {
    if (cache.has('shade')) return cache.get('shade');
    const tex = paint(64, 64, (y, data, width, height) => {
      for (let x = 0; x < width; x++) {
        const r = Math.hypot((x + 0.5) / width - 0.5, (y + 0.5) / height - 0.5) * 2;
        const at = (y * width + x) * 4;
        data[at] = 255; data[at + 1] = 255; data[at + 2] = 255;
        data[at + 3] = Math.round(255 * (1 - smoothstep(0.35, 1, r)));
      }
    }, { clamp: true, base: [255, 255, 255, 0] });
    cache.set('shade', tex);
    return tex;
  }

  /** A soft glow that always faces the viewer: suns, lamps, flames, engines, halos, atmospheres. */
  function glow(color = '#ffd27a', size = 0.1, o = {}) {
    const sprite = new THREE.Sprite(own(new THREE.SpriteMaterial({
      map: dot(), color: new THREE.Color(color), transparent: true, opacity: o.opacity ?? 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })));
    sprite.scale.set(size, size, 1);
    sprite.raycast = noHit;
    // Wrapped in a group, so code that pulses it with scale.setScalar(1.05) scales the glow instead of
    // replacing its size (a sprite's size is its scale).
    const holder = new THREE.Group();
    holder.name = 'glow';
    holder.add(sprite);
    return holder;
  }

  /**
   * Small soft dots scattered in a volume: stars, dust, sparks, bubbles, pollen, snow, spray.
   * Options: count, radius (sphere) or box [x, y, z], shell (on the sphere's surface), color, size (metres), seed.
   */
  function particles(o = {}) {
    const count = Math.max(1, Math.min(5000, Math.round(o.count ?? 200)));
    const seed = o.seed ?? 1;
    const radius = o.radius ?? 0.25;
    const box = o.box ? vec3(o.box, 'particles box') : null;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = hash(i, 1, 0, seed);
      const b = hash(i, 2, 0, seed);
      const c = hash(i, 3, 0, seed);
      if (box) {
        positions[i * 3] = (a - 0.5) * box[0];
        positions[i * 3 + 1] = (b - 0.5) * box[1];
        positions[i * 3 + 2] = (c - 0.5) * box[2];
      } else {
        const theta = a * Math.PI * 2;
        const phi = Math.acos(2 * b - 1);
        const r = radius * (o.shell ? 1 : Math.cbrt(c));
        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.cos(phi);
        positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      }
    }
    const g = own(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(g, own(new THREE.PointsMaterial({
      map: dot(), color: new THREE.Color(o.color ?? '#ffffff'), size: o.size ?? 0.006, sizeAttenuation: true,
      transparent: true, opacity: o.opacity ?? 0.9, depthWrite: false,
    })));
    points.name = 'particles';
    points.raycast = noHit;
    return points;
  }

  /**
   * A flat ring lying in the XZ plane, colored from its inner to its outer edge: planet rings, halos, discs,
   * orbits and tracks drawn on the desk. Options: colors, gaps ([[from, to], ...] as 0..1 across the ring),
   * opacity, seed, glow.
   */
  function ring(inner = 0.08, outer = 0.14, o = {}) {
    const segments = 96;
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      positions.push(Math.cos(a) * inner, 0, Math.sin(a) * inner, Math.cos(a) * outer, 0, Math.sin(a) * outer);
      uvs.push(0, i / segments, 1, i / segments);
      if (i < segments) indices.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    }
    const g = own(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    const ramp = makeRamp(o.colors || ['#b9a88a', '#e6d7b4', '#a8946f', '#d9c9a3']);
    const gaps = o.gaps || [];
    const seed = o.seed ?? 1;
    const strip = paint(256, 4, (y, data, width) => {
      for (let x = 0; x < width; x++) {
        const t = (x + 0.5) / width;
        const at = (y * width + x) * 4;
        ramp(t, data, at);
        const fine = 0.75 + 0.25 * noise3(t * 60, 0.5, 0.5, seed, 0, 0, 0);
        data[at] *= fine; data[at + 1] *= fine; data[at + 2] *= fine;
        let alpha = 0.55 + 0.45 * noise3(t * 24, 2.5, 0.5, seed + 3, 0, 0, 0);
        for (const [from, to] of gaps) if (t >= from && t <= to) alpha = 0;
        alpha *= smoothstep(0, 0.04, t) * smoothstep(1, 0.96, t);
        data[at + 3] = Math.round(255 * clamp01(alpha));
      }
    }, { clamp: true, base: [...ramp.mid.slice(0, 3), 160] });
    const mat = own(new THREE.MeshStandardMaterial({
      map: strip, transparent: true, opacity: o.opacity ?? 1, side: THREE.DoubleSide, roughness: 1, depthWrite: false,
    }));
    if (o.glow) { mat.emissiveMap = strip; mat.emissive.set('#ffffff'); mat.emissiveIntensity = o.glow; }
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'ring';
    return mesh;
  }

  /** A soft dark patch on the desk (y = 0) that grounds whatever stands above it. */
  function shadow(radius = 0.12, opacity = 0.4) {
    const g = own(new THREE.CircleGeometry(radius, 40));
    g.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(g, own(new THREE.MeshBasicMaterial({ map: shade(), color: 0x000000, transparent: true, opacity, depthWrite: false })));
    mesh.position.y = 0.0006;
    mesh.renderOrder = -1;
    mesh.raycast = noHit;
    mesh.name = 'contact shadow';
    return mesh;
  }

  /**
   * A low display base that makes a model read as an exhibit. Stands on y = 0; put the model on its top:
   * model.position.y = stand.userData.top. Options: height, color, accent (a thin lit ring).
   */
  function stand(radius = 0.14, o = {}) {
    const height = o.height ?? 0.012;
    const group = new THREE.Group();
    group.name = 'stand';
    const chamfer = Math.min(height * 0.45, radius * 0.1);
    const base = new THREE.Mesh(
      lathe([[0, 0], [radius, 0], [radius, height - chamfer], [radius - chamfer, height], [0, height]], 64),
      material('glossy', { color: o.color ?? '#16181d' }),
    );
    group.add(base);
    if (o.accent !== null) {
      const band = new THREE.Mesh(
        own(new THREE.TorusGeometry(radius - chamfer * 2.2, Math.max(0.0008, height * 0.07), 8, 96)),
        material('light', { color: o.accent ?? '#5aa9ff', glow: 1.6 }),
      );
      band.rotation.x = Math.PI / 2;
      band.position.y = height + 0.0002;
      group.add(band);
    }
    group.add(shadow(radius * 1.35, 0.45));
    group.userData.top = height;
    return group;
  }

  /**
   * An arrow through two or more points (curved through the middle ones): flows, forces, directions.
   * Options: color, radius, glow.
   */
  function arrow(points, o = {}) {
    if (!Array.isArray(points) || points.length < 2) throw new Error('kit.arrow: give at least 2 [x, y, z] points, tail first.');
    const list = points.map((p) => new THREE.Vector3(...vec3(p, 'arrow points')));
    const radius = o.radius ?? 0.004;
    const mat = material('plastic', { color: o.color ?? '#f2f4f7', glow: o.glow, wear: 0 });
    const group = new THREE.Group();
    group.name = 'arrow';
    const tip = list[list.length - 1];
    const curve = list.length > 2 ? new THREE.CatmullRomCurve3(list, false, 'centripetal') : new THREE.LineCurve3(list[0], tip);
    const length = curve.getLength();
    const head = Math.min(length * 0.4, radius * 7);
    const direction = curve.getTangentAt(1).normalize();
    // The shaft stops where the head begins.
    const cut = Math.max(0.05, 1 - head / Math.max(length, 1e-6));
    const samples = Math.max(2, list.length * 6);
    const shaftPoints = Array.from({ length: samples }, (_, i) => curve.getPointAt((i / (samples - 1)) * cut));
    const shaft = new THREE.Mesh(
      own(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(shaftPoints, false, 'centripetal'), Math.max(4, shaftPoints.length * 2), radius, 10, false)),
      mat,
    );
    const cone = new THREE.Mesh(own(new THREE.ConeGeometry(radius * 2.6, head, 16)), mat);
    cone.position.copy(tip).addScaledVector(direction, -head / 2);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    group.add(shaft, cone);
    return group;
  }

  // --- Panels ---------------------------------------------------------------------------------------------

  /**
   * A stylesheet for ui() panels, so every panel of a lesson shares one look. Put it in the panel's
   * <style> block and use its classes; add your own classes after it when you need them.
   */
  function theme(o = {}) {
    const accent = `#${colorBytes(o.accent ?? '#5aa9ff').map((c) => c.toString(16).padStart(2, '0')).join('')}`;
    const [r, g, b] = colorBytes(accent);
    const onAccent = 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#0e1013' : '#ffffff';
    const lighter = `#${[r, g, b].map((c) => Math.round(c + (255 - c) * 0.25).toString(16).padStart(2, '0')).join('')}`;
    const pad = (v, h) => `padding-top: ${v}px; padding-bottom: ${v}px; padding-left: ${h}px; padding-right: ${h}px;`;
    return `
      .panel { width: 500px; flex-direction: column; gap: 14px; ${pad(24, 26)} border-radius: 24px; background-color: #14171c; border-width: 2px; border-color: #2a3038; }
      .bar { width: 56px; height: 6px; border-radius: 3px; background-color: ${accent}; }
      .eyebrow { color: ${accent}; font-size: 20px; font-weight: 700; }
      .title { color: #ffffff; font-size: 34px; font-weight: 700; }
      .subtitle { color: #e8ebef; font-size: 26px; font-weight: 600; }
      .body { color: #c5cbd5; font-size: 24px; }
      .small { color: #99a2af; font-size: 20px; }
      .good { color: #4ade80; font-size: 24px; font-weight: 600; }
      .bad { color: #f87171; font-size: 24px; font-weight: 600; }
      .row { flex-direction: row; gap: 10px; align-items: center; }
      .col { flex-direction: column; gap: 10px; }
      .grow { flex-grow: 1; flex-shrink: 1; }
      .card { flex-direction: column; gap: 8px; ${pad(14, 16)} border-radius: 16px; background-color: #1d2128; }
      .btn { ${pad(12, 20)} border-radius: 14px; background-color: ${accent}; align-items: center; justify-content: center; cursor: pointer; }
      .btn:hover { background-color: ${lighter}; }
      .btn-text { color: ${onAccent}; font-size: 24px; font-weight: 700; }
      .btn2 { ${pad(12, 20)} border-radius: 14px; background-color: #272c35; align-items: center; justify-content: center; cursor: pointer; }
      .btn2:hover { background-color: #353c48; }
      .btn2-text { color: #eef1f5; font-size: 24px; font-weight: 600; }
      .chip { ${pad(6, 14)} border-radius: 18px; background-color: #222730; }
      .chip-text { color: #cfd5de; font-size: 20px; font-weight: 600; }
      .badge { width: 40px; height: 40px; border-radius: 20px; background-color: ${accent}; align-items: center; justify-content: center; flex-shrink: 0; }
      .badge-text { color: ${onAccent}; font-size: 22px; font-weight: 700; }
      .divider { height: 2px; background-color: #2a3038; }
      .stat { color: #ffffff; font-size: 44px; font-weight: 700; }
    `;
  }

  // --- Host hooks -----------------------------------------------------------------------------------------

  /** Lay kit materials' textures onto a geometry at real-world scale (one tile per `tile` metres). */
  function worldUV(geometry, object, tile) {
    const g = own(geometry.index ? geometry.toNonIndexed() : geometry.clone());
    const position = g.attributes.position;
    const scale = object.getWorldScale(new THREE.Vector3());
    const uv = new Float32Array(position.count * 2);
    const corner = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    for (let i = 0; i + 2 < position.count; i += 3) {
      for (let k = 0; k < 3; k++) corner[k].fromBufferAttribute(position, i + k).multiply(scale);
      ab.subVectors(corner[1], corner[0]);
      ac.subVectors(corner[2], corner[0]);
      ab.cross(ac);
      const ax = Math.abs(ab.x);
      const ay = Math.abs(ab.y);
      const az = Math.abs(ab.z);
      for (let k = 0; k < 3; k++) {
        const p = corner[k];
        // Project along the axis the triangle faces most (box mapping).
        const u = ax >= ay && ax >= az ? p.z : p.x;
        const v = ax >= ay && ax >= az ? p.y : ay >= az ? p.z : p.y;
        uv[(i + k) * 2] = u / tile;
        uv[(i + k) * 2 + 1] = v / tile;
      }
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return g;
  }

  /** Called by the host once build() has returned: gives kit materials their real-world texture scale. */
  function finalize(root) {
    if (dry || !root || !root.isObject3D) return;
    root.updateMatrixWorld(true);
    const converted = new Map();
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      const tile = Math.min(...materials.map((m) => m?.userData?.kitTile ?? Infinity));
      if (!Number.isFinite(tile)) return;
      const key = o.geometry;
      if (!converted.has(key)) converted.set(key, worldUV(key, o, tile));
      o.geometry = converted.get(key);
    });
  }

  /** Paint pending textures for up to `budgetMs`; the host calls it every frame. Returns how many are left. */
  function pump(budgetMs = 5) {
    const start = now();
    while (jobs.length > 0 && now() - start < budgetMs) {
      const job = jobs[0];
      const end = Math.min(job.height, job.row + 4);
      while (job.row < end) job.shadeRow(job.row++, job.data, job.width, job.height);
      if (job.row >= job.height) {
        job.tex.needsUpdate = true;
        jobs.shift();
      }
    }
    return jobs.length;
  }

  function dispose() {
    jobs.length = 0;
    cache.clear();
    for (const thing of owned) thing.dispose?.();
    owned.clear();
  }

  return {
    material, texture, theme,
    roundedBox, extrude, lathe, tube, gear, instances, along, merge,
    glow, particles, ring, shadow, stand, arrow,
    finalize, pump, dispose,
    presets: Object.keys(PRESETS),
    textures: Object.keys(TEXTURES),
  };
}
