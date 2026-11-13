// The on-demand asset path (docs/3d-architecture.md, sections 3 and 6): when a lesson needs a real-world
// object the library lacks, get an accurate-looking model with named parts into the library:
//
//   reference picture (Muse Image), briefed and checked by Ember, redrawn if it shows the object wrongly
//   -> search Objaverse, rank by DINOv3, Ember picks from renders        (tier C: an existing model)
//   -> if nothing fits: TRELLIS.2 builds one from the reference picture   (tier D: a generated model)
//   -> P3-SAM cuts it into regions, Ember names them, Ember checks the names
//   -> library asset with credit, licence and provenance
//
// One to three minutes per object, mostly waiting on our Modal GPU apps (which scale to zero). Jobs
// run one at a time in the background; the lesson that asked is served at once from shapes and can be
// rebuilt when the model is ready. Every stage leaves its files in data/acquire-work/<name>/.
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LIBRARY_DIR } from '../library.js';
import { checkedReference, nameRegions, pythonJson, repoRoot, retrieveModel, runPython, verifyParts, type Candidate, type CheckedReference, type Retrieval } from './stages.js';

/** A real-world object a lesson wants as a 3D model: its everyday name and a one-line description. */
export type AssetWanted = { name: string; describe: string; parts?: string[] };
export type AcquireStage = 'reference' | 'search' | 'generate' | 'segment' | 'name' | 'check' | 'library';
export type AcquireEvent = { stage: AcquireStage; message: string; at: string };
export type AcquireResult =
  | { ok: true; assetId: string; source: 'objaverse' | 'trellis'; parts: string[]; ms: number }
  | { ok: false; error: string; stage: AcquireStage; ms: number };

const WORK = join(repoRoot, 'data/acquire-work');
/** A model is generated only from a reference picture Ember scored at least this (of 5). */
const MIN_REFERENCE_SCORE = 3;
export const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'object';

/**
 * Run the whole path for one object. `onEvent` gets a line per stage, for progress display.
 * options.top: how many search results Ember sees (default 6); options.search: false skips the search
 * and generates the model.
 */
export async function acquireAsset(wanted: AssetWanted, onEvent: (event: AcquireEvent) => void = () => {}, options: { top?: number; search?: boolean } = {}): Promise<AcquireResult> {
  const started = performance.now();
  const slug = slugOf(wanted.name);
  const dir = join(WORK, slug);
  const glbPath = join(dir, 'model.glb');
  let stage: AcquireStage = 'reference';
  const say = (next: AcquireStage, message: string) => {
    stage = next;
    onEvent({ stage: next, message, at: new Date().toISOString() });
  };
  try {
    await mkdir(dir, { recursive: true });

    // 1. What it should look like: one picture, used to rank search results and, if needed, to generate.
    // Checked before use, because a model generated from a wrong picture repeats its mistakes.
    const reference = join(dir, `${slug}.jpg`);
    const referenceInfo = join(dir, 'reference.json');
    if (!existsSync(reference) || !existsSync(referenceInfo)) {
      say('reference', `Drawing a reference picture of ${wanted.name}`);
      const drawn = await checkedReference({
        name: wanted.name, describe: wanted.describe, parts: wanted.parts ?? [], dir,
        onTry: (n) => { if (n > 1) say('reference', `Redrawing the picture (try ${n}): the last one showed it wrongly`); },
      });
      await copyFile(drawn.path, reference);
      await writeFile(referenceInfo, JSON.stringify(drawn, null, 2));
    }
    const checked = JSON.parse(await readFile(referenceInfo, 'utf8')) as CheckedReference;

    // 2. An existing open-licence model, if one fits.
    let found: Retrieval = { ok: false, terms: [], searched: 0, choice: null, fit: [], candidates: [], reason: 'search skipped' };
    if (options.search !== false) {
      say('search', `Searching 700,000 open-licence models for ${wanted.name}`);
      found = await retrieveModel({
        prompt: wanted.describe, parts: wanted.parts ?? [], fallbackTerm: wanted.name, reference, top: options.top ?? 6,
        onRender: (uid, grid) => writeFile(join(dir, `candidate-${uid}.jpg`), grid),
      });
      await writeFile(join(dir, 'retrieval.json'), JSON.stringify(found, null, 2));
    }
    let source: 'objaverse' | 'trellis';
    let choice: Candidate | null = null;
    if (found.choice) {
      source = 'objaverse';
      choice = found.choice;
      await copyFile(choice.glb, glbPath);
    } else {
      // 3. Nothing fits: generate one from the reference picture.
      if (checked.score < MIN_REFERENCE_SCORE) {
        const worst = checked.attempts.find((a) => a.file === checked.path)?.problems.join('; ') ?? '';
        throw new Error(`no reference picture was good enough to build a model from (best ${checked.score}/5: ${worst.slice(0, 200)})`);
      }
      say('generate', `No existing model fits (${(found.reason ?? found.error ?? 'none found').slice(0, 120)}); generating one`);
      source = 'trellis';
      const made = await runPython('fetch_trellis.py', [dir, dir, slug]);
      if (!existsSync(join(dir, `${slug}.glb`))) throw new Error(`TRELLIS.2 made no model: ${made.stdout.trim().split('\n').at(-1)?.slice(0, 200) ?? 'no output'}`);
      await copyFile(join(dir, `${slug}.glb`), glbPath);
    }

    // 4. Parts: clean regions from P3-SAM, named by Ember, then checked by Ember.
    say('segment', 'Cutting the model into parts');
    const prepared = await pythonJson('library/retrieved.py', ['prepare', glbPath, dir, '--refine']);
    if (!prepared.ok) throw new Error(`prepare: ${prepared.error}`);
    const cut = await pythonJson('library/segment.py', ['p3sam', glbPath, dir]);
    if (!cut.ok) throw new Error(`P3-SAM: ${cut.error}`);
    say('name', `Naming ${cut.regions} parts`);
    const named = await nameRegions({ glbPath, dir, request: { prompt: wanted.describe, parts: wanted.parts }, withMeta: true });
    let parts = named.parts;
    say('check', `Checking the names: ${parts.join(', ')}`);
    try {
      parts = (await verifyParts({ glbPath, dir, objectName: wanted.name })).parts;
    } catch (err) {
      // An unreadable check is not a reason to throw the model away: it goes in as named, marked unchecked.
      const names = JSON.parse(await readFile(join(dir, 'names.json'), 'utf8'));
      await writeFile(join(dir, 'names.json'), JSON.stringify({ ...names, verified: { by: null, error: (err as Error).message.slice(0, 200) } }, null, 2));
    }

    // 5. Into the library, with what a lesson and a reader need to know about where it came from.
    say('library', 'Adding it to the library');
    const namesPath = join(dir, 'names.json');
    const names = JSON.parse(await readFile(namesPath, 'utf8'));
    // The router finds it by the name the lesson asked for, whatever title Ember gave it.
    const keywords = [...new Set([wanted.name.toLowerCase(), ...((names.keywords as string[] | undefined) ?? []).map((k) => String(k).toLowerCase())])];
    await writeFile(namesPath, JSON.stringify({ ...names, title: names.title ?? wanted.name, keywords }, null, 2));
    const assetId = `${slug}-${source}`;
    const meta = choice
      ? { uid: choice.uid, name: choice.name, author: choice.author, authorUrl: choice.authorUrl, viewerUrl: choice.viewerUrl, licence: choice.licence, similarity: choice.similarity, reason: found.reason, request: wanted.describe, assetId }
      : { uid: `trellis-${slug}`, name: String(names.title ?? wanted.name), author: 'TRELLIS.2 (generated)', licence: 'generated (TRELLIS.2, MIT)', viewerUrl: '', credit: 'Generated with TRELLIS.2 (Microsoft, MIT) from a Muse Image reference', tier: 'D', assetId,
          note: `Generated by TRELLIS.2 from a reference picture made by Muse Image (the picture was checked by Muse Ember: ${checked.score}/5); not checked by a subject expert.`, request: wanted.describe };
    await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
    const ingested = await pythonJson('library/retrieved.py', ['ingest', glbPath, dir, '--out', LIBRARY_DIR, '--refine']);
    if (!ingested.ok) throw new Error(`ingest: ${ingested.error}`);
    return { ok: true, assetId: ingested.id as string, source, parts: ingested.parts as string[], ms: Math.round(performance.now() - started) };
  } catch (err) {
    return { ok: false, error: (err as Error).message.slice(0, 400), stage, ms: Math.round(performance.now() - started) };
  }
}

// --- Background jobs (for the agent server) ---------------------------------------------------------

export type AssetJob = {
  id: string;
  name: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  events: AcquireEvent[];
  assetId?: string;
  parts?: string[];
  error?: string;
  startedAt: string;
  finishedAt?: string;
};

const jobs = new Map<string, AssetJob>();
let queue: Promise<unknown> = Promise.resolve();

/**
 * Start getting a model for `wanted` in the background, or return the job already doing so (a second
 * lesson about the same object doesn't start a second job). One job runs at a time: they share the
 * renderer and the GPU apps.
 */
export function startAssetJob(wanted: AssetWanted): AssetJob {
  const id = slugOf(wanted.name);
  const existing = jobs.get(id);
  if (existing && existing.status !== 'failed') return existing;
  const job: AssetJob = { id, name: wanted.name, status: 'queued', events: [], startedAt: new Date().toISOString() };
  jobs.set(id, job);
  queue = queue.then(async () => {
    job.status = 'running';
    const result = await acquireAsset(wanted, (event) => job.events.push(event));
    job.finishedAt = new Date().toISOString();
    if (result.ok) Object.assign(job, { status: 'done', assetId: result.assetId, parts: result.parts });
    else Object.assign(job, { status: 'failed', error: `${result.stage}: ${result.error}` });
  }).catch((err) => {
    Object.assign(job, { status: 'failed', error: String((err as Error).message), finishedAt: new Date().toISOString() });
  });
  return job;
}

export const assetJob = (id: string): AssetJob | undefined => jobs.get(id);
export const assetJobs = (): AssetJob[] => [...jobs.values()];
