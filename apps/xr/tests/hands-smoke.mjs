// Room placement and hand features, in the managed browser's emulated XR session (hand input):
// - the lesson stands in the anchored room frame and its spot is saved;
// - a lesson built below its origin, for a learner sitting low, stays above the floor;
// - a card held by its frame moves (not the lesson, and not when its button is pressed), two hands resize it,
//   and let go below the floor it comes back up; a card with nothing to press moves by its frame too; the picker
//   is held by its frame too;
// - two hands hold a model (and don't resize it: the view pill sizes lessons);
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
  const info = kit.panel(ui, { width: 0.3, position: [0.62, 0.3, -0.05], title: 'About', items: [{ text: 'A column, a box and a button.' }] });
  info.object3D.name = 'info card';
  root.add(info.object3D);
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
      // The lesson's anchor: its 3D (root), cards and name tags.
      genui.debugRoot()?.parent?.traverse((o) => { if (!found && o.name === name) found = o; });
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

      // Cards: held by the frame around them (set up once the card has laid out).
      const card = anchor.getObjectByName('GenUI Cards').getObjectByName('GenUI Panel');
      const frameOf = () => { let f = null; card.traverse((o) => { if (!f && o.name === 'Card frame') f = o; }); return f; };
      for (let i = 0; i < 25 && !frameOf(); i++) await sleep(200);
      const frame = frameOf();
      out.cardFrame = Boolean(frame);
      if (frame) {
        frame.geometry.computeBoundingBox();
        const fb = frame.geometry.boundingBox;
        // A point on the frame's margin at the card's left or right edge, in the world.
        const edge = (side) => { frame.updateWorldMatrix(true, false); const v = frame.position.clone().set(side < 0 ? fb.min.x + 0.012 : fb.max.x - 0.012, (fb.min.y + fb.max.y) / 2, 0); return worldOfLocal(frame, v); };
        const worldOfLocal = (o, v) => { const w = o.localToWorld(v); return [w.x, w.y, w.z]; };
        const lessonBefore = anchor.position.clone();
        const cardBefore = worldOf(card);
        // One hand: point at the frame's left edge, pinch, move 10 cm right, let go.
        const p = edge(-1);
        await r.dispatch('set_transform', { device: 'hand-right', position: { x: p[0] + 0.05, y: p[1] + 0.05, z: p[2] + 0.3 } });
        await r.dispatch('look_at', { device: 'hand-right', target: at(p) });
        await sleep(200);
        await r.dispatch('set_select_value', { device: 'hand-right', value: 1, duration: 0.1 });
        await sleep(150);
        await r.dispatch('animate_to', { device: 'hand-right', position: { x: p[0] + 0.15, y: p[1] + 0.05, z: p[2] + 0.3 }, duration: 0.3 });
        await sleep(150);
        await r.dispatch('set_select_value', { device: 'hand-right', value: 0, duration: 0.1 });
        await sleep(250);
        const cardAfter = worldOf(card);
        out.cardMovedM = round(Math.hypot(cardAfter[0] - cardBefore[0], cardAfter[1] - cardBefore[1], cardAfter[2] - cardBefore[2]));
        out.lessonStayedPut = anchor.position.distanceTo(lessonBefore) < 0.001;

        // The card's button still presses (a pinch on the card itself doesn't move it).
        const button = genui.inspect().panelButtons[0];
        const callsBefore = genui.inspect().handlerCalls;
        const cardBeforePress = worldOf(card);
        await r.dispatch('set_transform', { device: 'hand-right', position: { x: button.center[0] + 0.03, y: button.center[1] + 0.03, z: button.center[2] + 0.3 } });
        await r.dispatch('look_at', { device: 'hand-right', target: at(button.center) });
        await sleep(200);
        await r.dispatch('select', { device: 'hand-right', duration: 0.2 });
        await sleep(250);
        out.buttonPressed = genui.inspect().handlerCalls > callsBefore;
        const cardAfterPress = worldOf(card);
        out.cardStillOnPress = Math.hypot(cardAfterPress[0] - cardBeforePress[0], cardAfterPress[1] - cardBeforePress[1], cardAfterPress[2] - cardBeforePress[2]) < 0.005;
        await r.dispatch('set_transform', { device: 'hand-right', position: { x: 0.35, y: 0.6, z: 0.1 } });
        await sleep(200);

        // Two hands: point at the frame's left and right edges, pinch both, swing the right hand 15 cm further out.
        const scaleBefore = card.scale.x;
        const left = edge(-1);
        const right = edge(1);
        const leftFrom = { x: left[0] - 0.05, y: left[1] - 0.05, z: left[2] + 0.3 };
        const rightFrom = { x: right[0] + 0.05, y: right[1] - 0.05, z: right[2] + 0.3 };
        await r.dispatch('set_transform', { device: 'hand-left', position: leftFrom });
        await r.dispatch('look_at', { device: 'hand-left', target: at(left) });
        await r.dispatch('set_transform', { device: 'hand-right', position: rightFrom });
        await r.dispatch('look_at', { device: 'hand-right', target: at(right) });
        await sleep(200);
        await r.dispatch('set_select_value', { device: 'hand-left', value: 1, duration: 0.1 });
        await r.dispatch('set_select_value', { device: 'hand-right', value: 1, duration: 0.1 });
        await sleep(150);
        await r.dispatch('animate_to', { device: 'hand-right', position: { x: rightFrom.x + 0.15, y: rightFrom.y, z: rightFrom.z }, duration: 0.3 });
        await sleep(150);
        for (const hand of ['hand-left', 'hand-right']) await r.dispatch('set_select_value', { device: hand, value: 0 });
        await sleep(250);
        out.cardScaleRatio = round(card.scale.x / scaleBefore);
        for (const hand of ['hand-left', 'hand-right']) await r.dispatch('set_transform', { device: hand, position: { x: hand === 'hand-left' ? -0.35 : 0.35, y: 0.6, z: 0.1 } });
        await sleep(200);

        // Pull the card 1.4 m down by its frame and let go: it comes back above the floor.
        const low = edge(-1);
        await r.dispatch('set_transform', { device: 'hand-right', position: { x: low[0] + 0.05, y: low[1] + 0.05, z: low[2] + 0.3 } });
        await r.dispatch('look_at', { device: 'hand-right', target: at(low) });
        await sleep(200);
        await r.dispatch('set_select_value', { device: 'hand-right', value: 1, duration: 0.1 });
        await sleep(150);
        await r.dispatch('animate_to', { device: 'hand-right', position: { x: low[0] + 0.05, y: low[1] - 1.35, z: low[2] + 0.3 }, duration: 0.4 });
        await sleep(150);
        await r.dispatch('set_select_value', { device: 'hand-right', value: 0, duration: 0.1 });
        await sleep(300);
        frame.updateWorldMatrix(true, false);
        out.cardLowestM = round(frame.localToWorld(fb.min.clone()).y);
        for (const hand of ['hand-left', 'hand-right']) await r.dispatch('set_transform', { device: hand, position: { x: hand === 'hand-left' ? -0.35 : 0.35, y: 0.6, z: 0.1 } });
        await sleep(200);

        // A card with nothing to press (an info card) is held by its frame the same way.
        const info = find('info card');
        let infoFrame = null;
        info.traverse((o) => { if (!infoFrame && o.name === 'Card frame') infoFrame = o; });
        out.infoCardFrame = Boolean(infoFrame);
        if (infoFrame) {
          infoFrame.geometry.computeBoundingBox();
          const ib = infoFrame.geometry.boundingBox;
          infoFrame.updateWorldMatrix(true, false);
          const q = worldOfLocal(infoFrame, infoFrame.position.clone().set(ib.max.x - 0.012, (ib.min.y + ib.max.y) / 2, 0));
          const infoBefore = worldOf(info);
          await r.dispatch('set_transform', { device: 'hand-right', position: { x: q[0] + 0.05, y: q[1] + 0.05, z: q[2] + 0.3 } });
          await r.dispatch('look_at', { device: 'hand-right', target: at(q) });
          await sleep(350); // the pointer settles on the frame before the pinch
          await r.dispatch('set_select_value', { device: 'hand-right', value: 1, duration: 0.1 });
          await sleep(150);
          await r.dispatch('animate_to', { device: 'hand-right', position: { x: q[0] + 0.15, y: q[1] + 0.05, z: q[2] + 0.3 }, duration: 0.3 });
          await sleep(150);
          await r.dispatch('set_select_value', { device: 'hand-right', value: 0, duration: 0.1 });
          await sleep(250);
          const infoAfter = worldOf(info);
          out.infoCardMovedM = round(Math.hypot(infoAfter[0] - infoBefore[0], infoAfter[1] - infoBefore[1], infoAfter[2] - infoBefore[2]));
        }
        await r.dispatch('set_transform', { device: 'hand-right', position: { x: 0.35, y: 0.6, z: 0.1 } });
        await sleep(300);
      }
      // The picker (in the room frame beside the lesson): its course rows still open with a pointed pinch, and it is
      // held by its frame too.
      genui.setOverlayHidden(false);
      await sleep(600);
      const row = (await r.dispatch('list_targets')).targets.find((x) => x.name === 'course-0');
      if (row) {
        const shownBefore = genui.inspectPicker()?.shown ?? null;
        const p = row.position;
        await r.dispatch('set_transform', { device: 'hand-right', position: { x: p.x + 0.05, y: p.y - 0.05, z: p.z + 0.35 } });
        await r.dispatch('look_at', { device: 'hand-right', target: p });
        await sleep(250);
        await r.dispatch('select', { device: 'hand-right', duration: 0.2 });
        await sleep(800);
        out.pickerCourseOpens = (genui.inspectPicker()?.shown ?? null) !== shownBefore;
        // What stood in the way, if anything.
        if (!out.pickerCourseOpens) out.pickerRay = genui.debugRay([p.x + 0.05, p.y - 0.05, p.z + 0.35], [p.x, p.y, p.z]).slice(0, 3).map((h) => h.chain);
        genui.courses.show(null);
        await r.dispatch('set_transform', { device: 'hand-right', position: { x: 0.35, y: 0.6, z: 0.1 } });
        await sleep(400);
      }
      const picker = anchor.parent.children.find((o) => o.name === 'Lesson Picker');
      let pickerFrame = null;
      picker?.traverse((o) => { if (!pickerFrame && o.name === 'Card frame') pickerFrame = o; });
      out.pickerFrame = Boolean(pickerFrame);
      if (pickerFrame) {
        pickerFrame.geometry.computeBoundingBox();
        const pb = pickerFrame.geometry.boundingBox;
        pickerFrame.updateWorldMatrix(true, false);
        // Its outer (left) edge: the inner one faces the lesson, whose card can stand in the way.
        const w = pickerFrame.localToWorld(pickerFrame.position.clone().set(pb.min.x + 0.012, (pb.min.y + pb.max.y) / 2, 0));
        const q = [w.x, w.y, w.z];
        const before = worldOf(picker);
        await r.dispatch('set_transform', { device: 'hand-right', position: { x: q[0] - 0.05, y: q[1] + 0.05, z: q[2] + 0.3 } });
        await r.dispatch('look_at', { device: 'hand-right', target: at(q) });
        await sleep(200);
        await r.dispatch('set_select_value', { device: 'hand-right', value: 1, duration: 0.1 });
        await sleep(150);
        await r.dispatch('animate_to', { device: 'hand-right', position: { x: q[0] - 0.15, y: q[1] + 0.05, z: q[2] + 0.3 }, duration: 0.3 });
        await sleep(150);
        await r.dispatch('set_select_value', { device: 'hand-right', value: 0, duration: 0.1 });
        await sleep(250);
        const after = worldOf(picker);
        out.pickerMovedM = round(Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]));
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
      cardFrame: out.cardFrame === true,
      cardMovedM: out.cardMovedM >= 0.05,
      lessonStayedPut: out.lessonStayedPut === true,
      buttonPressed: out.buttonPressed === true,
      cardStillOnPress: out.cardStillOnPress === true,
      cardScaleRatio: out.cardScaleRatio > 1.1,
      cardLowestM: Math.abs(out.cardLowestM - 0.02) < 0.01, // pulled into the floor, it ends 2 cm above
      infoCardFrame: out.infoCardFrame === true,
      infoCardMovedM: out.infoCardMovedM >= 0.05,
      pickerCourseOpens: out.pickerCourseOpens === true,
      pickerFrame: out.pickerFrame === true,
      pickerMovedM: out.pickerMovedM >= 0.05,
      heldByTwo: out.heldByTwo === true,
      scaleRatio: Math.abs(out.scaleRatio - 1) < 0.02, // objects don't change size by hand: the view pill sizes lessons
    };
    const failed = Object.entries(expect).filter(([, ok]) => !ok).map(([check]) => `${check} (${JSON.stringify(out[check])})`);
    if (failed.length) throw new Error(`hands-smoke failed: ${failed.join(', ')}; measured ${JSON.stringify(out)}`);
    return out;
  }, LESSON);
}
