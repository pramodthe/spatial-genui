// The view pill, in the managed browser's emulated XR session:
// - a lesson's cards and name tags leave its 3D for layers of their own, so the views scale the 3D only;
// - a lesson's 3D is fitted into the 0.5 m box and its card keeps its size;
// - the pill offers the real size with the scale ("1:16" for an 8 m house shown 0.5 m tall);
// - pressed, the house stands 8 m tall on the floor ahead while its cards stay put at their size, wherever the lesson
//   attached them, and the name tags stay on their spots on the house at their size; pressed again, back to fit;
// - hiding a group of the lesson hides the card the lesson put in it, and a card or tag the lesson hides itself stays
//   hidden, also when its group is shown again;
// - the pill waits for the lesson's layout, and a lesson whose root is raised still stands on the floor;
// - a tag the learner can grab stays in the 3D;
// - a subject too small to see at its real size (a bacterium) only shows the scale.
// Returns the measurements; fails (ok: false) listing any check that didn't hold.
// Usage: npx @iwsdk/cli browser run tests/view-smoke.mjs --timeout 60000

const HOUSE = `export default function build({ THREE, kit, ui, traits }) {
  const root = new THREE.Group();
  const house = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 0.3), new THREE.MeshStandardMaterial({ color: '#c98a5a' }));
  house.name = 'house';
  house.position.set(0, 0.2, 0);
  root.add(house);
  const panel = kit.panel(ui, { width: 0.36, position: [0.4, 0.22, 0], title: 'A house', items: [{ buttons: [{ label: 'Next', onPress: () => {} }] }] });
  root.add(panel.object3D);
  // A card the lesson keeps in a group of its own, and a name tag on the house (nothing to press).
  const side = new THREE.Group();
  side.name = 'side';
  side.position.set(-0.4, 0.1, 0);
  root.add(side);
  const nested = kit.panel(ui, { width: 0.36, position: [0, 0.12, 0], title: 'Inside', items: [{ buttons: [{ label: 'Open', onPress: () => {} }] }] });
  nested.object3D.name = 'nested card';
  side.add(nested.object3D);
  const tag = ui('<div style="padding: 8px; background-color: #222;"><span style="font-size: 24px; color: #fff;">Roof</span></div>', { width: 0.08 });
  tag.object3D.name = 'tag';
  tag.object3D.position.set(0, 0.25, 0.16);
  house.add(tag.object3D);
  // A name tag drawn in 3D, as kit.card draws them, standing in root by the door.
  const door = new THREE.Group();
  door.name = 'door tag';
  door.userData.nameTag = true;
  door.add(new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.02), new THREE.MeshBasicMaterial({ color: '#222222' })));
  door.position.set(0, 0.05, 0.17);
  root.add(door);
  // A tag the learner drags (a game piece): it stays in the 3D.
  const piece = new THREE.Group();
  piece.name = 'movable tag';
  piece.userData.nameTag = true;
  piece.add(new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.02), new THREE.MeshBasicMaterial({ color: '#333333' })));
  piece.position.set(0.1, 0.02, 0.14);
  root.add(piece);
  traits(piece, { grab: true });
  return { root, real: { size: 8 } };
}`;
const CELL = HOUSE.replace("real: { size: 8 }", 'real: undefined');
const RAISED = HOUSE.replace('const root = new THREE.Group();', 'const root = new THREE.Group();\n  root.position.y = 0.1;');

export default async function run({ frame, page }) {
  const target = frame ?? page;
  await target.waitForFunction(() => Boolean(window.genui?.inspectPill && window.IWER_DEVICE?.remote), null, { timeout: 30000 });
  return target.evaluate(async ({ house, cell, raised }) => {
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
    // Whether an object is drawn: it and every group above it visible.
    const drawn = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
    try {
      await genui.mount(house);
      out.pillEarly = genui.inspectPill()?.enabled ?? null;
      await sleep(2500);
      const root = genui.debugRoot();
      const anchor = root.parent;
      const find = (name) => { let f = null; anchor.traverse((o) => { if (!f && o.name === name) f = o; }); return f; };
      const mesh = find('house');
      const card = anchor.getObjectByName('GenUI Cards').getObjectByName('GenUI Panel');
      const V = mesh.position.constructor;
      // Layers: nothing but the 3D (and the pins the cards and tags left) is in root.
      const layers = genui.inspect().layers;
      out.layers = `${layers.cards.join('+')} | ${layers.annotations.join('+')}`;
      let inRoot = 0;
      root.traverse((o) => { if (['GenUI Panel', 'nested card', 'tag', 'door tag'].includes(o.name)) inRoot++; });
      out.panelsInRoot = inRoot;
      let movableInRoot = false;
      root.traverse((o) => { if (o.name === 'movable tag') movableInRoot = true; });
      out.movableTagInRoot = movableInRoot;
      // A tag stays on its spot on the house (0.25 up, 0.16 in front of its centre) at its own size.
      const tagGap = () => { const spot = mesh.localToWorld(new V(0, 0.25, 0.16)); return round(find('tag').getWorldPosition(new V()).distanceTo(spot)); };
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
      const nested = find('nested card');
      const tag = find('tag');
      const worldOf = (o) => { const v = o.getWorldPosition(new V()); return { at: [v.x, v.y, v.z].map(round), scale: round(o.getWorldScale(new V()).x) }; };
      const nestedFit = worldOf(nested);
      const tagFit = worldOf(tag);
      const doorFit = worldOf(find('door tag'));
      out.tagScaleFit = tagFit.scale;
      out.doorScaleFit = doorFit.scale;
      out.tagGapFitM = tagGap();
      out.cardScale = cardFit.scale;
      // The lesson hides the group its nested card is in: the card goes too, and comes back with it.
      find('side').visible = false;
      await sleep(100);
      out.nestedHidesWithGroup = !drawn(nested);
      find('side').visible = true;
      await sleep(100);
      out.nestedShowsWithGroup = drawn(nested);
      // The lesson hides the card itself while its group is hidden, then shows the group: the card stays hidden.
      find('side').visible = false;
      nested.visible = false;
      await sleep(100);
      find('side').visible = true;
      await sleep(100);
      out.ownFlagKept = !drawn(nested);
      nested.visible = true;
      await sleep(100);
      out.ownFlagShows = drawn(nested);
      find('door tag').visible = false;
      await sleep(100);
      out.doorStaysHidden = !drawn(find('door tag'));
      find('door tag').visible = true;
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
      const nestedReal = worldOf(nested);
      out.nestedStayedM = round(Math.hypot(...nestedReal.at.map((v, i) => v - nestedFit.at[i])));
      out.nestedScaleRatio = round(nestedReal.scale / nestedFit.scale);
      out.tagScaleRatio = round(worldOf(tag).scale / tagFit.scale);
      out.doorScaleRatio = round(worldOf(find('door tag')).scale / doorFit.scale);
      out.tagGapRealM = tagGap();

      genui.pressPill();
      await sleep(300);
      out.backToFitM = extent().height;
      out.cardBackM = round(Math.hypot(...cardWorld().at.map((v, i) => v - cardFit.at[i])));
      out.nestedBackRatio = round(worldOf(nested).scale / nestedFit.scale);

      // A lesson that raised its root: at its real size it still stands on the floor.
      await genui.mount(raised);
      await sleep(2500);
      genui.pressPill();
      await sleep(300);
      const raisedMesh = genui.debugRoot().getObjectByName('house');
      raisedMesh.geometry.computeBoundingBox();
      raisedMesh.updateWorldMatrix(true, false);
      out.raisedBottomM = round(raisedMesh.localToWorld(raisedMesh.geometry.boundingBox.min.clone()).y);

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
      layers: out.layers === 'GenUI Panel+nested card | tag+door tag',
      panelsInRoot: out.panelsInRoot === 0,
      movableTagInRoot: out.movableTagInRoot === true,
      doorStaysHidden: out.doorStaysHidden === true,
      tagScaleFit: Math.abs(out.tagScaleFit - 1) < 0.01,
      doorScaleFit: Math.abs(out.doorScaleFit - 1) < 0.01,
      tagGapFitM: out.tagGapFitM < 0.005,
      tagGapRealM: out.tagGapRealM < 0.005,
      doorScaleRatio: Math.abs(out.doorScaleRatio - 1) < 0.01,
      pillEarly: out.pillEarly === false,
      raisedBottomM: Math.abs(out.raisedBottomM) < 0.05,
      ownFlagKept: out.ownFlagKept === true,
      ownFlagShows: out.ownFlagShows === true,
      nestedHidesWithGroup: out.nestedHidesWithGroup === true,
      nestedShowsWithGroup: out.nestedShowsWithGroup === true,
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
      nestedStayedM: out.nestedStayedM < 0.005,
      nestedScaleRatio: Math.abs(out.nestedScaleRatio - 1) < 0.01,
      tagScaleRatio: Math.abs(out.tagScaleRatio - 1) < 0.01,
      nestedBackRatio: Math.abs(out.nestedBackRatio - 1) < 0.01,
      pillSmall: out.pillSmall === 'Scale x250,000',
      pillSmallEnabled: out.pillSmallEnabled === false,
    };
    const failed = Object.entries(expect).filter(([, ok]) => !ok).map(([check]) => `${check} (${JSON.stringify(out[check])})`);
    if (failed.length) throw new Error(`view-smoke failed: ${failed.join(', ')}; measured ${JSON.stringify(out)}`);
    return out;
  }, { house: HOUSE, cell: CELL, raised: RAISED });
}
