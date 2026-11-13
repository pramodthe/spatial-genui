// Tier C of docs/3d-architecture.md (section 4.3): find an existing open-licence model instead of
// generating one. For each object: Muse Ember turns the request into search terms; objaverse_retrieve.py
// searches Objaverse (CC0 / CC BY only) and ranks the matches by DINOv3 similarity to the object's
// reference picture; each of the best few is rendered from four angles; Ember sees the reference and
// the renders and picks the one that fits the request, or rejects them all (the router then moves on
// to generation). Picked GLBs land in <out>/glbs/<object id>.glb for bench3d:import and the judge.
// Usage: npm run bench3d:retrieve -- [--objects bench/prompts/objects-12.json] [--refs <dir of ref__<id>.jpg>]
//          [--out bench/results/_3d-retrieval] [--only id,id] [--top 6]
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCli } from '../args.js';
import { complete, type ContentPart } from '../llm.js';
import { loadModel } from '../models.js';
import type { AssetRequest } from './prompts.js';
import { closeRenderer, renderGlb } from './render.js';
import { dataUrl } from './review.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const WORKER = join(repoRoot, 'apps/worker3d');
const cli = parseCli(process.argv.slice(2), {
  values: ['objects', 'refs', 'out', 'only', 'top'],
  usage: 'npm run bench3d:retrieve -- [--objects file] [--refs dir] [--out dir] [--only id,id] [--top n]',
});
const objects = (JSON.parse(await readFile(resolve(repoRoot, cli.flags.objects ?? 'bench/prompts/objects-12.json'), 'utf8')) as AssetRequest[])
  .filter((o) => !cli.flags.only || cli.flags.only.split(',').includes(o.id));
const refs = resolve(repoRoot, cli.flags.refs ?? 'bench/results/3d-run-1/gallery');
const outDir = resolve(repoRoot, cli.flags.out ?? 'bench/results/_3d-retrieval');
const top = Number(cli.flags.top ?? 6);
const ember = await loadModel('muse-ember-1.0-max');
const quick = { ...ember, extraBody: { ...ember.extraBody, reasoning_effort: 'low' } };
await mkdir(join(outDir, 'glbs'), { recursive: true });
await mkdir(join(outDir, 'renders'), { recursive: true });

type Candidate = { uid: string; name: string; licence: string; author: string; authorUrl: string; viewerUrl: string; faces: number; similarity: number; glb: string };

const TERMS_SYSTEM = `You help find an existing 3D model in a large library of user-made models (Sketchfab). Given a request for a model, reply with only a JSON object {"terms": ["..."]}: 1-4 short search terms, most specific first, the words a model's title would use (e.g. "bicycle", "bike"; "acoustic guitar", "guitar"). No adjectives about quality or style.`;

const PICK_SYSTEM = `You choose a 3D model for a mixed-reality lesson from candidates found in a public library. You see a reference picture of what the lesson needs, the request with the parts it must show, and four-view renders (front, side, back, above) of each candidate. Choose the candidate that a teacher would use: it is the requested object (not a different object, a scene, a building around it, or a collection), complete, with realistic proportions, and with the listed parts visible. Prefer realistic models to cartoon, toy or low-poly ones. Reject every candidate if none would serve. Reply with only a JSON object:
{"choice": <candidate number, or null>, "reason": "<one sentence>", "fit": [<1-5 for each candidate, in order>]}`;

function parseJson<T>(text: string): T | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  try {
    return start >= 0 && end > start ? (JSON.parse(text.slice(start, end + 1)) as T) : null;
  } catch {
    return null;
  }
}

function retrieveCandidates(terms: string[], reference: string): Promise<{ ok: boolean; candidates?: Candidate[]; searched?: number; error?: string }> {
  return new Promise((done) => {
    // Trusted code: it downloads data and calls our Modal app; no model-written code runs.
    const child = spawn(join(WORKER, '.venv/bin/python3'), [join(WORKER, 'library/objaverse_retrieve.py'),
      '--terms', terms.join(','), '--reference', reference, '--top', String(top), '--data', join(repoRoot, 'data/objaverse')],
    { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 15 * 60_000);
    child.on('close', () => {
      clearTimeout(timer);
      const last = out.trim().split('\n').filter((l) => l.startsWith('{')).at(-1);
      try {
        done(last ? JSON.parse(last) : { ok: false, error: 'no output' });
      } catch {
        done({ ok: false, error: 'unreadable output' });
      }
    });
  });
}

const rowsFile = join(outDir, 'retrieval.jsonl');
const done = new Set(existsSync(rowsFile) ? (await readFile(rowsFile, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l).objectId as string) : []);
await writeFile(join(outDir, 'meta.json'), JSON.stringify({
  objectsFile: cli.flags.objects ?? 'bench/prompts/objects-12.json', refs, top, picker: ember.id, source: 'Objaverse 1.0 (CC0 and CC BY only)',
  imageRerank: 'DINOv3 ViT-L/16 class token, cosine to the reference picture', updatedAt: new Date().toISOString(),
}, null, 2));

for (const obj of objects) {
  if (done.has(obj.id)) continue;
  const started = performance.now();
  const reference = join(refs, `ref__${obj.id}.jpg`);
  const termsReply = await complete([{ role: 'system', content: TERMS_SYSTEM }, { role: 'user', content: obj.prompt }], quick);
  const terms = (parseJson<{ terms?: string[] }>(termsReply.text)?.terms ?? [obj.id.replace(/-/g, ' ')]).map(String).slice(0, 4);
  const found = await retrieveCandidates(terms, reference);
  const row: Record<string, unknown> = { objectId: obj.id, terms, searched: found.searched ?? 0 };
  if (!found.ok || !found.candidates?.length) {
    Object.assign(row, { ok: false, error: found.error ?? 'no candidates', ms: Math.round(performance.now() - started) });
  } else {
    const candidates = found.candidates;
    const grids: (Buffer | null)[] = [];
    for (const c of candidates) {
      const render = await renderGlb(await readFile(c.glb));
      grids.push('grid' in render ? render.grid : null);
      if ('grid' in render) await writeFile(join(outDir, 'renders', `${obj.id}__${c.uid}.jpg`), render.grid);
    }
    const content: ContentPart[] = [
      { type: 'text', text: `Request: ${obj.prompt}\nParts it must show: ${obj.parts.join(', ')}.\nReference picture:` },
      { type: 'image_url', image_url: { url: dataUrl(await readFile(reference)) } },
    ];
    candidates.forEach((c, i) => {
      content.push({ type: 'text', text: `Candidate ${i + 1}: "${c.name}"${grids[i] ? '' : ' (could not be rendered)'}` });
      if (grids[i]) content.push({ type: 'image_url', image_url: { url: dataUrl(grids[i]!) } });
    });
    const pickReply = await complete([{ role: 'system', content: PICK_SYSTEM }, { role: 'user', content }], ember);
    const pick = parseJson<{ choice?: number | null; reason?: string; fit?: number[] }>(pickReply.text);
    const index = typeof pick?.choice === 'number' && grids[pick.choice - 1] ? pick.choice - 1 : -1;
    if (index >= 0) await copyFile(candidates[index].glb, join(outDir, 'glbs', `${obj.id}.glb`));
    Object.assign(row, {
      ok: index >= 0, choice: index >= 0 ? candidates[index] : null, reason: pick?.reason ?? pickReply.text.slice(0, 200), fit: pick?.fit ?? [],
      candidates: candidates.map((c, i) => ({ uid: c.uid, name: c.name, licence: c.licence, similarity: c.similarity, faces: c.faces, rendered: Boolean(grids[i]) })),
      ms: Math.round(performance.now() - started),
    });
  }
  await appendFile(rowsFile, JSON.stringify(row) + '\n');
  const choice = row.choice as Candidate | null | undefined;
  console.error(`${obj.id.padEnd(16)} ${row.ok ? `picked "${choice?.name}" (${choice?.licence}, ${choice?.author})` : `none: ${String(row.reason ?? row.error).slice(0, 100)}`}  ${((row.ms as number) / 1000).toFixed(0)} s`);
}
await closeRenderer();
