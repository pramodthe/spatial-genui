// The lesson frame (src/genui/bounds.ts) in the managed browser's emulated XR session: open a ready-made lesson,
// then with an emulated hand pinch a bottom edge and drag (moves), pinch an upright edge's knob and swing (turns),
// and check a pinch inside the frame does not move it.
// A game's frame has the same move and turn handles (no lines or corners), outside its playfield.
// Usage: [FRAME_GAME=1] npx @iwsdk/cli browser run tests/frame-smoke.mjs --timeout 100000

export default async function run({ frame, page }) {
  const target = frame ?? page;
  await target.waitForFunction(() => Boolean(window.genui?.inspectFrame), null, { timeout: 30000 });
  return target.evaluate(async (useGame) => {
    const g = window.genui;
    const r = window.IWER_DEVICE.remote;
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const hand = 'hand-right';
    const at = (c) => ({ x: c[0], y: c[1], z: c[2] });
    try { await r.dispatch('accept_session'); } catch { /* already in XR */ }
    await r.dispatch('set_input_mode', { mode: 'hand' });
    await r.dispatch('set_transform', { device: 'headset', position: { x: 0, y: 1.3, z: 0 }, orientation: { x: -0.1736, y: 0, z: 0, w: 0.9848 } });
    await r.dispatch('set_transform', { device: hand, position: { x: 0.35, y: 0.9, z: 0.1 } });
    localStorage.removeItem('genui.lessonSpot.v1');
    if (useGame) {
      g.courses.section('play');
      await g.courses.exampleGame(0);
    } else {
      g.courses.section('learn');
      await g.startLesson('Teach me the parts of a microscope and what each part does.');
    }
    await sleep(4000);
    const out = { kind: g.state.kind, mount: g.state.lastMount?.ok, start: g.inspectFrame() };
    if (!out.start) return { ...out, error: 'No frame' };
    out.handles = out.start.handles.length;

    // Hand far away: the frame is faint. Near: it brightens.
    out.farNear = out.start.near;
    // Move: point the hand ray at the front bottom edge's rod from 30 cm, pinch, and drag 10 cm to the right.
    const rods = out.start.handles.filter((h) => h.kind === 'move');
    const front = rods.reduce((a, b) => (b.center[2] > a.center[2] ? b : a));
    const from = { x: front.center[0] + 0.05, y: front.center[1] + 0.15, z: front.center[2] + 0.25 };
    await r.dispatch('set_transform', { device: hand, position: from });
    await r.dispatch('look_at', { device: hand, target: at(front.center) });
    await sleep(200);
    out.rodHovered = g.inspectFrame().handles.some((h) => h.kind === 'move' && h.hovered);
    await r.dispatch('run_sequence', { device: hand, steps: [{ pinch: 1, duration: 0.25 }] });
    await sleep(150);
    out.dragging = g.inspectFrame().drag;
    out.nearWhileOn = g.inspectFrame().near;
    for (let i = 1; i <= 5; i++) {
      await r.dispatch('set_transform', { device: hand, position: { ...from, x: from.x + i * 0.02 } });
      await sleep(60);
    }
    await r.dispatch('run_sequence', { device: hand, steps: [{ pinch: 0, duration: 0.15 }] });
    await sleep(200);
    const moved = g.inspectFrame();
    out.movedX = Math.round((moved.anchor[0] - out.start.anchor[0]) * 1000) / 1000;

    // Turn: point at a front knob, pinch, and swing the hand an eighth of a circle about the frame's middle.
    const head = window.IWER_DEVICE.position;
    const toHead = (c) => Math.hypot(c[0] - head.x, c[1] - head.y, c[2] - head.z);
    const knob = moved.handles.filter((h) => h.kind === 'turn').reduce((a, b) => (toHead(b.center) < toHead(a.center) ? b : a));
    // From outside the frame, along the line from its middle through the knob (as a hand reaching for it would).
    const out2 = [knob.center[0] - moved.anchor[0], knob.center[2] - moved.anchor[2]];
    const len2 = Math.hypot(...out2) || 1;
    const knobFrom = { x: knob.center[0] + (out2[0] / len2) * 0.2, y: knob.center[1] + 0.1, z: knob.center[2] + (out2[1] / len2) * 0.2 };
    await r.dispatch('set_transform', { device: hand, position: knobFrom });
    await r.dispatch('look_at', { device: hand, target: at(knob.center) });
    await sleep(200);
    out.knobHovered = g.inspectFrame().handles.some((h) => h.kind === 'turn' && h.hovered);
    await r.dispatch('run_sequence', { device: hand, steps: [{ pinch: 1, duration: 0.25 }] });
    await sleep(150);
    out.turning = g.inspectFrame().drag;
    const mid = moved.anchor;
    const radius = Math.hypot(knobFrom.x - mid[0], knobFrom.z - mid[2]);
    const a0 = Math.atan2(knobFrom.x - mid[0], knobFrom.z - mid[2]);
    for (let i = 1; i <= 6; i++) {
      const a = a0 + (i / 6) * (Math.PI / 4);
      await r.dispatch('set_transform', { device: hand, position: { x: mid[0] + Math.sin(a) * radius, y: knobFrom.y, z: mid[2] + Math.cos(a) * radius } });
      await sleep(60);
    }
    await r.dispatch('run_sequence', { device: hand, steps: [{ pinch: 0, duration: 0.15 }] });
    await sleep(200);
    out.turnedYaw = Math.round((g.inspectFrame().yaw - moved.yaw) * 1000) / 1000;

    // A pinch in the middle of the frame (on the lesson, not a handle) leaves the frame alone.
    const before = g.inspectFrame().anchor;
    await r.dispatch('run_sequence', { device: hand, steps: [{ anchor: 'grasp', position: at([mid[0], mid[1] + 0.12, mid[2]]) }, { pinch: 1, duration: 0.2 }] });
    out.middleDrag = g.inspectFrame().drag;
    await r.dispatch('run_sequence', { device: hand, steps: [{ anchor: 'grasp', position: at([mid[0] + 0.08, mid[1] + 0.12, mid[2]]), duration: 0.3 }, { pinch: 0, duration: 0.15 }] });
    await sleep(200);
    out.middleMovedM = Math.round(Math.hypot(...g.inspectFrame().anchor.map((v, i) => v - before[i])) * 1000) / 1000;
    await r.dispatch('set_transform', { device: hand, position: { x: 0.35, y: 0.9, z: 0.1 } });
    return out;
  }, Boolean(process.env.FRAME_GAME));
}
