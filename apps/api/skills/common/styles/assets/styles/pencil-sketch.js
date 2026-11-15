// Pencil sketch look for an XR lesson: graphite hatching that follows a fixed key light, graphite outlines, one red
// accent for the step's part, on a sketchbook page. Needs look-kit.js (lookShade, lookOutline). Paste above `export default`.
function pencilSketchLook(THREE, kit) {
  const PAL = { paper: '#f2ede0', graphite: '#33343a', red: '#cf472b', wash: '#e8967a', line: '#c9c2b2' };
  const hatch = lookShade(THREE, { mode: 'hatch', lit: PAL.paper, ink: PAL.graphite, scale: 0.005 });
  const wash = lookShade(THREE, { mode: 'hatch', lit: PAL.wash, ink: PAL.graphite, scale: 0.005 });
  const red = kit.material('plastic', { color: PAL.red, wear: 0 });
  const look = {
    name: 'pencil-sketch',
    PAL,
    // Draw a geometry in graphite: hatched by the light, with an outline. Returns the mesh.
    draw(geometry, name) {
      const mesh = new THREE.Mesh(geometry, hatch);
      mesh.name = name;
      lookOutline(THREE, mesh, { width: 0.0012, color: PAL.graphite });
      return mesh;
    },
    // The step's part in the red marker wash (on = true), or back to graphite.
    wash(mesh, on) { mesh.material = on ? wash : hatch; },
    // A numbered red note: a name tag at `at` with a red leader line to the point `to` (both in the same parent).
    note(text, at, to) {
      const g = new THREE.Group();
      g.name = `Note ${text}`;
      const card = kit.card(text, { width: 0.06 });
      card.position.set(at[0], at[1], at[2]);
      g.add(card, new THREE.Mesh(kit.tube([at, to], 0.0006), red));
      return g;
    },
    // The sketchbook page with faint construction lines and the spiral binding. Its top is set.userData.top.
    set({ width = 0.38, depth = 0.28 } = {}) {
      const set = new THREE.Group();
      set.name = 'Sketchbook page';
      const page = new THREE.Mesh(kit.roundedBox(width, 0.006, depth, 0.002), lookShade(THREE, { mode: 'cel', lit: PAL.paper, shade: '#e4dccb', band: 0.2 }));
      page.position.y = 0.003;
      const lineMat = kit.material('plastic', { color: PAL.line, wear: 0 });
      for (const [w, d, x, z] of [[width * 0.8, 0.0008, 0, 0], [0.0008, depth * 0.8, 0, 0]]) {
        const l = new THREE.Mesh(kit.roundedBox(w, 0.0004, d, 0.0001), lineMat);
        l.position.set(x, 0.0062, z);
        set.add(l);
      }
      const rings = kit.instances(new THREE.TorusGeometry(0.007, 0.0012, 6, 16), kit.material('steel'),
        Array.from({ length: 9 }, (_, i) => ({ position: [-width / 2 + 0.03 + i * (width - 0.06) / 8, 0.008, -depth / 2 + 0.004], rotation: [0, Math.PI / 2, 0] })));
      set.add(page, rings);
      set.userData.top = 0.006;
      return set;
    },
    demo(subject) {
      const block = look.draw(kit.roundedBox(0.08, 0.08, 0.08, 0.004), 'Block');
      block.position.set(-0.05, 0.04, 0);
      const can = look.draw(new THREE.CylinderGeometry(0.035, 0.035, 0.1, 40), 'Can');
      can.position.set(0.07, 0.05, 0.02);
      subject.add(block, can);
      return [{ object: can, grab: true }, { object: block, press: true }];
    },
  };
  return look;
}
