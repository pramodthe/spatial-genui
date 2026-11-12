// Phase 2 benchmark, browser stage: mount each successful generation from <dir>/results.jsonl in
// the emulator (XR session, hands), screenshot it, and probe interaction with an emulated hand:
// grab one grabbable object and press one pressable object. Appends to <dir>/browser.jsonl and
// resumes, so it can run in batches within the managed-browser time limit.
// Usage: GENUI_BENCH_DIR=/abs/bench/results/<name> [GENUI_LIMIT=10] npx @iwsdk/cli browser run tests/bench-browser.mjs --timeout 100000
// (scripts/bench-browser.mjs loops this until every row is done.)

import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const HEAD = { position: { x: 0, y: 1.3, z: 0 }, orientation: { x: -0.1736, y: 0, z: 0, w: 0.9848 } }; // 20° down
const key = (r) => `${r.model}|${r.promptId}|${r.rep}`;

async function readJsonl(file) {
  if (!existsSync(file)) return [];
  return (await readFile(file, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

export default async function run({ frame, page }) {
  const target = frame ?? page;
  const dir = process.env.GENUI_BENCH_DIR;
  if (!dir) return { error: 'Set GENUI_BENCH_DIR to a benchmark results directory.' };
  const limit = Number(process.env.GENUI_LIMIT || 10);
  const deadline = Date.now() + Number(process.env.GENUI_BUDGET_MS || 90000);

  // A scene is done once it has a real result, or after two harness errors (retry transient
  // glitches once, but don't loop forever on a scene the harness can't handle).
  const previous = await readJsonl(join(dir, 'browser.jsonl'));
  const harnessErrors = new Map();
  for (const r of previous.filter((r) => r.harnessError)) harnessErrors.set(key(r), (harnessErrors.get(key(r)) ?? 0) + 1);
  const done = new Set([
    ...previous.filter((r) => !r.harnessError).map(key),
    ...[...harnessErrors].filter(([, n]) => n >= 2).map(([k]) => k),
  ]);
  const todo = (await readJsonl(join(dir, 'results.jsonl'))).filter((r) => r.ok && r.code && !done.has(key(r)));
  await mkdir(join(dir, 'shots'), { recursive: true });
  await target.waitForFunction(() => Boolean(window.genui?.inspect && window.IWER_DEVICE?.remote), null, { timeout: 30000 });
  await target.evaluate(async () => {
    const r = window.IWER_DEVICE.remote;
    try { await r.dispatch('accept_session'); } catch { /* already in XR */ }
    await r.dispatch('set_input_mode', { mode: 'hand' });
    window.genui.setOverlayHidden(true);
  });

  let processed = 0;
  try {
  for (const row of todo.slice(0, limit)) {
    if (Date.now() > deadline) break;
    const shot = `shots/${row.model}__${row.promptId}__${row.rep}.png`;
    // A harness failure (dispatch, mount call, screenshot) is recorded for this row and the batch
    // moves on; reports ignore such rows instead of blaming the model.
    let outcome;
    let probes;
    try {
    outcome = await target.evaluate(async ({ code, head }) => {
      const r = window.IWER_DEVICE.remote;
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      const hand = 'hand-right';
      const park = async () => {
        await r.dispatch('run_sequence', { device: hand, steps: [{ pinch: 0, duration: 0.1 }] });
        await r.dispatch('set_transform', { device: hand, position: { x: 0.35, y: 0.9, z: 0.1 } });
      };
      await park();
      await r.dispatch('set_transform', { device: 'headset', ...head });
      const report = await window.genui.mount(code);
      await sleep(2500); // panels load, update() runs
      const runtimeErrors = [...window.genui.state.runtimeErrors];
      const info = window.genui.inspect();
      return { report, runtimeErrors, info };
    }, { code: row.code, head: HEAD });

    // Screenshot of the app view (emulator chrome included, our overlay hidden).
    // GENUI_KEEP_SHOTS=1 re-probes a run without replacing the screenshots its judge scores refer to.
    const keepShot = process.env.GENUI_KEEP_SHOTS && existsSync(join(dir, shot));
    const element = keepShot || target === page ? null : await target.frameElement();
    // CSS-pixel scale keeps images ~1200 px wide: enough for the judge, a quarter of the tokens.
    if (keepShot) { /* keep the judged screenshot */ }
    else if (element) await element.screenshot({ path: join(dir, shot), scale: 'css' });
    else await page.screenshot({ path: join(dir, shot), scale: 'css' });

    probes = await target.evaluate(async () => {
      const r = window.IWER_DEVICE.remote;
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      const hand = 'hand-right';
      const info = window.genui.inspect();
      const result = { grab: { tested: false }, press: { tested: false }, panelPress: { tested: 0, worked: 0, buttons: [] } };
      if (!info) return result;
      const at = (c) => ({ x: c[0], y: c[1], z: c[2] });
      const aimFromNear = async (c) => {
        await r.dispatch('set_transform', { device: hand, position: { x: c[0] + 0.12, y: c[1] - 0.08, z: c[2] + 0.3 } });
        await r.dispatch('look_at', { device: hand, target: at(c) });
      };

      // Order matters: after a grab, the emulated hand's ray stops delivering clicks (the grab keeps
      // the hand's pointer), so test panel buttons and 3D presses on the fresh scene and grab last.
      // Panel buttons: complex UIs are driven by them (Next, Add to cart, Confirm). Point the hand ray
      // at up to 3 different buttons from the user's side and pinch; success = the generated handler ran.
      const head = window.IWER_DEVICE.position;
      const tried = [];
      for (const id of [...new Set(window.genui.inspect().panelButtons.map((b) => b.id))].slice(0, 3)) {
        const b = window.genui.inspect().panelButtons.find((x) => x.id === id); // re-read: earlier presses may move things
        if (!b) continue;
        const c = b.center;
        const d = [head.x - c[0], head.y - c[1], head.z - c[2]];
        const len = Math.hypot(...d) || 1;
        await r.dispatch('set_transform', { device: hand, position: { x: c[0] + (d[0] / len) * 0.3 + 0.05, y: c[1] + (d[1] / len) * 0.3 - 0.05, z: c[2] + (d[2] / len) * 0.3 } });
        await r.dispatch('look_at', { device: hand, target: at(c) });
        const calls = window.genui.inspect().handlerCalls;
        await r.dispatch('select', { device: hand, duration: 0.2 });
        await sleep(250);
        // Size (cm) lets us tell tiny targets from blocked ones when a press fails.
        tried.push({ id, worked: window.genui.inspect().handlerCalls > calls, sizeCm: b.size ? [Math.round(b.size[0] * 1000) / 10, Math.round(b.size[1] * 1000) / 10] : null });
      }
      result.panelPress = { tested: tried.length, worked: tried.filter((t) => t.worked).length, buttons: tried };
      await r.dispatch('set_transform', { device: hand, position: { x: 0.35, y: 0.9, z: 0.1 } });
      // Press: like a person would, first point the hand ray and pinch-select; if something else is
      // in the way, reach out and pinch the object itself. Success = a generated handler ran.
      const p = window.genui.inspect().pressables[0]; // re-read: the grab test may have moved things
      if (p) {
        let calls = window.genui.inspect().handlerCalls;
        await aimFromNear(p.center);
        await r.dispatch('select', { device: hand, duration: 0.2 });
        await sleep(200);
        let via = window.genui.inspect().handlerCalls > calls ? 'ray' : null;
        if (!via) {
          calls = window.genui.inspect().handlerCalls;
          await r.dispatch('run_sequence', {
            device: hand,
            steps: [{ anchor: 'grasp', position: at(p.center) }, { pinch: 1, duration: 0.2 }, { pinch: 0, duration: 0.1 }],
          });
          await sleep(200);
          if (window.genui.inspect().handlerCalls > calls) via = 'touch';
        }
        result.press = { tested: true, name: p.name, fired: via !== null, via };
        await r.dispatch('set_transform', { device: hand, position: { x: 0.35, y: 0.9, z: 0.1 } });
      }

      // Grab: prefer a touch-grab object (near pinch); ray-grab objects are aimed at and pinched.
      const grabbables = window.genui.inspect().grabbables; // re-read: panel presses may have moved things
      const gIndex = Math.max(0, grabbables.findIndex((g) => g.mode === 'touch'));
      const g = grabbables[gIndex];
      if (g) {
        if (g.mode === 'touch') {
          await r.dispatch('run_sequence', { device: hand, steps: [{ anchor: 'grasp', position: at(g.center) }, { pinch: 1, duration: 0.3 }] });
        } else {
          await aimFromNear(g.center);
          await r.dispatch('run_sequence', { device: hand, steps: [{ pinch: 1, duration: 0.3 }] });
        }
        await sleep(150);
        result.grab = { tested: true, mode: g.mode, name: g.name, held: window.genui.inspect().grabbables[gIndex]?.held ?? false };
        await r.dispatch('run_sequence', { device: hand, steps: [{ pinch: 0, duration: 0.15 }] });
        await r.dispatch('set_transform', { device: hand, position: { x: 0.35, y: 0.9, z: 0.1 } });
      }

      window.genui.clear();
      return result;
    });
    } catch (err) {
      await target.evaluate(() => window.genui.clear()).catch(() => {});
      await appendFile(join(dir, 'browser.jsonl'), JSON.stringify({
        model: row.model, promptId: row.promptId, rep: row.rep, mounted: null, runtimeErrors: [],
        harnessError: String(err?.message ?? err).slice(0, 300),
      }) + '\n');
      processed++;
      continue;
    }

    await appendFile(join(dir, 'browser.jsonl'), JSON.stringify({
      model: row.model, promptId: row.promptId, rep: row.rep,
      mounted: outcome.report.ok, mountError: outcome.report.ok ? undefined : outcome.report.error,
      runtimeErrors: outcome.runtimeErrors,
      grabbables: outcome.info?.grabbables.length ?? 0, pressables: outcome.info?.pressables.length ?? 0,
      panels: outcome.info?.panels ?? 0, panelsLoaded: outcome.info?.panelsLoaded ?? 0,
      ...probes, shot,
    }) + '\n');
    processed++;
  }
  } finally {
    await target.evaluate(() => window.genui.setOverlayHidden(false)).catch(() => {});
  }
  return { processed, remaining: Math.max(0, todo.length - processed) };
}
