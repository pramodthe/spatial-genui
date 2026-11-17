// The game is written in /work/game.js; the kits it uses (the look kit, the look, the play, ECS and world kits) are
// /work/kits.js, ready and never edited. The gate, the play-test and the headset take one module, /work/module.js,
// built here from the two: the check and the play-test run this first, so module.js is always the latest game.
// Usage: node build-module.mjs [/work/module.js] | node build-module.mjs --split [/work/module.js]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GAME_START = "// ---- game.js: the game's own code (everything above is /work/kits.js) ----";

/**
 * Build module.js from kits.js and game.js beside it. Returns the offset to add to a game.js line to get its
 * module.js line, or 0 when there is no game.js (a module written as one file is left as it is).
 */
export function buildModule(file) {
  const dir = dirname(file);
  const kits = join(dir, 'kits.js');
  const game = join(dir, 'game.js');
  if (!existsSync(kits) || !existsSync(game)) return 0;
  const head = readFileSync(kits, 'utf8').replace(/\n+$/, '');
  writeFileSync(file, `${head}\n\n${GAME_START}\n${readFileSync(game, 'utf8')}`);
  return head.split('\n').length + 2;
}

/** Split a built module back into kits.js and game.js beside it (a repair starts from the saved module). */
export function splitModule(file) {
  const code = readFileSync(file, 'utf8');
  const at = code.indexOf(`\n${GAME_START}\n`);
  if (at < 0) return false;
  writeFileSync(join(dirname(file), 'kits.js'), `${code.slice(0, at).replace(/\n+$/, '')}\n`);
  writeFileSync(join(dirname(file), 'game.js'), code.slice(at + GAME_START.length + 2));
  return true;
}

/** Point the gate's module line numbers at game.js (or kits.js, for the lines above the game). */
export function toGameLines(text, offset) {
  if (!offset) return text;
  const at = (n) => (Number(n) > offset ? `game.js line ${Number(n) - offset}` : `kits.js line ${n}`);
  return text
    .replace(/\(line (\d+), col (\d+)\)/g, (_, n, col) => `(${at(n)}, col ${col})`)
    .replace(/\(line ([\d, ]+)\)/g, (_, list) => `(${list.split(/,\s*/).map(at).join(', ')})`)
    .replace(/\((\d+):(\d+)\)/g, (_, n, col) => `(${at(n)}:${col})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '/work/module.js';
  if (process.argv.includes('--split')) {
    console.log(splitModule(file) ? `split ${file} into kits.js and game.js` : `${file} has no game.js part: edit it as one file`);
  } else {
    console.log(buildModule(file) ? `built ${file} from kits.js and game.js` : `no kits.js and game.js beside ${file}: nothing to build`);
  }
}
