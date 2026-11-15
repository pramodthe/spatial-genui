// Low-poly look for an XR lesson: a faceted island, every triangle one tone, paper flags at the stops.
// Needs look-kit.js (lookFacets, lookFacetMaterial, lookHash3). Paste above `export default`.
function lowPolyLook(THREE, kit) {
  const PAL = {
    seaDeep: '#1f6a80', sea: '#2e8f9c', seaShallow: '#63bfb4', river: '#59b9cc', sand: '#ecd3a0', bed: '#c9b99a',
    grass: '#a5bf66', meadow: '#86ad5c', forest: '#5d9160', pine: '#3f7d62', leaf: '#74a857', ochre: '#e0a646',
    rock: '#a3929b', rockDark: '#857a8c', snow: '#fffbf4', trunk: '#7d5e4e', cloud: '#fff8ef', paper: '#fff6e4',
    ink: '#22303c', accent: '#e9684a', roof: '#e9684a', wall: '#fff6e4',
  };
  const matte = lookFacetMaterial(THREE);
  const glossy = lookFacetMaterial(THREE, 0.35);
  let seed = 1;
  const look = {
    name: 'low-poly',
    PAL,
    // Any geometry as facets of one family colour. Water: { water: true }.
    facet(geometry, colour, name, { jitter = 0.003, water = false } = {}) {
      const mesh = new THREE.Mesh(lookFacets(THREE, geometry, PAL[colour] || colour, { jitter, seed: seed++ }), water ? glossy : matte);
      mesh.name = name;
      return mesh;
    },
    tree(name, h = 0.07) {
      const g = new THREE.Group();
      g.name = name;
      const trunk = look.facet(new THREE.CylinderGeometry(0.004, 0.006, h * 0.35, 5), 'trunk', `${name} trunk`, { jitter: 0 });
      trunk.position.y = h * 0.175;
      const crown = look.facet(new THREE.ConeGeometry(h * 0.3, h * 0.75, 6, 2), 'pine', `${name} crown`);
      crown.position.y = h * 0.6;
      g.add(trunk, crown);
      return g;
    },
    // A stop's paper flag: press it to go to that stage. The flag cloth is 4 cm, so a pinch can hit it.
    flag(number, name) {
      const g = new THREE.Group();
      g.name = name;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.08, 6), kit.material('wood'));
      pole.position.y = 0.04;
      const cloth = new THREE.Mesh(kit.extrude([[0, 0], [0.04, 0.012], [0, 0.024]], 0.004), kit.material('paper', { color: PAL.paper, wear: 0 }));
      cloth.position.set(0.001, 0.055, 0);
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.005, 16), kit.material('plastic', { color: PAL.accent, wear: 0 }));
      dot.position.set(0.012, 0.067, 0.0025);
      g.add(pole, cloth, dot);
      g.userData.number = number;
      return g;
    },
    // The island: a low faceted tile of land over a sand rim. Its top is set.userData.top.
    set({ radius = 0.2 } = {}) {
      const set = new THREE.Group();
      set.name = 'Island';
      const sand = look.facet(new THREE.CylinderGeometry(radius, radius * 0.9, 0.02, 9, 1), 'sand', 'Island rim', { jitter: 0.004 });
      sand.position.y = 0.01;
      const land = look.facet(new THREE.CylinderGeometry(radius * 0.92, radius * 0.95, 0.012, 9, 1), 'grass', 'Island land', { jitter: 0.003 });
      land.position.y = 0.026;
      set.add(sand, land);
      set.userData.top = 0.032;
      return set;
    },
    demo(subject) {
      const hill = look.facet(new THREE.IcosahedronGeometry(0.06, 1), 'meadow', 'Hill');
      hill.scale.y = 0.6;
      hill.position.set(-0.07, 0, -0.05);
      const pond = look.facet(new THREE.CylinderGeometry(0.05, 0.05, 0.006, 7), 'seaShallow', 'Pond', { water: true });
      pond.position.set(0.07, 0.003, 0.03);
      const tree = look.tree('Tree');
      tree.position.set(0.02, 0, -0.06);
      const flag = look.flag(1, 'Stop 1 flag');
      flag.position.set(-0.05, 0, 0.08);
      subject.add(hill, pond, tree, flag);
      return [{ object: flag, press: true }];
    },
  };
  return look;
}
