// M5 of docs/3d-architecture.md: named parts for any mesh (a TRELLIS.2 model is one fused mesh; a
// retrieved model's pieces rarely match the parts a lesson labels) from SAM 3.1 masks on renders.
// Per model: Muse Ember looks at it and lists the parts to find (the request's parts that are visible,
// as short noun phrases, plus its main body); the model is rendered from 10 angles, as made and as
// face-number colours; SAM 3.1 finds each part in each view; apps/worker3d/library/segment.py lifts
// the masks onto the mesh's faces; retrieved.py writes the asset with one node per part.
// Usage: npm run bench3d:segment -- --glbs <dir of <object id>.glb> --out <dir> [--tag name]
//          [--objects bench/prompts/objects-12.json] [--only id,id] [--source objaverse|trellis]
// Writes <out>/glbs/<id>.glb (named parts, for bench3d:import), <out>/parts/<id>.jpg (each part in its
// own colour) and <out>/segment.jsonl.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCli } from '../args.js';
import { complete, type ContentPart } from '../../src/llm.js';
import { loadModel } from '../../src/models.js';
import type { AssetRequest } from '../../src/three-d/prompts.js';
import { closeRenderer, renderGlb, renderViews } from '../../src/three-d/render.js';
import { dataUrl } from '../../src/three-d/review.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const WORKER = join(repoRoot, 'apps/worker3d');
const cli = parseCli(process.argv.slice(2), {
  values: ['glbs', 'out', 'tag', 'objects', 'only', 'source'],
  usage: 'npm run bench3d:segment -- --glbs <dir> --out <dir> [--tag name] [--objects file] [--only id,id] [--source objaverse|trellis]',
});
if (!cli.flags.glbs || !cli.flags.out) {
  console.error('Usage: npm run bench3d:segment -- --glbs <dir of <object id>.glb> --out <dir> [--tag name] [--only id,id]');
  process.exit(1);
}
const glbDir = resolve(repoRoot, cli.flags.glbs);
const outDir = resolve(repoRoot, cli.flags.out);
const work = join(repoRoot, 'data/segment-work', cli.flags.tag ?? 'default');
const source = cli.flags.source ?? 'objaverse';
const requests = new Map((JSON.parse(await readFile(resolve(repoRoot, cli.flags.objects ?? 'bench/prompts/objects-12.json'), 'utf8')) as AssetRequest[]).map((o) => [o.id, o]));
const ember = await loadModel('muse-ember-1.0-max');
const META_BASE = (process.env.META_API_BASE || 'https://api.meta.ai/v1').replace(/\/$/, '');
const META_KEY = process.env.META_API_KEY;
if (!META_KEY) throw new Error('Set META_API_KEY in .env for SAM 3.1.');

// Eight around the model a little above it, two from higher up (tops of things), front and back.
const VIEWS = [0, 45, 90, 135, 180, 225, 270, 315].map((az) => ({ az, el: 15 })).concat([{ az: 30, el: 55 }, { az: 210, el: 55 }]);
const VIEW_PX = 768;
const SAM_PRICE = 0.0025; // USD per image (Meta Model API pricing, Nov 2026)

const PLAN_SYSTEM = `You prepare a 3D model for a mixed-reality lesson. You see four views of it (front, side = seen from the right, back, above) and the request it was made for. Its parts will be found in pictures by SAM 3.1, which finds things named by a short noun phrase. Reply with only a JSON object:
{"title": "<short name of the object>",
 "bestView": "<the view a learner should see first, the one that shows the object most clearly: front, side, back, or opposite side (facing away from the side view)>",
 "sizeM": <the real object's largest dimension in metres>,
 "kind": "<one of: anatomy, biology, astronomy, chemistry, mechanical, everyday, architecture, earth-science>",
 "keywords": ["<3-8 words a lesson request might use for it>"],
 "parts": [{"name": "<the part's name for its label>", "find": "<what it looks like on this model, as a 1-4 word noun phrase>", "main": <true for the main body only>}]}
For parts (3-8): use the parts the request lists that you can see on this model, named in the request's words, plus the object's main body as one part (e.g. "guitar body", "bicycle frame", "chair seat") so every surface has an owner. Leave out parts you can't see on the model. SAM knows everyday words, not technical ones: "find" must name what the part looks like on this model ("gold box at the bottom" for a lunar module's descent stage, "green ovals" for chloroplasts, "round hole" for a sound hole); it may equal the name when the name is an everyday word. SAM can't tell front from rear or left from right, so name such parts together ("wheels", "pedals", "armrests"). Mark exactly one part, the main body, with "main": true.`;

function python(script: string, args: string[]): Promise<Record<string, unknown>> {
  return new Promise((done) => {
    // Trusted code: reads model files, renders and SAM replies (no code in them runs) and writes files.
    const child = spawn(join(WORKER, '.venv/bin/python3'), [join(WORKER, 'library', script), ...args], { cwd: join(WORKER, 'library'), stdio: ['ignore', 'pipe', 'pipe'] });
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

/** One SAM 3.1 request: every match of `phrase` in the PNG, as the reply's text (empty when none). */
async function sam(png: Buffer, phrase: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${META_BASE}/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${META_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'sam-3.1',
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: phrase }, { type: 'input_image', image_url: `data:image/png;base64,${png.toString('base64')}` }] }],
        metadata: { include_confidence: 'true', mask_encoding: 'one_bit' },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (res.ok) {
      const body = (await res.json()) as { output?: { content?: { text?: string }[] }[] };
      return body.output?.flatMap((o) => o.content ?? []).map((c) => c.text ?? '').join('\n') ?? '';
    }
    if (attempt >= 3 || (res.status !== 429 && res.status < 500)) throw new Error(`SAM 3.1 ${res.status}: ${(await res.text()).slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
}

/** Run tasks with at most `limit` in flight. */
async function pool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  }));
  return results;
}

await mkdir(join(outDir, 'glbs'), { recursive: true });
await mkdir(join(outDir, 'parts'), { recursive: true });
const rowsFile = join(outDir, 'segment.jsonl');
const done = new Set(existsSync(rowsFile) ? (await readFile(rowsFile, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l).objectId as string) : []);
const ids = (await readdir(glbDir)).filter((f) => f.endsWith('.glb')).map((f) => f.slice(0, -4))
  .filter((id) => !done.has(id) && (!cli.flags.only || cli.flags.only.split(',').includes(id)));

for (const id of ids) {
  const started = performance.now();
  const glbPath = join(glbDir, `${id}.glb`);
  const glb = await readFile(glbPath);
  const dir = join(work, id);
  const row: Record<string, unknown> = { objectId: id };
  try {
    const prepared = await python('retrieved.py', ['prepare', glbPath, dir, '--refine']); // drops stray pieces
    if (!prepared.ok) throw new Error(`prepare: ${prepared.error}`);
    const encoded = await python('segment.py', ['idglb', glbPath, dir]);
    if (!encoded.ok) throw new Error(`idglb: ${encoded.error}`);

    // What to look for.
    const request = requests.get(id);
    const asMade = await renderGlb(glb);
    if (!('grid' in asMade)) throw new Error(`render: ${asMade.error}`);
    const planReply = await complete([{ role: 'system', content: PLAN_SYSTEM }, {
      role: 'user', content: [
        { type: 'text', text: `Request: ${request?.prompt ?? id}${request ? `\nParts the lesson wants: ${request.parts.join(', ')}.` : ''}` },
        { type: 'image_url', image_url: { url: dataUrl(asMade.grid) } },
      ] as ContentPart[],
    }], ember);
    const plan = parseJson<{ parts?: { name?: string; find?: string; main?: boolean }[]; [k: string]: unknown }>(planReply.text);
    const clean = (text: unknown) => String(text ?? '').toLowerCase().trim();
    const planned = (plan?.parts ?? []).map((p) => ({ name: clean(p.name), find: clean(p.find || p.name), main: p.main === true }))
      .filter((p) => /^[a-z0-9 '-]{2,40}$/.test(p.name) && /^[a-z0-9 ,'-]{2,60}$/.test(p.find)).slice(0, 8);
    if (planned.length === 0) throw new Error(`no parts in plan: ${planReply.text.slice(0, 200)}`);
    const parts = planned.map((p) => p.name);
    const { parts: _parts, ...names } = plan!;
    await writeFile(join(dir, 'names.json'), JSON.stringify({ ...names, partsNote: 'Parts were found by SAM 3.1 on 10 renders of the model and lifted onto its surface; boundaries between parts are approximate.' }, null, 2));
    const main = planned.findIndex((p) => p.main);
    await writeFile(join(dir, 'parts.json'), JSON.stringify({ parts, find: planned.map((p) => p.find), ...(main >= 0 ? { main } : {}), views: VIEWS.length }));

    // Renders: as made (for SAM) and as face numbers (to lift masks onto faces), same angles.
    const colour = await renderViews(glb, VIEWS, VIEW_PX, 'color');
    const faces = await renderViews(await readFile(join(dir, 'ids.glb')), VIEWS, VIEW_PX, 'id');
    if (!Array.isArray(colour) || !Array.isArray(faces)) throw new Error('views render failed');
    await mkdir(join(dir, 'views'), { recursive: true });
    await mkdir(join(dir, 'sam'), { recursive: true });
    for (let v = 0; v < VIEWS.length; v++) {
      await writeFile(join(dir, 'views', `v${v}.png`), colour[v]);
      await writeFile(join(dir, 'views', `v${v}-id.png`), faces[v]);
    }
    const tasks = VIEWS.flatMap((_, v) => planned.map(({ find }, p) => async () => {
      await writeFile(join(dir, 'sam', `v${v}__p${p}.txt`), await sam(colour[v], find));
    }));
    await pool(tasks, 8);

    const assigned = await python('segment.py', ['assign', glbPath, dir]);
    if (!assigned.ok) throw new Error(`assign: ${assigned.error}`);
    const preview = await renderGlb(await readFile(join(dir, 'parts.glb')));
    if ('grid' in preview) await writeFile(join(outDir, 'parts', `${id}.jpg`), preview.grid);

    // The asset itself, with the model's own materials and one node per part.
    const retrieval = existsSync(join(repoRoot, 'bench/results/_3d-retrieval/retrieval.jsonl'))
      ? (await readFile(join(repoRoot, 'bench/results/_3d-retrieval/retrieval.jsonl'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((r) => r.objectId === id && r.ok)
      : null;
    const meta = source === 'objaverse' && retrieval
      ? { uid: retrieval.choice.uid, name: retrieval.choice.name, author: retrieval.choice.author, authorUrl: retrieval.choice.authorUrl, viewerUrl: retrieval.choice.viewerUrl, licence: retrieval.choice.licence, similarity: retrieval.choice.similarity, reason: retrieval.reason, request: request?.prompt }
      : { uid: `trellis-${id}`, name: String(plan!.title ?? id), author: 'TRELLIS.2 (generated)', licence: 'generated (TRELLIS.2, MIT)', viewerUrl: '', credit: 'Generated with TRELLIS.2 (Microsoft, MIT) from a Muse Image reference', tier: 'D', assetId: `${id}-trellis`,
          note: 'Generated by TRELLIS.2 from a reference picture made by Muse Image; not checked by a subject expert.', request: request?.prompt };
    await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
    const scratchLibrary = join(outDir, 'library');
    const ingested = await python('retrieved.py', ['ingest', glbPath, dir, '--out', scratchLibrary, '--refine']);
    if (!ingested.ok) throw new Error(`ingest: ${ingested.error}`);
    await copyFile(join(scratchLibrary, 'assets', `${ingested.id}.glb`), join(outDir, 'glbs', `${id}.glb`));
    Object.assign(row, {
      ok: true, assetId: ingested.id, asked: planned, parts: assigned.parts, dropped: assigned.dropped, claimedShare: assigned.claimedShare,
      faces: assigned.faces, samImages: tasks.length, samUSD: Math.round(tasks.length * SAM_PRICE * 1000) / 1000,
    });
  } catch (err) {
    Object.assign(row, { ok: false, error: (err as Error).message.slice(0, 300) });
  }
  row.ms = Math.round(performance.now() - started);
  await appendFile(rowsFile, JSON.stringify(row) + '\n');
  console.error(`${id.padEnd(16)} ${row.ok ? `parts: ${(row.parts as string[]).join(', ')}${(row.dropped as string[]).length ? ` (not found: ${(row.dropped as string[]).join(', ')})` : ''}` : `failed: ${row.error}`}  ${((row.ms as number) / 1000).toFixed(0)} s`);
}
await closeRenderer();
