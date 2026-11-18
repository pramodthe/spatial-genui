// The example module (the system prompt's own lesson) must pass the gate, and a second run must agree.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse as parseUIKitML, resolveKitComponentSets } from '@drawcall/uikitml';

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

// The module's own ECS (api.ecs, EliCS, as in the headset): a system that turns a box runs in the dry run.
const ecsKit = readFileSync(new URL('../agent_skills/common/ecs/assets/ecs-kit.js', import.meta.url), 'utf8');
const ecs = run(`${ecsKit}
export default function build(api) {
  const { THREE } = api;
  const game = playWorld(api);
  const root = new THREE.Group();
  const Spinner = game.component('Spinner', { speed: 'number' });
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), new THREE.MeshStandardMaterial());
  root.add(box);
  game.spawn(box, Spinner, { speed: 2 }, game.Grabbable);
  game.system('Spin', { spinners: [Spinner] }, (q, delta) => {
    for (const e of q.spinners) game.objectOf(e).rotation.y += e.getValue(Spinner, 'speed') * delta;
  });
  return { root, update: (time, delta) => game.update(time, delta) };
}
`) as { ok: boolean; error?: string; stats?: { grabbables?: number; moving?: number } };
if (!ecs.ok || ecs.stats?.grabbables !== 1 || ecs.stats?.moving !== 1) {
  console.error('expected an ECS module to run: one grabbable that its system turns', ecs);
  process.exit(1);
}

// Layout, from where the player stands: on the desk a button behind a wall is hidden; in a world, a box at the
// player's feet, a button over their head and a name tag filling the view (its size and the view it blocks) are each called out.
type LayoutResult = { ok: boolean; error?: string; stats?: { layout?: { mode: string; findings: { level: string; rule: string }[] } } };
const rulesOf = (r: LayoutResult) => (r.stats?.layout?.findings ?? []).map((f) => `${f.level}:${f.rule}`).sort().join(',');
const desk = run(`export default function build(api) {
  const { THREE } = api;
  const root = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.02), new THREE.MeshStandardMaterial());
  wall.position.set(0, 0.1, 0.05);
  const button = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.02), new THREE.MeshStandardMaterial());
  button.position.set(0, 0.03, -0.05);
  root.add(wall, button);
  api.traits(button, { onPress() {} });
  return { root };
}
`) as LayoutResult;
if (!desk.ok || desk.stats?.layout?.mode !== 'desk' || rulesOf(desk) !== 'fix:hidden') {
  console.error('expected a desk button behind a wall to be hidden', desk.error ?? desk.stats?.layout);
  process.exit(1);
}
const world = run(`export default function build(api) {
  const { THREE, kit } = api;
  const root = new THREE.Group();
  const crate = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.03), new THREE.MeshStandardMaterial());
  crate.position.set(0.02, 0.03, -0.01);
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.01), new THREE.MeshStandardMaterial());
  bell.position.set(0, 0.2, -0.12);
  const tag = kit.card('LOOK HERE', { height: 0.03 });
  tag.position.set(0, 0.12, -0.06);
  root.add(crate, bell, tag);
  api.traits(bell, { onPress() {} });
  return { root, mode: 'world' };
}
`) as LayoutResult;
if (!world.ok || world.stats?.layout?.mode !== 'world' || rulesOf(world) !== 'fix:label-size,fix:reach,fix:start-clear,fix:view') {
  console.error('expected a crowded start, a bell out of reach and a huge tag blocking the view', world.error ?? world.stats?.layout);
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
// The headset dashboard's own panel parses with the same component sets: a style rule the format does not take (a
// comment, a descendant selector) leaves the dashboard empty in VR, with no error anywhere a player would see.
const dashboard = parseUIKitML(readFileSync(new URL('../headset/public/ui/lesson-picker.uikitml', import.meta.url), 'utf8'), { componentSets: resolveKitComponentSets('horizon') });
if (!dashboard.success) {
  console.error('the headset dashboard panel (headset/public/ui/lesson-picker.uikitml) does not parse', dashboard.errors);
  process.exit(1);
}
console.log(`gate ok: triangles=${first.stats?.triangles} rawPanels=${first.stats?.rawPanels} warnings=${first.warnings?.length ?? 0} preview=${early.meshes}->${later.meshes} meshes`);
