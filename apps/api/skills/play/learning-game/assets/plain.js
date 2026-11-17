// ---------------------------------------------------------------- the plain look
// For a learning game in plain, realistic materials (no art style): a soft desk mat to play on, and the kit's
// materials for everything else (/skills/common/kit). Same shape as the looks in /skills/looks, so the play starter
// works with it unchanged.
//   set({ width, depth, colour })        the mat; never grabbable. .userData.top is its top surface
//   demo(subject)                        two sample pieces, one to pick up and one to press (replace them)
function plainLook(THREE, kit) {
  const look = {};
  look.set = (o = {}) => {
    const width = o.width ?? 0.5;
    const depth = o.depth ?? 0.36;
    const mat = new THREE.Mesh(kit.roundedBox(width, 0.012, depth, 0.006), kit.material('fabric', { color: o.colour ?? '#3f6f7a' }));
    mat.name = 'Mat';
    mat.position.y = 0.006;
    const set = new THREE.Group();
    set.name = 'Set';
    set.add(mat);
    set.userData.top = 0.012;
    return set;
  };
  look.demo = (subject) => {
    const block = new THREE.Mesh(kit.roundedBox(0.06, 0.06, 0.06, 0.008), kit.material('plastic', { color: '#f2a03d' }));
    block.name = 'Block';
    block.position.set(-0.09, 0.03, 0.04);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.035, 24, 16), kit.material('rubber', { color: '#d9483b' }));
    ball.name = 'Ball';
    ball.position.set(0.09, 0.035, 0.04);
    subject.add(block, ball);
    return [{ object: block, grab: true }, { object: ball, press: true }];
  };
  return look;
}
