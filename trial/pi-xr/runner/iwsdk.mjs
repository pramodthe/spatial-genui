// IWSDK's command line, called on one game project: the dev runtime (its emulated headset in a managed browser),
// screenshots, the console, emulated hands and the game's ECS state. Every MCP tool the agent has is one of these
// commands (the project's AGENTS.md: "MCP and CLI are one surface"), so the runner checks a game the same way the
// agent played it. The runtime helpers follow agent_skills/play/playtest/scripts/playtest.mjs.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/** Run `iwsdk <argv>` in a project and return its JSON envelope: { ok, data: { result, ... } } or { ok: false, error }. */
export function iwsdk(game, argv, timeoutMs = 120000) {
  const run = spawnSync('node', [join(game, 'node_modules', '@iwsdk', 'cli', 'dist', 'cli.js'), ...argv], { cwd: game, encoding: 'utf8', timeout: timeoutMs });
  const text = (run.stdout || '') + (run.stderr || '');
  const start = text.indexOf('{');
  try { return JSON.parse(text.slice(start)); } catch { return { ok: false, error: { message: text.slice(-600) || 'no output' } }; }
}

const input = (value) => ['--input-json', JSON.stringify(value)];
const resultOf = (reply) => (reply.ok ? reply.data?.result ?? reply.data ?? {} : null);

export const status = (game) => iwsdk(game, ['dev', 'status'], 30000);
export const ready = (game) => status(game)?.data?.state?.browserCommandReady === true;

/** Start the runtime if it is not up and wait until its browser takes commands. `window` shows the emulator. */
export async function up(game, { window = true } = {}) {
  if (ready(game)) return true;
  iwsdk(game, ['dev', 'up', '--ai-mode', window ? 'collaborate' : 'agent', '--timeout', '150000'], 200000);
  for (let i = 0; i < 60; i++) {
    if (ready(game)) return true;
    await sleep(2000);
  }
  return false;
}

export const down = (game) => iwsdk(game, ['dev', 'down'], 60000);

/** Reload the app and wait for the runtime again: a fresh game, as a player opening it. */
export async function reload(game) {
  iwsdk(game, ['browser', 'reload'], 60000);
  for (let i = 0; i < 30; i++) {
    await sleep(1500);
    if (ready(game)) return true;
  }
  return false;
}

export const xrStatus = (game) => resultOf(iwsdk(game, ['xr', 'status'], 30000)) ?? {};

/** Enter the immersive session with hands, as on the headset. The app offers its session a few seconds after it
 * loads, so this waits for the offer. */
export async function enterXR(game) {
  let entered = null;
  for (let i = 0; i < 25; i++) {
    const session = xrStatus(game);
    if (session.sessionActive) break;
    if (session.sessionOffered) entered = iwsdk(game, ['xr', 'enter'], 60000);
    await sleep(1000);
  }
  const mode = iwsdk(game, ['xr', 'set-input-mode', ...input({ mode: 'hand' })], 30000);
  const session = xrStatus(game);
  return { ok: session.sessionActive === true && mode.ok === true, error: entered?.error?.message ?? (session.sessionActive ? null : 'the app offered no XR session'), session };
}

export function screenshot(game, file) {
  mkdirSync(dirname(file), { recursive: true });
  const shot = iwsdk(game, ['browser', 'screenshot', '--output-file', file], 60000);
  const path = shot?.data?.screenshotPath;
  if (path && path !== file && existsSync(path)) copyFileSync(path, file);
  return existsSync(file) ? file : null;
}

/** The app's console errors since a time (ms; the log keeps earlier page loads too). A reload aborts the requests of
 * the page it replaces, and the log records each as an error: those are the runtime's, not the game's. */
export function consoleErrors(game, since = 0) {
  const reply = iwsdk(game, ['browser', 'logs', ...input({ count: 400 })], 30000);
  const result = resultOf(reply);
  const logs = Array.isArray(result) ? result : result?.logs ?? [];
  return logs
    .filter((l) => /error/i.test(String(l.level ?? '')) && (l.timestamp ?? Infinity) >= since && l.kind !== 'navigation')
    .filter((l) => !/net::ERR_ABORTED|favicon|ERR_CERT|certificate/i.test(JSON.stringify(l)))
    .map((l) => String(l.message ?? (l.args || []).join(' ')).slice(0, 300));
}

export const targets = (game) => resultOf(iwsdk(game, ['xr', 'list-targets'], 30000))?.targets ?? [];

/** One emulated-hand sequence, exactly as the agent's xr_run_sequence takes it. */
export function runSequence(game, sequence, timeoutMs = 60000) {
  const reply = iwsdk(game, ['xr', 'run-sequence', ...input(sequence), '--timeout', String(timeoutMs - 5000)], timeoutMs);
  return reply.ok ? { ok: true, ...resultOf(reply) } : { ok: false, error: reply.error?.message ?? 'the sequence could not run' };
}

/** The values of one ECS component on the first entity that has it (the game's GameState), or null. */
export function componentValues(game, component) {
  const found = resultOf(iwsdk(game, ['ecs', 'find', ...input({ withComponents: [component] })], 30000));
  const entity = found?.entities?.[0];
  if (!entity) return null;
  const queried = resultOf(iwsdk(game, ['ecs', 'query', ...input({ entityIndex: entity.entityIndex })], 30000));
  const part = (queried?.components ?? []).find((c) => c.componentId === component || String(c.componentId).endsWith(`.${component}`) || c.name === component);
  return part?.values ?? null;
}

/** How many times the app's page has loaded (the runtime counts each load of its tab), or null. */
export function pageLoads(game) {
  const clients = status(game)?.data?.state?.session?.browser?.clients ?? [];
  return clients.find((c) => c.role === 'app')?.tabGeneration ?? null;
}

/** Wait until the app's page has not reloaded for `quietMs`: a reload that follows a build or a saved file has then
 * happened. Returns the page's load count. */
export async function settled(game, quietMs = 2500, maxMs = 20000) {
  let loads = pageLoads(game);
  let quietSince = Date.now();
  const until = Date.now() + maxMs;
  while (Date.now() - quietSince < quietMs && Date.now() < until) {
    await sleep(500);
    const now = pageLoads(game);
    if (now !== loads) { loads = now; quietSince = Date.now(); }
  }
  return loads;
}

// ---- where things are, for the first-view check ----

/** The headset's pose: { position: [x, y, z], quaternion: [x, y, z, w] } in XR-origin metres. */
export function headPose(game) {
  const pose = resultOf(iwsdk(game, ['xr', 'get-transform', ...input({ device: 'headset' })], 30000)) ?? {};
  const p = pose.position ?? { x: 0, y: 1.6, z: 0 };
  const q = pose.orientation ?? { x: 0, y: 0, z: 0, w: 1 };
  return { position: [p.x, p.y, p.z], quaternion: [q.x, q.y, q.z, q.w] };
}

/** The level's scene nodes as the running app has them: [{ name, nodeId, assetId, entityIndex }]. */
export function sceneNodes(game) {
  const root = resultOf(iwsdk(game, ['scene', 'runtime-hierarchy'], 60000));
  const found = [];
  const walk = (node, inLevel) => {
    if (!node) return;
    if (inLevel && node.sceneNodeId && !found.some((n) => n.nodeId === node.sceneNodeId)) found.push({ name: node.name, nodeId: node.sceneNodeId, assetId: node.assetId ?? null, entityIndex: node.entityIndex ?? null });
    for (const child of node.children ?? []) walk(child, inLevel || node.name === 'LevelRoot');
  };
  walk(root, false);
  return found;
}

/** A scene node's place in the world: { position, quaternion, scale } (global), or null. */
export function nodeTransform(game, nodeId) {
  const t = resultOf(iwsdk(game, ['scene', 'transform', ...input({ nodeId })], 30000));
  return t?.globalPosition ? { position: t.globalPosition, quaternion: t.globalQuaternion, scale: t.globalScale } : null;
}

/** A panel as its entity shows it: its size in UIKit units (centimetres before the node's scale) and its elements. */
export function panelOf(game, entityIndex) {
  const seen = resultOf(iwsdk(game, ['ui', 'inspect', ...input({ entityIndex })], 30000));
  return seen?.panel ? { size: seen.panel.computedSize ?? null, elements: seen.elements ?? [] } : null;
}

export { sleep };
