// M5 self-check (section 4.7 verification, first piece): before named parts reach a lesson, Muse Ember
// looks at each part again, in solid red with the rest of the model faint, and keeps it, renames it,
// or merges it into the main body (not a meaningful part, or it can't tell what it is). A wrong label
// teaches something false, so it is told to be strict (the stage itself is verifyParts in stages.ts).
// Runs on work folders from bench3d:name-regions.
// Usage: npm run bench3d:verify-parts -- --glbs <dir of <id>.glb> --tag <work tag> --out <dir> [--only id,id]
// Writes <out>/segment.jsonl (for bench3d:judge-parts) and <out>/parts/<id>.jpg.
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseCli } from '../args.js';
import { closeRenderer, renderGlb } from '../../src/three-d/render.js';
import { repoRoot, verifyParts, type PartVerdict } from '../../src/three-d/stages.js';

const cli = parseCli(process.argv.slice(2), {
  values: ['glbs', 'tag', 'out', 'only'],
  usage: 'npm run bench3d:verify-parts -- --glbs <dir> --tag <work tag> --out <dir> [--only id,id]',
});
if (!cli.flags.glbs || !cli.flags.tag || !cli.flags.out) {
  console.error('Usage: npm run bench3d:verify-parts -- --glbs <dir> --tag <work tag> --out <dir> [--only id,id]');
  process.exit(1);
}
const glbDir = resolve(repoRoot, cli.flags.glbs);
const work = join(repoRoot, 'data/segment-work', cli.flags.tag);
const outDir = resolve(repoRoot, cli.flags.out);

await mkdir(join(outDir, 'parts'), { recursive: true });
const rowsFile = join(outDir, 'segment.jsonl');
const done = new Set(existsSync(rowsFile) ? (await readFile(rowsFile, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l).objectId as string) : []);
const ids = (await readdir(work)).filter((id) => existsSync(join(work, id, 'regions-merged.npy')) && existsSync(join(glbDir, `${id}.glb`)))
  .filter((id) => !done.has(id) && (!cli.flags.only || cli.flags.only.split(',').includes(id)));

for (const id of ids) {
  const started = performance.now();
  const dir = join(work, id);
  const row: Record<string, unknown> = { objectId: id };
  try {
    const checked = await verifyParts({ glbPath: join(glbDir, `${id}.glb`), dir, objectName: id.replace(/-/g, ' ') });
    const preview = await renderGlb(await readFile(join(dir, 'parts.glb')));
    if ('grid' in preview) await writeFile(join(outDir, 'parts', `${id}.jpg`), preview.grid);
    Object.assign(row, { ok: true, ...checked });
  } catch (err) {
    Object.assign(row, { ok: false, error: (err as Error).message.slice(0, 300) });
  }
  row.ms = Math.round(performance.now() - started);
  await appendFile(rowsFile, JSON.stringify(row) + '\n');
  const changes = ((row.verdicts as PartVerdict[] | undefined) ?? []).filter((v) => v.verdict !== 'keep').map((v) => `${v.name} ${v.verdict}${v.newName ? ` -> ${v.newName}` : ''}`);
  console.error(`${id.padEnd(16)} ${row.ok ? `${(row.parts as string[]).join(', ')}${changes.length ? `  [${changes.join('; ')}]` : ''}` : `failed: ${row.error}`}  ${((row.ms as number) / 1000).toFixed(0)} s`);
}
await closeRenderer();
