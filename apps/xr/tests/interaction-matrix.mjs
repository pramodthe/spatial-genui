// Phase 4 hand-interaction matrix, emulator stage: mount each lesson in <dir>/cases.jsonl in the managed browser's
// emulated XR session and try every hand interaction the lesson offers with an emulated right hand. Appends one
// row per lesson to <dir>/emulator.jsonl and resumes, so it runs in batches within the managed-browser time limit.
// Usage: MATRIX_DIR=/abs/bench/results/interaction-matrix npx @iwsdk/cli browser run tests/interaction-matrix.mjs --timeout 108000
// (scripts/interaction-matrix.mjs writes the cases, loops this until every lesson is done, and writes the table.)
//
// Each interaction passes only when the app saw it land: a generated handler ran (presses, pokes, sliders), the
// object was held and followed the hand at least 5 cm (grabs, the move bar), or a model's parts moved apart (explode).

import { existsSync } from 'node:fs';
import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const HEAD = { position: { x: 0, y: 1.3, z: 0 }, orientation: { x: -0.1736, y: 0, z: 0, w: 0.9848 } }; // seated, 20° down

async function readJsonl(file) {
  if (!existsSync(file)) return [];
  return (await readFile(file, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

export default async function run({ frame, page }) {
  const target = frame ?? page;
  const dir = process.env.MATRIX_DIR;
  if (!dir) return { error: 'Set MATRIX_DIR to the matrix results directory.' };
  const deadline = Date.now() + Number(process.env.MATRIX_BUDGET_MS || 50000);

  // A lesson is done once it has a real result, or after two harness errors.
  const previous = await readJsonl(join(dir, 'emulator.jsonl'));
  const harnessErrors = new Map();
  for (const r of previous.filter((r) => r.harnessError)) harnessErrors.set(r.id, (harnessErrors.get(r.id) ?? 0) + 1);
  const done = new Set([...previous.filter((r) => !r.harnessError).map((r) => r.id), ...[...harnessErrors].filter(([, n]) => n >= 2).map(([id]) => id)]);
  const todo = (await readJsonl(join(dir, 'cases.jsonl'))).filter((c) => !done.has(c.id));

  await target.waitForFunction(() => Boolean(window.genui?.inspect && window.IWER_DEVICE?.remote), null, { timeout: 30000 });
  await target.evaluate(installProbes, HEAD);

  let processed = 0;
  try {
    for (const lesson of todo) {
      if (Date.now() > deadline) break;
      let row;
      try {
        row = await target.evaluate(({ code }) => window.__matrix.runAll(code), { code: lesson.code });
      } catch (err) {
        await target.evaluate(() => window.genui.clear()).catch(() => {});
        row = { harnessError: String(err?.message ?? err).slice(0, 300) };
      }
      await appendFile(join(dir, 'emulator.jsonl'), JSON.stringify({ id: lesson.id, source: lesson.source, label: lesson.label, ...row }) + '\n');
      processed++;
    }
  } finally {
    await target.evaluate(() => window.genui.setOverlayHidden(false)).catch(() => {});
  }
  return { processed, remaining: Math.max(0, todo.length - processed) };
}

/** Runs in the page: defines window.__matrix. Kept self-contained because evaluate() sends only its source. */
function installProbes(HEAD) {
  const r = window.IWER_DEVICE.remote;
  const genui = window.genui;
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const hand = 'hand-right';
  const at = (c) => ({ x: c[0], y: c[1], z: c[2] });
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const calls = () => genui.inspect()?.handlerCalls ?? 0;
  const MOVED_M = 0.05;

  async function rest() {
    await r.dispatch('set_select_value', { device: hand, value: 0 });
    await r.dispatch('set_transform', { device: hand, position: { x: 0.35, y: 0.9, z: 0.1 } });
    await r.dispatch('set_transform', { device: 'headset', ...HEAD });
  }

  async function mount(code) {
    await rest();
    const report = await genui.mount(code);
    await sleep(2500); // panels load, update() runs
    // Library lessons: the host lays panels out once they have all loaded; aiming before that hits moving targets.
    for (let i = 0; i < 40 && genui.inspect() && !genui.inspect().layoutSettled; i++) await sleep(250);
    return report;
  }

  /** Point the hand ray at `c` from about 30 cm on the learner's side, as a seated learner would. */
  async function aim(c) {
    const head = window.IWER_DEVICE.position;
    const d = [head.x - c[0], head.y - c[1], head.z - c[2]];
    const len = Math.hypot(...d) || 1;
    const from = { x: c[0] + (d[0] / len) * 0.3 + 0.05, y: c[1] + (d[1] / len) * 0.3 - 0.05, z: c[2] + (d[2] / len) * 0.3 };
    await r.dispatch('set_transform', { device: hand, position: from });
    await r.dispatch('look_at', { device: hand, target: at(c) });
    return from;
  }

  /** The first things a ray from `from` toward `to` passes through, for failures (a panel or part in the way). */
  const firstHits = (from, to) => genui.debugRay([from.x, from.y, from.z], to).slice(0, 3).map((hit) => hit.chain);

  async function rayPress(c) {
    const before = calls();
    const from = await aim(c);
    await r.dispatch('select', { device: hand, duration: 0.2 });
    await sleep(250);
    await rest();
    return calls() > before ? { worked: true } : { worked: false, firstHits: firstHits(from, c) };
  }

  /** A point on pressable `index` that a learner's ray reaches first (not a centre hidden inside another part). */
  function pressPoint(index) {
    const c = genui.inspect().pressables[index].center;
    return genui.aimPoint?.(index, [c[0] + 0.05, c[1] - 0.05, c[2] + 0.3], 'press') ?? c;
  }

  /** Press `c` with the index fingertip, coming in from the learner's side (panels and parts face the learner). */
  async function poke(c) {
    const before = calls();
    const head = window.IWER_DEVICE.position;
    const d = [head.x - c[0], head.y - c[1], head.z - c[2]];
    const len = Math.hypot(...d) || 1;
    const normal = { x: d[0] / len, y: d[1] / len, z: d[2] / len };
    const result = await r.dispatch('run_sequence', { device: hand, steps: [{ position: { ...at(c), normal }, press: {} }] });
    await sleep(250);
    await rest();
    return calls() > before ? { worked: true } : { worked: false, warnings: result?.warnings ?? [] };
  }

  /** Pick up grabbable `index` (near pinch or ray, as the host set it up), carry it 10 cm, and let go. */
  async function grab(index) {
    const g = genui.inspect().grabbables[index];
    const before = g.center;
    const from = [before[0] + 0.12, before[1] - 0.08, before[2] + 0.3];
    // A point on the object the hand can reach first: the centre of a ring or a hollow organ is not on the object.
    const point = genui.aimPoint?.(index, from) ?? before;
    if (g.mode === 'touch') {
      await r.dispatch('run_sequence', { device: hand, steps: [
        { anchor: 'grasp', position: at(point), pinch: { value: 1, at: 'arrival' } },
        { anchor: 'grasp', position: { x: point[0] + 0.08, y: point[1] + 0.06, z: point[2] + 0.04 } },
      ] });
    } else {
      await r.dispatch('set_transform', { device: hand, position: at(from) });
      await r.dispatch('look_at', { device: hand, target: at(point) });
      await r.dispatch('set_select_value', { device: hand, value: 1, duration: 0.1 });
      await sleep(150);
      await r.dispatch('animate_to', { device: hand, position: { x: from[0] + 0.08, y: from[1] + 0.06, z: from[2] }, duration: 0.3 });
    }
    await sleep(150);
    const now = genui.inspect().grabbables[index];
    const result = { name: g.name, mode: g.mode, held: now?.held ?? false, movedM: now ? Math.round(dist(before, now.center) * 1000) / 1000 : 0 };
    result.worked = result.held && result.movedM >= MOVED_M;
    if (!result.held) result.firstHits = firstHits({ x: from[0], y: from[1], z: from[2] }, point);
    await rest();
    return result;
  }

  /** Point at the left end of the slider, pinch, sweep to the right end, let go. */
  async function slide(s) {
    const before = calls();
    const y = s.center[1];
    const z = s.center[2];
    const x0 = s.center[0] - s.size[0] * 0.4;
    const x1 = s.center[0] + s.size[0] * 0.4;
    await aim(s.center);
    await r.dispatch('look_at', { device: hand, target: { x: x0, y, z } });
    await r.dispatch('set_select_value', { device: hand, value: 1, duration: 0.1 });
    await sleep(150);
    for (let k = 1; k <= 6; k++) {
      await r.dispatch('look_at', { device: hand, target: { x: x0 + ((x1 - x0) * k) / 6, y, z } });
      await sleep(60);
    }
    await rest();
    await sleep(150);
    return calls() > before;
  }

  /** Drag the lesson's move bar 10 cm to the right, then back (so the next lesson opens where this one did). */
  async function dragBar(dx) {
    const bar = () => genui.inspectMoveHandles().find((h) => h.target === 'GenUI Anchor');
    const start = bar();
    if (!start?.visible) return { visible: Boolean(start?.visible) };
    const p = start.position;
    const from = { x: p[0] + 0.05, y: p[1] + 0.1, z: p[2] + 0.3 };
    await r.dispatch('set_transform', { device: hand, position: from });
    await r.dispatch('look_at', { device: hand, target: at(p) });
    await r.dispatch('set_select_value', { device: hand, value: 1, duration: 0.1 });
    await sleep(150);
    const held = bar().held;
    const blocked = held ? undefined : firstHits(from, p);
    await r.dispatch('animate_to', { device: hand, position: { x: from.x + dx, y: from.y, z: from.z }, duration: 0.3 });
    await sleep(150);
    await rest();
    await sleep(150);
    const movedM = Math.round(dist(start.targetPosition, bar().targetPosition) * 1000) / 1000;
    return { visible: true, held, movedM, worked: held && movedM >= MOVED_M, ...(blocked ? { firstHits: blocked } : {}) };
  }

  const EXPLODE_WORDS = /explod|apart|separat|split|pull|expand|open/i;

  async function runAll(code) {
    const report = await mount(code);
    const runtimeErrors = [...genui.state.runtimeErrors];
    const info = genui.inspect();
    const row = {
      mounted: report.ok, mountError: report.ok ? undefined : report.error, runtimeErrors,
      offers: info ? {
        touchGrab: info.grabbables.filter((g) => g.mode === 'touch').length,
        rayGrab: info.grabbables.filter((g) => g.mode === 'ray').length,
        press3d: info.pressables.length,
        panelButtons: new Set(info.panelButtons.map((b) => b.id)).size,
        sliders: info.sliders.length,
        rigs: info.rigs.length,
      } : null,
      probes: {},
    };
    if (!report.ok || !info) return row;
    const p = row.probes;

    // Presses first, on the fresh lesson: after a grab the emulated hand's ray stops delivering clicks.
    const ids = [...new Set(info.panelButtons.map((b) => b.id))];
    const toggle = ids.find((id) => id.endsWith('-switch'));
    const rayIds = [...ids.slice(0, 3), ...(toggle && !ids.slice(0, 3).includes(toggle) ? [toggle] : [])];
    const buttonAt = (id) => genui.inspect().panelButtons.find((b) => b.id === id); // re-read: presses move things
    if (rayIds.length) {
      const buttons = [];
      for (const id of rayIds) {
        const b = buttonAt(id);
        if (b) buttons.push({ id, ...(await rayPress(b.center)) });
      }
      p.panelRay = { tested: buttons.length, worked: buttons.filter((b) => b.worked).length, buttons };
    }
    if (ids.length) {
      const id = ids[ids.length > 1 ? 1 : 0]; // not always the first: the ray test already pressed that one
      const b = buttonAt(id);
      if (b) p.panelPoke = { id, ...(await poke(b.center)) };
    }
    if (toggle) {
      const b = buttonAt(toggle);
      if (b) p.toggle = { id: toggle, ...(await rayPress(b.center)) };
    }
    const slider = genui.inspect().sliders[0];
    if (slider) p.slider = { id: slider.id, worked: await slide(slider) };
    const pressable = genui.inspect().pressables[0];
    if (pressable) {
      p.press3dRay = { name: pressable.name, ...(await rayPress(pressPoint(0))) };
      p.poke3d = { name: pressable.name, ...(genui.inspect().pressables[0] ? await poke(pressPoint(0)) : { worked: false }) };
    }

    // Explode: a model's parts move apart when the learner asks, in lessons that offer it (call the rig's
    // explode()). Buttons that say so first, then any button.
    if (info.rigs.length && /\.explode\(/.test(code) && (await mount(code)).ok) {
      const spread = () => genui.inspect().rigs.reduce((sum, rig) => sum + rig.spread, 0);
      const order = [...ids.filter((id) => EXPLODE_WORDS.test(id)), ...ids.filter((id) => !EXPLODE_WORDS.test(id))].slice(0, 8);
      p.explode = { worked: false, tried: [] };
      for (const id of order) {
        const b = buttonAt(id);
        if (!b) continue;
        const before = spread();
        await rayPress(b.center);
        await sleep(1200); // lessons ease the parts out over a second or so
        p.explode.tried.push(id);
        if (spread() - before >= 0.01) {
          p.explode = { worked: true, via: id, spreadGainM: Math.round((spread() - before) * 1000) / 1000, tried: p.explode.tried };
          break;
        }
      }
    }

    // Grabs, each on a freshly mounted lesson so an earlier grab can't leave the hand or the object out of place.
    // A remount that fails leaves its probe unset rather than losing the lesson's other results.
    const firstOf = (mode) => genui.inspect().grabbables.findIndex((g) => g.mode === mode);
    for (const mode of ['touch', 'ray']) {
      if (!info.grabbables.some((g) => g.mode === mode) || !(await mount(code)).ok) continue;
      p[mode === 'touch' ? 'touchGrab' : 'rayGrab'] = await grab(firstOf(mode));
    }
    // A single part of a model: the first grabbable that is one of a rig's parts.
    if (info.rigs.length && (await mount(code)).ok) {
      const partNames = new Set(genui.inspect().rigs.flatMap((rig) => rig.names));
      const index = genui.inspect().grabbables.findIndex((g) => partNames.has(g.name));
      if (index >= 0) p.partGrab = await grab(index);
    }

    // The move bar, shown with the rest of the chrome.
    if ((await mount(code)).ok) {
      genui.setOverlayHidden(false);
      await sleep(300);
      p.moveBar = await dragBar(0.1);
      if (p.moveBar.worked) p.moveBar.back = (await dragBar(-0.1)).worked;
      genui.setOverlayHidden(true);
    }

    genui.clear();
    await rest();
    return row;
  }

  return (async () => {
    try { await r.dispatch('accept_session'); } catch { /* already in XR */ }
    await r.dispatch('set_input_mode', { mode: 'hand' });
    genui.setOverlayHidden(true);
    genui.state.prompt = null; // with no request to repair, a lesson that breaks while loading starts no model call
    window.__matrix = { runAll };
  })();
}
