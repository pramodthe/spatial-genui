// Voxel look for an XR lesson: everything from small chamfered cubes on an off-white plinth, the step's word in cubes.
// Needs look-kit.js (lookVoxels, lookVoxelWord, lookCube, lookHash3). Paste above `export default`.
function voxelLook(THREE, kit) {
  const PAL = {
    grass: '#86b84f', grassB: '#74a945', soilA: '#8a5a38', soilB: '#74482c', soilC: '#5f3a25', stone: '#a9a297',
    wood: '#d3a468', woodDark: '#9c6f42', leaf: '#3f8f3d', leafLight: '#72b947', stem: '#5c9a3a', red: '#e5352b',
    orange: '#f2952f', yellow: '#ffd94a', cloud: '#ffffff', water: '#3fa0ee', metal: '#b9c0c4', pink: '#f39ab0',
    letter: '#2f7a37',
  };
  const plinthMat = kit.material('plastic', { color: '#f6f1e7', roughness: 0.45, wear: 0 });
  const look = {
    name: 'voxel',
    PAL,
    size: 0.012, // metres per cube; choose so the model is 0.25-0.35 m across
    // The plinth the model stands on. Its top is set.userData.top. Never grabbable.
    set({ width = 0.3, depth = 0.2 } = {}) {
      const set = new THREE.Mesh(kit.roundedBox(width, 0.03, depth, 0.006), plinthMat);
      set.name = 'Plinth';
      set.position.y = 0.015;
      set.userData.top = 0.03;
      set.userData.front = depth / 2;
      return set;
    },
    // One hand target or one moving thing = one call: cells [[x, y, z, 'name' | '#hex'], ...].
    model(cells, name, size = look.size) {
      const mesh = lookVoxels(THREE, kit, cells, { size, palette: PAL });
      mesh.name = name;
      return mesh;
    },
    // A filled box of cells from (x0, y0, z0) to (x1, y1, z1) inclusive, in one colour (or a function of x, y, z).
    box(x0, y0, z0, x1, y1, z1, colour) {
      const cells = [];
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
        cells.push([x, y, z, typeof colour === 'function' ? colour(x, y, z) : colour]);
      }
      return cells;
    },
    // A ball of cells of radius r around (cx, cy, cz).
    ball(cx, cy, cz, r, colour) {
      const cells = [];
      const R = Math.ceil(r);
      for (let x = -R; x <= R; x++) for (let y = -R; y <= R; y++) for (let z = -R; z <= R; z++) {
        if (x * x + y * y + z * z <= r * r) cells.push([cx + x, cy + y, cz + z, typeof colour === 'function' ? colour(x, y, z) : colour]);
      }
      return cells;
    },
    // The step's word in cubes on the front face of the plinth (dark letters on the off-white plinth).
    word(text, set) {
      const size = 0.005;
      const mesh = lookVoxels(THREE, kit, lookVoxelWord(text, 'letter'), { size, palette: PAL, shade: 0.03 });
      mesh.name = `Word ${text}`;
      mesh.position.set(-(String(text).length * 4 - 1) * size / 2, 0.003, set.userData.front + size / 2);
      return mesh;
    },
    // A working demo: a small tree of three hand targets (trunk, crown, an apple to pick and put back).
    demo(subject) {
      const s = look.size;
      const trunk = look.model(look.box(-1, 0, -1, 1, 7, 1, (x, y) => (y % 3 ? 'wood' : 'woodDark')), 'Trunk');
      const crown = look.model(look.ball(0, 12, 0, 5.2, (x, y) => (y > 1 ? 'leafLight' : 'leaf')), 'Crown');
      const apple = look.model(look.ball(0, 0, 0, 1.6, 'red'), 'Apple');
      apple.position.set(4 * s, 9 * s, 5.2 * s);
      subject.add(trunk, crown, apple);
      return [{ object: apple, grab: true }, { object: crown, press: true }];
    },
  };
  return look;
}
