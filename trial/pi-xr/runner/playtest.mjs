// The agent's two play-test tools, run as a process of their own by the studio service (IWSDK's command line is
// called synchronously, which must not hold up the service):
//   record  run one hand sequence in the running game and, when it did what it should, write it into playtest.json
//           as a step, so the file is always in the format the independent check replays
//   replay  reload the page and replay playtest.json from its first step, exactly as the independent check does,
//           with the first view measured
// Usage: node runner/playtest.mjs <game folder> record '<json: { id, sequence, expect, waitMs?, waitFor?, clear? }>'
//        node runner/playtest.mjs <game folder> replay
// Prints one line of JSON: { ok: true, text, ... } or { ok: false, error }.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { badExpectation, replay, unmet } from './check.mjs';
import { componentValues, runSequence, sleep } from './iwsdk.mjs';

/** Run one hand sequence and, when it worked, write it into playtest.json. Throws with what happened otherwise. */
export async function recordStep(game, { id, sequence, expect = {}, waitMs = 500, waitFor = null, clear = false }) {
  if (typeof id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(id)) throw new Error('Give the step an "id" of lower-case letters, digits and dashes, such as "move-1" or "start".');
  if (!sequence?.device || !Array.isArray(sequence.steps) || sequence.steps.length === 0) throw new Error('"sequence" is the input of xr_run_sequence: { "device": "hand-right", "steps": [...] }.');
  for (const [where, values] of [['expect', expect ?? {}], ['waitFor', waitFor ?? {}]]) {
    for (const [key, wanted] of Object.entries(values)) {
      if (key !== 'timeoutMs' && badExpectation(wanted)) throw new Error(`${where}.${key}: ${badExpectation(wanted)}.`);
    }
  }
  const file = join(game, 'playtest.json');
  let playtest = { version: 1, state: 'GameState', steps: [] };
  if (!clear && existsSync(file)) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      if (Array.isArray(saved.steps)) playtest = { version: 1, state: saved.state || 'GameState', steps: saved.steps.filter((s) => s?.sequence) };
    } catch { /* a file in another shape is replaced */ }
  }
  const before = componentValues(game, playtest.state);
  if (before === null) throw new Error(`No entity has a ${playtest.state} component (or the page is not in XR): the game's state cannot be read.`);
  const ran = runSequence(game, sequence, 90000);
  await sleep(Math.min(Number(waitMs) || 500, 10000));
  const wanted = waitFor ? Object.fromEntries(Object.entries(waitFor).filter(([k]) => k !== 'timeoutMs')) : null;
  let state = componentValues(game, playtest.state);
  const until = Date.now() + Math.min(Number(waitFor?.timeoutMs) || 15000, 60000);
  while (wanted && unmet(state, wanted).length && Date.now() < until) {
    await sleep(700);
    state = componentValues(game, playtest.state);
  }
  const problems = [];
  if (!ran.ok) problems.push(`the sequence could not run: ${ran.error}`);
  else if (!ran.completed) problems.push(`the sequence did not complete${ran.reason ? ` (${ran.reason})` : ''}`);
  if (JSON.stringify(state) === JSON.stringify(before)) problems.push(`${playtest.state} did not change: the game did not notice this`);
  problems.push(...unmet(state, expect), ...(wanted ? unmet(state, wanted).map((p) => `after waiting, ${p}`) : []));
  const seen = `Events the app saw: ${(ran.events ?? []).map((e) => e.type).join(', ') || 'none'}${(ran.warnings ?? []).length ? `. Warnings: ${ran.warnings.join(' ')}` : ''}. ${playtest.state} is now ${JSON.stringify(state)}.`;
  if (problems.length) throw new Error(`Not recorded: ${problems.join('; ')}. ${seen}`);
  const step = { id, sequence, ...(waitFor ? { waitFor } : { waitMs: Number(waitMs) || 500 }), expect };
  const at = playtest.steps.findIndex((s) => s.id === id);
  if (at >= 0) playtest.steps[at] = step; else playtest.steps.push(step);
  writeFileSync(file, `${JSON.stringify(playtest, null, 2)}\n`);
  return { text: `Recorded "${id}" as step ${at >= 0 ? at + 1 : playtest.steps.length} of ${playtest.steps.length} in playtest.json. ${seen}`, state };
}

/** Replay playtest.json from a fresh reload, exactly as the independent check will. */
export async function replayAll(game) {
  const file = join(game, 'playtest.json');
  if (!existsSync(file)) throw new Error('There is no playtest.json yet: record each working step with playtest_record.');
  const playtest = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(playtest.steps) || playtest.steps.length === 0) throw new Error('playtest.json has no steps: record each working step with playtest_record.');
  const result = await replay(game, playtest, null);
  const lines = result.played.map((p) => `step ${p.step} (${p.id}): ${p.ok ? 'ok' : 'FAILED'} ${JSON.stringify(p.state)}`);
  const view = (result.view?.panels ?? []).map((p) => `panel "${p.name}": ${p.wide} m wide, ${p.away} m away, ${p.side} degrees to the side`).join('; ');
  const text = [
    `${result.failures.length ? 'REPLAY FAILED' : 'Replay passed'}: ${result.played.filter((p) => p.ok).length} of ${playtest.steps.length} steps.`,
    result.restarted ? 'The page reloaded by itself during the first replay, so the file was played again from the start.' : '',
    ...lines, view ? `First view: ${view}.` : '', ...result.failures.map((f) => `- ${f}`),
    'The page was reloaded: enter XR and set hand mode again before more hand work.',
  ].filter(Boolean).join('\n');
  return { text, passed: result.failures.length === 0 };
}

const [folder, action, payload] = process.argv.slice(2);
if (folder && action) {
  try {
    const game = resolve(folder);
    const result = action === 'record' ? await recordStep(game, JSON.parse(payload ?? '{}')) : await replayAll(game);
    console.log(JSON.stringify({ ok: true, ...result }));
  } catch (err) {
    console.log(JSON.stringify({ ok: false, error: String(err?.message ?? err) }));
    process.exit(1);
  }
}
