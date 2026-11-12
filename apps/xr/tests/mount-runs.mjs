// Mount a list of logged runs one after another and record what the browser host reports.
// Usage: GENUI_RUN_IDS="id1,id2,…" [GENUI_KEEP=1 keeps the last scene] npx @iwsdk/cli browser run tests/mount-runs.mjs --timeout 100000

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const RUNS_DIR = new URL('../../server/runs/', import.meta.url).pathname;

async function loadRuns(ids) {
  const wanted = new Set(ids);
  const found = new Map();
  for (const file of (await readdir(RUNS_DIR)).filter((f) => f.endsWith('.jsonl'))) {
    for (const line of (await readFile(join(RUNS_DIR, file), 'utf8')).trim().split('\n')) {
      const run = JSON.parse(line);
      if (wanted.has(run.id)) found.set(run.id, run);
    }
  }
  return ids.map((id) => found.get(id) ?? { id, missing: true });
}

export default async function run({ frame, page }) {
  const target = frame ?? page;
  const ids = (process.env.GENUI_RUN_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return { error: 'Set GENUI_RUN_IDS to a comma-separated list of run ids.' };
  await target.waitForFunction(() => Boolean(window.genui), null, { timeout: 30000 });

  const results = [];
  for (const r of await loadRuns(ids)) {
    if (r.missing || !r.code) {
      results.push({ id: r.id, mounted: false, error: r.missing ? 'run not found' : 'run has no code' });
      continue;
    }
    const outcome = await target.evaluate(async (code) => {
      const report = await window.genui.mount(code);
      await new Promise((res) => setTimeout(res, 2500)); // panels load, update() runs for a while
      return { report, runtimeErrors: [...window.genui.state.runtimeErrors] };
    }, r.code);
    results.push({ id: r.id, prompt: r.prompt.slice(0, 60), mounted: outcome.report.ok, ...outcome });
  }
  if (!process.env.GENUI_KEEP) await target.evaluate(() => window.genui.clear());
  return {
    total: results.length,
    mountedClean: results.filter((x) => x.mounted && x.runtimeErrors?.length === 0).length,
    results,
  };
}
