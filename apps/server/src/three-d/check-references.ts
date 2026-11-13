// Check existing reference pictures with the on-demand path's checker (stages.ts): for each object of a
// benchmark set, Ember lists what a picture of it must show and scores the picture that was used. Shows
// how many generated models started from a picture that already had the mistake.
// Usage: npm run bench3d:check-refs -- [--objects bench/prompts/objects-12.json] [--refs <dir of ref__<id>.jpg>] [--out bench/results/_ref-check]
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseCli } from '../args.js';
import type { AssetRequest } from './prompts.js';
import { briefReference, checkReference, repoRoot } from './stages.js';

const cli = parseCli(process.argv.slice(2), { values: ['objects', 'refs', 'out'], usage: 'npm run bench3d:check-refs -- [--objects file] [--refs dir] [--out dir]' });
const objects = JSON.parse(await readFile(resolve(repoRoot, cli.flags.objects ?? 'bench/prompts/objects-12.json'), 'utf8')) as AssetRequest[];
const refs = resolve(repoRoot, cli.flags.refs ?? 'bench/results/3d-run-1/gallery');
const outDir = resolve(repoRoot, cli.flags.out ?? 'bench/results/_ref-check');
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'checks.jsonl'), '');
for (const obj of objects) {
  const parts = obj.parts.map((p) => p.replace(/_/g, ' '));
  const { asked, mustShow } = await briefReference({ name: obj.id.replace(/-/g, ' '), describe: obj.prompt, parts });
  const verdict = await checkReference(asked, mustShow, await readFile(join(refs, `ref__${obj.id}.jpg`)));
  await appendFile(join(outDir, 'checks.jsonl'), JSON.stringify({ objectId: obj.id, ...verdict, mustShow }) + '\n');
  console.error(`${obj.id.padEnd(16)} ${verdict.score}/5  ${verdict.problems.join('; ').slice(0, 150)}`);
}
