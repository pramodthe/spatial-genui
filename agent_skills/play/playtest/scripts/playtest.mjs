// Play-test a module in the headset app, run headless by Meta's IWSDK runtime in this sandbox: start the runtime if it
// is not running, open the module in XR with hands, point the emulated headset at it, save a screenshot and report
// what the app sees (hand targets, panel buttons, errors in the console).
// Usage: node playtest.mjs [/work/module.js] [--game] [--shot-only] [--state] [--play]
//   --game       open it as a game (scoreboard, bigger fit), as the Play section does
//   --shot-only  only take another screenshot of what is on screen now (after driving hands with `npx iwsdk xr ...`)
//   --state      print what the open game is doing now (piece positions, held, glowing, the game's values), no picture
//   --play       open it, then play it by its own play block with the emulated hand and say what did not register
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const XR = process.env.PLAYTEST_XR || '/opt/xr';
const OUT = process.env.PLAYTEST_OUT || '/work/playtest';
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--')) || '/work/module.js';
const kind = args.includes('--game') ? 'game' : 'lesson';
const shotOnly = args.includes('--shot-only');
const stateOnly = args.includes('--state');
const replay = args.includes('--play');
// A learning game written as game.js on kits.js plays its latest game.js: build module.js from the two first.
if (!shotOnly && !stateOnly) {
  try {
    const { buildModule } = await import(join(here, '..', '..', 'learning-game', 'scripts', 'build-module.mjs'));
    buildModule(file);
  } catch { /* a lesson or a module written as one file plays as it is */ }
}

function iwsdk(argv, timeoutMs = 120000, env = {}) {
  const run = spawnSync('npx', ['iwsdk', ...argv], { cwd: XR, encoding: 'utf8', timeout: timeoutMs, env: { ...process.env, ...env } });
  const text = (run.stdout || '') + (run.stderr || '');
  const start = text.indexOf('{');
  try { return JSON.parse(text.slice(start)); } catch { return { ok: false, error: { message: text.slice(-600) || 'no output' } }; }
}
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const ready = () => iwsdk(['dev', 'status'], 30000)?.data?.state?.browserCommandReady === true;

async function ensureRuntime() {
  // The kit the app loads from /api/kit.js (the API serves it in the real app).
  if (!process.env.PLAYTEST_NO_KIT) {
    const up = await fetch('http://127.0.0.1:8787/api/kit.js').then((r) => r.ok).catch(() => false);
    if (!up) {
      spawn('node', [join(here, 'kit-server.mjs')], { detached: true, stdio: 'ignore' }).unref();
      await sleep(500);
    }
  }
  if (ready()) return true;
  // Hidden in the sandbox; PLAYTEST_HEADED=1 opens the emulator's browser window, to watch it on a desktop.
  const mode = process.env.PLAYTEST_HEADED === '1' ? 'collaborate' : 'agent';
  iwsdk(['dev', 'up', '--ai-mode', mode, '--allow-browser-automation', '--timeout', '150000'], 200000);
  for (let i = 0; i < 60; i++) {
    if (ready()) return true;
    await sleep(2000);
  }
  return false;
}

function screenshot() {
  const shot = iwsdk(['browser', 'screenshot'], 60000);
  const path = shot?.data?.screenshotPath;
  if (!path || !existsSync(path)) return null;
  mkdirSync(OUT, { recursive: true });
  const n = readdirSync(OUT).filter((f) => /^view-\d+\.png$/.test(f)).length + 1;
  const saved = join(OUT, `view-${n}.png`);
  copyFileSync(path, saved);
  return saved;
}

function consoleErrors() {
  const logs = iwsdk(['browser', 'logs'], 30000)?.data?.logs || [];
  return logs
    .filter((l) => /error|warn/i.test(l.level || l.type || '') && !/vite|favicon|404|not in a play-test|courses|games|library/i.test(JSON.stringify(l)))
    .slice(-8)
    .map((l) => String(l.text ?? (l.args || []).join(' ') ?? '').slice(0, 300));
}

if (!(await ensureRuntime())) {
  console.log(JSON.stringify({ ok: false, error: 'The IWSDK runtime did not start (npx iwsdk dev status). Run the play-test again.' }));
  process.exit(1);
}
if (stateOnly) {
  mkdirSync(join(XR, 'tests'), { recursive: true });
  copyFileSync(join(here, 'state.mjs'), join(XR, 'tests', '.playtest-state.mjs'));
  const run = iwsdk(['browser', 'run', 'tests/.playtest-state.mjs', '--timeout', '40000'], 60000);
  console.log(JSON.stringify(run.ok ? run.data?.result ?? {} : { ok: false, error: run.error?.message || 'the state could not be read' }, null, 1));
  process.exit(run.ok ? 0 : 1);
}
let report = {};
if (!shotOnly) {
  mkdirSync(join(XR, 'tests'), { recursive: true });
  copyFileSync(join(here, 'mount.mjs'), join(XR, 'tests', '.playtest-mount.mjs'));
  const run = iwsdk(['browser', 'run', 'tests/.playtest-mount.mjs', '--timeout', '100000'], 130000, { PLAYTEST_MODULE: file, PLAYTEST_KIND: kind });
  if (!run.ok) {
    console.log(JSON.stringify({ ok: false, error: run.error?.message || 'the module could not be opened' }));
    process.exit(1);
  }
  report = run.data?.result || {};
}
if (replay) {
  // The game is open and fresh: play its moves, Start and one round, as its play block says (scripts/replay.mjs), one
  // step per browser script (a script may run 110 s at most).
  copyFileSync(join(here, 'replay.mjs'), join(XR, 'tests', '.playtest-replay.mjs'));
  const step = (name, index = 0) => {
    const run = iwsdk(['browser', 'run', 'tests/.playtest-replay.mjs', '--timeout', '105000'], 130000, { REPLAY_STEP: name, REPLAY_INDEX: String(index) });
    return run.ok ? run.data?.result ?? { ok: false, error: 'no answer' } : { ok: false, error: run.error?.message || 'the replay step could not run' };
  };
  const played = { ok: false, mounted: report.mounted, moves: [], start: null, challenge: [], round: null, errors: [] };
  const finish = (error) => {
    if (error) played.errors.push(error);
    played.ok = !error && played.errors.length === 0;
    console.log(JSON.stringify(played, null, 1));
    process.exit(played.ok ? 0 : 1);
  };
  if (report.mounted === false) finish(`The game did not open: ${report.error}`);
  const plan = step('plan');
  if (!plan.ok) finish(plan.error);
  for (let i = 0; i < plan.moves; i++) {
    const move = step('move', i);
    if (move.skipped) break; // the game left its learn phase: no more moves to learn
    played.moves.push(move);
    if (!move.registered) {
      finish(`Move ${i + 1} did not register in the app: after its gesture (${move.gesture}) the game still waits at move ${(move.state?.move ?? i) + 1}.${move.error ? ` The gesture failed: ${move.error}` : ''}`);
    }
  }
  played.start = step('start');
  if (!played.start.ok) finish(played.start.error || `Start (${played.start.gesture}) did not begin a round in the app: the game is in phase '${played.start.state?.phase}'.`);
  for (let i = 0; i < (played.start.gestures || 0); i++) {
    const gesture = step('challenge', i);
    if (gesture.skipped) break; // the round has ended
    played.challenge.push(gesture);
    if (gesture.error) played.errors.push(`Challenge gesture ${i + 1} (${gesture.gesture}) failed: ${gesture.error}`);
  }
  const end = step('end');
  played.round = end.round ?? null;
  played.runtimeErrors = end.runtimeErrors;
  if (!end.ok) finish(end.error || `The round did not end with a result in the app (phase '${end.round?.phase}', result ${end.round?.result}).`);
  finish(null);
}
const picture = screenshot();
const out = {
  ok: report.mounted !== false,
  ...report,
  consoleErrors: consoleErrors(),
  screenshot: picture,
  next: picture
    ? `Look at it: read_file ${picture}. Would a first-time player know what to do? Try each hand action with npx iwsdk xr run-sequence (see SKILL.md), then node ${join(here, 'playtest.mjs')} --shot-only.`
    : 'No screenshot was taken; run the play-test again.',
};
console.log(JSON.stringify(out, null, 1));
process.exit(out.ok ? 0 : 1);
