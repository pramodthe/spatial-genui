// Play-test a module in the headset app, run headless by Meta's IWSDK runtime in this sandbox: start the runtime if it
// is not running, open the module in XR with hands, point the emulated headset at it, save a screenshot and report
// what the app sees (hand targets, panel buttons, errors in the console).
// Usage: node playtest.mjs [/work/module.js] [--game] [--shot-only]
//   --game       open it as a game (scoreboard, bigger fit), as the Play section does
//   --shot-only  only take another screenshot of what is on screen now (after driving hands with `npx iwsdk xr ...`)
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
// A learning game written as game.js on kits.js plays its latest game.js: build module.js from the two first.
if (!shotOnly) {
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
  iwsdk(['dev', 'up', '--ai-mode', 'agent', '--allow-browser-automation', '--timeout', '150000'], 200000);
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
const picture = screenshot();
const out = {
  ok: report.mounted !== false,
  ...report,
  consoleErrors: consoleErrors(),
  screenshot: picture,
  next: picture
    ? `Look at it: read_file ${picture}. Would a first-time player know what to do? Try the main action with npx iwsdk xr run-sequence (see SKILL.md), then node ${join(here, 'playtest.mjs')} --shot-only.`
    : 'No screenshot was taken; run the play-test again.',
};
console.log(JSON.stringify(out, null, 1));
process.exit(out.ok ? 0 : 1);
