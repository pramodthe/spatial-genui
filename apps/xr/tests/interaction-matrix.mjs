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
  const SETTLE_MS = 150;

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

  /**
   * Where a seated learner's hand would be to point at `c`: up to 30 cm from it toward the eyes, but never more
   * than 60% of the way (for things near the learner, 30 cm would put the hand at or behind the face).
   */
  function handFor(c, dx = 0.05, dy = -0.05) {
    const head = window.IWER_DEVICE.position;
    const d = [head.x - c[0], head.y - c[1], head.z - c[2]];
    const len = Math.hypot(...d) || 1;
    const back = Math.min(0.3, len * 0.6);
    return { x: c[0] + (d[0] / len) * back + dx, y: c[1] + (d[1] / len) * back + dy, z: c[2] + (d[2] / len) * back };
  }

  /**
   * Point the hand ray at `c`, as a seated learner would, and hold it there a moment: the pointer picks up a
   * moved hand a few frames later, and a pinch before then lands on whatever the ray crossed on the way.
   */
  async function aim(c) {
    const from = handFor(c);
    await r.dispatch('set_transform', { device: hand, position: from });
    await r.dispatch('look_at', { device: hand, target: at(c) });
    await sleep(SETTLE_MS);
    return from;
  }

  /** The first things a ray from `from` toward `to` passes through, for failures (a panel or part in the way). */
  const firstHits = (from, to) => genui.debugRay([from.x, from.y, from.z], to).slice(0, 3).map((hit) => hit.chain);

  /**
   * Hand positions to point at `c` from, in order: the learner's usual side, straight on, the other side. The
   * emulated hand's ray leaves a little off the direction the hand is turned to, so a small target seen at an
   * angle can be missed; in the headset the learner sees the ray and re-aims, and the probes do the same.
   */
  function aimsFor(c) {
    const near = handFor(c, 0, 0);
    return [handFor(c), { x: c[0], y: c[1], z: c[2] + Math.hypot(near.x - c[0], near.y - c[1], near.z - c[2]) }, handFor(c, -0.08, 0.04)];
  }

  /** Point the hand from `from` at `c` and let the pointer settle. */
  async function pointFrom(from, c) {
    await r.dispatch('set_transform', { device: hand, position: from });
    await r.dispatch('look_at', { device: hand, target: at(c) });
    await sleep(SETTLE_MS);
  }

  async function rayPress(c) {
    const before = calls();
    const aims = aimsFor(c);
    for (const [i, from] of aims.entries()) {
      await pointFrom(from, c);
      await r.dispatch('select', { device: hand, duration: 0.2 });
      await sleep(250);
      await rest();
      if (calls() > before) return { worked: true, aims: i + 1 };
    }
    return { worked: false, aims: aims.length, firstHits: firstHits(aims[0], c) };
  }

  /** A point on pressable `index` that a learner's ray reaches first (not a centre hidden inside another part). */
  function pressPoint(index) {
    const c = genui.inspect().pressables[index].center;
    const from = handFor(c);
    return genui.aimPoint?.(index, [from.x, from.y, from.z], 'press') ?? c;
  }

  /**
   * Press `c` with the index fingertip. A panel element the emulator can name (`name`, unique) is pressed straight
   * on along its own surface normal; anything else is approached from the learner's side.
   */
  async function poke(c, name) {
    const before = calls();
    const targets = name ? (await r.dispatch('list_targets'))?.targets ?? [] : [];
    let step;
    if (name && targets.filter((t) => t.name === name).length === 1) step = { target: name, press: {} };
    else {
      const head = window.IWER_DEVICE.position;
      const d = [head.x - c[0], head.y - c[1], head.z - c[2]];
      const len = Math.hypot(...d) || 1;
      step = { position: { ...at(c), normal: { x: d[0] / len, y: d[1] / len, z: d[2] / len } }, press: {} };
    }
    const result = await r.dispatch('run_sequence', { device: hand, steps: [step] });
    await sleep(250);
    await rest();
    return calls() > before ? { worked: true } : { worked: false, warnings: result?.warnings ?? [] };
  }

  /** Pick up grabbable `index` (near pinch or ray, as the host set it up), carry it 10 cm, and let go. */
  async function grab(index) {
    const g = genui.inspect().grabbables[index];
    const before = g.center;
    const hand0 = handFor(before, 0.12, -0.08);
    const from = [hand0.x, hand0.y, hand0.z];
    // A point on the object the hand can reach first: the centre of a ring or a hollow organ is not on the object.
    const point = genui.aimPoint?.(index, from) ?? before;
    let aims = 0;
    if (g.mode === 'touch') {
      await r.dispatch('run_sequence', { device: hand, steps: [
        { anchor: 'grasp', position: at(point), pinch: { value: 1, at: 'arrival' } },
        { anchor: 'grasp', position: { x: point[0] + 0.08, y: point[1] + 0.06, z: point[2] + 0.04 } },
      ] });
    } else {
      for (const [i, aimFrom] of aimsFor(point).entries()) {
        await pointFrom(aimFrom, point);
        await r.dispatch('set_select_value', { device: hand, value: 1, duration: 0.1 });
        await sleep(150);
        aims = i + 1;
        if (genui.inspect().grabbables[index]?.held) {
          await r.dispatch('animate_to', { device: hand, position: { x: aimFrom.x + 0.08, y: aimFrom.y + 0.06, z: aimFrom.z }, duration: 0.3 });
          break;
        }
        await rest();
      }
    }
    await sleep(150);
    const now = genui.inspect().grabbables[index];
    const result = { name: g.name, mode: g.mode, held: now?.held ?? false, movedM: now ? Math.round(dist(before, now.center) * 1000) / 1000 : 0, ...(aims ? { aims } : {}) };
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
    await sleep(SETTLE_MS);
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
    let from = null;
    let aims = 0;
    for (const aimFrom of aimsFor(p)) {
      await pointFrom(aimFrom, p);
      await r.dispatch('set_select_value', { device: hand, value: 1, duration: 0.1 });
      await sleep(150);
      aims++;
      if (bar().held) {
        from = aimFrom;
        break;
      }
      await rest();
    }
    const held = from !== null;
    const blocked = held ? undefined : firstHits(aimsFor(p)[0], p);
    if (held) await r.dispatch('animate_to', { device: hand, position: { x: from.x + dx, y: from.y, z: from.z }, duration: 0.3 });
    await sleep(150);
    await rest();
    await sleep(150);
    const movedM = Math.round(dist(start.targetPosition, bar().targetPosition) * 1000) / 1000;
    return { visible: true, held, aims, movedM, worked: held && movedM >= MOVED_M, ...(blocked ? { firstHits: blocked } : {}) };
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
      if (b) p.panelPoke = { id, ...(await poke(b.center, id)) };
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
