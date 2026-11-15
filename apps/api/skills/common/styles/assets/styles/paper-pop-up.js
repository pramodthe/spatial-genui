// Paper pop-up look for an XR lesson: an open pop-up book on the desk; scenes of flat die-cut card in a few flat inks,
// standing in layers that fold up from the page. Needs look-kit.js (lookCard, lookInk, lookSeg, lookBack).
function paperPopUpLook(THREE, kit) {
  const PAL = {
    card: '#f5ecd9', cream: '#fbf3df', navy: '#22364e', coral: '#e2604a', pink: '#f3ab99', yellow: '#f5bd35',
    honey: '#eba020', amber: '#cf7d22', leaf: '#74a25e', sage: '#a6c787', deep: '#2f6753', sky: '#cfe5df',
  };
  const inks = {};
  const core = kit.material('paper', { color: '#fbf5e6', wear: 0 });
  const look = {
    name: 'paper-pop-up',
    PAL,
    ink(colour) { if (!inks[colour]) inks[colour] = lookInk(kit, PAL[colour] || colour); return inks[colour]; },
    // A die-cut card standing up in the XY plane, base at y = 0 (outline points [[x, y], ...], metres).
    card(outline, colour, name, thick = 0.0015) {
      const mesh = lookCard(THREE, kit, outline, look.ink(colour), core, thick);
      mesh.name = name;
      return mesh;
    },
    // A layer that folds up from the page: put cards in it; look.fold(layer, k) with k 0 (flat) .. 1 (standing).
    layer(name, z) {
      const g = new THREE.Group();
      g.name = name;
      g.position.z = z;
      return g;
    },
    fold(layer, k) { layer.rotation.x = -Math.PI / 2 * (1 - k); },
    // A pull tab the hand can pinch: a thick card tab sticking out of the page edge, 3 cm wide (grab it and pull).
    tab(colour, name) {
      const mesh = new THREE.Mesh(kit.roundedBox(0.03, 0.008, 0.05, 0.003), look.ink(colour));
      mesh.name = name;
      return mesh;
    },
    // The open book: cloth boards and cream pages meeting at the gutter (x = 0). Its top is set.userData.top.
    set({ width = 0.4, depth = 0.26 } = {}) {
      const set = new THREE.Group();
      set.name = 'Pop-up book';
      const cloth = kit.material('fabric', { color: '#1f4a4b' });
      for (const side of [-1, 1]) {
        const board = new THREE.Mesh(kit.roundedBox(width / 2, 0.008, depth, 0.002), cloth);
        board.position.set(side * width / 4, 0.004, 0);
        const page = new THREE.Mesh(kit.roundedBox(width / 2 - 0.01, 0.003, depth - 0.01, 0.001), look.ink('cream'));
        page.position.set(side * (width / 4 - 0.002), 0.0095, 0);
        page.rotation.z = side * -0.03;
        set.add(board, page);
      }
      set.userData.top = 0.011;
      return set;
    },
    demo(subject) {
      const back = look.layer('Back layer', -0.05);
      back.add(look.card([[-0.12, 0], [0.12, 0], [0.12, 0.09], [0.06, 0.13], [-0.04, 0.1], [-0.12, 0.12]], 'sage', 'Hills'));
      const front = look.layer('Front layer', 0.02);
      const flower = look.card([[-0.03, 0], [0.03, 0], [0.04, 0.05], [0, 0.08], [-0.04, 0.05]], 'coral', 'Flower');
      front.add(flower);
      const tab = look.tab('yellow', 'Pull tab');
      tab.position.set(0.17, 0.016, 0.1);
      subject.add(back, front, tab);
      look.fold(back, 1);
      look.fold(front, 1);
      return [{ object: tab, grab: true }, { object: front, press: true }];
    },
  };
  return look;
}
