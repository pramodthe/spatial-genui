// Circuit city look for an XR lesson: a circuit board as a city: black chips as buildings, aluminium capacitors as
// towers, gold tracks as streets, a pulse of light travelling from stop to stop. Needs look-kit.js (lookPath, lookSeg).
function circuitCityLook(THREE, kit) {
  const M = {
    mask: kit.material('paintedMetal', { color: '#0f4a2e', roughness: 0.42, wear: 0.05 }),
    gold: kit.material('gold', { color: '#d9a546', roughness: 0.36 }),
    tin: kit.material('metal', { color: '#b9bdc3', roughness: 0.34 }),
    alu: kit.material('brushedMetal', { color: '#c3c7cc' }),
    epoxy: kit.material('plastic', { color: '#141416', roughness: 0.7, wear: 0.05 }),
    silk: kit.material('plastic', { color: '#f2f2ea', roughness: 0.8, wear: 0 }),
    signal: kit.material('light', { color: '#ffb44a', glow: 2.5 }),
    trackLit: kit.material('light', { color: '#d9a546', glow: 0.8 }),
  };
  const look = {
    name: 'circuit-city',
    PAL: M,
    // A chip (a landmark): black body, tin pins on its sides, a silkscreen outline. Press it to visit that stop.
    chip(w, d, name, { h = 0.012, pins = 8 } = {}) {
      const g = new THREE.Group();
      g.name = name;
      const body = new THREE.Mesh(kit.roundedBox(w, h, d, 0.0015), M.epoxy);
      body.position.y = h / 2;
      const pin = kit.roundedBox(0.003, 0.002, 0.006, 0.0005);
      const place = [];
      for (let i = 0; i < pins; i++) {
        const x = -w / 2 + (i + 0.5) * w / pins;
        place.push({ position: [x, 0.001, d / 2 + 0.003] }, { position: [x, 0.001, -d / 2 - 0.003] });
      }
      g.add(body, kit.instances(pin, M.tin, place));
      // Silkscreen: a thin white outline round the footprint, printed on the board.
      const W = w + 0.014, D = d + 0.02, t = 0.0012;
      g.add(kit.instances(kit.roundedBox(1, 0.0004, 1, 0.0001), M.silk, [
        { position: [0, 0.0002, -D / 2], scale: [W, 1, t] }, { position: [0, 0.0002, D / 2], scale: [W, 1, t] },
        { position: [-W / 2, 0.0002, 0], scale: [t, 1, D] }, { position: [W / 2, 0.0002, 0], scale: [t, 1, D] },
      ]));
      g.userData.glow = body;
      return g;
    },
    // A capacitor tower: an aluminium can with a scored top.
    tower(r, h, name) {
      const g = new THREE.Group();
      g.name = name;
      const can = new THREE.Mesh(kit.lathe([[0, 0], [r, 0], [r, h], [r * 0.9, h], [0, h]], 32), M.alu);
      const cross = new THREE.Mesh(kit.roundedBox(r * 1.6, 0.0006, 0.001, 0.0002), M.epoxy);
      cross.position.y = h + 0.0003;
      g.add(can, cross);
      return g;
    },
    // A gold track along points [[x, z], ...] at board height, 45-degree bends. Returns { mesh, path }.
    track(points, name) {
      const pts = points.map(([x, z]) => [x, 0.0006, z]);
      const mesh = new THREE.Mesh(kit.tube(pts, 0.0015), M.gold);
      mesh.name = name;
      return { mesh, path: lookPath(THREE, pts) };
    },
    // The travelling pulse: a glow you move along a track's path with path.at(u, pulse.position).
    pulse() { const p = kit.glow('#ffb44a', 0.03); p.name = 'Pulse'; return p; },
    // The board: green solder mask, gold pads round the edge, brass mounting holes. Its top is set.userData.top.
    set({ width = 0.42, depth = 0.3 } = {}) {
      const set = new THREE.Group();
      set.name = 'Circuit board';
      const board = new THREE.Mesh(kit.roundedBox(width, 0.006, depth, 0.004), M.mask);
      board.position.y = 0.003;
      const pads = [];
      for (let i = 0; i < 14; i++) pads.push({ position: [-width / 2 + 0.02 + i * (width - 0.04) / 13, 0.0062, depth / 2 - 0.01] });
      set.add(board, kit.instances(kit.roundedBox(0.012, 0.0006, 0.005, 0.0005), M.gold, pads));
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const hole = new THREE.Mesh(new THREE.TorusGeometry(0.006, 0.0018, 8, 24), M.gold);
        hole.rotation.x = Math.PI / 2;
        hole.position.set(x * (width / 2 - 0.015), 0.0062, z * (depth / 2 - 0.015));
        set.add(hole);
      }
      set.userData.top = 0.006;
      return set;
    },
    demo(subject) {
      const cpu = look.chip(0.08, 0.08, 'Processor', { pins: 10 });
      cpu.position.set(0.05, 0, -0.02);
      const mem = look.chip(0.07, 0.03, 'Memory', { pins: 8 });
      mem.position.set(-0.1, 0, -0.04);
      const cap = look.tower(0.012, 0.03, 'Capacitor');
      cap.position.set(-0.03, 0, 0.06);
      const t = look.track([[-0.1, -0.015], [-0.03, -0.015], [0.0, -0.02], [0.05, -0.02]], 'Track');
      const pulse = look.pulse();
      t.path.at(0.3, pulse.position);
      subject.add(cpu, mem, cap, t.mesh, pulse);
      return [{ object: cpu, press: true }, { object: mem, press: true }];
    },
  };
  return look;
}
