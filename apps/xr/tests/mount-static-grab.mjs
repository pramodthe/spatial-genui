// Mount a static module with one grabbable cube, to test the host's hand-interaction bridge
// in isolation. Then: npx @iwsdk/cli xr run-sequence … target "Test Cube".

const MODULE = `export default function build({ THREE, traits }) {
  const root = new THREE.Group();
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.06, 0.06),
    new THREE.MeshStandardMaterial({ color: 0xe0533d }),
  );
  cube.name = 'Test Cube';
  cube.position.set(0, 0.05, 0);
  root.add(cube);
  traits(cube, { grab: true });
  return { root };
}`;

export default async function run({ frame, page }) {
  const target = frame ?? page;
  await target.waitForFunction(() => Boolean(window.genui), null, { timeout: 30000 });
  return target.evaluate(async (code) => {
    const report = await window.genui.mount(code);
    return { report, runtimeErrors: window.genui.state.runtimeErrors };
  }, MODULE);
}
