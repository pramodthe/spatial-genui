// Fixture for tests/interaction-matrix.mjs, the hand-written control: one of each interaction the host offers on
// plain three.js content. A lone cube to pick up by hand, three close spheres (crowded, so the host gives them a
// ray grab), a red button to press in 3D, and a kit.panel with buttons, choices, a segmented control, a toggle
// and a slider.
export default function build({ THREE, traits, ui, kit }) {
  const root = new THREE.Group();
  const material = (color) => new THREE.MeshStandardMaterial({ color });

  const cube = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), material('#e0773a'));
  cube.name = 'cube';
  cube.position.set(-0.22, 0.05, 0.05);
  root.add(cube);
  traits(cube, { grab: true });

  for (let i = 0; i < 3; i++) {
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.025, 24, 16), material('#4f8fe0'));
    sphere.name = `sphere ${i + 1}`;
    sphere.position.set(-0.04 + i * 0.065, 0.05, 0.05);
    root.add(sphere);
    traits(sphere, { grab: true });
  }

  const button = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 32), material('#d33c3c'));
  button.name = 'red button';
  button.position.set(0.24, 0.02, 0.05);
  root.add(button);
  let pressed = false;
  traits(button, { onPress: () => button.material.color.set((pressed = !pressed) ? '#3cd36b' : '#d33c3c') });

  const panel = kit.panel(ui, {
    width: 0.36, position: [0, 0.3, -0.05], title: 'Interaction test',
    items: [
      { status: 'Ready', id: 'state' },
      { buttons: [{ label: 'One', id: 'one', onPress: () => panel.set('state', 'One') }, { label: 'Two', id: 'two', onPress: () => panel.set('state', 'Two') }] },
      { choices: ['Red', 'Green', 'Blue'], columns: 3, selected: null, onSelect: (i, label) => panel.set('state', label) },
      { segmented: ['Slow', 'Normal', 'Fast'], selected: 1, onSelect: (i, label) => panel.set('state', label) },
      { toggle: 'Spin', on: false, onChange: (on) => panel.set('state', on ? 'Spin on' : 'Spin off') },
      { slider: 'Size', min: 0, max: 10, step: 1, value: 5, onChange: (value) => panel.set('state', `Size ${value}`) },
    ],
  });
  root.add(panel.object3D);
  return { root };
}
