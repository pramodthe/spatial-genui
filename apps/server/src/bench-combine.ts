// Combine several benchmark runs into one directory so a single report/gallery compares them.
// Each source is `<results dir>[:<model id>[=<label>]]`; a label renames that model in the combined
// view (e.g. to tell two system versions of the same model apart). Screenshots are referenced in
// place, not copied.
// Usage: npm run bench:combine -- --out ../../bench/results/<name> [--note "..."] <source> <source> ...
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const argv = process.argv.slice(2);
const outIndex = argv.indexOf('--out');
const noteIndex = argv.indexOf('--note');
if (outIndex < 0) {
  console.error('Usage: npm run bench:combine -- --out <dir> [--note "..."] <dir[:model[=label]]> ...');
  process.exit(1);
}
const outDir = resolve(argv[outIndex + 1]);
const note = noteIndex >= 0 ? argv[noteIndex + 1] : undefined;
const sources = argv.filter((_, i) => i !== outIndex && i !== outIndex + 1 && i !== noteIndex && i !== noteIndex + 1);

const readJsonl = async (file: string) =>
  existsSync(file) ? (await readFile(file, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];

const merged: Record<'results' | 'browser' | 'judge', string[]> = { results: [], browser: [], judge: [] };
let promptsFile: string | undefined;
const order: string[] = [];
for (const source of sources) {
  const [dirPart, modelPart] = source.split(':');
  const dir = resolve(dirPart);
  const [onlyModel, label] = modelPart ? modelPart.split('=') : [];
  const rename = (m: string) => (label && m === onlyModel ? label : m);
  const keep = (row: { model: string }) => !onlyModel || row.model === onlyModel;
  const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8').catch(() => '{}'));
  promptsFile ??= meta.promptsFile;

  for (const row of (await readJsonl(join(dir, 'results.jsonl'))).filter(keep)) {
    row.model = rename(row.model);
    if (!order.includes(row.model)) order.push(row.model);
    merged.results.push(JSON.stringify(row));
  }
  for (const row of (await readJsonl(join(dir, 'browser.jsonl'))).filter(keep)) {
    row.model = rename(row.model);
    if (row.shot) row.shot = relative(outDir, join(dir, row.shot)); // keep pointing at the source run's file
    merged.browser.push(JSON.stringify(row));
  }
  for (const row of (await readJsonl(join(dir, 'judge.jsonl'))).filter(keep)) {
    row.model = rename(row.model);
    merged.judge.push(JSON.stringify(row));
  }
}

await mkdir(outDir, { recursive: true });
for (const [name, lines] of Object.entries(merged)) await writeFile(join(outDir, `${name}.jsonl`), lines.join('\n') + '\n');
await writeFile(join(outDir, 'meta.json'), JSON.stringify({ combinedFrom: sources, promptsFile, note, models: order }, null, 2));
console.log(`${outDir}: ${order.join(', ')}`);
