// Worked example (voxel look). The look-kit functions it uses were pasted above it (lookSeg, lookBounce, lookHash3, lookCube, lookVoxels,
// lookVoxelWord from references/look-kit.js); assembled, it passes the dry run, the audit and the photos.
// Take its method (cells from loops, stages with an arrival order, one voxel word per step, start at full size), not
// its subject.
// A voxel lesson: a bean seed sprouts in four steps. The soil is cut open at the front so the roots show.
// Step 0 shows the grown plant: the host fits a lesson by what it shows first, so a model that grows starts at its
// full size, then Next takes it back to the seed and builds it up again.
export default function build({ THREE, kit, traits, ui }) {
  const root = new THREE.Group();
  const S = 0.012;                                    // metres per cube
  const PAL = {
    soilA: '#8a5a38', soilB: '#74482c', soilC: '#5f3a25', grass: '#74a945', seed: '#f6dc98',
    root: '#f3ead8', stem: '#5c9a3a', leaf: '#3f8f3d', leafLight: '#72b947', letter: '#2f7a37',
  };

  // The plinth: a smooth base, no wider than the soil.
  const plinth = new THREE.Mesh(kit.roundedBox(0.19, 0.03, 0.15, 0.006), kit.material('plastic', { color: '#f6f1e7', roughness: 0.45, wear: 0 }));
  plinth.name = 'Plinth';
  plinth.position.y = 0.015;
  root.add(plinth);

  // The subject is the soil and the plant together: the lesson is the plant growing in it.
  const sprout = new THREE.Group();
  sprout.name = 'Sprouting bean';
  sprout.userData.subject = true;
  sprout.position.y = 0.03;
  root.add(sprout);

  // The soil: 14 x 6 x 10 cubes with a notch cut out of the front middle, so the seed and its roots are in view.
  const soil = [];
  for (let x = -7; x < 7; x++) for (let y = 0; y < 6; y++) for (let z = -5; z < 5; z++) {
    if (x >= -3 && x <= 2 && z >= 1) continue;      // the cut
    soil.push([x, y, z, y === 5 ? 'grass' : ['soilA', 'soilB', 'soilC'][(x * 7 + y * 3 + z * 5 + 99) % 3]]);
  }
  const soilMesh = lookVoxels(THREE, kit, soil, { size: S, palette: PAL });
  soilMesh.name = 'Soil';
  sprout.add(soilMesh);

  // The plant, stage by stage. Each cell: [x, y, z, colour, stage, order] - order is when it arrives in its stage.
  const plantCells = [];
  const put = (x, y, z, c, stage, order) => plantCells.push([x, y, z, c, stage, order]);
  put(0, 3, 0.9, 'seed', 0, 0); put(-1, 3, 0.9, 'seed', 0, 1); put(0, 4, 0.9, 'seed', 0, 2); put(-1, 4, 0.9, 'seed', 0, 3);
  for (let i = 0; i < 3; i++) put(0, 2 - i, 0.9, 'root', 1, i);                       // the main root, down the cut
  put(1, 1, 0.9, 'root', 1, 3); put(-1, 0, 0.9, 'root', 1, 4); put(-2, 0, 0.9, 'root', 1, 5);
  for (let i = 0; i < 7; i++) put(0, 5 + i, 0.9, 'stem', 2, i);                       // the shoot rises out of the soil
  put(1, 11, 0.9, 'leafLight', 2, 7); put(-1, 11, 0.9, 'leafLight', 2, 8);
  for (let i = 0; i < 6; i++) put(0, 12 + i, 0.9, 'stem', 3, i);                      // grows on, true leaves
  for (const side of [-1, 1]) for (let k = 1; k <= 3; k++) for (let h = 0; h < 2; h++) put(side * k, 14 + h + (k === 3 ? 0 : 1), 0.9, 'leaf', 3, 6 + k + h);
  const plant = lookVoxels(THREE, kit, plantCells.map(([x, y, z, c]) => [x, y, z, c]), { size: S, palette: PAL });
  plant.name = 'Bean plant';
  sprout.add(plant);
  // lookVoxels drops hidden cubes; keep each kept cube's stage and order for the animation.
  const info = new Map(plantCells.map((c) => [`${c[0]},${c[1]},${c[2]}`, c]));
  const cubes = plant.userData.cells.map((cell) => ({ ...cell, stage: info.get(`${cell.x},${cell.y},${cell.z}`)[4], order: info.get(`${cell.x},${cell.y},${cell.z}`)[5] }));

  // One voxel word per step, on the front of the plinth.
  const WORDS = ['PLANT', 'SEED', 'ROOTS', 'SHOOT', 'LEAVES'];
  const words = WORDS.map((w) => {
    const mesh = lookVoxelWord(w, 'letter');
    const v = lookVoxels(THREE, kit, mesh, { size: 0.005, palette: PAL, shade: 0.03 });
    v.name = `Word ${w}`;
    v.position.set(-(w.length * 4 - 1) * 0.005 / 2, 0.003, 0.075 + 0.0025);
    v.visible = false;
    root.add(v);
    return v;
  });

  // The hand action: a watering can on the desk beside the plinth. Pressing it waters the seed and grows the next
  // stage, so the learner moves the lesson on with the model, not only with the panel. It is its own voxel mesh
  // (one hand target, 6 cm across), in front and within reach.
  const can = [];
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) for (let z = 0; z < 3; z++) can.push([x, y, z, y === 3 ? 'canTop' : 'can']);
  for (let i = 0; i < 3; i++) can.push([4 + i, 2 + i, 1, 'can']);                   // the spout
  can.push([-1, 2, 1, 'can'], [-1, 3, 1, 'can']);                                    // the handle
  const canMesh = lookVoxels(THREE, kit, can, { size: 0.01, palette: { can: '#4d9fb2', canTop: '#8fd0dc' } });
  canMesh.name = 'Watering can';
  canMesh.position.set(0.13, 0, 0.04);
  canMesh.rotation.y = Math.PI;                                                       // spout toward the plant
  root.add(canMesh);
  traits(canMesh, { onPress() { go(step + 1); } });

  const TEXT = [
    'A young bean plant. Press the watering can to grow it again from a seed, one stage at a time.',
    'A bean seed lies in moist soil. Inside it, a tiny plant waits with its food store.',
    'Water softens the seed coat. The root comes out first and grows down.',
    'The shoot pushes up through the soil and opens its first two leaves.',
    'True leaves open and catch the light. Now the plant makes its own food.',
  ];
  let step = 0;
  let since = 0;
  // The panel scales with the 3D (the host fits its largest size to 0.5 m): place it from the model's size.
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  const big = Math.max(size.x, size.y, size.z);
  const right = new THREE.Box3().setFromObject(root).max.x;
  const panel = kit.panel(ui, {
    width: 0.3, position: [Math.max(1.06 * big, right + 0.05), 0.6 * big, 0], rotationY: -0.3, eyebrow: 'HOW A SEED SPROUTS', title: 'A seed sprouts',
    items: [
      { status: 'The whole plant', tone: 'neutral', id: 'state' },
      { text: TEXT[0], id: 'info' },
      { buttons: [{ label: 'Back', onPress() { go(step - 1); } }, { label: 'Next', onPress() { go(step + 1); } }] },
      { note: 'Shown about 3 times real size. The soil is cut open at the front.' },
    ],
  });
  root.add(panel.object3D);
  function go(n) {
    step = Math.max(0, Math.min(4, n));
    since = 0;
    panel.set('state', step === 0 ? 'The whole plant' : `Step ${step} of 4: ${WORDS[step][0]}${WORDS[step].slice(1).toLowerCase()}`);
    panel.set('info', TEXT[step]);
    words.forEach((w, i) => { w.visible = i === step; });
  }
  go(0);

  const m = new THREE.Matrix4();
  return {
    root,
    update(time, delta) {
      since += delta;
      for (const c of cubes) {
        let drop = 0;
        const stage = step === 0 ? 3 : step - 1;     // step 0: everything, already grown
        let show = c.stage <= stage;
        if (step > 0 && c.stage === stage) {
          const k = lookSeg(since, c.order * 0.12, c.order * 0.12 + 0.4);
          show = k > 0;
          drop = 0.03 * (1 - lookBounce(k));
        }
        if (show) m.makeTranslation(c.x * S, c.y * S + S / 2 + drop, c.z * S);
        else m.makeScale(0, 0, 0);
        plant.setMatrixAt(c.index, m);
      }
      plant.instanceMatrix.needsUpdate = true;
    },
  };
}
