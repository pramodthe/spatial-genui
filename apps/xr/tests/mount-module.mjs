// Mount module files (e.g. lessons compiled from A2UI or a template) one after another and record what
// the browser host reports: mount result, runtime errors after the panels load, and what is pressable.
// Usage: GENUI_MODULES="/path/a.js,/path/b.js" [GENUI_KEEP=1 keeps the last scene] npx @iwsdk/cli browser run tests/mount-module.mjs --timeout 100000

import { readFile } from 'node:fs/promises';

export default async function run({ frame, page }) {
  const target = frame ?? page;
  const files = (process.env.GENUI_MODULES || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (files.length === 0) return { error: 'Set GENUI_MODULES to a comma-separated list of module files.' };
  await target.waitForFunction(() => Boolean(window.genui), null, { timeout: 30000 });

  const results = [];
  for (const file of files) {
    const code = await readFile(file, 'utf8');
    const outcome = await target.evaluate(async (code) => {
      const report = await window.genui.mount(code);
      await new Promise((res) => setTimeout(res, 2500)); // panels load, update() runs for a while
      const inspection = window.genui.inspect();
      return {
        report,
        runtimeErrors: [...window.genui.state.runtimeErrors],
        panels: inspection && `${inspection.panelsLoaded}/${inspection.panels}`,
        panelButtons: inspection?.panelButtons.map((b) => b.id),
        pressables: inspection?.pressables.map((p) => p.name),
        grabbables: inspection?.grabbables.map((g) => g.name),
      };
    }, code);
    results.push({ file: file.split('/').pop(), mounted: outcome.report.ok, ...outcome });
  }
  if (!process.env.GENUI_KEEP) await target.evaluate(() => window.genui.clear());
  return results;
}
