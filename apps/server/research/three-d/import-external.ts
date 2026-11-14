// Bring 3D models made outside the harness (e.g. Tripo's website) into a benchmark folder, so they get
// the same renders, measurements and judge as the agent's pipelines. One <object id>.glb per object.
// Usage: npm run bench3d:import -- <folder of GLBs> --pipeline p4-tripo --label "Tripo website (v3.1, defaults)"
//          [--variant ref] [--objects bench/prompts/objects-12.json] [--out bench/results/3d-tripo]
import { existsSync } from 'node:fs';
import { appendFile, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCli } from '../args.js';
import type { JobRow } from './bench3d.js';
import { missingParts, type AssetRequest, type Pipeline } from '../../src/three-d/prompts.js';
import { closeRenderer, renderGlb } from '../../src/three-d/render.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const cli = parseCli(process.argv.slice(2), {
  values: ['pipeline', 'label', 'variant', 'objects', 'out'],
  usage: 'npm run bench3d:import -- <folder of GLBs> --pipeline <id> --label <text> [--variant ref|base] [--objects file] [--out dir]',
});
const source = cli.positional[0] ? resolve(process.cwd(), cli.positional[0]) : '';
if (!source || !existsSync(source) || !cli.flags.pipeline || !cli.flags.label) {
  console.error('Usage: npm run bench3d:import -- <folder of GLBs> --pipeline <id> --label <text> [--variant ref|base] [--objects file] [--out dir]');
  process.exit(1);
}
const pipeline = cli.flags.pipeline as Pipeline;
const variant = (cli.flags.variant ?? 'ref') as 'base' | 'ref';
const objectsFile = resolve(repoRoot, cli.flags.objects ?? 'bench/prompts/objects-12.json');
const objects = JSON.parse(await readFile(objectsFile, 'utf8')) as AssetRequest[];
const outDir = resolve(repoRoot, cli.flags.out ?? `bench/results/3d-${pipeline.replace(/^p\d+-/, '')}`);
await mkdir(outDir, { recursive: true });

const resultsFile = join(outDir, 'results.jsonl');
const done = new Set(existsSync(resultsFile)
  ? (await readFile(resultsFile, 'utf8')).split('\n').filter(Boolean).map((l) => (JSON.parse(l) as JobRow).objectId)
  : []);
await writeFile(join(outDir, 'meta.json'), JSON.stringify({
  objectsFile: relative(repoRoot, objectsFile), pipelines: [pipeline], variants: [variant], criticRounds: 0, passScore: null,
  model: cli.flags.label, criticModel: '–', backend: 'external', source: 'imported GLB files', updatedAt: new Date().toISOString(),
}, null, 2));

const files = (await readdir(source)).filter((f) => f.toLowerCase().endsWith('.glb'));
const known = new Map(objects.map((o) => [o.id, o]));
const unknown = files.filter((f) => !known.has(basename(f, '.glb').toLowerCase()));
if (unknown.length) console.error(`Skipping files that match no object id: ${unknown.join(', ')}`);

for (const obj of objects) {
  const file = files.find((f) => basename(f, '.glb').toLowerCase() === obj.id);
  if (!file || done.has(obj.id)) continue;
  const jobDir = join(outDir, 'jobs', `${pipeline}__${obj.id}__${variant}`);
  await mkdir(jobDir, { recursive: true });
  const glbPath = join(jobDir, 'round-0.glb');
  await copyFile(join(source, file), glbPath);
  const glb = await readFile(glbPath);
  const render = await renderGlb(glb);
  const round: JobRow['rounds'][number] = {
    round: 0, ok: !('error' in render), repairs: 0, ms: 0,
    gen: { ms: 0, calls: 0, promptTokens: 0, completionTokens: 0, toolCalls: 0 },
  };
  if ('error' in render) {
    round.error = render.error;
  } else {
    round.glb = relative(outDir, glbPath);
    round.grid = relative(outDir, join(jobDir, 'round-0.jpg'));
    round.hero = relative(outDir, join(jobDir, 'round-0-hero.jpg'));
    await writeFile(join(outDir, round.grid), render.grid);
    await writeFile(join(outDir, round.hero), render.hero);
    round.stats = render.stats;
    round.glbBytes = render.glbBytes;
    round.missing = missingParts(obj, render.stats.nodeNames);
  }
  const row: JobRow = {
    objectId: obj.id, category: obj.category, pipeline, variant, model: cli.flags.label!, criticModel: '–',
    ok: round.ok, rounds: [round], finalRound: round.ok ? 0 : null, lastRound: round.ok ? 0 : null,
    usage: { calls: 0, promptTokens: 0, cachedTokens: 0, completionTokens: 0, llmMs: 0, toolCalls: 0 },
    criticUsage: { calls: 0, promptTokens: 0, completionTokens: 0, ms: 0 }, totalMs: 0, external: true,
  };
  await appendFile(resultsFile, JSON.stringify(row) + '\n');
  const s = round.stats;
  console.error(`${obj.id}: ${round.ok ? `${s!.triangles.toLocaleString('en-US')} tris, ${s!.meshes} meshes, ${(round.glbBytes! / 1e6).toFixed(1)} MB, named parts ${s!.namedParts.length}` : round.error}`);
}
const missing = objects.filter((o) => !files.some((f) => basename(f, '.glb').toLowerCase() === o.id)).map((o) => o.id);
if (missing.length) console.error(`No file for: ${missing.join(', ')}`);
await closeRenderer();
