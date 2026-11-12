// Mount tests/fixtures/rig-demo.js (a heart lesson that cycles through every teaching-rig state on
// a timer) and screenshot each state. Needs the agent server running for /api/library.
// Usage: RIG_SHOTS_DIR=/abs/dir npx @iwsdk/cli browser run tests/rig-demo.mjs --timeout 90000
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const STATES = [['assembled', 1.5], ['explode', 5.2], ['cutaway', 7.5], ['xray', 10.5], ['reset', 13.5]];

export default async function run({ frame, page }) {
  const target = frame ?? page;
  const out = process.env.RIG_SHOTS_DIR;
  if (!out) return { error: 'Set RIG_SHOTS_DIR to an absolute folder for the screenshots.' };
  await mkdir(out, { recursive: true });
  const code = await readFile(new URL('./fixtures/rig-demo.js', import.meta.url), 'utf8');
  await target.waitForFunction(() => Boolean(window.genui), null, { timeout: 30000 });
  const report = await target.evaluate((c) => window.genui.mount(c), code);
  if (!report.ok) return { report };
  await target.evaluate(() => window.genui.setOverlayHidden?.(true));
  const started = Date.now();
  const shots = [];
  for (const [name, at] of STATES) {
    const wait = at * 1000 - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const path = join(out, `${name}.png`);
    await page.screenshot({ path });
    shots.push(path);
  }
  const errors = await target.evaluate(() => window.genui.state.runtimeErrors);
  await target.evaluate(() => window.genui.setOverlayHidden?.(false));
  return { report, runtimeErrors: errors, shots };
}
