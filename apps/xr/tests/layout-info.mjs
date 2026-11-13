// Mount one module as the benchmark does (XR session, hands, head 1.3 m high looking 20 degrees
// down) and return the lesson layout's decision from genui.inspect().layout.
// Usage: DEBUG_CODE=/abs/module.js npx @iwsdk/cli browser run tests/layout-info.mjs --timeout 60000
import { readFile } from 'node:fs/promises';

const HEAD = { position: { x: 0, y: 1.3, z: 0 }, orientation: { x: -0.1736, y: 0, z: 0, w: 0.9848 } };

export default async function run({ frame, page }) {
  const target = frame ?? page;
  const code = await readFile(process.env.DEBUG_CODE, 'utf8');
  await target.waitForFunction(() => Boolean(window.genui?.inspect && window.IWER_DEVICE?.remote), null, { timeout: 30000 });
  return await target.evaluate(async ({ code, head }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const r = window.IWER_DEVICE.remote;
    try { await r.dispatch('accept_session'); } catch { /* already in XR */ }
    await r.dispatch('set_transform', { device: 'headset', ...head });
    await window.genui.mount(code);
    for (let i = 0; i < 60 && !window.genui.inspect()?.layoutSettled; i++) await sleep(250);
    const info = window.genui.inspect();
    window.genui.clear();
    return info?.layout ?? null;
  }, { code, head: HEAD });
}
