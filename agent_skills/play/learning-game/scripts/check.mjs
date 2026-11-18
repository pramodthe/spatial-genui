// Check a learning game: the app's gate and dry run, the hand rules and the look's rules (the shared look check),
// then the play rules (a goal, moves with a why, a measured result, Try again, a scene that moves).
// Prints FIX lines (must change) and NOTE lines; exits 1 while any FIX is left. Usage: node check.mjs [/work/module.js]
// A game written as /work/game.js on /work/kits.js is built into module.js first, and lines are given in game.js.
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleParts } from './assemble.mjs';
import { buildModule, toGameLines } from './build-module.mjs';
import { readScene } from './layout.mjs';

const here = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2] ?? '/work/module.js';
// The team's latest parts go in first (identity, sounds), then module.js is built from kits.js and game.js, so what
// is checked is what the headset gets.
const gameFile = join(dirname(file), 'game.js');
const source = existsSync(gameFile) && existsSync(join(dirname(file), 'kits.js')) ? gameFile : file;
const partProblems = /---- parts \(/.test(readFileSync(source, 'utf8')) ? assembleParts(source) : [];
const offset = buildModule(file);
const code = readFileSync(file, 'utf8');
// new-game.mjs writes the look on the first line; plain has no look rules.
const look = (code.match(/^\/\/ learning-game look: ([\w-]+)/) ?? [])[1] ?? '';
const shared = spawnSync('node', [join(here, '..', '..', 'looks', 'shared', 'scripts', 'check.mjs'), look === 'plain' ? '' : look, file], {
  encoding: 'utf8', env: { ...process.env, LOOK_CHECK_STATS: '1', LOOK_CHECK_GAME: '1' },
});
const lines = (shared.stdout || shared.stderr || '').trim().split('\n');
const statsLine = lines.find((l) => l.startsWith('STATS '));
if (!statsLine) {
  console.log(toGameLines(lines.join('\n'), offset));
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
for (const p of partProblems) add(fix, p);
// The app shows the game's name as its opening title card: a sign with the name would stay in the game for good.
const titleText = (code.match(/const\s+IDENTITY\s*=\s*\{[\s\S]{0,800}?\btitle:\s*(['"`])((?:(?!\1).){1,60})\1/) ?? [])[2];
const named = titleText ? new RegExp(`kit\\.(sign|card)\\(\\s*(['"\`])${titleText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\2`, 'i') : null;
if (/kit\.(sign|card)\(\s*IDENTITY\.title/.test(game) || (named && named.test(game))) add(fix, "A sign with the game's name: the app shows the name as a title card when the game opens, then it fades. Remove the title sign.");
if (/Touch every piece|Piece by piece/.test(code)) add(fix, "The starter's own title or challenge is still in: write the game's own (references/design.md).");
if (!/\{\s*stat:/.test(game)) add(fix, 'No measured result on the panel: the challenge ends with a number the player can beat ({ stat } part).');
if (!/label:\s*['"`](Try again|Play again|Again|Retry)/i.test(game)) add(fix, 'No Try again button: the player must be able to beat their result with one press.');
if (!/\bwhy\s*:/.test(game)) add(fix, 'No why: each move says in one short line why it matters (references/design.md).');
if ((s.moving ?? 0) === 0) add(fix, 'Nothing moves in the first second: the scene must feel alive (water, a bob, a nudge on the next thing to touch; references/feel.md).');
const behind = game.match(/kit\.panel\(\s*ui\s*,\s*\{[\s\S]{0,200}?position:\s*\[[^,\]]+,[^,\]]+,\s*(-\s*0?\.\d+|-\s*\d+(?:\.\d+)?)\s*\]/);
if (behind && Number(behind[1].replace(/\s/g, '')) < -0.1) add(fix, 'The panel stands behind the game: a pointing hand cannot reach its buttons past the scene. Put it beside the game, as the starter does.');
if ((s.sounds ?? 0) === 0 && !/\bsfx\.|\bsound\.(play|tone|note|hum)\(/.test(game)) add(note, 'No sound: answer the hands with sound.play (/skills/common/sound), and teach with it when the idea is about sound.');
if (!/playStars\(|stars?\b/i.test(game)) add(note, 'No stars or best result: a reward for doing well makes Try again worth it.');
if ((s.grabbables ?? 0) === 0) add(note, 'Nothing to pick up: most learning games are best when the hands move the main thing (references/design.md).');
// The layout as the player sees it, measured on the built scene by the dry run (hidden targets, the start spot,
// reach, label sizes; a world's rules are in references/world.md).
if (process.env.LAYOUT_CHECK !== '0') for (const f of s.layout?.findings ?? []) add(f.level === 'fix' ? fix : note, `Layout: ${f.text}`);
// The scene plan (parts/scene.js, references/scene.md), when the game has one: placed, placed from the plan as it is
// now, and every thing of it built, no bigger than the box it was placed with.
const sceneFile = join(dirname(file), 'parts', 'scene.js');
if (process.env.SCENE_PLAN !== '0' && existsSync(sceneFile)) {
  let part = null;
  try {
    part = readScene(sceneFile);
  } catch (err) {
    add(fix, `Scene: parts/scene.js does not run: ${String(err?.message ?? err).slice(0, 160)}`);
  }
  const again = 'node /skills/play/learning-game/scripts/layout.mjs /work/module.js';
  if (part && !part.scene) add(fix, 'Scene: parts/scene.js must define const SCENE = { mode, things, relations } (references/scene.md).');
  else if (part && !part.places) add(fix, `Scene: the plan is not placed. Run \`${again}\`: it says which thing finds no place and why.`);
  else if (part && !part.fresh) add(fix, `Scene: SCENE changed since it was placed. Run \`${again}\`: it places the plan again, or says which thing finds no place and why.`);
  else if (part) {
    for (const [name, placed] of Object.entries(part.places)) {
      const thing = part.scene.things[name];
      if (!thing || thing.role === 'panel') continue;
      const built = s.things?.[name] ?? [];
      const planned = Array.isArray(placed) ? placed.length : 1;
      if (built.length === 0) {
        add(fix, `Scene: \`${name}\` is in the plan and nowhere in the game. Build it and stand it with sceneAt(THREE, object, '${name}', { ground }), or take it out of SCENE.`);
        continue;
      }
      if (built.length < planned) add(note, `Scene: ${built.length} of the plan's ${planned} \`${name}\` are in the game.`);
      const size = built[0].size;
      const text = (v) => v.map((n) => Number(n.toFixed(3))).join(' x ');
      if (size.some((n, i) => n > thing.size[i] * 1.3 + 0.005)) {
        add(fix, `Scene: \`${name}\` is built ${text(size)}, bigger than the ${text(thing.size)} its place was found for. Write its real size in SCENE and run \`${again}\`, or build it smaller.`);
      } else if (size.every((n, i) => n < thing.size[i] * 0.5)) {
        add(note, `Scene: \`${name}\` is built ${text(size)}, much smaller than the ${text(thing.size)} of its plan: the plan keeps more room for it than it needs.`);
      }
    }
  }
}
// The play-through: a simulated hand plays the game as its `play` block says (references/play.md), in the gate's
// dry run. Its FIX findings count like any other; PLAY_CHECK=note reports them without failing the check, and
// PLAY_CHECK=0 skips the play-through (the server passes CODER_PLAY_CHECK here).
const playCheck = process.env.PLAY_CHECK ?? '1';
let played = '';
if (playCheck !== '0') {
  const strict = playCheck !== 'note';
  if (!s.play) add(strict ? fix : note, 'Play: build() returns no `play` block, so nothing can play the game through (references/play.md).');
  else {
    for (const f of s.play.findings ?? []) add(strict && f.level === 'fix' ? fix : note, `Play: ${f.text}`);
    const r = s.play.rounds ?? {};
    const round = (x) => (x?.phase === 'done' ? `${x.stars} star${x.stars === 1 ? '' : 's'} (result ${Number(x.result).toFixed(2)})` : 'no result');
    if (r.played) played = `played through: ${round(r.played)} as play.challenge plays it, ${round(r.slow)} at 30 frames a second, ${round(r.idle)} with no hand`;
  }
}
for (const m of game.matchAll(/\bwhy:\s*(['"`])((?:(?!\1).)*)\1/g)) {
  const words = m[2].trim().split(/\s+/).length;
  if (words > 22) add(note, `A why of ${words} words ("${m[2].slice(0, 40)}..."): keep each to one short line, about 15 words.`);
}
for (const m of game.matchAll(/\btext:\s*(['"`])((?:(?!\1).)*)\1/g)) {
  const words = m[2].trim().split(/\s+/).length;
  if (words > 30) add(note, `Panel text of ${words} words ("${m[2].slice(0, 40)}..."): players read 2 short sentences at most; the rest is doing.`);
}

console.log(`gate ok: ${s.meshes} meshes, ${s.drawCalls} draw calls, ${s.triangles} triangles, ${s.grabbables} grabbable, ${s.pressables} pressable, ${s.moving} moving, ${s.panels} panel(s)`);
if (played) console.log(played);
for (const f of fix) console.log(toGameLines(f, offset));
for (const n of note) console.log(toGameLines(n, offset));
if (!fix.length) console.log('game ok');
process.exit(fix.length ? 1 : 0);
