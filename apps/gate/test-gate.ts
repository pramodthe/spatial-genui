// The example module (the system prompt's own lesson) must pass the gate, and a second run must agree.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tsx = fileURLToPath(new URL('./node_modules/.bin/tsx', import.meta.url));
const gate = fileURLToPath(new URL('./gate.ts', import.meta.url));
const snapshot = fileURLToPath(new URL('./snapshot.ts', import.meta.url));
const example = readFileSync(new URL('./src/example-module.js', import.meta.url), 'utf8')
  .replace(/^(\/\/.*\n)+/, '')
  .trim();

function run(code: string) {
  const child = spawnSync(tsx, [gate], { input: JSON.stringify({ code, knownAssets: [] }), encoding: 'utf8' });
  if (child.status !== 0) throw new Error(child.stderr || `gate exit ${child.status}`);
  return JSON.parse(child.stdout) as { ok: boolean; stats?: { triangles: number; rawPanels: number }; error?: string; warnings?: string[] };
}

const first = run(example);
if (!first.ok) {
  console.error(first.error);
  process.exit(1);
}
const second = run(example);
const same = JSON.stringify(first.stats) === JSON.stringify(second.stats)
  && JSON.stringify(first.warnings) === JSON.stringify(second.warnings);
if (!same) {
  console.error('two gate runs disagreed', first, second);
  process.exit(1);
}
const broken = run('export default function build() { return fetch("http://x"); }\n');
if (broken.ok || broken.error == null) {
  console.error('expected the gate to reject a banned global', broken);
  process.exit(1);
}

// Live preview: a reply cut mid-way still runs (its finished statements, closed and checked), and a later cut shows more.
function preview(reply: string) {
  const child = spawnSync(tsx, [snapshot], { input: JSON.stringify({ reply, knownAssets: [] }), encoding: 'utf8' });
  if (child.status !== 0) throw new Error(child.stderr || `snapshot exit ${child.status}`);
  return JSON.parse(child.stdout) as { ok: boolean; meshes?: number; error?: string };
}
const reply = '```js\n' + example + '\n```';
const early = preview(reply.slice(0, Math.round(reply.length * 0.45)));
const later = preview(reply.slice(0, Math.round(reply.length * 0.7)));
if (!early.ok || !later.ok || (later.meshes ?? 0) <= (early.meshes ?? 0)) {
  console.error('expected partial replies to run and to grow', early, later);
  process.exit(1);
}
console.log(`gate ok: triangles=${first.stats?.triangles} rawPanels=${first.stats?.rawPanels} warnings=${first.warnings?.length ?? 0} preview=${early.meshes}->${later.meshes} meshes`);
