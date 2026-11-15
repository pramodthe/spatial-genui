// The lesson frame (src/genui/bounds.ts) in the managed browser's emulated XR session: open a ready-made lesson,
// then with an emulated hand put the index tip on a bottom edge and drag (moves), put it on an upright edge's
// knob and swing (turns), and check a pinch in the air outside the frame, or in the middle of it, does not move it.
// Then point the hand ray at a rod and pinch: a lesson's rod takes it, a game's does not (games take a fingertip
// only), and a game still sees a pinch made in front of its board.
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
    const rods = out.start.handles.filter((h) => h.kind === 'move');
    const front = rods.reduce((a, b) => (b.center[2] > a.center[2] ? b : a));
    // A pinch 12 cm in front of the rod (the fingertip is not on it) leaves the frame alone.
    const outside = { x: front.center[0], y: front.center[1], z: front.center[2] + 0.12 };
    await r.dispatch('run_sequence', { device: hand, steps: [{ anchor: 'index-tip', position: outside }, { pinch: 1, duration: 0.2 }] });
    await sleep(150);
    out.outsideDrag = g.inspectFrame().drag;
    await r.dispatch('run_sequence', { device: hand, steps: [{ anchor: 'index-tip', position: { ...outside, x: outside.x + 0.08 }, duration: 0.25 }, { pinch: 0, duration: 0.1 }] });
    await sleep(200);
    out.outsideMovedM = Math.round(Math.hypot(...g.inspectFrame().anchor.map((v, i) => v - out.start.anchor[i])) * 1000) / 1000;

    // Move: put the index tip on the front bottom rod, pinch, and drag 10 cm to the right.
    await r.dispatch('run_sequence', { device: hand, steps: [{ anchor: 'index-tip', position: at(front.center) }, { pinch: 1, duration: 0.25 }] });
    await sleep(150);
    out.dragging = g.inspectFrame().drag;
    out.nearWhileOn = g.inspectFrame().near;
    for (let i = 1; i <= 5; i++) {
      await r.dispatch('run_sequence', { device: hand, steps: [{ anchor: 'index-tip', position: { x: front.center[0] + i * 0.02, y: front.center[1], z: front.center[2] }, duration: 0.08 }] });
      await sleep(40);
    }
    await r.dispatch('run_sequence', { device: hand, steps: [{ pinch: 0, duration: 0.15 }] });
    await sleep(200);
    const moved = g.inspectFrame();
    out.movedX = Math.round((moved.anchor[0] - out.start.anchor[0]) * 1000) / 1000;

    // Turn: put the index tip on the nearest knob, pinch, and swing it an eighth of a circle about the frame's middle.
    const head = window.IWER_DEVICE.position;
    const toHead = (c) => Math.hypot(c[0] - head.x, c[1] - head.y, c[2] - head.z);
    const knob = moved.handles.filter((h) => h.kind === 'turn').reduce((a, b) => (toHead(b.center) < toHead(a.center) ? b : a));
    const knobAt = { x: knob.center[0], y: knob.center[1], z: knob.center[2] };
    await r.dispatch('run_sequence', { device: hand, steps: [{ anchor: 'index-tip', position: knobAt }, { pinch: 1, duration: 0.25 }] });
    await sleep(150);
    out.turning = g.inspectFrame().drag;
    const mid = moved.anchor;
    const radius = Math.hypot(knobAt.x - mid[0], knobAt.z - mid[2]);
    const a0 = Math.atan2(knobAt.x - mid[0], knobAt.z - mid[2]);
    for (let i = 1; i <= 6; i++) {
      const a = a0 + (i / 6) * (Math.PI / 4);
      await r.dispatch('run_sequence', { device: hand, steps: [{ anchor: 'index-tip', position: { x: mid[0] + Math.sin(a) * radius, y: knobAt.y, z: mid[2] + Math.cos(a) * radius }, duration: 0.08 }] });
      await sleep(40);
    }
    await r.dispatch('run_sequence', { device: hand, steps: [{ pinch: 0, duration: 0.15 }] });
    await sleep(200);
    out.turnedYaw = Math.round((g.inspectFrame().yaw - moved.yaw) * 1000) / 1000;

    // A pinch in the middle of the frame (on the lesson, not a handle) leaves the frame alone.
    const before = g.inspectFrame().anchor;
    await r.dispatch('run_sequence', { device: hand, steps: [{ anchor: 'index-tip', position: at([mid[0], mid[1] + 0.12, mid[2]]) }, { pinch: 1, duration: 0.2 }] });
    out.middleDrag = g.inspectFrame().drag;
    await r.dispatch('run_sequence', { device: hand, steps: [{ anchor: 'index-tip', position: at([mid[0] + 0.08, mid[1] + 0.12, mid[2]]), duration: 0.3 }, { pinch: 0, duration: 0.15 }] });
    await sleep(200);
    out.middleMovedM = Math.round(Math.hypot(...g.inspectFrame().anchor.map((v, i) => v - before[i])) * 1000) / 1000;

    // Pointing: aim the hand ray at the front rod from 30 cm and pinch. A lesson's rod takes it (drag 'move');
    // a game's handles take only a fingertip, so the same pinch leaves the game where it is.
    const rodNow = g.inspectFrame().handles.filter((h) => h.kind === 'move').reduce((a, b) => (b.center[2] > a.center[2] ? b : a));
    await r.dispatch('set_transform', { device: hand, position: { x: rodNow.center[0] + 0.05, y: rodNow.center[1] + 0.15, z: rodNow.center[2] + 0.25 } });
    await r.dispatch('look_at', { device: hand, target: at(rodNow.center) });
    await sleep(200);
    await r.dispatch('run_sequence', { device: hand, steps: [{ pinch: 1, duration: 0.25 }] });
    await sleep(150);
    out.pointedDrag = g.inspectFrame().drag;
    await r.dispatch('run_sequence', { device: hand, steps: [{ pinch: 0, duration: 0.15 }] });
    await sleep(200);

    // A game sees a pinch made in front of its board, where the player's hand is (15 cm off the near edge).
    if (useGame) {
      await r.dispatch('run_sequence', { device: hand, steps: [{ anchor: 'index-tip', position: { x: rodNow.center[0], y: rodNow.center[1] + 0.12, z: rodNow.center[2] + 0.15 } }] });
      await sleep(200);
      let seen = false;
      r.dispatch('run_sequence', { device: hand, steps: [{ pinch: 1, duration: 0.2 }] });
      for (let i = 0; i < 10; i++) { await sleep(40); if (g.debugHands().right.pinching) seen = true; }
      await r.dispatch('run_sequence', { device: hand, steps: [{ pinch: 0, duration: 0.1 }] });
      out.gameSeesFrontPinch = seen;
    }
    await r.dispatch('set_transform', { device: hand, position: { x: 0.35, y: 0.9, z: 0.1 } });
    return out;
  }, Boolean(process.env.FRAME_GAME));
}
