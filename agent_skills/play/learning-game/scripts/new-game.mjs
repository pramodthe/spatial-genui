// Start a learning game that passes the gate as it is, with the look's demo pieces, a move to learn, a challenge, stars
// and Try again. Writes /work/game.js (the game's own code: the parts and the play starter; the file to edit),
// /work/kits.js (the look kit, the look, the play, ECS, motion and world kits: ready, never edited) and /work/module.js built
// from the two (scripts/build-module.mjs). Usage: node new-game.mjs <look> [/work/module.js] [--force] [--world]
// --world: a world around the player instead of a toy on the desk (references/world.md).
// <look>: one of the looks in /skills/looks (soft-clay, voxel, ...), or plain for the kit's realistic materials.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { assembleParts, PARTS_START, PARTS_END } from './assemble.mjs';
import { buildModule } from './build-module.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = join(dirname(fileURLToPath(import.meta.url)), '..');
const looks = join(here, '..', '..', 'looks');
const LOOKS = {
  voxel: 'voxelLook', 'soft-clay': 'softClayLook', 'low-poly': 'lowPolyLook', 'ink-toon': 'inkToonLook',
  painted: 'paintedLook', 'paper-pop-up': 'paperPopUpLook', 'exploded-view': 'explodedViewLook',
  'circuit-city': 'circuitCityLook', plain: 'plainLook',
};
const look = process.argv[2];
const out = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : '/work/module.js';
if (!LOOKS[look]) {
  console.log(`Unknown look "${look ?? ''}". Looks: ${Object.keys(LOOKS).join(', ')}`);
  process.exit(1);
}
const gameFile = join(dirname(out), 'game.js');
const kitsFile = join(dirname(out), 'kits.js');
if ((existsSync(out) || existsSync(gameFile)) && !process.argv.includes('--force')) {
  console.log(`${existsSync(gameFile) ? gameFile : out} exists. Add --force to replace it, or edit ${gameFile}.`);
  process.exit(1);
}
const read = (p) => readFileSync(p, 'utf8');
// The game's parts (references/parts.md): the starter's own identity and sounds until the coder writes its own.
const parts = join(dirname(out), 'parts');
mkdirSync(parts, { recursive: true });
for (const name of ['identity.js', 'sounds.js']) {
  if (!existsSync(join(parts, name)) || process.argv.includes('--force')) copyFileSync(join(here, 'assets', 'parts', name), join(parts, name));
}
writeFileSync(kitsFile, [
  `// learning-game look: ${look}`,
  '// The kits a learning game uses, ready as they are: every function here is in scope in game.js. Their APIs are in',
  '// the skills (the look kit and the look: /skills/looks; the play kit: assets/play-kit.js; the ECS kit: /skills/common/ecs;',
  '// the motion kit: /skills/game/motion).',
  read(join(looks, 'shared', 'look-kit.js')),
  read(look === 'plain' ? join(here, 'assets', 'plain.js') : join(looks, look, 'assets', `${look}.js`)),
  read(join(here, 'assets', 'play-kit.js')),
  read(join(here, '..', '..', 'common', 'ecs', 'assets', 'ecs-kit.js')),
  read(join(here, '..', '..', 'game', 'motion', 'assets', 'motion-kit.js')),
  ...(process.argv.includes('--world') ? [read(join(here, 'assets', 'world-kit.js'))] : []),
].join('\n\n'));
writeFileSync(gameFile, [
  `${PARTS_START}\n${PARTS_END}`,
  read(join(here, 'assets', 'play-starter.js')).replaceAll('__LOOK__', LOOKS[look]).replaceAll('__WORLD__', String(process.argv.includes('--world'))),
].join('\n\n'));
assembleParts(gameFile);
buildModule(out);
console.log(`${gameFile}: a learning game in the ${look} look${process.argv.includes('--world') ? ', as a world around the player (references/world.md)' : ''}, with its demo pieces. Next:`);
console.log(`- edit ${gameFile} only: it is the game. ${kitsFile} holds the kits (all in scope; do not read or edit it). The check and`);
console.log(`  the play-test build ${out} from the two, so never edit ${out}`);
console.log(`- the game's identity and sounds are parts: ${parts}/identity.js and sounds.js (references/parts.md)`);
console.log('- plan it first in /work/plan.md (references/design.md): goal, the moves and their whys, the challenge');
console.log(`- replace look.demo(subject) with the game's pieces${look === 'plain' ? ' (kit materials, /skills/common/kit)' : `, built with the ${look} skill's builders (/skills/looks/${look})`}`);
console.log('- replace MOVES and CHALLENGE, and make the scene answer every hand action (references/feel.md)');
console.log(`- check: node ${join(here, 'scripts', 'check.mjs')} ${out}`);
