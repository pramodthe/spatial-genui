// The worked example (agent_skills/design/xr-design-doc/references/example-cake.md) as a real game: gate/examples/cake
// (game.js and its parts), put together with today's kits the way a game in the sandbox is (new-game.mjs, then the
// game's own files), passes the learning-game check: the gate, the layout, the scene plan, the look's rules and the
// play-through of its moves, its round and every level.
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const skill = fileURLToPath(new URL('../agent_skills/play/learning-game/scripts/', import.meta.url));
const example = fileURLToPath(new URL('./examples/cake/', import.meta.url));
const env = {
  ...process.env,
  GATE_TSX: fileURLToPath(new URL('./node_modules/.bin/tsx', import.meta.url)),
  GATE_ENTRY: fileURLToPath(new URL('./gate.ts', import.meta.url)),
  SCENE_PLAN: '1',
};
const work = mkdtempSync(join(tmpdir(), 'cake-'));
try {
  const made = spawnSync('node', [join(skill, 'new-game.mjs'), 'ink-toon', join(work, 'module.js')], { encoding: 'utf8', env });
  if (made.status !== 0) throw new Error(made.stdout + made.stderr);
  cpSync(join(example, 'game.js'), join(work, 'game.js'));
  cpSync(join(example, 'parts'), join(work, 'parts'), { recursive: true });
  const check = spawnSync('node', [join(skill, 'check.mjs'), join(work, 'module.js')], { encoding: 'utf8', env });
  const out = check.stdout + check.stderr;
  const levels = out.match(/levels: (.*)$/m)?.[1] ?? '';
  if (check.status !== 0 || !/^game ok$/m.test(out) || (levels.match(/[123] stars?/g) ?? []).length !== 3) {
    console.error('expected the cake example to pass check.mjs, every level with a star\n', out.slice(0, 4000));
    process.exit(1);
  }
  console.log(`cake ok: ${out.match(/^played through: (.*?);/m)?.[1] ?? 'played through'}; levels: ${levels}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
