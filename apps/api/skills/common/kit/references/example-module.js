// The worked example in the system prompt (prompt.ts), and what POST /api/generate returns for "/example".
// Real code, so it can be checked and run like any generated module. Keep it short: models imitate it.
export default function build({ THREE, kit, traits, ui, isGrabbed }) {
  const root = new THREE.Group();
  const accent = '#ffb347';

  // A display base grounds the model; the model stands on its top.
  const stand = kit.stand(0.17, { accent });
  root.add(stand);
  const lighthouse = new THREE.Group();
  lighthouse.name = 'Lighthouse';
  lighthouse.position.y = stand.userData.top;
  root.add(lighthouse);

  // Materials: made once, reused. Presets bring their own surface texture.
  const rock = kit.material('rock');
  const iron = kit.material('iron', { color: '#2b2e33' });
  const paint = new THREE.MeshStandardMaterial({ map: kit.texture('stripes', { colors: ['#c8372d', '#f3efe6'], count: 5 }), roughness: 0.7 });
  const lampLight = kit.material('light', { color: '#ffe9a8', glow: 2.5 });

  // Main masses: profiles spun around the Y axis ([radius, y] from bottom to top).
  const island = new THREE.Mesh(kit.lathe([[0, 0], [0.13, 0], [0.12, 0.012], [0.085, 0.028], [0.06, 0.034], [0, 0.036]], 24), rock);
  const tower = new THREE.Mesh(kit.lathe([[0.042, 0], [0.04, 0.02], [0.03, 0.2], [0.032, 0.206], [0, 0.206]], 40), paint);
  tower.position.y = 0.03;
  // The tower's radius at a height, from the same numbers as its profile: details sit exactly on its wall.
  const wall = (y) => 0.04 - ((y - 0.05) / 0.18) * 0.01;
  const deck = new THREE.Mesh(kit.lathe([[0, 0], [0.047, 0], [0.047, 0.005], [0, 0.005]], 40), iron);
  deck.position.y = 0.236;
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.04, 32, 1, true), kit.material('glass'));
  glass.position.y = 0.261;
  const roof = new THREE.Mesh(kit.lathe([[0.034, 0], [0.03, 0.006], [0.006, 0.03], [0.004, 0.04], [0.007, 0.046], [0, 0.05]], 32), iron);
  roof.position.y = 0.281;
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.011, 24, 16), lampLight);
  lamp.position.y = 0.261;
  lighthouse.add(island, tower, deck, glass, roof, lamp);

  // Secondary forms and small repeated detail: door, windows, railing posts and rail, window bars.
  const door = new THREE.Mesh(kit.roundedBox(0.022, 0.036, 0.006, 0.004), kit.material('wood', { color: '#6b4a2f' }));
  door.position.set(0, 0.05, wall(0.05));
  const windows = kit.instances(kit.roundedBox(0.011, 0.018, 0.004, 0.003), iron, [[0, 0.11, wall(0.11)], [0, 0.17, wall(0.17)]]);
  const posts = [];
  const bars = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    posts.push([Math.cos(a) * 0.044, 0.249, Math.sin(a) * 0.044]);
    if (i % 2 === 0) bars.push([Math.cos(a) * 0.026, 0.261, Math.sin(a) * 0.026]);
  }
  const railing = kit.instances(new THREE.CylinderGeometry(0.0008, 0.0008, 0.016, 6), iron, posts);
  const rail = new THREE.Mesh(kit.tube(posts.map(([x, y, z]) => [x, y + 0.008, z]), 0.0009, { closed: true }), iron);
  const windowBars = kit.instances(new THREE.CylinderGeometry(0.0009, 0.0009, 0.04, 6), iron, bars);
  lighthouse.add(door, windows, railing, rail, windowBars);

  // Light and motion: a glow at the lamp and a beam that sweeps around.
  const halo = kit.glow('#ffd98a', 0.11);
  halo.position.y = 0.261;
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(0.03, 0.3, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: '#ffe9a8', transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  beam.geometry.rotateZ(Math.PI / 2).translate(0.15, 0, 0); // the tip at the lamp, opening outward along x
  const beamPivot = new THREE.Group();
  beamPivot.position.y = 0.261;
  beamPivot.add(beam);
  lighthouse.add(halo, beamPivot);

  // One panel, built from the kit's parts: what it is, one fact at a time, clear buttons.
  const facts = [
    'A lighthouse marks dangerous coasts and safe harbour entrances for ships at night.',
    'Its lamp stays still. A turning lens gathers the light into beams that sweep the sea.',
    'Each lighthouse flashes in its own rhythm, so sailors can tell which one they see.',
  ];
  let factIndex = 0;
  let lit = true;
  const panel = kit.panel(ui, {
    width: 0.36, position: [0.38, 0.22, 0], rotationY: -0.3,
    eyebrow: 'HOW IT WORKS', title: 'Lighthouse',
    items: [
      { text: facts[0], id: 'fact' },
      { progress: 1 / facts.length, label: 'Fact 1 of ' + facts.length, id: 'seen' },
      { buttons: [
        { label: 'Next fact', onPress() {
          factIndex = (factIndex + 1) % facts.length;
          panel.set('fact', facts[factIndex]);
          panel.set('seen', (factIndex + 1) / facts.length, 'Fact ' + (factIndex + 1) + ' of ' + facts.length);
        } },
      ] },
      { toggle: 'Lamp', on: true, onChange(on) {
        lit = on;
        beamPivot.visible = lit;
        halo.visible = lit;
        lampLight.emissiveIntensity = lit ? 2.5 : 0.1;
      } },
      { note: 'Pinch the lighthouse to pick it up.' },
    ],
  });
  root.add(panel.object3D);

  traits(lighthouse, { grab: true });
  return {
    root,
    update(time) {
      beamPivot.rotation.y = time * 0.9;
    },
  };
}
