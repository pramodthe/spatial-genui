// Builds one game the way OhMyGame does, for WebXR: one continuous pi session works in a real project folder (a
// clone of the IWSDK starter), with short always-on instructions, the studio skills read on demand, a canvas for the
// design and the art, tools that make pictures and 3D models, IWSDK's own tools to see and play the game with
// emulated hands, and no small step cap. The runner owns everything round the agent: the dev runtime (the emulator
// window), the studio service (media and canvas), the limits (minutes and dollars), the independent check, and up
// to two follow-ups that continue the same session with what the check found. README.md has the whole picture.
// Usage: node runner/run.mjs <name> "<request>" [--minutes N] [--usd N] [--headless] [--no-sandbox] [--down]
//        node runner/run.mjs <name> --request-file <file>   (a long request, word for word)
//        node runner/run.mjs <name> --continue "<message>"   (a follow-up in the game's own session, as a user would type it)
//        node runner/run.mjs <name> --prepare-only     (the project folder and the runtime, no agent: for the free checks)
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runPi, sandboxProfile, setupPiHome } from './agent.mjs';
import { check } from './check.mjs';
import { count, newStats } from './events.mjs';
import { down, ready, status, up } from './iwsdk.mjs';
import { ARCHIVE, GAMES, IWSDK_SKILLS, LIMITS, MEDIA, MODEL, PORT, RESULTS, RUNS, STUDIO_SKILLS, TEMPLATE, THINKING, TRIAL, agentKey, imageMaker, metaKey } from './paths.mjs';
import { startStudio } from './studio-server.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  if (!args.includes(`--${name}`)) return fallback;
  const value = Number(args[args.indexOf(`--${name}`) + 1]);
  if (!Number.isFinite(value) || value <= 0) {
    console.log(`--${name} needs a positive number: a limit that is not a number would not stop the run.`);
    process.exit(2);
  }
  return value;
};
const [name, typed] = args.filter((a, i) => !a.startsWith('--') && !['--minutes', '--usd', '--request-file'].includes(args[i - 1]));
// A long request (a benchmark prompt) comes from a file, word for word.
const request = args.includes('--request-file') ? readFileSync(args[args.indexOf('--request-file') + 1], 'utf8').trim() : typed;
const prepareOnly = flag('prepare-only');
const benchmark = process.env.PI_XR_BENCHMARK === '1';
const freeform = process.env.PI_XR_FREEFORM === '1'; // the request specifies a whole app: build that, not a lesson
const continuing = flag('continue');
if (!name || !/^[a-z0-9-]+$/.test(name) || (!request && !prepareOnly)) {
  console.log('Usage: node runner/run.mjs <name: a-z, 0-9, -> "<request>" [--continue] [--minutes N] [--usd N] [--headless] [--no-sandbox] [--down]');
  process.exit(2);
}
const limits = { ...LIMITS, minutes: option('minutes', LIMITS.minutes), usd: option('usd', LIMITS.usd) };
const game = join(GAMES, name);
// A follow-up works in the game's own run folder: its session, its media ledger and its events go on there.
const earlier = existsSync(RUNS) ? readdirSync(RUNS).filter((d) => d.startsWith(`${name}-2`) && existsSync(join(RUNS, d, 'events-0.jsonl'))).sort() : [];
if (continuing && earlier.length === 0) throw new Error(`No earlier run of "${name}" to continue.`);
const run = continuing ? join(RUNS, earlier.at(-1)) : join(RUNS, `${name}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
const RUNNING = join(ARCHIVE, 'running.json');
const say = (text) => console.log(`[${name}] ${text}`);
const listening = (port) => spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean).sort().join(',');

// ---- before anything is touched ----
if (!existsSync(join(TEMPLATE, '.pi-xr-template.json'))) throw new Error('No template yet: run `node runner/make-template.mjs` first.');
if (existsSync(game) && !continuing) throw new Error(`${game} exists already: pick another name, or send it a follow-up with --continue.`);
if (!existsSync(game) && continuing) throw new Error(`${game} does not exist: there is nothing to continue.`);
const pictures = prepareOnly ? null : imageMaker(); // null: Muse Image
const key = prepareOnly || pictures ? null : metaKey(); // the studio's, for Muse Image pictures
const piKey = prepareOnly ? null : agentKey(); // the agent model's provider
const others = { 8081: listening(8081), 8787: listening(8787) }; // the Quest preview and the app: must not change
const ownRuntimeUp = continuing && ready(game); // this game's emulator is still up from its build
if (existsSync(RUNNING) && !ownRuntimeUp) {
  // The last game's emulator is left up for looking at; one game at a time, so it goes down now.
  const last = JSON.parse(readFileSync(RUNNING, 'utf8'));
  if (existsSync(last.game)) down(last.game);
  rmSync(RUNNING, { force: true });
}
if (!ownRuntimeUp && listening(PORT)) throw new Error(`Port ${PORT} is taken by another process: the trial's runtime cannot start.`);

// ---- the project folder: a clone of the starter, with our skill beside IWSDK's ----
const git = (...argv) => spawnSync('git', argv, { cwd: game, encoding: 'utf8' });
const commit = (message) => { git('add', '-A'); git('-c', 'user.name=pi-xr-trial', '-c', 'user.email=trial@localhost', 'commit', '-qm', message); };
mkdirSync(GAMES, { recursive: true });
mkdirSync(join(run, 'session'), { recursive: true });
if (continuing) {
  commit('before a follow-up'); // so the summary says what this follow-up changed
  // The studio skills as they are now: a follow-up may come after they were improved.
  for (const skill of STUDIO_SKILLS) cpSync(join(TRIAL, 'skills', skill), join(game, '.agents', 'skills', skill), { recursive: true });
} else {
  const cloned = spawnSync('cp', ['-cR', TEMPLATE, game], { encoding: 'utf8' }); // an APFS clone: instant and nearly free
  if (cloned.status !== 0) throw new Error(`The template could not be cloned: ${cloned.stderr}`);
  rmSync(join(game, '.iwsdk', 'runtime'), { recursive: true, force: true });
  for (const skill of STUDIO_SKILLS) cpSync(join(TRIAL, 'skills', skill), join(game, '.agents', 'skills', skill), { recursive: true });
  // The runner's own snapshot of the start, to say afterwards what the agent changed (the agent has no git).
  git('init', '-q');
  commit('the starter');
}

setupPiHome(game);
const sandbox = flag('no-sandbox') ? null : sandboxProfile(game, run);

// ---- the dev runtime: the harness's, up before the agent starts and left up after it ----
spawn('caffeinate', ['-dimsu', '-w', String(process.pid)], { detached: true, stdio: 'ignore' }).unref();
say(`starting the IWSDK runtime on port ${PORT} (${flag('headless') ? 'headless' : 'a visible emulator window'}) ...`);
if (!(await up(game, { window: !flag('headless') }))) throw new Error('The dev runtime did not come up (iwsdk dev status).');
writeFileSync(RUNNING, JSON.stringify({ game, run }));
if (prepareOnly) {
  say(`prepared, no agent started.\ngame: ${game}\nrun: ${run}\nsandbox: ${sandbox}`);
  process.exit(0);
}

// ---- the studio service: pictures, 3D models, the canvas and the plan, outside the agent's sandbox ----
const madeBefore = existsSync(join(run, 'media.jsonl')) ? readFileSync(join(run, 'media.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
const studio = await startStudio({ game, run, key, limits: MEDIA, previous: madeBefore, images: pictures });
const spentUsd = () => stats.usd + studio.spent().usd + studio.spent().pendingUsd; // art in flight counts too

// ---- the agent: one pi process per prompt, the same session throughout ----
// A follow-up uses the session its build made (the first record of its event stream names it).
const sessionId = continuing ? JSON.parse(readFileSync(join(run, 'events-0.jsonl'), 'utf8').split('\n')[0]).id : randomUUID();
const firstN = continuing ? readdirSync(run).filter((f) => /^events-\d+\.jsonl$/.test(f)).length : 0;
const stats = newStats();
let agentSeconds = 0;
let lastTool = '';
const agent = async (prompt, n) => {
  const before = agentSeconds;
  const progress = setInterval(() => say(`${(agentSeconds / 60).toFixed(1)} min, ${stats.turns} turns, ${stats.toolCalls} tool calls, $${spentUsd().toFixed(3)} (${studio.spent().images} pictures, ${studio.spent().models} models), last tool: ${lastTool || '-'}`), 60000);
  const ended = await runPi({
    game, run, key: piKey, prompt, n, sessionId, sandbox, studio,
    skills: [...STUDIO_SKILLS, ...IWSDK_SKILLS].map((s) => join(game, '.agents', 'skills', s)),
    // Ours, then IWSDK's ECS cheat-sheet (pi loads only the root AGENTS.md by itself).
    // PI_XR_BENCHMARK=1: a reference run for quality, with no cost limit and no 30-minute aim (BENCHMARK.md).
    append: [join(TRIAL, 'instructions', 'APPEND_SYSTEM.md'), ...(freeform ? [join(TRIAL, 'instructions', 'FREEFORM.md')] : []), ...(benchmark ? [join(TRIAL, 'instructions', 'BENCHMARK.md')] : []), join(game, 'src', 'AGENTS.md')],
    extensions: [join(TRIAL, 'runner', 'guard.ts'), join(TRIAL, 'runner', 'studio-tools.ts')],
    onRecord: (record, seconds) => {
      agentSeconds = before + seconds;
      if (record.type === 'tool_execution_start') lastTool = record.toolName;
      count(stats, record, agentSeconds);
    },
    stopWhen: (seconds, idle) => {
      agentSeconds = before + seconds;
      if (agentSeconds / 60 >= limits.minutes) return `${limits.minutes} minutes used`;
      if (spentUsd() >= limits.usd) return `$${limits.usd} spent`;
      if (stats.turns >= limits.turns) return `${limits.turns} turns`;
      if (stats.largestRequest >= limits.requestTokens) return `a request of ${stats.largestRequest} input tokens (the price tier is 200K)`;
      if (idle > limits.idleS) return `no event for ${limits.idleS} s`;
      return null;
    },
  });
  clearInterval(progress);
  agentSeconds = before + ended.seconds;
  if (ended.stopped) say(`the agent was stopped: ${ended.stopped}`);
  return ended;
};

const startedAt = Date.now();
say(`the agent starts: ${MODEL}, thinking ${THINKING}, pictures by ${pictures?.model ?? 'muse-image-1.0'}, limits ${limits.minutes} min and $${limits.usd}${sandbox ? ', sandboxed' : ''}`);
/** The independent check; one that crashes is a failed check, so the run is still written down below. */
async function checkSafely(out) {
  try {
    return await check(game, { out });
  } catch (err) {
    const failure = `The check itself stopped: ${String(err?.message ?? err).slice(0, 400)}`;
    return { ok: false, failures: [failure], warnings: [], text: `- ${failure}`, played: [], steps: 0, moves: 0 };
  }
}

// The skill goes in with the request, so its order of work is in context from the first turn.
const first = freeform ? `Build this XR app exactly as it is specified here:\n\n${request}` : `Make this VR learning game: ${request}`;
let ended = await agent(continuing ? [request] : ['@.agents/skills/xr-game-studio/SKILL.md', first], firstN);
say(`the agent stopped after ${(ended.seconds / 60).toFixed(1)} min (${ended.stopped ?? stats.stopReason ?? `exit ${ended.code}`}); checking the game ...`);
let checked = await checkSafely(join(run, `check-${firstN}`));
let followUps = 0;
while (!checked.ok && followUps < limits.followUps && !ended.stopped && agentSeconds / 60 < limits.minutes && spentUsd() < limits.usd) {
  followUps += 1;
  say(`the check failed; follow-up ${followUps} continues the same session:\n${checked.text}`);
  ended = await agent([`An independent check replayed the game from a fresh reload and found this:\n${checked.text}\n\nFix these in the game as it is (do not start over), verify with hands as before, and stop when typecheck, build and the playtest.json replay pass.`], firstN + followUps);
  checked = await checkSafely(join(run, `check-${firstN + followUps}`));
}

// ---- what happened, written down ----
git('add', '-A');
const urls = status(game)?.data?.runtimeUrls ?? {};
const row = {
  name, request, continued: continuing, benchmark, freeform, model: MODEL, thinking: THINKING, imageModel: pictures?.model ?? 'muse-image-1.0', started: new Date(startedAt).toISOString(), sandboxed: Boolean(sandbox),
  agentMinutes: +(agentSeconds / 60).toFixed(1), totalMinutes: +((Date.now() - startedAt) / 60000).toFixed(1),
  turns: stats.turns, toolCalls: stats.toolCalls, failedCalls: stats.failedCalls, tools: stats.tools, imageReads: stats.imageReads,
  compactions: stats.compactions, retries: stats.retries, input: stats.input, output: stats.output, cacheRead: stats.cacheRead,
  usd: +spentUsd().toFixed(4), modelUsd: +stats.usd.toFixed(4), media: { images: studio.spent().images, models: studio.spent().models, usd: studio.spent().usd },
  largestRequest: stats.largestRequest, models: stats.models,
  firstTypecheckPassMin: stats.firstTypecheckPassS === null ? null : +(stats.firstTypecheckPassS / 60).toFixed(1),
  firstSequenceMin: stats.firstSequenceS === null ? null : +(stats.firstSequenceS / 60).toFixed(1),
  followUps, stop: ended.stopped ?? stats.stopReason ?? `exit ${ended.code}`,
  check: { ok: checked.ok, failures: checked.failures, warnings: checked.warnings ?? [], moves: checked.moves, steps: checked.steps, played: (checked.played ?? []).filter((p) => p.ok).length, lastState: checked.lastState ?? null },
  changed: git('diff', '--cached', '--shortstat', 'HEAD').stdout.trim(),
  othersUntouched: { 8081: listening(8081) === others[8081], 8787: listening(8787) === others[8787] }, game, run, urls,
};
// A key must never be left in a log: every text file of the run is scanned, and a key replaced if found.
row.keyLeaksRemoved = 0;
const scrub = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) scrub(path);
    else if (statSync(path).size < 200e6 && !/\.(png|jpe?g)$/i.test(entry.name)) {
      const text = readFileSync(path, 'utf8');
      const secrets = [...new Set([key, piKey.value, pictures?.key].filter(Boolean))].filter((secret) => text.includes(secret));
      if (secrets.length) { row.keyLeaksRemoved += 1; writeFileSync(path, secrets.reduce((clean, secret) => clean.split(secret).join('[API_KEY]'), text)); }
    }
  }
};
scrub(run);
writeFileSync(join(run, continuing ? `summary-${firstN}.json` : 'summary.json'), `${JSON.stringify(row, null, 1)}\n`);
appendFileSync(RESULTS, `${JSON.stringify(row)}\n`);

await studio.close();
say(`${checked.ok ? 'CHECK PASSED' : 'CHECK FAILED'}: ${row.agentMinutes} min of agent time, ${row.turns} turns, ${row.toolCalls} tool calls, $${row.usd} ($${row.modelUsd} model, $${row.media.usd} for ${row.media.images} pictures and ${row.media.models} 3D models), ${followUps} follow-up(s), stop: ${row.stop}`);
for (const warning of row.check.warnings) say(`note: ${warning}`);
if (!checked.ok) say(`what failed:\n${checked.text}`);
if (!row.othersUntouched[8081] || !row.othersUntouched[8787]) say('WARNING: the process on port 8081 or 8787 changed during the run.');
if (row.keyLeaksRemoved) say(`WARNING: the API key was found in ${row.keyLeaksRemoved} log file(s) and removed.`);
say(`game: ${game}\nrun: ${run}`);
if (flag('down')) {
  down(game);
  rmSync(RUNNING, { force: true });
} else say(`the game is left running: ${urls.local ?? `https://localhost:${PORT}/`} (on the Quest: ${(urls.network ?? [])[0] ?? 'see iwsdk dev status'}, or adb reverse tcp:${PORT} tcp:${PORT})`);
process.exit(checked.ok ? 0 : 1);
