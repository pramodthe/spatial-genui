// Soft clay look for an XR lesson: chunky, slightly lopsided plasticine forms on a coloured card board.
// Needs look-kit.js (lookClay, lookLumpy, lookNoise). Paste above `export default`.
function softClayLook(THREE, kit) {
  const BOX = {
    card: '#12808a', cream: ['#f3e6cd', '#eec78c'], coral: ['#de3a26', '#f2814f'], yellow: ['#f4ad08', '#ee7f14'],
    navy: ['#253677', '#4467b8'], green: ['#4f9a3a', '#8cc15a'], white: ['#f5f1ea', '#d9d2c4'],
  };
  const mats = {};
  let seed = 1;
  const look = {
    name: 'soft-clay',
    PAL: BOX,
    // One material per clay colour, made once.
    mat(colour) {
      if (!mats[colour]) mats[colour] = lookClay(THREE, kit, BOX[colour][0], { streak: BOX[colour][1], seed: seed++ });
      return mats[colour];
    },
    // A clay object from any geometry: pushed a little out of true, in one clay colour.
    clay(geometry, colour, name) {
      const mesh = new THREE.Mesh(lookLumpy(THREE, geometry, 0.002, 0.03, seed++), look.mat(colour));
      mesh.name = name;
      return mesh;
    },
    // A clay coin or puck lying flat, centre at its middle.
    coin(radius, height, colour, name) {
      return look.clay(new THREE.CylinderGeometry(radius, radius * 0.96, height, 40, 2), colour, name);
    },
    // A wedge (pie slice) lying flat: angle in radians, from the +x axis, centred on the cake's centre.
    wedge(radius, height, from, angle, colour, name) {
      const g = new THREE.CylinderGeometry(radius, radius, height, Math.max(8, Math.round(48 * angle / (2 * Math.PI))), 2, false, from, angle);
      return look.clay(g, colour, name);
    },
    // The board: uncoated coloured card with a low curved backdrop strip behind. Its top is set.userData.top.
    set({ width = 0.36, depth = 0.26 } = {}) {
      const set = new THREE.Group();
      set.name = 'Clay board';
      const card = kit.material('paper', { color: BOX.card, roughness: 0.93 });
      const board = new THREE.Mesh(kit.roundedBox(width, 0.01, depth, 0.004), card);
      board.position.y = 0.005;
      const back = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, width, 24, 1, true, Math.PI, Math.PI / 2), card);
      back.rotation.z = Math.PI / 2;
      back.position.set(0, 0.06, -depth / 2 + 0.05);
      back.material = card;
      set.add(board, back);
      set.userData.top = 0.01;
      return set;
    },
    demo(subject) {
      const stack = [];
      for (let i = 0; i < 3; i++) {
        const c = look.coin(0.03, 0.012, i === 2 ? 'yellow' : 'coral', `Coin ${i + 1}`);
        c.position.set(-0.1 + i * 0.1, 0.006, 0.02);
        subject.add(c);
        stack.push({ object: c, grab: true });
      }
      return stack;
    },
  };
  return look;
}
