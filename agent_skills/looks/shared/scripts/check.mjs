// Check a lesson in a look: the app's gate and dry run, the hand rules every look shares, then the look's own rules
// (looks/<look>/scripts/rules.json). Prints FIX lines (must change) and NOTE lines; exits 1 while any FIX is left.
// Each look's skill calls this through its own scripts/check.mjs. Usage: node check.mjs <look> [/work/module.js]
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const looks = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const look = process.argv[2];
const file = process.argv[3] ?? '/work/module.js';
const code = readFileSync(file, 'utf8');
const dry = spawnSync('node', [join(looks, '..', 'common', 'dry-run', 'scripts', 'check.mjs'), file], { encoding: 'utf8' });
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

// The hand rules every look keeps (shared/hands.md).
if (grabs + presses === 0) fix.push('No hand target on the model: add traits(part, { grab: true }) or traits(part, { onPress }) (shared/hands.md).');
else if (grabs + presses < 2) note.push('Only one hand target. Most lessons need one per step: a part to pick up or a stop to press.');
if ((s.crowdedGrabPairs ?? 0) > 0) note.push(`${s.crowdedGrabPairs} pairs of grabbable objects closer than 4 cm: fine for parts of one whole, else move them apart.`);
if (/traits\(\s*(set|board|island|book|plinth|page|sheet|floor|ground|root|subject|scene|city|world)\s*[,)]/i.test(code)) fix.push('A set, the subject group or the whole scene is given traits: grab the pieces, not the scene.');
if (/grab:\s*true/.test(code) && !/lookSeat\(/.test(code)) note.push('Grabbable parts without lookSeat: a part let go should slide home near its place (shared/hands.md).');
if (/look\.demo\(/.test(code)) fix.push("The look's demo is still in the lesson: replace look.demo(subject) with the lesson's own parts.");
if (/REPLACE/.test(code)) note.push("REPLACE markers left: fill in the lesson's steps, panel and press handlers.");
if (s.triangles > 150000 || s.drawCalls > 150) fix.push(`Over budget: ${s.triangles} triangles, ${s.drawCalls} draw calls (max 150,000 and 150).`);

// The look's own rules: { "fix": [rule], "note": [rule] }, rule = { "pattern", "flags"?, "when": "present"|"absent", "message" }.
const rulesFile = join(looks, look ?? '', 'scripts', 'rules.json');
if (look && existsSync(rulesFile)) {
  const rules = JSON.parse(readFileSync(rulesFile, 'utf8'));
  // Look rules judge the lesson's own code (from `export default` on), not the look kit and look module pasted above
  // it, which use materials and builders a lesson should not.
  const at = code.search(/^export\s+default\s+function/m);
  const lesson = at >= 0 ? code.slice(at) : code;
  for (const [kind, list] of [['fix', rules.fix ?? []], ['note', rules.note ?? []]]) {
    for (const rule of list) {
      // A learning game (LOOK_CHECK_GAME) skips the rules about a lesson's structure: stage flags, a route, a word per step.
      if (rule.lessonOnly && process.env.LOOK_CHECK_GAME) continue;
      const found = new RegExp(rule.pattern, rule.flags ?? '').test(rule.whole ? code : lesson);
      if ((rule.when === 'absent' && !found) || (rule.when !== 'absent' && found)) (kind === 'fix' ? fix : note).push(rule.message);
    }
  }
} else if (look) {
  note.push(`No rules for look "${look}" (${rulesFile}).`);
}

console.log(`gate ok: ${s.meshes} meshes, ${s.drawCalls} draw calls, ${s.triangles} triangles, ${grabs} grabbable, ${presses} pressable, ${s.panels} panel(s)`);
for (const f of fix) console.log(`FIX: ${f}`);
for (const n of note) console.log(`NOTE: ${n}`);
if (!fix.length) console.log('lesson ok');
// The play check (/skills/play/learning-game) reads the dry run's numbers from here instead of running it again.
if (process.env.LOOK_CHECK_STATS) console.log(`STATS ${JSON.stringify(s)}`);
process.exit(fix.length ? 1 : 0);
