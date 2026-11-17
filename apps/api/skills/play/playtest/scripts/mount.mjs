// Runs inside Meta's managed browser (`iwsdk browser run`, copied into the app's workspace by playtest.mjs): opens the
// module the way the headset does, in XR with hands, the emulated headset looking at it, and reports what the app sees.
import { readFile } from 'node:fs/promises';

export default async function run({ frame, page }) {
  const t = frame ?? page;
  await t.waitForFunction(() => Boolean(window.genui && window.IWER_DEVICE), null, { timeout: 60000 });
  const code = await readFile(process.env.PLAYTEST_MODULE || '/work/module.js', 'utf8');
  const kind = process.env.PLAYTEST_KIND === 'game' ? 'game' : 'lesson';
  return t.evaluate(async ({ code, kind }) => {
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const r = window.IWER_DEVICE.remote;
    try { await r.dispatch('accept_session'); } catch { /* already in XR */ }
    await r.dispatch('set_input_mode', { mode: 'hand' });
    // A seated learner looking at the desk in front of them; the lesson is placed where they look.
    await r.dispatch('set_transform', { device: 'headset', position: { x: 0, y: 1.35, z: 0 } });
    await r.dispatch('look_at', { device: 'headset', target: { x: 0, y: 0.9, z: -0.6 } });
    for (const hand of ['hand-left', 'hand-right']) await r.dispatch('set_transform', { device: hand, position: { x: hand === 'hand-left' ? -0.3 : 0.3, y: 0.8, z: 0.1 } });
    window.genui.setOverlayHidden(true);
    await window.genui.clear();
    await wait(300);
    await window.genui.openWritten(code, 'play-test', kind);
    // The app shows a game's name as a title card for its first 3.3 s: the picture is taken after it.
    await wait(kind === 'game' ? 3800 : 2500);
    const frameInfo = window.genui.inspectFrame?.();
    // A world is around the player: they stand where they start and look ahead (the world was placed there).
    const world = Boolean(window.genui.inspect?.()?.world);
    if (world) {
      // The world's start spot is where the headset stood when it opened (x 0, z 0): stand up and look ahead.
      await r.dispatch('set_transform', { device: 'headset', position: { x: 0, y: 1.6, z: 0 } });
      await r.dispatch('look_at', { device: 'headset', target: { x: 0, y: 1.4, z: -3 } });
      await wait(400);
    } else if (frameInfo?.anchor) {
      // Lean in: about 55 cm from the game, 40 cm above it, on the side the learner sits, looking at it.
      const [x, y, z] = frameInfo.anchor;
      const dx = 0 - x;
      const dz = 0 - z;
      const d = Math.hypot(dx, dz) || 1;
      await r.dispatch('set_transform', { device: 'headset', position: { x: x + (dx / d) * 0.55, y: y + 0.4, z: z + (dz / d) * 0.55 } });
      await r.dispatch('look_at', { device: 'headset', target: { x, y: y + 0.06, z } });
      await wait(400);
    }
    const state = window.genui.state;
    const seen = window.genui.inspect() || {};
    const round = (v) => v.map((n) => Math.round(n * 1000) / 1000);
    return {
      mounted: !state.error,
      error: state.error ?? null,
      grabbables: (seen.grabbables || []).map((g) => ({ name: g.name, center: round(g.center) })),
      pressables: (seen.pressables || []).map((p) => ({ name: p.name, center: round(p.center) })),
      panelButtons: (seen.panelButtons || []).map((b) => ({ id: b.id, center: round(b.center) })),
      lessonAt: frameInfo?.anchor ? round(frameInfo.anchor) : null,
    };
  }, { code, kind });
}
