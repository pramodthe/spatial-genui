// Start a lesson in a look: writes one module (look-kit + the look's XR module + the starter) that passes the gate as
// it is, with the look's demo on its set and working hand targets. Then replace the demo with the lesson.
// Usage: node /skills/common/styles/scripts/new-lesson.mjs <look> [/work/module.js]
// Looks: voxel, soft-clay, low-poly, pencil-sketch, ink-toon, painted, paper-pop-up, exploded-view, circuit-city
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const skill = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOOKS = {
  voxel: 'voxelLook', 'soft-clay': 'softClayLook', 'low-poly': 'lowPolyLook', 'pencil-sketch': 'pencilSketchLook',
  'ink-toon': 'inkToonLook', painted: 'paintedLook', 'paper-pop-up': 'paperPopUpLook', 'exploded-view': 'explodedViewLook',
  'circuit-city': 'circuitCityLook',
};
const ALIASES = { 'ink-and-toon': 'ink-toon', pencil: 'pencil-sketch', clay: 'soft-clay', 'pop-up': 'paper-pop-up', exploded: 'exploded-view', circuit: 'circuit-city' };
const look = ALIASES[process.argv[2]] ?? process.argv[2];
const out = process.argv[3] ?? '/work/module.js';
if (!LOOKS[look]) {
  console.log(`Unknown look "${process.argv[2] ?? ''}". Looks: ${Object.keys(LOOKS).join(', ')}`);
  process.exit(1);
}
if (existsSync(out) && !process.argv.includes('--force')) {
  console.log(`${out} exists. Add --force to replace it, or edit it.`);
  process.exit(1);
}
const read = (p) => readFileSync(join(skill, p), 'utf8');
const module = [
  read('assets/lib/look-kit.js'),
  read(`assets/styles/${look}.js`),
  read('assets/starter.js').replaceAll('__LOOK__', LOOKS[look]),
].join('\n\n');
writeFileSync(out, module);
console.log(`${out}: the ${look} look (${LOOKS[look]}), its demo and the hand wiring. Next:`);
console.log(`- read references/briefs/${look === 'ink-toon' ? 'ink-and-toon' : look}.md and references/hands.md`);
console.log('- replace look.demo(subject) with the lesson\'s parts (built with the look\'s helpers) and its hand targets');
console.log('- replace STEPS and the panel title; keep the set, the subject group, the seats and the bounce');
console.log(`- check: node ${join(skill, 'scripts/check-lesson.mjs')} ${out}`);
