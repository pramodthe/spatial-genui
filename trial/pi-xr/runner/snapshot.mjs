// Keeps a built game as it is now under another name, before a follow-up changes it: an APFS clone of its folder
// (instant, and nearly free on disk) with a note of what it is a copy of. The shelf lists it with the runs that
// made it. Usage: node runner/snapshot.mjs <name> <new name> "<note>"
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAMES } from './paths.mjs';

const [name, copy, note = ''] = process.argv.slice(2);
if (!name || !copy || !/^[a-z0-9-]+$/.test(copy) || !existsSync(join(GAMES, name, 'package.json'))) {
  console.log('Usage: node runner/snapshot.mjs <name of a built game> <new name: a-z, 0-9, -> "<note>"');
  process.exit(2);
}
if (existsSync(join(GAMES, copy))) throw new Error(`${join(GAMES, copy)} exists already.`);
const cloned = spawnSync('cp', ['-cR', join(GAMES, name), join(GAMES, copy)], { encoding: 'utf8' });
if (cloned.status !== 0) throw new Error(`The game could not be copied: ${cloned.stderr}`);
rmSync(join(GAMES, copy, '.iwsdk', 'runtime'), { recursive: true, force: true }); // the copy has no runtime of its own yet
writeFileSync(join(GAMES, copy, '.pi-xr-snapshot.json'), `${JSON.stringify({ of: name, at: new Date().toISOString(), note }, null, 1)}\n`);
console.log(`[${copy}] a copy of ${name} as it is now${existsSync(join(GAMES, copy, 'dist', 'index.html')) ? ', with its production build' : ' (it has no production build yet)'}`);
