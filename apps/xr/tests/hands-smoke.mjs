// Room placement and hand features, in the managed browser's emulated XR session (hand input):
// - the lesson stands in the anchored room frame and its spot is saved;
// - a lesson built below its origin, for a learner sitting low, stays above the floor;
// - a card's own bar moves that card and not the lesson;
// - two hands on a model scale it;
// - a pointer over a pressable object makes it glow.
// Returns the measurements; fails (ok: false) listing any check that didn't hold.
// Usage: npx @iwsdk/cli browser run tests/hands-smoke.mjs --timeout 100000

const LESSON = `export default function build({ THREE, traits, kit, ui }) {
  const root = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: '#8899aa' });
  // A tall column reaching 0.5 m below the origin (lessons should not, but generated ones do).
  const column = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.8, 0.08), material);
  column.name = 'column';
  column.position.set(-0.25, -0.1, 0);
  root.add(column);
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), material);
  box.name = 'box';
  box.position.set(0.05, 0.08, 0.05);
  root.add(box);
  traits(box, { grab: true });
  const button = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 24), new THREE.MeshStandardMaterial({ color: '#d33c3c' }));
  button.name = 'button';
  button.position.set(0.28, 0.01, 0.05);
  root.add(button);
  traits(button, { onPress: () => {} });
  const panel = kit.panel(ui, { width: 0.36, position: [0, 0.38, -0.05], title: 'Card', items: [{ buttons: [{ label: 'One', onPress: () => {} }] }] });
  root.add(panel.object3D);
  return { root };
}`;

export default async function run({ frame, page }) {
  const target = frame ?? page;
  await target.waitForFunction(() => Boolean(window.genui?.inspect && window.IWER_DEVICE?.remote), null, { timeout: 30000 });
  return target.evaluate(async (code) => {
    const r = window.IWER_DEVICE.remote;
    const genui = window.genui;
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const at = (c) => ({ x: c[0], y: c[1], z: c[2] });
    const find = (name) => {
      let found = null;
      genui.debugRoot()?.traverse((o) => { if (!found && o.name === name) found = o; });
      return found;
    };
    const worldOf = (o) => { const v = o.getWorldPosition(o.position.clone()); return [v.x, v.y, v.z]; };
    const round = (v) => Math.round(v * 1000) / 1000;
    const out = {};
    try { await r.dispatch('accept_session'); } catch { /* already in XR */ }
    await r.dispatch('set_input_mode', { mode: 'hand' });
    genui.state.prompt = null;
    genui.clear(); // forget any saved spot: this test finds its own
    try {
      for (const hand of ['hand-left', 'hand-right']) await r.dispatch('set_transform', { device: hand, position: { x: hand === 'hand-left' ? -0.35 : 0.35, y: 0.6, z: 0.1 } });
      // Sitting low: eyes 0.9 m above the floor, looking a little down.
      await r.dispatch('set_transform', { device: 'headset', position: { x: 0, y: 0.9, z: 0 }, orientation: { x: -0.1736, y: 0, z: 0, w: 0.9848 } });
      out.mount = (await genui.mount(code)).ok;
      await sleep(2500);

      // Room frame and saved spot.
      const anchor = genui.debugRoot().parent;
      out.lessonInRoom = anchor.parent?.name === 'GenUI Room';
      out.spotSaved = Boolean(localStorage.getItem('genui.lessonSpot.v1'));
      // Floor: the lowest point of the lesson's meshes.
      const column = find('column');
      column.geometry.computeBoundingBox();
      const columnBottom = column.localToWorld(column.geometry.boundingBox.min.clone()).y;
      out.lowestPointM = round(columnBottom);
      out.aboveFloor = columnBottom >= 0.04;

      // Hover glow: point the right hand's ray at the button.
      const button = worldOf(find('button'));
      await r.dispatch('set_transform', { device: 'hand-right', position: { x: button[0] + 0.05, y: button[1] + 0.12, z: button[2] + 0.3 } });
      await r.dispatch('look_at', { device: 'hand-right', target: at(button) });
      await sleep(300);
      const glowing = () => genui.inspect().glowing.length;
      out.glowWhileOver = glowing();
      await r.dispatch('set_transform', { device: 'hand-right', position: { x: 0.35, y: 0.6, z: 0.1 } });
      await sleep(300);
      out.glowAfter = glowing();

      // Card bar: shown with the chrome (the host adds it once the card has laid out), dragged 10 cm to the right.
      genui.setOverlayHidden(false);
      const cardBar = () => genui.inspectMoveHandles().find((h) => h.target === 'GenUI Panel' && h.visible);
      for (let i = 0; i < 25 && !cardBar(); i++) await sleep(200);
      const bar = cardBar();
      out.cardBar = Boolean(bar);
      if (bar) {
        const lessonBefore = anchor.position.clone();
        const card = genui.debugRoot().children.find((o) => o.name === 'GenUI Panel');
        const cardBefore = worldOf(card);
        const p = bar.position;
        await r.dispatch('set_transform', { device: 'hand-right', position: { x: p[0] + 0.05, y: p[1] + 0.1, z: p[2] + 0.3 } });
        await r.dispatch('look_at', { device: 'hand-right', target: at(p) });
        await sleep(200);
        await r.dispatch('set_select_value', { device: 'hand-right', value: 1, duration: 0.1 });
        await sleep(150);
        await r.dispatch('animate_to', { device: 'hand-right', position: { x: p[0] + 0.15, y: p[1] + 0.1, z: p[2] + 0.3 }, duration: 0.3 });
        await sleep(150);
        await r.dispatch('set_select_value', { device: 'hand-right', value: 0, duration: 0.1 });
        await sleep(200);
        const cardAfter = worldOf(card);
        out.cardMovedM = round(Math.hypot(cardAfter[0] - cardBefore[0], cardAfter[1] - cardBefore[1], cardAfter[2] - cardBefore[2]));
        out.lessonStayedPut = anchor.position.distanceTo(lessonBefore) < 0.001;
      }
      genui.setOverlayHidden(true);
      await r.dispatch('set_transform', { device: 'hand-right', position: { x: 0.35, y: 0.6, z: 0.1 } });

      // Two hands: pinch the box on its left and right faces, then pull the hands apart.
      const box = find('box');
      const scaleBefore = box.scale.x;
      const centre = worldOf(box);
      const left = { x: centre[0] - 0.07, y: centre[1], z: centre[2] };
      const right = { x: centre[0] + 0.07, y: centre[1], z: centre[2] };
      await r.dispatch('run_sequence', { device: 'hand-left', steps: [{ anchor: 'grasp', position: left, pinch: { value: 1, at: 'arrival' } }] });
      await r.dispatch('run_sequence', { device: 'hand-right', idleHand: 'keep', steps: [{ anchor: 'grasp', position: right, pinch: { value: 1, at: 'arrival' } }] });
      await sleep(150);
      out.heldByTwo = genui.inspect().grabbables.find((g) => g.name === 'box')?.held ?? false;
      await r.dispatch('run_sequence', { device: 'hand-right', idleHand: 'keep', steps: [{ anchor: 'grasp', position: { x: right.x + 0.15, y: right.y, z: right.z } }] });
      await sleep(150);
      out.scaleRatio = round(box.scale.x / scaleBefore);
      for (const hand of ['hand-left', 'hand-right']) await r.dispatch('set_select_value', { device: hand, value: 0 });
    } finally {
      genui.setOverlayHidden(true);
      genui.clear(); // also forgets the spot this test saved
    }

    const expect = {
      mount: out.mount === true,
      lessonInRoom: out.lessonInRoom === true,
      spotSaved: out.spotSaved === true,
      aboveFloor: out.aboveFloor === true,
      glowWhileOver: out.glowWhileOver >= 1,
      glowAfter: out.glowAfter === 0,
      cardBar: out.cardBar === true,
      cardMovedM: out.cardMovedM >= 0.05,
      lessonStayedPut: out.lessonStayedPut === true,
      heldByTwo: out.heldByTwo === true,
      scaleRatio: out.scaleRatio > 1.05,
    };
    const failed = Object.entries(expect).filter(([, ok]) => !ok).map(([check]) => `${check} (${JSON.stringify(out[check])})`);
    if (failed.length) throw new Error(`hands-smoke failed: ${failed.join(', ')}; measured ${JSON.stringify(out)}`);
    return out;
  }, LESSON);
}
