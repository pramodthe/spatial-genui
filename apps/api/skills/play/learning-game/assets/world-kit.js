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
