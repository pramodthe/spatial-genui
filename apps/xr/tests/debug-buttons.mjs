// Debug blocked panel presses: mount a module, wait for the lesson layout, press its first buttons
// with the emulated right hand (like tests/bench-browser.mjs) and list what the hand's ray passes
// through. Usage: DEBUG_CODE=/abs/module.js npx @iwsdk/cli browser run tests/debug-buttons.mjs --timeout 90000
import { readFile } from 'node:fs/promises';

export default async function run({ frame, page }) {
  const target = frame ?? page;
  const code = await readFile(process.env.DEBUG_CODE, 'utf8');
  await target.waitForFunction(() => Boolean(window.genui?.inspect && window.IWER_DEVICE?.remote), null, { timeout: 30000 });
  return await target.evaluate(async (c) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await window.genui.mount(c);
    for (let i = 0; i < 40 && !window.genui.inspect()?.layoutSettled; i++) await sleep(250);
    await sleep(500);
    const r = window.IWER_DEVICE.remote;
    const hand = 'hand-right';
    const results = [];
    for (const id of [...new Set(window.genui.inspect().panelButtons.map((b) => b.id))].slice(0, 3)) {
      const b = window.genui.inspect().panelButtons.find((x) => x.id === id);
      const c = b.center;
      const head = window.IWER_DEVICE.position;
      const d = [head.x - c[0], head.y - c[1], head.z - c[2]];
      const len = Math.hypot(...d) || 1;
      const from = [c[0] + (d[0] / len) * 0.3 + 0.05, c[1] + (d[1] / len) * 0.3 - 0.05, c[2] + (d[2] / len) * 0.3];
      await r.dispatch('set_transform', { device: hand, position: { x: from[0], y: from[1], z: from[2] } });
      await r.dispatch('look_at', { device: hand, target: { x: c[0], y: c[1], z: c[2] } });
      const before = window.genui.inspect().handlerCalls;
      await r.dispatch('select', { device: hand, duration: 0.2 });
      await sleep(300);
      results.push({ id, center: c.map((x) => +x.toFixed(3)), worked: window.genui.inspect().handlerCalls > before, hits: window.genui.debugRay(from, c) });
    }
    return results;
  }, code);
}
