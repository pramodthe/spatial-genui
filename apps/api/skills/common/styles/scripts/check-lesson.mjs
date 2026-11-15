// Check a styled lesson: the app's gate and dry run, then the hands and the look. Prints what to fix; exits 1 if any.
// Usage: node /skills/common/styles/scripts/check-lesson.mjs [/work/module.js]
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = process.argv[2] ?? '/work/module.js';
const skill = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = readFileSync(file, 'utf8');
const dry = spawnSync('node', [join(skill, '../dry-run/scripts/check.mjs'), file], { encoding: 'utf8' });
let report;
try { report = JSON.parse((dry.stdout || '').trim().split('\n').pop()); } catch { report = null; }
if (!report || !report.ok) {
  console.log('GATE: not ok. Fix this first:');
  console.log((dry.stdout || dry.stderr || '').trim().slice(0, 3000));
  process.exit(1);
}
const s = report.stats ?? {};
const fix = [];
const note = [];
const grabs = s.grabbables ?? 0;
const presses = s.pressables ?? 0;
if (grabs + presses === 0) fix.push('No hand target on the model: add traits(part, { grab: true }) or traits(part, { onPress }) (references/hands.md).');
else if (grabs + presses < 2) note.push('Only one hand target. Most lessons need one per step: a part to pick up or a stop to press.');
if ((s.crowdedGrabPairs ?? 0) > 0) note.push(`${s.crowdedGrabPairs} pairs of grabbable objects closer than 4 cm: fine for parts of one whole, else move them apart.`);
const setNames = /traits\(\s*(set|board|island|book|plinth|page|sheet|floor|ground|root|subject|scene|city|world)\s*[,)]/i;
if (setNames.test(code)) fix.push('A set, the subject group or the whole scene is given traits: grab the pieces, not the scene.');
if (/grab:\s*true/.test(code) && !/lookSeat\(/.test(code)) note.push('Grabbable parts without lookSeat: a part let go should slide home near its place (references/hands.md).');
if (!/\b(voxel|softClay|lowPoly|pencilSketch|inkToon|painted|paperPopUp|explodedView|circuitCity)Look\(THREE, kit\)/.test(code)) fix.push('No look module is used: start from scripts/new-lesson.mjs <look>.');
if (/look\.demo\(/.test(code)) fix.push('The look\'s demo is still in the lesson: replace look.demo(subject) with the lesson\'s own parts.');
if (/REPLACE/.test(code)) note.push('REPLACE markers left in the code: fill in the lesson\'s steps, panel and press handlers.');
if (s.triangles > 150000 || s.drawCalls > 150) fix.push(`Over budget: ${s.triangles} triangles, ${s.drawCalls} draw calls (max 150,000 and 150).`);
console.log(`gate ok: ${s.meshes} meshes, ${s.drawCalls} draw calls, ${s.triangles} triangles, ${grabs} grabbable, ${presses} pressable, ${s.panels} panel(s)`);
for (const f of fix) console.log(`FIX: ${f}`);
for (const n of note) console.log(`NOTE: ${n}`);
if (!fix.length) console.log('lesson ok');
process.exit(fix.length ? 1 : 0);
