// Mount the most recent successful generation logged by the agent server (apps/server/runs/*.jsonl).
// Useful when generation takes longer than a browser-run lease: generate with `npm run gen` in
// apps/server, then: npx @iwsdk/cli browser run tests/mount-last-run.mjs

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const RUNS_DIR = new URL('../../server/runs/', import.meta.url).pathname;

async function lastSuccessfulRun() {
  const files = (await readdir(RUNS_DIR)).filter((f) => f.endsWith('.jsonl')).sort();
  for (const file of files.reverse()) {
    const lines = (await readFile(join(RUNS_DIR, file), 'utf8')).trim().split('\n').reverse();
    for (const line of lines) {
      const run = JSON.parse(line);
      if (run.ok && run.code) return run;
    }
  }
  return null;
}

export default async function run({ frame, page }) {
  const target = frame ?? page;
  const last = await lastSuccessfulRun();
  if (!last) return { error: `No successful run in ${RUNS_DIR}` };
  await target.waitForFunction(() => Boolean(window.genui), null, { timeout: 30000 });
  const result = await target.evaluate(async (code) => {
    const report = await window.genui.mount(code);
    await new Promise((r) => setTimeout(r, 2000)); // let panels load
    return { report, runtimeErrors: window.genui.state.runtimeErrors };
  }, last.code);
  return { id: last.id, prompt: last.prompt, model: last.model, ...result };
}
