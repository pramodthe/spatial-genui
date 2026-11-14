// Phase 4 hand-interaction matrix in the emulator: gathers the lessons to test (cases.jsonl), runs
// tests/interaction-matrix.mjs in batches until every lesson is done, and writes summary.md.
// Usage: node scripts/interaction-matrix.mjs [results dir, default ../../bench/results/interaction-matrix]
// Sources (columns): the hand-written fixtures; saved course lessons (open code), split by whether the course has
// its own 3D model; the ready-made library lessons; and RQ1's A2UI and template lessons (Sonnet, first repetition).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(app, '../..');
const dir = resolve(process.argv[2] ?? join(repo, 'bench/results/interaction-matrix'));
mkdirSync(dir, { recursive: true });

const SOURCES = [
  ['hand-written', 'Hand-written'],
  ['open-code', 'Open code (course lessons)'],
  ['course-model', 'Course model (TRELLIS + Blender parts)'],
  ['library', 'Library GLB (ready-made lessons)'],
  ['a2ui', 'A2UI (version C)'],
  ['templates', 'Templates (version D)'],
];

const readJsonl = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

function gatherCases() {
  const cases = [];
  for (const name of ['matrix-basic', 'matrix-rig']) {
    cases.push({ id: `hand-written/${name}`, source: 'hand-written', label: name, code: readFileSync(join(app, 'tests/fixtures', `${name}.js`), 'utf8') });
  }
  const lessons = JSON.parse(execFileSync('sqlite3', ['-json', join(repo, 'data/app.db'),
    "select l.course_id, l.idx, l.title, l.model, l.code, c.model is not null as has_model from lessons l join courses c on c.id = l.course_id where l.status = 'ready' and l.code is not null order by l.course_id, l.idx"], { encoding: 'utf8', maxBuffer: 64 << 20 }) || '[]');
  for (const l of lessons) {
    cases.push({ id: `course/${l.course_id}/${l.idx}`, source: l.has_model ? 'course-model' : 'open-code', label: `${l.title} (${l.model})`, code: l.code });
  }
  const ready = join(app, 'public/lessons');
  for (const file of readdirSync(ready).filter((f) => f.endsWith('.json')).sort()) {
    const lesson = JSON.parse(readFileSync(join(ready, file), 'utf8'));
    cases.push({ id: `library/${lesson.id}`, source: 'library', label: lesson.prompt, code: lesson.code });
  }
  for (const [source, run] of [['a2ui', 'rq1-a2ui-v3-sonnet'], ['templates', 'rq1-template-v2']]) {
    for (const row of readJsonl(join(repo, 'bench/results', run, 'results.jsonl'))) {
      if (row.ok && row.code && row.rep === 0 && row.model === 'claude-sonnet-5-5') cases.push({ id: `${source}/${row.promptId}`, source, label: row.promptId, code: row.code });
    }
  }
  return cases;
}

const casesFile = join(dir, 'cases.jsonl');
if (!existsSync(casesFile)) {
  const cases = gatherCases();
  writeFileSync(casesFile, cases.map((c) => JSON.stringify(c)).join('\n') + '\n');
  console.error(`${cases.length} lessons to test: ${SOURCES.map(([s]) => `${s} ${cases.filter((c) => c.source === s).length}`).join(', ')}`);
}

let remaining = null;
for (let batch = 1; batch <= 200; batch++) {
  const res = spawnSync('npx', ['@iwsdk/cli', 'browser', 'run', 'tests/interaction-matrix.mjs', '--timeout', '108000'], {
    cwd: app, env: { ...process.env, MATRIX_DIR: dir }, encoding: 'utf8',
  });
  let out;
  try {
    out = JSON.parse(res.stdout);
  } catch {
    console.error(res.stdout || res.stderr);
    process.exit(1);
  }
  const result = out?.data?.result;
  if (!out.ok || !result || result.error) {
    console.error(JSON.stringify(out.error ?? result, null, 2));
    process.exit(1);
  }
  console.error(`batch ${batch}: ${result.processed} processed, ${result.remaining} remaining`);
  remaining = result.remaining;
  if (remaining === 0) break;
  if (result.processed === 0) {
    console.error('No progress in this batch; stopping.');
    process.exit(1);
  }
}

if (remaining !== 0) {
  console.error(`Stopped after 200 batches with ${remaining} lessons still untested; not writing a summary that would undercount.`);
  process.exit(1);
}

// --- Summary --------------------------------------------------------------------------------------------------
// The latest row per lesson; a cell is "worked / tried" over the lessons of that source that offer the interaction.
const rows = new Map();
for (const row of readJsonl(join(dir, 'emulator.jsonl'))) if (!row.harnessError || !rows.has(row.id)) rows.set(row.id, row);
const all = [...rows.values()];

// [row name, probe key, whether the probe passed]
const INTERACTIONS = [
  ['Direct grab (near pinch), carried 10 cm', 'touchGrab', (p) => p.worked],
  ['Distance grab (pinch ray), carried 10 cm', 'rayGrab', (p) => p.worked],
  ['Grab one part of a model', 'partGrab', (p) => p.worked],
  ['Panel button, point and pinch (up to 3 per lesson, all must work)', 'panelRay', (p) => p.worked === p.tested],
  ['Panel button, fingertip poke', 'panelPoke', (p) => p.worked],
  ['Panel toggle, point and pinch', 'toggle', (p) => p.worked],
  ['Panel slider, point, pinch and sweep', 'slider', (p) => p.worked],
  ['3D object press, point and pinch', 'press3dRay', (p) => p.worked],
  ['3D object press, fingertip poke', 'poke3d', (p) => p.worked],
  ['Explode a model (parts move apart)', 'explode', (p) => p.worked],
  ['Move bar: point, pinch and drag the lesson', 'moveBar', (p) => p.worked],
];

const lines = [];
const mounted = (s) => all.filter((r) => r.source === s && r.mounted);
lines.push('# Hand-interaction matrix, emulator', '');
lines.push(`Run ${new Date().toISOString().slice(0, 10)}: IWSDK emulator (Meta Quest 3 profile), emulated right hand, seated head pose. Each cell is lessons where it worked / lessons that offer it. "-" means no lesson of that source offers it.`, '');
lines.push(`| Interaction | ${SOURCES.map(([, label]) => label).join(' | ')} |`);
lines.push(`|---|${SOURCES.map(() => '---').join('|')}|`);
lines.push(`| Lessons mounted / tested | ${SOURCES.map(([s]) => `${mounted(s).length} / ${all.filter((r) => r.source === s).length}`).join(' | ')} |`);
for (const [name, key, worked] of INTERACTIONS) {
  const cells = SOURCES.map(([s]) => {
    const tried = mounted(s).filter((r) => r.probes?.[key] !== undefined);
    return tried.length ? `${tried.filter((r) => worked(r.probes[key])).length} / ${tried.length}` : '-';
  });
  lines.push(`| ${name} | ${cells.join(' | ')} |`);
}
lines.push(`| Two-hand scale or rotate | ${SOURCES.map(() => 'not built').join(' | ')} |`, '');

lines.push('## Failures', '');
const failures = [];
for (const r of all) {
  if (r.harnessError) failures.push(`- \`${r.id}\`: harness error: ${r.harnessError}`);
  else if (!r.mounted) failures.push(`- \`${r.id}\`: did not mount: ${r.mountError}`);
  for (const [name, key, worked] of INTERACTIONS) {
    const probe = r.probes?.[key];
    if (probe !== undefined && !worked(probe)) failures.push(`- \`${r.id}\` (${r.label}): ${name}: \`${JSON.stringify(probe)}\``);
  }
}
lines.push(...(failures.length ? failures : ['None.']), '');
writeFileSync(join(dir, 'summary.md'), lines.join('\n'));
console.log(lines.join('\n'));
