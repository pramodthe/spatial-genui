// The headset dashboard (src/genui/picker.ts), in the managed browser's emulated XR session: it stands in front
// of the player with its cards; picking a card opens the game and folds the dashboard into its small bar;
// Home closes the game and brings the dashboard back. Returns the measurements; fails (throws) listing any check
// that didn't hold.
// Usage: npx @iwsdk/cli browser run tests/dashboard-smoke.mjs --timeout 100000

export default async function run({ frame, page }) {
  const target = frame ?? page;
  await target.waitForFunction(() => Boolean(window.genui?.inspectPicker && window.IWER_DEVICE?.remote), null, { timeout: 30000 });
  return target.evaluate(async () => {
    const genui = window.genui;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (test, ms = 20000) => { for (let waited = 0; waited < ms && !test(); waited += 250) await sleep(250); return test(); };
    const r = window.IWER_DEVICE.remote;
    try { await r.dispatch('accept_session'); } catch { /* already in XR */ }
    await r.dispatch('set_transform', { device: 'headset', position: { x: 0, y: 1.6, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } });
    genui.courses.home(); // whatever an earlier script left open
    await genui.courses.refresh();
    const out = {};
    // Home: in front of the player, a metre away, with the ready-made cards and their pictures.
    out.placed = await until(() => { const p = genui.inspectPicker(); return p.loaded && p.visible && !p.folded && p.position[2] < -0.5; });
    const home = genui.inspectPicker();
    out.position = home.position;
    out.ready = home.ready.length;
    out.readyPictures = home.ready.filter((card) => card.picture).length;
    out.mine = home.mine.map((card) => `${card.title}: ${card.state}`);
    // A ready-made game: it opens, and only the bar is left.
    await genui.courses.open('ready', 0);
    out.gameOpened = await until(() => genui.inspectPicker().folded && genui.state.lastMount?.ok === true);
    out.gameKind = genui.state.kind;
    out.barPosition = genui.inspectPicker().position;
    out.runtimeErrors = genui.state.runtimeErrors;
    // Home: the game is gone and the dashboard is back.
    genui.courses.home();
    out.homeAgain = await until(() => { const p = genui.inspectPicker(); return !p.folded && p.phase === 'idle' && genui.inspect() === null; });
    // A ready-made lesson opens the same way.
    const lesson = home.ready.findIndex((card) => card.key.startsWith('example-lesson-'));
    await genui.courses.open('ready', lesson);
    out.lessonOpened = await until(() => genui.inspectPicker().folded && genui.state.kind === 'lesson' && genui.state.lastMount?.ok === true);
    genui.courses.home();
    out.homeAtEnd = await until(() => !genui.inspectPicker().folded && genui.inspect() === null);

    const expect = {
      placed: out.placed === true,
      ready: out.ready === 8,
      readyPictures: out.readyPictures === 8,
      gameOpened: out.gameOpened === true,
      gameKind: out.gameKind === 'game',
      runtimeErrors: out.runtimeErrors.length === 0,
      homeAgain: out.homeAgain === true,
      lessonOpened: out.lessonOpened === true,
      homeAtEnd: out.homeAtEnd === true,
    };
    const failed = Object.entries(expect).filter(([, ok]) => !ok).map(([check]) => `${check} (${JSON.stringify(out[check])})`);
    if (failed.length) throw new Error(`dashboard-smoke failed: ${failed.join(', ')}; measured ${JSON.stringify(out)}`);
    return out;
  });
}
