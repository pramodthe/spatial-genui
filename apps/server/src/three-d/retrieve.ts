// Tier C of docs/3d-architecture.md (section 4.3): find an existing open-licence model instead of
// generating one, for each object of a benchmark set (the stage itself is retrieveModel in stages.ts):
// Muse Ember turns the request into search terms; objaverse_retrieve.py searches Objaverse (CC0 / CC BY
// only) and ranks the matches by DINOv3 similarity to the object's reference picture; each of the best
// few is rendered from four angles; Ember sees the reference and the renders and picks the one that fits
// the request, or rejects them all (the router then moves on to generation). Picked GLBs land in
// <out>/glbs/<object id>.glb for bench3d:import and the judge.
// Usage: npm run bench3d:retrieve -- [--objects bench/prompts/objects-12.json] [--refs <dir of ref__<id>.jpg>]
//          [--out bench/results/_3d-retrieval] [--only id,id] [--top 6]
import { existsSync } from 'node:fs';
import { appendFile, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseCli } from '../args.js';
import type { AssetRequest } from './prompts.js';
import { closeRenderer } from './render.js';
import { ember, repoRoot, retrieveModel } from './stages.js';

const cli = parseCli(process.argv.slice(2), {
  values: ['objects', 'refs', 'out', 'only', 'top'],
  usage: 'npm run bench3d:retrieve -- [--objects file] [--refs dir] [--out dir] [--only id,id] [--top n]',
});
const objects = (JSON.parse(await readFile(resolve(repoRoot, cli.flags.objects ?? 'bench/prompts/objects-12.json'), 'utf8')) as AssetRequest[])
  .filter((o) => !cli.flags.only || cli.flags.only.split(',').includes(o.id));
const refs = resolve(repoRoot, cli.flags.refs ?? 'bench/results/3d-run-1/gallery');
const outDir = resolve(repoRoot, cli.flags.out ?? 'bench/results/_3d-retrieval');
const top = Number(cli.flags.top ?? 6);
await mkdir(join(outDir, 'glbs'), { recursive: true });
await mkdir(join(outDir, 'renders'), { recursive: true });

const rowsFile = join(outDir, 'retrieval.jsonl');
const done = new Set(existsSync(rowsFile) ? (await readFile(rowsFile, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l).objectId as string) : []);
await writeFile(join(outDir, 'meta.json'), JSON.stringify({
  objectsFile: cli.flags.objects ?? 'bench/prompts/objects-12.json', refs, top, picker: (await ember()).id, source: 'Objaverse 1.0 (CC0 and CC BY only)',
  imageRerank: 'DINOv3 ViT-L/16 class token, cosine to the reference picture', updatedAt: new Date().toISOString(),
}, null, 2));

for (const obj of objects) {
  if (done.has(obj.id)) continue;
  const started = performance.now();
  const found = await retrieveModel({
    prompt: obj.prompt, parts: obj.parts, fallbackTerm: obj.id.replace(/-/g, ' '), reference: join(refs, `ref__${obj.id}.jpg`), top,
    onRender: (uid, grid) => writeFile(join(outDir, 'renders', `${obj.id}__${uid}.jpg`), grid),
  });
  if (found.choice) await copyFile(found.choice.glb, join(outDir, 'glbs', `${obj.id}.glb`));
  const ms = Math.round(performance.now() - started);
  await appendFile(rowsFile, JSON.stringify({ objectId: obj.id, ...found, ms }) + '\n');
  console.error(`${obj.id.padEnd(16)} ${found.choice ? `picked "${found.choice.name}" (${found.choice.licence}, ${found.choice.author})` : `none: ${String(found.reason ?? found.error).slice(0, 100)}`}  ${(ms / 1000).toFixed(0)} s`);
}
await closeRenderer();
