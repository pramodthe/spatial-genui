// Start a lesson in a look: writes one module (the look kit, the look's XR module, the starter) that passes the gate
// as it is, with the look's demo on its set and working hand targets. Each look's skill calls this through its own
// scripts/new-lesson.mjs. Usage: node new-lesson.mjs <look> [/work/module.js] [--force]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const looks = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOOKS = {
  voxel: 'voxelLook', 'soft-clay': 'softClayLook', 'low-poly': 'lowPolyLook',
  'ink-toon': 'inkToonLook', painted: 'paintedLook', 'paper-pop-up': 'paperPopUpLook', 'exploded-view': 'explodedViewLook',
  'circuit-city': 'circuitCityLook',
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
const read = (p) => readFileSync(join(looks, p), 'utf8');
writeFileSync(out, [
  read('shared/look-kit.js'),
  read(`${look}/assets/${look}.js`),
  read('shared/starter.js').replaceAll('__LOOK__', LOOKS[look]),
].join('\n\n'));
console.log(`${out}: the ${look} look (${LOOKS[look]}), its demo and the hand wiring. Next, from the ${look} skill:`);
console.log(`- replace look.demo(subject) with the lesson's parts, built from references/recipes.md, and its hand targets`);
console.log('- replace STEPS, the panel title and the press handlers (references/teaching.md)');
console.log(`- check: node ${join(looks, look, 'scripts/check.mjs')} ${out}`);
