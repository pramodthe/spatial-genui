// M5, P3-SAM path: Muse Ember names the clean 3D regions P3-SAM cut (apps/worker3d/modal_parts.py)
// from one highlight render per region, in the lesson's words; regions with the same name become one
// part (the stage itself is nameRegions in stages.ts). Expects work folders from bench3d:segment with
// regions.npy (segment.py p3sam).
// Usage: npm run bench3d:name-regions -- --glbs <dir of <id>.glb> --tag <work tag> --out <dir>
//          [--objects bench/prompts/objects-12.json] [--only id,id]
// Writes <out>/segment.jsonl (for bench3d:judge-parts) and <out>/parts/<id>.jpg.
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseCli } from '../args.js';
import type { AssetRequest } from './prompts.js';
import { closeRenderer, renderGlb } from './render.js';
import { nameRegions, repoRoot } from './stages.js';

const cli = parseCli(process.argv.slice(2), {
  values: ['glbs', 'tag', 'out', 'objects', 'only'],
  usage: 'npm run bench3d:name-regions -- --glbs <dir> --tag <work tag> --out <dir> [--objects file] [--only id,id]',
});
if (!cli.flags.glbs || !cli.flags.tag || !cli.flags.out) {
  console.error('Usage: npm run bench3d:name-regions -- --glbs <dir> --tag <work tag> --out <dir> [--only id,id]');
  process.exit(1);
}
const glbDir = resolve(repoRoot, cli.flags.glbs);
const work = join(repoRoot, 'data/segment-work', cli.flags.tag);
const outDir = resolve(repoRoot, cli.flags.out);
const requests = new Map((JSON.parse(await readFile(resolve(repoRoot, cli.flags.objects ?? 'bench/prompts/objects-12.json'), 'utf8')) as AssetRequest[]).map((o) => [o.id, o]));

await mkdir(join(outDir, 'parts'), { recursive: true });
const rowsFile = join(outDir, 'segment.jsonl');
const done = new Set(existsSync(rowsFile) ? (await readFile(rowsFile, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l).objectId as string) : []);
const ids = (await readdir(work)).filter((id) => existsSync(join(work, id, 'regions.npy')) && existsSync(join(glbDir, `${id}.glb`)))
  .filter((id) => !done.has(id) && (!cli.flags.only || cli.flags.only.split(',').includes(id)));

for (const id of ids) {
  const started = performance.now();
  const dir = join(work, id);
  const row: Record<string, unknown> = { objectId: id };
  try {
    const request = requests.get(id);
    const named = await nameRegions({ glbPath: join(glbDir, `${id}.glb`), dir, request: { prompt: request?.prompt ?? id, parts: request?.parts } });
    const preview = await renderGlb(await readFile(join(dir, 'parts.glb')));
    if ('grid' in preview) await writeFile(join(outDir, 'parts', `${id}.jpg`), preview.grid);
    Object.assign(row, { ok: true, regions: named.regions, parts: named.parts });
  } catch (err) {
    Object.assign(row, { ok: false, error: (err as Error).message.slice(0, 300) });
  }
  row.ms = Math.round(performance.now() - started);
  await appendFile(rowsFile, JSON.stringify(row) + '\n');
  console.error(`${id.padEnd(16)} ${row.ok ? `${row.regions} regions -> ${(row.parts as string[]).join(', ')}` : `failed: ${row.error}`}  ${((row.ms as number) / 1000).toFixed(0)} s`);
}
await closeRenderer();
