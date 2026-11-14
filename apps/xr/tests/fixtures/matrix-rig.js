// Fixture for tests/interaction-matrix.mjs, the hand-written control for library models: a microscope whose
// stage can be picked up on its own, and an Explode button that pulls the parts apart.
export default function build({ THREE, traits, ui, kit, assets }) {
  const root = new THREE.Group();
  const scope = assets.get('microscope-objaverse');
  root.add(scope.object3D);
  traits(scope.part('stage'), { grab: true });
  let apart = false;
  const panel = kit.panel(ui, {
    width: 0.36, position: [0, 0.45, 0], title: 'Microscope',
    items: [{ buttons: [{ label: 'Explode', id: 'explode', onPress: () => scope.explode((apart = !apart) ? 0.6 : 0) }] }],
  });
  root.add(panel.object3D);
  return { root };
}
