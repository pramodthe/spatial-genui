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
//   playSounds(sound, SOUNDS)            plays the game's sound map (parts/sounds.js): .fire(event) plays what
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
