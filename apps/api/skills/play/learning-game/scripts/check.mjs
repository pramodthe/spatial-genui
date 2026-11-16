// Check a learning game: the app's gate and dry run, the hand rules and the look's rules (the shared look check),
// then the play rules (a goal, moves with a why, a measured result, Try again, a scene that moves).
// Prints FIX lines (must change) and NOTE lines; exits 1 while any FIX is left. Usage: node check.mjs [/work/module.js]
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2] ?? '/work/module.js';
const code = readFileSync(file, 'utf8');
// new-game.mjs writes the look on the first line; plain has no look rules.
const look = (code.match(/^\/\/ learning-game look: ([\w-]+)/) ?? [])[1] ?? '';
const shared = spawnSync('node', [join(here, '..', '..', 'looks', 'shared', 'scripts', 'check.mjs'), look === 'plain' ? '' : look, file], {
  encoding: 'utf8', env: { ...process.env, LOOK_CHECK_STATS: '1', LOOK_CHECK_GAME: '1' },
});
const lines = (shared.stdout || shared.stderr || '').trim().split('\n');
const statsLine = lines.find((l) => l.startsWith('STATS '));
if (!statsLine) {
  console.log(lines.join('\n'));
  process.exit(1);
}
const s = JSON.parse(statsLine.slice(6));
const fix = lines.filter((l) => l.startsWith('FIX: '));
const note = lines.filter((l) => l.startsWith('NOTE: '));
const add = (list, text) => list.push(`${list === fix ? 'FIX' : 'NOTE'}: ${text}`);

// The play rules judge the game's own code, not the kits pasted above it.
const at = code.search(/^export\s+default\s+function/m);
const game = at >= 0 ? code.slice(at) : code;
if (!look) add(note, 'No "// learning-game look:" line at the top: start from scripts/new-game.mjs so the look rules run too.');
if (/REPLACE/.test(game)) add(fix, 'REPLACE markers left: fill in the title, goal, moves, whys and challenge (references/design.md).');
if (/Touch every piece|Piece by piece/.test(game)) add(fix, "The starter's own title or challenge is still in: write the game's own (references/design.md).");
if (!/\{\s*stat:/.test(game)) add(fix, 'No measured result on the panel: the challenge ends with a number the player can beat ({ stat } part).');
if (!/label:\s*['"`](Try again|Play again|Again|Retry)/i.test(game)) add(fix, 'No Try again button: the player must be able to beat their result with one press.');
if (!/\bwhy\s*:/.test(game)) add(fix, 'No why: each move says in one short line why it matters (references/design.md).');
if ((s.moving ?? 0) === 0) add(fix, 'Nothing moves in the first second: the scene must feel alive (water, a bob, a nudge on the next thing to touch; references/feel.md).');
const behind = game.match(/kit\.panel\(\s*ui\s*,\s*\{[\s\S]{0,200}?position:\s*\[[^,\]]+,[^,\]]+,\s*(-\s*0?\.\d+|-\s*\d+(?:\.\d+)?)\s*\]/);
if (behind && Number(behind[1].replace(/\s/g, '')) < -0.1) add(fix, 'The panel stands behind the game: a pointing hand cannot reach its buttons past the scene. Put it beside the game, as the starter does.');
if ((s.sounds ?? 0) === 0 && !/\bsfx\.|\bsound\.(play|tone|note|hum)\(/.test(game)) add(note, 'No sound: answer the hands with sound.play (/skills/common/sound), and teach with it when the idea is about sound.');
if (!/playStars\(|stars?\b/i.test(game)) add(note, 'No stars or best result: a reward for doing well makes Try again worth it.');
if ((s.grabbables ?? 0) === 0) add(note, 'Nothing to pick up: most learning games are best when the hands move the main thing (references/design.md).');
for (const m of game.matchAll(/\bwhy:\s*(['"`])((?:(?!\1).)*)\1/g)) {
  const words = m[2].trim().split(/\s+/).length;
  if (words > 22) add(note, `A why of ${words} words ("${m[2].slice(0, 40)}..."): keep each to one short line, about 15 words.`);
}
for (const m of game.matchAll(/\btext:\s*(['"`])((?:(?!\1).)*)\1/g)) {
  const words = m[2].trim().split(/\s+/).length;
  if (words > 30) add(note, `Panel text of ${words} words ("${m[2].slice(0, 40)}..."): players read 2 short sentences at most; the rest is doing.`);
}

console.log(`gate ok: ${s.meshes} meshes, ${s.drawCalls} draw calls, ${s.triangles} triangles, ${s.grabbables} grabbable, ${s.pressables} pressable, ${s.moving} moving, ${s.panels} panel(s)`);
for (const f of fix) console.log(f);
for (const n of note) console.log(n);
if (!fix.length) console.log('game ok');
process.exit(fix.length ? 1 : 0);
