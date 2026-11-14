// The view pill, in the managed browser's emulated XR session:
// - a lesson's 3D is fitted into the 0.5 m box and its card keeps its size;
// - the pill offers the real size with the scale ("1:16" for an 8 m house shown 0.5 m tall);
// - pressed, the house stands 8 m tall on the floor ahead while the card stays put; pressed again, back to fit;
// - a subject too small to see at its real size (a bacterium) only shows the scale.
// Returns the measurements; fails (ok: false) listing any check that didn't hold.
// Usage: npx @iwsdk/cli browser run tests/view-smoke.mjs --timeout 60000

const HOUSE = `export default function build({ THREE, kit, ui }) {
  const root = new THREE.Group();
  const house = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 0.3), new THREE.MeshStandardMaterial({ color: '#c98a5a' }));
  house.name = 'house';
  house.position.set(0, 0.2, 0);
  root.add(house);
  const panel = kit.panel(ui, { width: 0.36, position: [0.4, 0.22, 0], title: 'A house', items: [{ buttons: [{ label: 'Next', onPress: () => {} }] }] });
  root.add(panel.object3D);
  return { root, real: { size: 8 } };
}`;
const CELL = HOUSE.replace("real: { size: 8 }", 'real: undefined');

export default async function run({ frame, page }) {
  const target = frame ?? page;
  await target.waitForFunction(() => Boolean(window.genui?.inspectPill && window.IWER_DEVICE?.remote), null, { timeout: 30000 });
  return target.evaluate(async ({ house, cell }) => {
    const r = window.IWER_DEVICE.remote;
    const genui = window.genui;
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const round = (v) => Math.round(v * 1000) / 1000;
    const out = {};
    try { await r.dispatch('accept_session'); } catch { /* already in XR */ }
    await r.dispatch('set_input_mode', { mode: 'hand' });
    genui.state.prompt = null;
    genui.clear();
    genui.setOverlayHidden(false);
    await r.dispatch('set_transform', { device: 'headset', position: { x: 0, y: 1.3, z: 0 }, orientation: { x: -0.1736, y: 0, z: 0, w: 0.9848 } });
    try {
      await genui.mount(house);
      await sleep(2500);
      const root = genui.debugRoot();
      const find = (name) => { let f = null; root.traverse((o) => { if (!f && o.name === name) f = o; }); return f; };
      const mesh = find('house');
      const card = root.children.find((o) => o.name === 'GenUI Panel');
      const V = mesh.position.constructor;
      // The house's world height and lowest point, from its box's corners.
      const extent = () => {
        mesh.geometry.computeBoundingBox();
        const b = mesh.geometry.boundingBox;
        mesh.updateWorldMatrix(true, false);
        const lo = new V(b.min.x, b.min.y, b.min.z).applyMatrix4(mesh.matrixWorld);
        const hi = new V(b.max.x, b.max.y, b.max.z).applyMatrix4(mesh.matrixWorld);
        return { height: round(hi.y - lo.y), bottom: round(lo.y) };
      };
      const cardWorld = () => { const v = card.getWorldPosition(new V()); return { at: [v.x, v.y, v.z].map(round), scale: round(card.getWorldScale(new V()).x) }; };

      out.fitHeightM = extent().height;
      const cardFit = cardWorld();
      out.cardScale = cardFit.scale;
      const pill = genui.inspectPill();
      out.pill = pill && `${pill.label} ${pill.detail}`;
      out.pillVisible = Boolean(pill?.visible);

      genui.pressPill();
      await sleep(300);
      const real = extent();
      out.realHeightM = real.height;
      out.realBottomM = real.bottom;
      const cardReal = cardWorld();
      out.cardStayedM = round(Math.hypot(...cardReal.at.map((v, i) => v - cardFit.at[i])));
      out.cardScaleReal = cardReal.scale;
      out.pillReal = `${genui.inspectPill().label} ${genui.inspectPill().detail}`;

      genui.pressPill();
      await sleep(300);
      out.backToFitM = extent().height;
      out.cardBackM = round(Math.hypot(...cardWorld().at.map((v, i) => v - cardFit.at[i])));

      // A bacterium-sized subject: the pill only tells the scale.
      await genui.mount(cell);
      await sleep(1500);
      genui.setLessonRealSize(0.000002);
      const small = genui.inspectPill();
      out.pillSmall = small && `${small.label} ${small.detail}`;
      out.pillSmallEnabled = small?.enabled;
    } finally {
      genui.clear();
    }

    const expect = {
      fitHeightM: Math.abs(out.fitHeightM - 0.5) < 0.01,
      cardScale: Math.abs(out.cardScale - 0.8) < 0.02,
      pill: out.pill === 'Real size 1:16',
      pillVisible: out.pillVisible === true,
      realHeightM: Math.abs(out.realHeightM - 8) < 0.05,
      realBottomM: Math.abs(out.realBottomM) < 0.05,
      cardStayedM: out.cardStayedM < 0.005,
      cardScaleReal: Math.abs(out.cardScaleReal - out.cardScale) < 0.005,
      pillReal: out.pillReal === 'Fit 1:1',
      backToFitM: Math.abs(out.backToFitM - 0.5) < 0.01,
      cardBackM: out.cardBackM < 0.005,
      pillSmall: out.pillSmall === 'Scale x250,000',
      pillSmallEnabled: out.pillSmallEnabled === false,
    };
    const failed = Object.entries(expect).filter(([, ok]) => !ok).map(([check]) => `${check} (${JSON.stringify(out[check])})`);
    if (failed.length) throw new Error(`view-smoke failed: ${failed.join(', ')}; measured ${JSON.stringify(out)}`);
    return out;
  }, { house: HOUSE, cell: CELL });
}
