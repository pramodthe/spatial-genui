// ---------------------------------------------------------------- play kit: rewards and feel for learning games
// Pasted in by scripts/new-game.mjs, after the look kit and the look. Everything here lights itself (lookShade), so
// it reads the same in every look and on the headset, and none of it catches a pinch. It sits above
// `export default` on purpose: the look's rules judge the game's own code, not these helpers.
//
//   playStars(THREE, { n, size })        a row of n stars standing in XY, facing +z, hidden until earned:
//                                        .userData.show(k) pops them in (k gold, the rest grey), .userData.hide(),
//                                        .userData.update(delta) every frame
//   playStarsFor(value, [one, two, three], lowerIsBetter)   how many stars a result earns (0 to 3)
//   playBurst(THREE, parent, { colour, shade, count, size })   bits that fly out of a point and shrink away:
//                                        .fire(x, y, z) in parent's space, .update(delta) every frame
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
  const LIFE = 0.6;
  const bits = [];
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Burst';
    mesh.visible = false;
    mesh.raycast = () => {};
    parent.add(mesh);
    bits.push({ mesh, v: new THREE.Vector3(), life: 0 });
  }
  return {
    fire(x, y, z) {
      bits.forEach((b, i) => {
        const a = (i / count) * Math.PI * 2;
        b.mesh.position.set(x, y, z);
        b.v.set(Math.cos(a) * 0.22, 0.32 + 0.12 * (i % 2), Math.sin(a) * 0.22);
        b.life = LIFE;
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
        b.mesh.scale.setScalar(Math.max(0.001, b.life / LIFE));
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
