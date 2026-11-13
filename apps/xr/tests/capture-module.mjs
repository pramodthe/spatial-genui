// Mount a module file and save pictures of it from a virtual camera (src/genui/capture.ts): large, with a
// fixed framing, and without the emulator's wide field of view. For reviewing how generated lessons look.
// Usage: GENUI_MODULE=/abs/lesson.js GENUI_OUT=/abs/prefix [GENUI_VIEWS='[{"name":"hero"},{"name":"all","subject":"all","azimuth":0,"elevation":8}]']
//        [GENUI_WAIT_MS=4000] npx @iwsdk/cli browser run tests/capture-module.mjs --timeout 90000
// Without GENUI_MODULE it captures whatever is mounted.
import { readFile, writeFile } from 'node:fs/promises';

export default async function run({ frame, page }) {
  const target = frame ?? page;
  await target.waitForFunction(() => Boolean(window.genui?.capture), null, { timeout: 30000 });
  const out = process.env.GENUI_OUT;
  if (!out) return { error: 'Set GENUI_OUT to a file prefix.' };
  const views = JSON.parse(process.env.GENUI_VIEWS || '[{"name":"hero"},{"name":"all","subject":"all","azimuth":0,"elevation":8}]');
  let report = null;
  if (process.env.GENUI_MODULE) {
    const code = await readFile(process.env.GENUI_MODULE, 'utf8');
    report = await target.evaluate(async ([code, waitMs]) => {
      const mounted = await window.genui.mount(code);
      await new Promise((res) => setTimeout(res, waitMs)); // panels load and textures paint
      return { mounted, runtimeErrors: [...window.genui.state.runtimeErrors] };
    }, [code, Number(process.env.GENUI_WAIT_MS || 4000)]);
  }
  const files = [];
  for (const view of views) {
    const dataUrl = await target.evaluate((options) => window.genui.capture(options), view);
    if (!dataUrl) { files.push({ view: view.name, error: 'nothing to capture' }); continue; }
    const file = `${out}-${view.name}.jpg`;
    await writeFile(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
    files.push({ view: view.name, file });
  }
  return { report, files };
}
