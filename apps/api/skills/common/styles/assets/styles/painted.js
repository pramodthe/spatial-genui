// Painted look for an XR lesson: brush dabs fixed to each thing, warm in the light and cool in the shadow, small warm
// lamps where the eye should go, on a painted ground. Needs look-kit.js (lookShade, lookLumpy, lookPath).
function paintedLook(THREE, kit) {
  const PAL = {
    meadow: ['#a3a83a', '#3c5a2e'], wheat: ['#efd07a', '#a5532f'], earth: ['#e6c79c', '#6c68a4'],
    wall: ['#fff0cc', '#8f7aa8'], roof: ['#c8582c', '#4c3f6a'], tree: ['#7f9a34', '#1d4a3c'],
    water: ['#8fc0d8', '#3f72c0'], stone: ['#e2c08c', '#5a5a7a'], cloth: ['#4f77a0', '#34557e'], wool: ['#fbf3e4', '#9d93b8'],
  };
  const mats = {};
  const look = {
    name: 'painted',
    PAL,
    mat(colour, scale = 0.016) {
      const key = `${colour}:${scale}`;
      if (!mats[key]) mats[key] = lookShade(THREE, { mode: 'dabs', lit: PAL[colour][0], shade: PAL[colour][1], scale });
      return mats[key];
    },
    // A painted object. Keep shapes big and simple: brush dabs need room.
    paint(geometry, colour, name, scale) {
      const mesh = new THREE.Mesh(geometry, look.mat(colour, scale));
      mesh.name = name;
      return mesh;
    },
    // A lamp, window or lantern that glows warm (the eye goes to it).
    lamp(size, name) {
      const mesh = new THREE.Mesh(kit.roundedBox(size, size * 1.3, size * 0.3, size * 0.1), kit.material('light', { color: '#ffa23c', glow: 2 }));
      mesh.name = name;
      return mesh;
    },
    // The painted ground with a canvas edge. Its top is set.userData.top.
    set({ width = 0.4, depth = 0.3 } = {}) {
      const set = new THREE.Group();
      set.name = 'Painted ground';
      const edge = new THREE.Mesh(kit.roundedBox(width + 0.01, 0.016, depth + 0.01, 0.004), kit.material('fabric', { color: '#e8dcc0' }));
      edge.position.y = 0.008;
      const ground = look.paint(kit.roundedBox(width, 0.006, depth, 0.003), 'meadow', 'Meadow', 0.024);
      ground.position.y = 0.017;
      set.add(edge, ground);
      set.userData.top = 0.02;
      return set;
    },
    demo(subject) {
      const house = look.paint(kit.roundedBox(0.08, 0.06, 0.06, 0.004), 'wall', 'Cottage');
      house.position.set(-0.05, 0.03, -0.03);
      const roof = look.paint(new THREE.ConeGeometry(0.065, 0.045, 4), 'roof', 'Roof');
      roof.rotation.y = Math.PI / 4;
      roof.position.set(-0.05, 0.082, -0.03);
      const door = look.lamp(0.018, 'Lit door');
      door.position.set(-0.05, 0.015, 0.0);
      const tree = look.paint(lookLumpy(THREE, new THREE.SphereGeometry(0.04, 24, 16), 0.006, 0.03, 3), 'tree', 'Tree');
      tree.position.set(0.08, 0.05, -0.02);
      const sheep = look.paint(lookLumpy(THREE, new THREE.SphereGeometry(0.025, 24, 16), 0.004, 0.02, 5), 'wool', 'Sheep');
      sheep.position.set(0.04, 0.025, 0.07);
      subject.add(house, roof, door, tree, sheep);
      return [{ object: sheep, grab: true }, { object: door, press: true }];
    },
  };
  return look;
}
