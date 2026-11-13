// Pipeline stages shared by the benchmarks (bench3d:retrieve, bench3d:name-regions,
// bench3d:verify-parts) and the on-demand asset path (acquire.ts): find a model on Objaverse, name the
// regions P3-SAM cut, and check the names. Each stage works on files in a folder, so a failed job can
// be inspected and a benchmark can score any stage on its own.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { complete, type ChatMessage, type ContentPart } from '../llm.js';
import { loadModel, type ModelEntry } from '../models.js';
import { renderGlb } from './render.js';
import { dataUrl, museImage } from './review.js';

export const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
export const WORKER = join(repoRoot, 'apps/worker3d');

let emberEntry: Promise<ModelEntry> | null = null;
/** Muse Ember 1.0 (max): the pipeline's own model for search terms, picking, naming and checking. */
export const ember = () => (emberEntry ??= loadModel('muse-ember-1.0-max'));

/** Run one of the worker's trusted Python scripts (path relative to apps/worker3d); resolves with what it printed. */
export function runPython(script: string, args: string[], timeoutMs = 20 * 60_000): Promise<{ code: number | null; stdout: string }> {
  return new Promise((done) => {
    // Trusted code: these scripts read model files and call our own Modal apps; no model-written code runs.
    const child = spawn(join(WORKER, '.venv/bin/python3'), [join(WORKER, script), ...args], { cwd: join(WORKER, 'library'), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (d) => (stdout += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code, stdout });
    });
  });
}

/** Run a worker script whose last printed line is a JSON object ({"ok": ...}). */
export async function pythonJson(script: string, args: string[], timeoutMs?: number): Promise<Record<string, unknown>> {
  const { stdout } = await runPython(script, args, timeoutMs);
  const last = stdout.trim().split('\n').filter((l) => l.startsWith('{')).at(-1);
  try {
    return last ? JSON.parse(last) : { ok: false, error: 'no output' };
  } catch {
    return { ok: false, error: 'unreadable output' };
  }
}

/** First JSON object in a model reply (models sometimes wrap it in prose or a code fence). */
export function parseJson<T>(text: string): T | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  try {
    return start >= 0 && end > start ? (JSON.parse(text.slice(start, end + 1)) as T) : null;
  } catch {
    return null;
  }
}

// --- Reference picture, checked before anything is built from it -----------------------------------
// A 3D model generated from a picture repeats the picture's mistakes: the Phase 3 gear train's
// reference showed its gears from an angle, overlapping, and TRELLIS.2 put them at right angles. A
// picture costs a cent and a repair in Blender costs minutes, so mistakes are caught here.

const BRIEF_SYSTEM = `You brief an image generator for the reference picture of an object. A 3D model will be built from this one picture, so it must show the object's structure without ambiguity. Reply with only a JSON object:
{"brief": "<the picture to make, 2-4 sentences: what the object is, its parts and how they connect, and the camera view>",
 "mustShow": ["<3-7 facts a correct picture shows, each checkable by looking at it, e.g. 'the two gears lie in one plane, side by side, with their teeth interlocking'>"]}
Choose the view that shows the structure: flat mechanisms and things known from one side (gear trains, bicycles, clocks, a cut-away) nearly face-on but turned and raised a little, so both the arrangement and the object's depth can be seen; solid objects from a three-quarter front view. One object, whole, nothing cropped.
State only structure that the request gives or that every such object has (gears that drive each other mesh in one plane; a base is underneath). Don't invent details the request leaves open (how many supports, what they are made of), and don't list them in mustShow: a picture must not fail for something nobody asked for.`;

const REFERENCE_STYLE = ' A single physical object shown whole, on a plain light grey background, soft even studio lighting, realistic colors, clear shapes. No text, no labels, no arrows, no other objects.';
// A check problem that says the picture's depth can be read two ways (parts in front of / behind each
// other, stacked along an axle, overlapping along the line of sight).
const DEPTH_DOUBT = /depth|read (it )?two ways|could (instead )?(lie|be|sit)|in front of|behind|along the (axle|axis|line of sight)|coaxial|overlap/i;
const STRAIGHT_ON = 'Show it straight from the front with the camera level (no slant, no perspective tilt), with every part side by side in one view so that no part hides behind or overlaps another along the line of sight.';

const REFERENCE_CHECK_SYSTEM = `You check a reference picture before a 3D model is built from it; a wrong picture gives a wrong model. You get what the object is and the facts the picture must show. Look closely and be strict about structure (what connects to what, what lies in one plane, what is inside what).
The 3D generator sees only this one picture and must guess every depth. So also ask: could the arrangement be read two ways? Parts that overlap in the picture, or flat parts seen at a slant, hide whether they lie in one plane, one behind the other, or at an angle to each other. If a fact about arrangement holds only on the likeliest reading, it does not hold: name it as a problem and say what view would settle it. Reply with only a JSON object:
{"score": <1-5: 5 = every fact holds and no arrangement could be read two ways; 4 = right, one small flaw; 3 = recognisable but a fact is wrong, can't be told, or holds only on one reading of the depth; 2 = several facts wrong; 1 = the wrong object>,
 "problems": ["<each fact that does not hold or can't be told from the picture, and anything else wrong: several objects, cropped, text, an impossible shape>"]}`;

export type ReferenceAttempt = { file: string; score: number; problems: string[] };
export type CheckedReference = { path: string; score: number; brief: string; mustShow: string[]; attempts: ReferenceAttempt[] };

/** What a picture of the object must show: Ember's brief for the image generator and the checkable facts. */
export async function briefReference(opts: { name: string; describe: string; parts: string[] }): Promise<{ asked: string; brief: string; mustShow: string[] }> {
  const asked = `Object: ${opts.name}. ${opts.describe}${opts.parts.length ? `\nParts a lesson will label: ${opts.parts.join(', ')}.` : ''}`;
  const reply = await complete([{ role: 'system', content: BRIEF_SYSTEM }, { role: 'user', content: asked }], await ember());
  const planned = parseJson<{ brief?: string; mustShow?: string[] }>(reply.text);
  return {
    asked, brief: typeof planned?.brief === 'string' && planned.brief.length > 20 ? planned.brief : opts.describe,
    mustShow: (planned?.mustShow ?? []).map(String).slice(0, 7),
  };
}

/** Ember's check of one picture against the facts it must show: a score of 1-5 and what is wrong. */
export async function checkReference(asked: string, mustShow: string[], jpeg: Buffer): Promise<{ score: number; problems: string[] }> {
  const reply = await complete([{ role: 'system', content: REFERENCE_CHECK_SYSTEM }, {
    role: 'user', content: [
      { type: 'text', text: `${asked}\nThe picture must show:\n${mustShow.map((f) => `- ${f}`).join('\n') || '- the object, whole and recognisable'}` },
      { type: 'image_url', image_url: { url: dataUrl(jpeg) } },
    ],
  }], await ember());
  const verdict = parseJson<{ score?: number; problems?: string[] }>(reply.text);
  return { score: typeof verdict?.score === 'number' ? verdict.score : 0, problems: (verdict?.problems ?? []).map(String).slice(0, 6) };
}

/**
 * A reference picture that has been checked: Ember writes the brief and the facts the picture must
 * show; Muse Image draws it; Ember checks it against the facts; a failed picture is redrawn with its
 * problems named (up to `tries` pictures). Returns the best one and its score; files go in `dir`.
 */
export async function checkedReference(opts: { name: string; describe: string; parts: string[]; dir: string; tries?: number; onTry?: (n: number) => void }): Promise<CheckedReference> {
  const { asked, brief, mustShow } = await briefReference(opts);
  const attempts: ReferenceAttempt[] = [];
  let problems: string[] = [];
  for (let n = 1; n <= (opts.tries ?? 3); n++) {
    opts.onTry?.(n);
    const prompt = `${brief}${problems.length ? ` An earlier picture got these wrong, so take care: ${problems.join('; ')}.` : ''}${REFERENCE_STYLE}`;
    const picture = await museImage(prompt);
    const file = join(opts.dir, `reference-${n}.jpg`);
    await writeFile(file, picture.jpeg);
    const verdict = await checkReference(asked, mustShow, picture.jpeg);
    problems = verdict.problems;
    attempts.push({ file, ...verdict });
    if (verdict.score >= 4) break;
  }
  let best = attempts.reduce((a, b) => (b.score > a.score ? b : a));
  // A slanted view whose depth can be read two ways is how the gear train went wrong (the generator read
  // the gears as stacked on one axle). When the best picture is still doubtful for that reason, draw it
  // once more straight-on, so no part's place depends on depth.
  if (best.score < 4 && best.problems.some((p) => DEPTH_DOUBT.test(p))) {
    const n = attempts.length + 1;
    opts.onTry?.(n);
    const picture = await museImage(`${brief} ${STRAIGHT_ON}${REFERENCE_STYLE}`);
    const file = join(opts.dir, `reference-${n}.jpg`);
    await writeFile(file, picture.jpeg);
    attempts.push({ file, ...(await checkReference(asked, mustShow, picture.jpeg)) });
    best = attempts.reduce((a, b) => (b.score > a.score ? b : a));
  }
  return { path: best.file, score: best.score, brief, mustShow, attempts };
}

// --- Retrieval (tier C, section 4.3) ---------------------------------------------------------------

export type Candidate = { uid: string; name: string; licence: string; author: string; authorUrl: string; viewerUrl: string; faces: number; similarity: number; glb: string };
export type Retrieval = {
  ok: boolean;
  terms: string[];
  searched: number;
  /** The model Ember picked, or null when it rejected every candidate (the caller then generates one). */
  choice: Candidate | null;
  reason?: string;
  fit: number[];
  candidates: { uid: string; name: string; licence: string; similarity: number; faces: number; rendered: boolean }[];
  error?: string;
};

const TERMS_SYSTEM = `You help find an existing 3D model in a large library of user-made models (Sketchfab). Given a request for a model, reply with only a JSON object {"terms": ["..."]}: 1-4 short search terms, most specific first, the words a model's title would use (e.g. "bicycle", "bike"; "acoustic guitar", "guitar"). No adjectives about quality or style.`;

const PICK_SYSTEM = `You choose a 3D model for a mixed-reality lesson from candidates found in a public library. You see a reference picture of what the lesson needs, the request with the parts it must show, and four-view renders (front, side, back, above) of each candidate. Choose the candidate that a teacher would use: it is the requested object (not a different object, a scene, a building around it, or a collection), complete, with realistic proportions, and with the listed parts visible. Prefer realistic models to cartoon, toy or low-poly ones. Reject every candidate if none would serve. Reply with only a JSON object:
{"choice": <candidate number, or null>, "reason": "<one sentence>", "fit": [<1-5 for each candidate, in order>]}`;

/**
 * Find an open-licence model for a request: Ember writes search terms; objaverse_retrieve.py searches
 * Objaverse (CC0 / CC BY) and ranks matches by DINOv3 similarity to the reference picture; each of the
 * best `top` is rendered from four angles; Ember picks one or rejects them all.
 */
export async function retrieveModel(opts: {
  prompt: string;
  parts: string[];
  /** Search term if Ember's reply can't be read. */
  fallbackTerm: string;
  /** Path of the reference picture (JPEG). */
  reference: string;
  top: number;
  /** Called with each candidate's four-view render, e.g. to save it. */
  onRender?: (uid: string, grid: Buffer) => Promise<void>;
}): Promise<Retrieval> {
  const model = await ember();
  const quick = { ...model, extraBody: { ...model.extraBody, reasoning_effort: 'low' } };
  const termsReply = await complete([{ role: 'system', content: TERMS_SYSTEM }, { role: 'user', content: opts.prompt }], quick);
  const terms = (parseJson<{ terms?: string[] }>(termsReply.text)?.terms ?? [opts.fallbackTerm]).map(String).slice(0, 4);
  const found = await pythonJson('library/objaverse_retrieve.py', ['--terms', terms.join(','), '--reference', opts.reference, '--top', String(opts.top), '--data', join(repoRoot, 'data/objaverse')], 15 * 60_000) as { ok?: boolean; candidates?: Candidate[]; searched?: number; error?: string };
  const none = { ok: false, terms, searched: found.searched ?? 0, choice: null, fit: [], candidates: [] };
  if (!found.ok || !found.candidates?.length) return { ...none, error: found.error ?? 'no candidates' };

  const candidates = found.candidates;
  const grids: (Buffer | null)[] = [];
  for (const c of candidates) {
    const render = await renderGlb(await readFile(c.glb));
    grids.push('grid' in render ? render.grid : null);
    if ('grid' in render) await opts.onRender?.(c.uid, render.grid);
  }
  const content: ContentPart[] = [
    { type: 'text', text: `Request: ${opts.prompt}${opts.parts.length ? `\nParts it must show: ${opts.parts.join(', ')}.` : ''}\nReference picture:` },
    { type: 'image_url', image_url: { url: dataUrl(await readFile(opts.reference)) } },
  ];
  candidates.forEach((c, i) => {
    content.push({ type: 'text', text: `Candidate ${i + 1}: "${c.name}"${grids[i] ? '' : ' (could not be rendered)'}` });
    if (grids[i]) content.push({ type: 'image_url', image_url: { url: dataUrl(grids[i]!) } });
  });
  const pickReply = await complete([{ role: 'system', content: PICK_SYSTEM }, { role: 'user', content }], model);
  const pick = parseJson<{ choice?: number | null; reason?: string; fit?: number[] }>(pickReply.text);
  const index = typeof pick?.choice === 'number' && grids[pick.choice - 1] ? pick.choice - 1 : -1;
  return {
    ok: index >= 0, terms, searched: found.searched ?? 0, choice: index >= 0 ? candidates[index] : null,
    reason: pick?.reason ?? pickReply.text.slice(0, 200), fit: pick?.fit ?? [],
    candidates: candidates.map((c, i) => ({ uid: c.uid, name: c.name, licence: c.licence, similarity: c.similarity, faces: c.faces, rendered: Boolean(grids[i]) })),
  };
}

// --- Naming the regions P3-SAM cut (M5) ------------------------------------------------------------

const NAME_SYSTEM = `You name the parts of a 3D model for a mixed-reality lesson. A segmentation model has cut it into regions. You see four views of the model as made (front, side = seen from the right, back, above), then one picture per region with that region in solid red and the rest faint. Reply with only a JSON object:
{"regions": {"<region number>": "<the part a teacher would label, lower case, in the lesson's words where they fit>"}}
Name every region, with no exceptions. Give regions the same name when they are one part (four legs: "legs"), or when a region is only a piece of a part (a wheel cut in two). A region that is most of the object is named after the object's main structure (e.g. "guitar body", "lander body"). Use "base" for a stand or ground the object sits on.`;

// Asked for only when the model's description doesn't exist yet (the on-demand path): the benchmarks
// get it from an earlier planning step, and their prompt stays as published.
const NAME_META = `
Also describe the object, as further keys of the same JSON object:
"title": "<short name of the object, e.g. Microscope>",
"bestView": "<the view a learner should see first, the one that shows the object most clearly (a bicycle from the side, a guitar from the front): front, side, back, or opposite side (the side facing away from the side view)>",
"sizeM": <the real object's largest dimension in metres>,
"kind": "<one of: anatomy, biology, astronomy, chemistry, mechanical, everyday, architecture, earth-science>",
"keywords": ["<3-8 words a lesson request might use for it>"]`;

export const PARTS_NOTE = 'Parts are regions cut by P3-SAM (Tencent Hunyuan3D-Part, non-commercial licence) and named by Muse Ember from a render of each region.';

/**
 * Name the regions in a segmentation work folder (regions.npy from `segment.py p3sam`): merge tiny
 * regions, show Ember one highlight render per region, write the names to names.json and build the
 * parts (`segment.py finalize`). Returns the parts and their shares of the surface.
 */
export async function nameRegions(opts: {
  glbPath: string;
  dir: string;
  /** What the model is for: the request and, if known, the parts the lesson wants. */
  request: { prompt: string; parts?: string[] };
  /** Also ask for the object's title, best view, real size, kind and keywords (written to names.json). */
  withMeta?: boolean;
}): Promise<{ regions: number; parts: string[]; shares: number[] }> {
  const model = await ember();
  const prepared = await pythonJson('library/segment.py', ['regions', opts.glbPath, opts.dir]);
  if (!prepared.ok) throw new Error(`regions: ${prepared.error}`);
  const legend = prepared.groups as { group: number; glb: string; surfaceShare: number }[];
  const asMade = await renderGlb(await readFile(opts.glbPath));
  if (!('grid' in asMade)) throw new Error('render failed');
  const content: ContentPart[] = [
    { type: 'text', text: `Request: ${opts.request.prompt}${opts.request.parts?.length ? `\nParts the lesson wants: ${opts.request.parts.join(', ')}.` : ''}\nThe model as made:` },
    { type: 'image_url', image_url: { url: dataUrl(asMade.grid) } },
  ];
  for (const g of legend) {
    const render = await renderGlb(await readFile(g.glb));
    if (!('grid' in render)) throw new Error(`render of region ${g.group} failed`);
    content.push({ type: 'text', text: `Region ${g.group} (${Math.round(g.surfaceShare * 100)}% of the surface):` }, { type: 'image_url', image_url: { url: dataUrl(render.hero) } });
  }
  type Named = { regions?: Record<string, string>; title?: string; bestView?: string; sizeM?: number; kind?: string; keywords?: string[] };
  const messages: ChatMessage[] = [{ role: 'system', content: opts.withMeta ? NAME_SYSTEM + NAME_META : NAME_SYSTEM }, { role: 'user', content }];
  let reply = await complete(messages, model);
  let named = parseJson<Named>(reply.text);
  const unnamed = () => legend.filter((g) => !named?.regions?.[String(g.group)]).map((g) => g.group);
  if (named?.regions && unnamed().length) {
    messages.push({ role: 'assistant', content: reply.text }, { role: 'user', content: `You left out region${unnamed().length > 1 ? 's' : ''} ${unnamed().join(', ')}. Reply with the whole JSON again, naming every region.` });
    reply = await complete(messages, model);
    named = parseJson<Named>(reply.text) ?? named;
  }
  if (!named?.regions) throw new Error(`unreadable naming reply: ${reply.text.slice(0, 200)}`);
  const namesPath = join(opts.dir, 'names.json');
  const names = existsSync(namesPath) ? JSON.parse(await readFile(namesPath, 'utf8')) : {};
  const { regions: regionNames, ...meta } = named;
  await writeFile(namesPath, JSON.stringify({ ...names, ...(opts.withMeta ? meta : {}), regionNames, partsNote: PARTS_NOTE }, null, 2));
  const finished = await pythonJson('library/segment.py', ['finalize', opts.glbPath, opts.dir]);
  if (!finished.ok) throw new Error(`finalize: ${finished.error}`);
  return { regions: legend.length, parts: finished.parts as string[], shares: finished.shares as number[] };
}

// --- Self-check of the named parts (section 4.7, first piece) ---------------------------------------

const VERIFY_SYSTEM = `You check the parts of a 3D model before it is used in a lesson. For each part you see four views of the model (front, side, back, above) with that part in solid red and the rest faint. Be strict: a wrong label teaches a student something false. For each part decide:
- "keep": the red region is that part (small stray bits are fine);
- "rename": the red region is clearly a different part; give its correct name;
- "merge": it is not a meaningful part on its own, it mixes several parts, or you can't tell what it is.
Reply with only a JSON object: {"parts": [{"name": "<part>", "verdict": "keep" | "rename" | "merge", "newName": "<only for rename>", "reason": "<short>"}]}`;

export type PartVerdict = { name: string; verdict: string; newName?: string; reason?: string };

/**
 * Ember looks at each named part again (solid red, the rest faint) and keeps it, renames it, or
 * merges it into the main body; names.json and the parts are rewritten accordingly.
 */
export async function verifyParts(opts: { glbPath: string; dir: string; objectName: string }): Promise<{ before: string[]; parts: string[]; verdicts: PartVerdict[] }> {
  const model = await ember();
  // The parts as named, with their surface shares (finalize is deterministic, so this re-creates them).
  const before = await pythonJson('library/segment.py', ['finalize', opts.glbPath, opts.dir]);
  if (!before.ok) throw new Error(`finalize: ${before.error}`);
  const parts = before.parts as string[];
  const shares = before.shares as number[];
  const content: ContentPart[] = [{ type: 'text', text: `Object: ${opts.objectName}. It has ${parts.length} parts.` }];
  for (let i = 0; i < parts.length; i++) {
    const render = await renderGlb(await readFile(join(opts.dir, `check_${i + 1}.glb`)));
    if (!('grid' in render)) throw new Error(`render of part ${i + 1} failed`);
    content.push({ type: 'text', text: `Part ${i + 1}: "${parts[i]}"` }, { type: 'image_url', image_url: { url: dataUrl(render.grid) } });
  }
  const reply = await complete([{ role: 'system', content: VERIFY_SYSTEM }, { role: 'user', content }], model);
  const verdicts = parseJson<{ parts?: PartVerdict[] }>(reply.text)?.parts;
  if (!verdicts) throw new Error(`unreadable self-check reply: ${reply.text.slice(0, 200)}`);
  // Merged parts join the main body: the largest part that is not itself merged. Names compare the way
  // segment.py writes them (region names may use underscores).
  const norm = (name: string) => name.toLowerCase().replace(/[_\s]+/g, ' ').trim();
  const verdictOf = new Map(verdicts.map((v) => [norm(v.name), v]));
  const sized = parts.map((p, i) => ({ p, share: shares[i] }));
  const kept = sized.filter(({ p }) => verdictOf.get(p)?.verdict !== 'merge');
  const main = (kept.length ? kept : sized).sort((a, b) => b.share - a.share)[0].p;
  const finalName = (p: string) => {
    const v = verdictOf.get(p);
    if (v?.verdict === 'merge') return main;
    if (v?.verdict === 'rename' && v.newName) return norm(v.newName);
    return p;
  };
  const namesPath = join(opts.dir, 'names.json');
  const names = JSON.parse(await readFile(namesPath, 'utf8'));
  const regionNames = Object.fromEntries(Object.entries(names.regionNames as Record<string, string>).map(([r, n]) => [r, finalName(norm(n))]));
  await writeFile(namesPath, JSON.stringify({ ...names, regionNames, verified: { by: model.id, verdicts } }, null, 2));
  const after = await pythonJson('library/segment.py', ['finalize', opts.glbPath, opts.dir]);
  if (!after.ok) throw new Error(`finalize: ${after.error}`);
  return { before: parts, parts: after.parts as string[], verdicts };
}
