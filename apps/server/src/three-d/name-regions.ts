// M5, P3-SAM path: Muse Ember names the clean 3D regions P3-SAM cut (apps/worker3d/modal_parts.py)
// from one highlight render per region, in the lesson's words; regions with the same name become one
// part. Expects work folders from bench3d:segment with regions.npy (segment.py p3sam).
// Usage: npm run bench3d:name-regions -- --glbs <dir of <id>.glb> --tag <work tag> --out <dir>
//          [--objects bench/prompts/objects-12.json] [--only id,id]
// Writes <out>/segment.jsonl (for bench3d:judge-parts) and <out>/parts/<id>.jpg.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCli } from '../args.js';
import { complete, type ChatMessage, type ContentPart } from '../llm.js';
import { loadModel } from '../models.js';
import type { AssetRequest } from './prompts.js';
import { closeRenderer, renderGlb } from './render.js';
import { dataUrl } from './review.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const WORKER = join(repoRoot, 'apps/worker3d');
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
const ember = await loadModel('muse-ember-1.0-max');

const SYSTEM = `You name the parts of a 3D model for a mixed-reality lesson. A segmentation model has cut it into regions. You see four views of the model as made (front, side = seen from the right, back, above), then one picture per region with that region in solid red and the rest faint. Reply with only a JSON object:
{"regions": {"<region number>": "<the part a teacher would label, lower case, in the lesson's words where they fit>"}}
Name every region, with no exceptions. Give regions the same name when they are one part (four legs: "legs"), or when a region is only a piece of a part (a wheel cut in two). A region that is most of the object is named after the object's main structure (e.g. "guitar body", "lander body"). Use "base" for a stand or ground the object sits on.`;

function python(args: string[]): Promise<Record<string, unknown>> {
  return new Promise((done) => {
    // Trusted code: reads model files and writes work files.
    const child = spawn(join(WORKER, '.venv/bin/python3'), [join(WORKER, 'library/segment.py'), ...args], { cwd: join(WORKER, 'library'), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('close', () => {
      const last = out.trim().split('\n').filter((l) => l.startsWith('{')).at(-1);
      try {
        done(last ? JSON.parse(last) : { ok: false, error: 'no output' });
      } catch {
        done({ ok: false, error: 'unreadable output' });
      }
    });
  });
}

function parseJson<T>(text: string): T | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  try {
    return start >= 0 && end > start ? (JSON.parse(text.slice(start, end + 1)) as T) : null;
  } catch {
    return null;
  }
}

await mkdir(join(outDir, 'parts'), { recursive: true });
const rowsFile = join(outDir, 'segment.jsonl');
const done = new Set(existsSync(rowsFile) ? (await readFile(rowsFile, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l).objectId as string) : []);
const ids = (await readdir(work)).filter((id) => existsSync(join(work, id, 'regions.npy')) && existsSync(join(glbDir, `${id}.glb`)))
  .filter((id) => !done.has(id) && (!cli.flags.only || cli.flags.only.split(',').includes(id)));

for (const id of ids) {
  const started = performance.now();
  const glbPath = join(glbDir, `${id}.glb`);
  const dir = join(work, id);
  const row: Record<string, unknown> = { objectId: id };
  try {
    const prepared = await python(['regions', glbPath, dir]);
    if (!prepared.ok) throw new Error(`regions: ${prepared.error}`);
    const legend = prepared.groups as { group: number; glb: string; surfaceShare: number }[];
    const asMade = await renderGlb(await readFile(glbPath));
    if (!('grid' in asMade)) throw new Error('render failed');
    const content: ContentPart[] = [];
    const request = requests.get(id);
    content.push({ type: 'text', text: `Request: ${request?.prompt ?? id}${request ? `\nParts the lesson wants: ${request.parts.join(', ')}.` : ''}\nThe model as made:` },
      { type: 'image_url', image_url: { url: dataUrl(asMade.grid) } });
    for (const g of legend) {
      const render = await renderGlb(await readFile(g.glb));
      if (!('grid' in render)) throw new Error(`render of region ${g.group} failed`);
      content.push({ type: 'text', text: `Region ${g.group} (${Math.round(g.surfaceShare * 100)}% of the surface):` }, { type: 'image_url', image_url: { url: dataUrl(render.hero) } });
    }
    const messages: ChatMessage[] = [{ role: 'system', content: SYSTEM }, { role: 'user', content }];
    let reply = await complete(messages, ember);
    let named = parseJson<{ regions?: Record<string, string> }>(reply.text);
    const unnamed = () => legend.filter((g) => !named?.regions?.[String(g.group)]).map((g) => g.group);
    if (named?.regions && unnamed().length) {
      messages.push({ role: 'assistant', content: reply.text }, { role: 'user', content: `You left out region${unnamed().length > 1 ? 's' : ''} ${unnamed().join(', ')}. Reply with the whole JSON again, naming every region.` });
      reply = await complete(messages, ember);
      named = parseJson<{ regions?: Record<string, string> }>(reply.text) ?? named;
    }
    if (!named?.regions) throw new Error(`unreadable naming reply: ${reply.text.slice(0, 200)}`);
    const namesPath = join(dir, 'names.json');
    const names = existsSync(namesPath) ? JSON.parse(await readFile(namesPath, 'utf8')) : {};
    await writeFile(namesPath, JSON.stringify({ ...names, regionNames: named.regions, partsNote: 'Parts are regions cut by P3-SAM (Tencent Hunyuan3D-Part, non-commercial licence) and named by Muse Ember from a render of each region.' }, null, 2));
    const finished = await python(['finalize', glbPath, dir]);
    if (!finished.ok) throw new Error(`finalize: ${finished.error}`);
    const preview = await renderGlb(await readFile(join(dir, 'parts.glb')));
    if ('grid' in preview) await writeFile(join(outDir, 'parts', `${id}.jpg`), preview.grid);
    Object.assign(row, { ok: true, regions: legend.length, parts: finished.parts });
  } catch (err) {
    Object.assign(row, { ok: false, error: (err as Error).message.slice(0, 300) });
  }
  row.ms = Math.round(performance.now() - started);
  await appendFile(rowsFile, JSON.stringify(row) + '\n');
  console.error(`${id.padEnd(16)} ${row.ok ? `${row.regions} regions -> ${(row.parts as string[]).join(', ')}` : `failed: ${row.error}`}  ${((row.ms as number) / 1000).toFixed(0)} s`);
}
await closeRenderer();
