// The independent check of a finished game, by IWSDK's command line only (not by the agent's word): the design is
// on the canvas with its 12 sections, the canvas files are valid, the project typechecks and builds, it loads with
// a clean console and enters XR, and its own playtest.json, replayed from a fresh reload, plays the game with
// emulated hands from the first move to a result. Before the replay it measures the first view (first-view.mjs):
// panels in view, small enough and turned to the player; the things to touch in view. Generated art that the game
// does not use is reported as a note.
// The replay holds the game to what the agent cannot write away: every sequence completes, GameState changes at
// every step, there is a step for every move of the design, and the last state is a result with a star.
// Usage: node runner/check.mjs <game folder> [--out <folder for pictures and the report>] [--no-build]
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCanvas, mainDocument, readAssets } from './canvas.mjs';
import { firstView } from './first-view.mjs';
import { componentValues, consoleErrors, enterXR, pageLoads, reload, runSequence, screenshot, settled, sleep, targets, up, xrStatus } from './iwsdk.mjs';

const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16);
const tail = (text, n = 500) => String(text ?? '').trim().slice(-n);

export const COMPARISONS = ['gte', 'gt', 'lte', 'lt', 'ne'];
/** A step's expected value, if it is malformed: a comparison object may only use the five comparisons. */
export function badExpectation(wanted) {
  if (wanted === null || typeof wanted !== 'object') return null;
  if (Array.isArray(wanted)) return 'a list is not an expected value';
  const keys = Object.keys(wanted);
  const unknown = keys.filter((key) => !COMPARISONS.includes(key));
  if (keys.length === 0) return 'an empty comparison';
  return unknown.length ? `unknown comparison ${unknown.map((key) => `"${key}"`).join(', ')} (use ${COMPARISONS.join(', ')})` : null;
}

/** Does a GameState value meet what a step expects? A plain value must equal it; {gte|gt|lte|lt|ne} compare. */
export function meets(actual, wanted) {
  if (wanted !== null && typeof wanted === 'object') {
    if (badExpectation(wanted)) return false;
    return Object.entries(wanted).every(([op, v]) => (
      op === 'gte' ? actual >= v : op === 'gt' ? actual > v : op === 'lte' ? actual <= v : op === 'lt' ? actual < v : actual !== undefined && actual !== v));
  }
  return typeof actual === 'number' && typeof wanted === 'number' ? Math.abs(actual - wanted) < 1e-6 : actual === wanted;
}
export const unmet = (state, expect = {}) => Object.entries(expect).filter(([key, wanted]) => !meets(state?.[key], wanted)).map(([key, wanted]) => (
  badExpectation(wanted) ? `${key}: ${badExpectation(wanted)}` : `${key} is ${JSON.stringify(state?.[key])}, expected ${JSON.stringify(wanted)}`));

/** The rows of the design's Moves table (section 3): one hand step each. */
export function movesOf(design) {
  const at = design.search(/^###\s+Moves\b/m);
  if (at < 0) return 0;
  const table = design.slice(at).split(/^##\s/m)[0];
  return table.split('\n').filter((line) => /^\|\s*\d+\s*\|/.test(line)).length;
}

/** The game's own text (sources, scenes, panels), to see whether a generated file is used. */
function gameText(game) {
  let text = '';
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|js|json|uikitml)$/.test(entry.name)) text += readFileSync(path, 'utf8');
    }
  };
  for (const dir of ['src', join('public', 'scenes'), join('public', 'ui')]) walk(join(game, dir));
  return text;
}

/** Every file under public/, by the hash of its bytes: a generated file is in the game as a copy, often renamed. */
function publicFiles(game) {
  const byHash = new Map();
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(glb|gltf|png|jpe?g|webp)$/i.test(entry.name)) byHash.set(createHash('sha256').update(readFileSync(path)).digest('hex'), entry.name);
    }
  };
  walk(join(game, 'public'));
  return byHash;
}

/** Generated art the game does not load: made and paid for, but not in the game. Mockups are meant to stay out, and
 * a picture a used model was made from has done its work. */
function unusedArt(game) {
  if (!existsSync(join(game, 'canvas', 'assets.json'))) return [];
  const text = gameText(game);
  const copies = publicFiles(game);
  const mockups = new Set();
  const boards = join(game, 'canvas', 'boards');
  for (const file of existsSync(boards) ? readdirSync(boards) : []) {
    try {
      for (const node of JSON.parse(readFileSync(join(boards, file), 'utf8')).nodes ?? []) {
        if (/mockup|reference/i.test(`${node.title ?? ''} ${node.description ?? ''}`) && node.data?.assetId) mockups.add(node.data.assetId);
      }
    } catch { /* canvas_check reports an unreadable board */ }
  }
  const assets = Object.entries(readAssets(game).assets ?? {}).filter(([, asset]) => String(asset.path).startsWith('assets/generated/') && existsSync(join(game, asset.path)));
  const stem = (file) => basename(file).replace(/\.[^.]+$/, '');
  const used = (asset) => {
    // The working copy or its full-size original, byte for byte under public/ (whatever it was renamed to) ...
    const sources = [asset.path, join(dirname(asset.path), 'originals', basename(asset.path))].filter((path) => existsSync(join(game, path)));
    const same = sources.map((path) => copies.get(createHash('sha256').update(readFileSync(join(game, path))).digest('hex'))).find((copy) => copy && text.includes(copy));
    if (same || text.includes(basename(asset.path))) return true;
    // ... or a copy that was converted or resized and kept its name (coast.png -> art/coast.jpg).
    return [...copies.values()].some((copy) => stem(copy) === stem(asset.path) && text.includes(copy));
  };
  const notes = [];
  for (const [id, asset] of assets) {
    if (mockups.has(id) || used(asset)) continue;
    const madeInto = assets.find(([, other]) => other.description === `3D model made from ${asset.path}`);
    if (madeInto && used(madeInto[1])) continue;
    notes.push(`"${id}" (${asset.path}) was generated but the game does not load it.`);
  }
  return notes;
}

// PI_XR_FREEFORM=1: the request is a whole app specification (a benchmark prompt), not a learning game. The design
// is then a requirements checklist, and the replay shows the interactions working without having to reach an end.
const FREEFORM = process.env.PI_XR_FREEFORM === '1';

function staticChecks(game) {
  const failures = [];
  // The design is the canvas main document; a design.md in the project root is accepted too.
  const onCanvas = mainDocument(game);
  const designFile = onCanvas?.file ?? join(game, 'design.md');
  let moves = 0;
  if (existsSync(join(game, 'canvas'))) failures.push(...checkCanvas(game).map((issue) => `${issue.file}: ${issue.message}`));
  if (!existsSync(designFile)) failures.push('There is no design document: canvas/documents/design.md, registered in canvas/index.json as mainDocumentId.');
  else {
    const design = readFileSync(designFile, 'utf8');
    const missing = Array.from({ length: 12 }, (_, i) => i + 1).filter((n) => !new RegExp(`^##\\s*${n}\\.`, 'm').test(design));
    if (FREEFORM) {
      if (design.trim().length < 400) failures.push('The design document is nearly empty: it lists every requirement of the request, how the app meets it and whether it was verified.');
    } else {
      if (missing.length) failures.push(`The design document lacks section(s) ${missing.join(', ')} of the 12 (references/design-template.md).`);
      moves = movesOf(design);
      if (moves === 0) failures.push('The design document has no rows in its Moves table (section 3).');
    }
  }
  let playtest = null;
  const playFile = join(game, 'playtest.json');
  if (!existsSync(playFile)) failures.push('There is no playtest.json in the project root (references/playtest-format.md).');
  else {
    try { playtest = JSON.parse(readFileSync(playFile, 'utf8')); } catch (err) { failures.push(`playtest.json is not valid JSON: ${err.message}`); }
    const steps = playtest?.steps;
    const FORMAT = 'Its format is in .agents/skills/xr-game-studio/references/playtest-format.md: { "version": 1, "state": "GameState", "steps": [{ "id", "sequence": { "device", "steps": [...] }, "expect": { ... } }] }, with "expect" values plain or { "gte" | "lte" | "ne": value }.';
    if (playtest && (!Array.isArray(steps) || steps.length === 0)) failures.push(`playtest.json has no top-level "steps" list${playtest.tests ? ' (it has "tests" instead)' : ''}. ${FORMAT}`);
    else if (playtest) {
      steps.forEach((step, i) => {
        if (!step?.sequence?.device || !Array.isArray(step.sequence.steps)) failures.push(`playtest.json step ${i + 1} (${step?.id ?? 'no id'}) has no "sequence": { "device", "steps" } (the exact input that worked in xr_run_sequence). ${i === 0 ? FORMAT : ''}`.trim());
      });
      if (moves && steps.length < moves) failures.push(`playtest.json has ${steps.length} step(s) but the design has ${moves} moves: every move needs its step, then Start and the round.`);
    }
  }
  const stampFile = join(game, '.pi-xr-template.json');
  if (existsSync(stampFile)) {
    let stamp = {};
    try { stamp = JSON.parse(readFileSync(stampFile, 'utf8')); } catch { failures.push('.pi-xr-template.json was changed; it is fixed by the harness. Put it back as it was.'); }
    if (hash(join(game, 'package.json')) !== stamp.packageJson) failures.push('package.json was changed; it is fixed by the harness. Put it back as it was.');
    if (hash(join(game, 'vite.config.ts')) !== stamp.viteConfig) failures.push('vite.config.ts was changed; it is fixed by the harness. Put it back as it was.');
  }
  return { failures, playtest, moves, warnings: unusedArt(game) };
}

function buildChecks(game) {
  const failures = [];
  const typecheck = spawnSync('npm', ['run', '--silent', 'typecheck'], { cwd: game, encoding: 'utf8', timeout: 180000 });
  if (typecheck.status !== 0) failures.push(`npm run typecheck fails:\n${tail(typecheck.stdout + typecheck.stderr, 700)}`);
  const build = spawnSync('npm', ['run', '--silent', 'build'], { cwd: game, encoding: 'utf8', timeout: 300000 });
  if (build.status !== 0) failures.push(`npm run build fails:\n${tail(build.stdout + build.stderr, 500)}`);
  return failures;
}

async function waitFor(game, component, wanted, timeoutMs) {
  const until = Date.now() + timeoutMs;
  let state = componentValues(game, component);
  while (unmet(state, wanted).length && Date.now() < until) {
    await sleep(700);
    state = componentValues(game, component);
  }
  return state;
}

/** The names a play-test's hand sequences aim at: the things the player must be able to see and reach. */
export const touchedBy = (playtest, only = () => true) => [...new Set((playtest.steps ?? []).flatMap((step) => (step.sequence?.steps ?? []).filter(only).map((s) => (typeof s.target === 'string' ? s.target : s.target?.name)).filter(Boolean)))];
/** The names it presses: the game's controls. */
export const pressedBy = (playtest) => touchedBy(playtest, (s) => s.press !== undefined);

/** Replay a play-test from a fresh reload, as a player with hands only. { failures, played, view, ... }
 * A page reload the replay did not ask for (a late reload after a build or a saved file) ends the XR session and
 * resets the game under it; that says nothing about the game, so the file is then played once more from the start. */
export async function replay(game, playtest, out) {
  const first = await replayOnce(game, playtest, out);
  if (!first.pageReloaded) return first;
  const second = await replayOnce(game, playtest, out);
  if (second.pageReloaded) second.failures.push('The page reloaded by itself during the replay, twice: something keeps reloading the app (a file written while it runs, or a dev-server restart).');
  return { ...second, restarted: true };
}

async function replayOnce(game, playtest, out) {
  const failures = [];
  const played = [];
  const component = playtest.state || 'GameState';
  if (!(await up(game))) return { failures: ['The dev runtime is not ready (iwsdk dev status).'], played };
  const since = Date.now();
  if (!(await reload(game))) return { failures: ['The app did not come back after a reload.'], played };
  await settled(game);
  const loadErrors = consoleErrors(game, since);
  if (loadErrors.length) failures.push(`The console has ${loadErrors.length} error(s) on a fresh load: ${loadErrors.slice(0, 3).join(' | ')}`);
  const xr = await enterXR(game);
  if (!xr.ok) return { failures: [...failures, `The app did not enter XR: ${xr.error}`], played };
  await sleep(1000);
  const loads = pageLoads(game);
  const reloadedUnderUs = () => pageLoads(game) !== loads || xrStatus(game).sessionActive !== true;
  const opening = out ? screenshot(game, join(out, 'opening-view.png')) : null;
  const names = targets(game).map((t) => t.name);
  let state = componentValues(game, component);
  if (state === null) return { failures: [...failures, `No entity has a ${component} component: the game's state cannot be read (the GameState contract).`], played, opening, targets: names };
  const first = state;
  // What the player sees before touching anything: measured here, while the game is as it opens.
  const view = firstView(game, touchedBy(playtest), pressedBy(playtest));
  failures.push(...view.failures);

  for (const [i, step] of playtest.steps.entries()) {
    const label = `step ${i + 1} (${step.id ?? 'no id'})`;
    const before = state;
    const ran = runSequence(game, step.sequence, 90000);
    await sleep(step.waitMs ?? 500);
    state = step.waitFor
      ? await waitFor(game, component, Object.fromEntries(Object.entries(step.waitFor).filter(([k]) => k !== 'timeoutMs')), step.waitFor.timeoutMs ?? 15000)
      : componentValues(game, component);
    const problems = [];
    if (!ran.ok) problems.push(`its hand sequence could not run: ${ran.error}`);
    else if (!ran.completed) problems.push(`its hand sequence did not complete${ran.reason ? ` (${ran.reason})` : ''}${ran.failedStep !== undefined ? ` at its step ${ran.failedStep}` : ''}`);
    if (JSON.stringify(state) === JSON.stringify(before)) problems.push(`${component} did not change (it is still ${JSON.stringify(state)}): the game did not notice this move`);
    problems.push(...unmet(state, step.expect));
    if (step.waitFor) problems.push(...unmet(state, Object.fromEntries(Object.entries(step.waitFor).filter(([k]) => k !== 'timeoutMs'))).map((p) => `after waiting, ${p}`));
    played.push({ step: i + 1, id: step.id ?? null, completed: ran.completed === true, events: (ran.events ?? []).map((e) => e.type), warnings: ran.warnings ?? [], state, ok: problems.length === 0 });
    if (problems.length) {
      if (reloadedUnderUs()) return { failures: [...failures, `Replay ${label}: the page reloaded during the replay.`], played, opening, targets: names, pageReloaded: true };
      failures.push(`Replay ${label}: ${problems.join('; ')}.`);
      break; // later steps build on this one
    }
  }
  if (!FREEFORM && played.length === playtest.steps.length && played.every((p) => p.ok)) {
    if (state?.phase !== 'result') failures.push(`After the last step ${component}.phase is ${JSON.stringify(state?.phase)}, not "result": the replay does not reach the end of a round.`);
    if (!(state?.stars >= 1)) failures.push(`After the last step ${component}.stars is ${JSON.stringify(state?.stars)}: the round the replay plays earns no star.`);
  }
  const endErrors = consoleErrors(game, since).filter((e) => !loadErrors.includes(e));
  if (endErrors.length) failures.push(`The console has ${endErrors.length} error(s) after playing: ${endErrors.slice(0, 3).join(' | ')}`);
  const final = out ? screenshot(game, join(out, 'final-view.png')) : null;
  return { failures, played, opening, final, targets: names, view: { panels: view.panels, things: view.things }, firstState: first, lastState: state };
}

/** Check one game. { ok, failures, moves, played, ... } and `text`, the failures as a short message for the agent. */
export async function check(game, { out = null, build = true } = {}) {
  if (out) mkdirSync(out, { recursive: true });
  const fixed = staticChecks(game);
  const failures = [...fixed.failures, ...(build ? buildChecks(game) : [])];
  let played = { played: [] };
  // A project that does not build has nothing to replay; a missing design alone does not stop the replay.
  if (fixed.playtest?.steps?.length && !failures.some((f) => f.startsWith('npm run'))) {
    played = await replay(game, fixed.playtest, out);
    failures.push(...played.failures);
  }
  const result = {
    ...played, ok: failures.length === 0, failures, warnings: fixed.warnings, moves: fixed.moves, steps: fixed.playtest?.steps?.length ?? 0,
    text: failures.map((f) => `- ${f}`).join('\n').slice(0, 2500),
  };
  if (out) writeFileSync(join(out, 'check.json'), `${JSON.stringify(result, null, 1)}\n`);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const outAt = args.indexOf('--out');
  const out = outAt >= 0 ? resolve(args[outAt + 1]) : null;
  const game = resolve(args.find((a, i) => !a.startsWith('--') && (outAt < 0 || i !== outAt + 1)) ?? '.');
  const result = await check(game, { out, build: !args.includes('--no-build') });
  console.log(result.ok ? `check ok: ${result.steps} step(s) replayed, ${result.moves} move(s) in the design` : `check FAILED:\n${result.text}`);
  process.exit(result.ok ? 0 : 1);
}
