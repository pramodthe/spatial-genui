// Exploded view look for an XR lesson: one object, enlarged, pulled apart along its axis over a pale floor; every part
// a real finish and a numbered ink-blue callout. Needs look-kit.js (lookSeg, lookBack, lookBounce, lookSeat).
function explodedViewLook(THREE, kit) {
  const PAL = { ink: '#1b2f8c', floor: '#dedbd5', accent: '#e8742a' };
  const inkMat = kit.material('plastic', { color: PAL.ink, wear: 0 });
  const look = {
    name: 'exploded-view',
    PAL,
    // Real finishes, one per part, so neighbours never share a material.
    finish: {
      chrome: kit.material('chrome'), brass: kit.material('brass'), steel: kit.material('steel'),
      rubber: kit.material('rubber'), clear: kit.material('glass'), orange: kit.material('glossy', { color: PAL.accent }),
      black: kit.material('plastic', { color: '#1c1d21' }), white: kit.material('plastic', { color: '#ecebe6' }),
    },
    // Lay parts along x (assembly order left to right). parts: [{ object, length }]. Each part's seated x is packed
    // end to end; its exploded x adds `gap` per part. Returns place(k): 0 = assembled, 1 = exploded, overshooting.
    row(parts, { gap = 0.035, y = 0.08 } = {}) {
      let x = 0;
      for (const p of parts) { p.seated = x + p.length / 2; x += p.length; }
      const centre = x / 2 + gap * (parts.length - 1) / 2;
      parts.forEach((p, i) => {
        p.exploded = p.seated + gap * i - centre;
        p.seated -= x / 2;
        p.object.position.set(p.exploded, y, 0);
      });
      return {
        parts,
        place(k) {
          parts.forEach((p, i) => {
            const ki = lookBack(Math.min(1, Math.max(0, k * 1.4 - i * 0.06)), 1.2);
            p.object.position.x = p.seated + (p.exploded - p.seated) * ki;
          });
        },
      };
    },
    // A numbered callout above a part: a tag and an ink-blue leader line. Alternate high = true on close neighbours.
    callout(text, part, high = false) {
      const g = new THREE.Group();
      g.name = `Callout ${text}`;
      const top = high ? 0.075 : 0.05;
      const card = kit.card(text, { width: 0.06 });
      card.position.set(0, top, 0);
      g.add(card, new THREE.Mesh(kit.tube([[0, top - 0.008, 0], [0, 0.018, 0]], 0.0006), inkMat));
      part.add(g);
      return g;
    },
    // The pale floor slab under the row, with two thin stands. Its top is set.userData.top.
    set({ length = 0.44, depth = 0.12 } = {}) {
      const set = new THREE.Group();
      set.name = 'Floor';
      const slab = new THREE.Mesh(kit.roundedBox(length, 0.006, depth, 0.003), kit.material('plastic', { color: PAL.floor, roughness: 0.95, wear: 0 }));
      slab.position.y = 0.003;
      set.add(slab);
      set.userData.top = 0.006;
      return set;
    },
    demo(subject) {
      const make = (geo, mat, name) => { const m = new THREE.Mesh(geo, mat); m.name = name; m.rotation.z = Math.PI / 2; const g = new THREE.Group(); g.name = name; g.add(m); subject.add(g); return g; };
      const cap = make(new THREE.CylinderGeometry(0.022, 0.022, 0.04, 40), look.finish.rubber, 'Cap');
      const spring = make(new THREE.CylinderGeometry(0.012, 0.012, 0.05, 24), look.finish.steel, 'Spring');
      const body = make(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 40), look.finish.clear, 'Body');
      const tip = make(new THREE.ConeGeometry(0.02, 0.04, 40), look.finish.brass, 'Tip');
      const row = look.row([{ object: cap, length: 0.04 }, { object: spring, length: 0.05 }, { object: body, length: 0.1 }, { object: tip, length: 0.04 }]);
      row.place(1);
      ['1 Cap', '2 Spring', '3 Body', '4 Tip'].forEach((t, i) => look.callout(t, row.parts[i].object, i % 2 === 1));
      return row.parts.map((p) => ({ object: p.object, grab: true }));
    },
  };
  return look;
}
