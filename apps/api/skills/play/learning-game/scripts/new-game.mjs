// Start a learning game: writes one module (the look kit, the look, the play kit, the play starter) that passes the
// gate as it is, with the look's demo pieces, a move to learn, a challenge, stars and Try again.
// Usage: node new-game.mjs <look> [/work/module.js] [--force]
// <look>: one of the looks in /skills/looks (soft-clay, voxel, ...), or plain for the kit's realistic materials.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
if (existsSync(out) && !process.argv.includes('--force')) {
  console.log(`${out} exists. Add --force to replace it, or edit it.`);
  process.exit(1);
}
const read = (p) => readFileSync(p, 'utf8');
writeFileSync(out, [
  `// learning-game look: ${look}`,
  read(join(looks, 'shared', 'look-kit.js')),
  read(look === 'plain' ? join(here, 'assets', 'plain.js') : join(looks, look, 'assets', `${look}.js`)),
  read(join(here, 'assets', 'play-kit.js')),
  read(join(here, 'assets', 'play-starter.js')).replaceAll('__LOOK__', LOOKS[look]),
].join('\n\n'));
console.log(`${out}: a learning game in the ${look} look, with its demo pieces. Next:`);
console.log('- plan it first in /work/plan.md (references/design.md): goal, the moves and their whys, the challenge');
console.log(`- replace look.demo(subject) with the game's pieces${look === 'plain' ? ' (kit materials, /skills/common/kit)' : `, built with the ${look} skill's builders (/skills/looks/${look})`}`);
console.log('- replace TITLE, GOAL, MOVES and CHALLENGE, and make the scene answer every hand action (references/feel.md)');
console.log(`- check: node ${join(here, 'scripts', 'check.mjs')} ${out}`);
