// The Play section (games.ts) of the in-headset picker, in the managed browser's emulated XR session.
// Usage: npx @iwsdk/cli browser run tests/play-smoke.mjs --timeout 105000
//   PLAY_STEP=inspect  (default) switch the picker to Play and report what it shows
//   PLAY_STEP=game     open the newest ready saved game, as a pinch on its row would, and report the mount
//   PLAY_STEP=learn    switch back to Learn
// Each step enters the emulated XR session first (the picker only shows in XR).

export default async function run({ frame, page }) {
  const target = frame ?? page;
  await target.waitForFunction(() => Boolean(window.genui?.inspectPicker), null, { timeout: 30000 });
  const step = process.env.PLAY_STEP || 'inspect';
  return target.evaluate(async (step) => {
    const genui = window.genui;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const r = window.IWER_DEVICE.remote;
    try { await r.dispatch('accept_session'); } catch { /* already in XR */ }
    await r.dispatch('set_transform', { device: 'headset', position: { x: 0, y: 1.3, z: 0 }, orientation: { x: -0.1736, y: 0, z: 0, w: 0.9848 } });
    await sleep(1500);
    if (step === 'learn') {
      genui.courses.section('learn');
      await sleep(300);
      return { picker: genui.inspectPicker() };
    }
    genui.courses.section('play');
    await genui.courses.refresh();
    if (step === 'game') {
      const index = genui.inspectPicker().games.findIndex((g) => g.status === 'ready');
      if (index < 0) return { error: 'No ready saved game. Ask for one: POST /api/games { "prompt": "..." }' };
      await genui.courses.game(index);
      await sleep(3000);
      return {
        opened: genui.inspectPicker().games[index],
        kind: genui.state.kind,
        mount: genui.state.lastMount?.ok,
        runtimeErrors: genui.state.runtimeErrors,
        pill: genui.inspectPill(),
        picker: genui.inspectPicker(),
      };
    }
    await sleep(300);
    return { picker: genui.inspectPicker() };
  }, step);
}
