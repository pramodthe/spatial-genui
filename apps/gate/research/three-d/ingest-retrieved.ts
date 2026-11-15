// Tier C into the library: turn models picked by bench3d:retrieve into library assets with named parts
// and a teaching rig (apps/worker3d/library/retrieved.py does the geometry). Per model: split it into
// groups of pieces, render each group highlighted, and ask Muse Ember to name the groups, pick the
// view a learner should see first and give the real size; then write the asset with the
// author's own materials, credit and licence. Renders of each result go to <work>/<object>/final.jpg.
// Usage: npm run bench3d:ingest -- [--from bench/results/_3d-retrieval] [--only id,id] [--skip heart]
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCli } from '../args.js';
import { LIBRARY_DIR } from '../../src/library.js';
import { complete, type ChatMessage, type ContentPart } from '../../src/llm.js';
import { loadModel } from '../../src/models.js';
import type { AssetRequest } from '../../src/three-d/prompts.js';
import { closeRenderer, renderGlb } from '../../src/three-d/render.js';
import { dataUrl } from '../../src/three-d/review.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const WORKER = join(repoRoot, 'apps/worker3d');
const cli = parseCli(process.argv.slice(2), {
  values: ['from', 'only', 'skip', 'objects'],
  usage: 'npm run bench3d:ingest -- [--from dir] [--only id,id] [--skip id,id] [--objects file]',
});
const from = resolve(repoRoot, cli.flags.from ?? 'bench/results/_3d-retrieval');
const work = join(repoRoot, 'data/library-work');
const only = cli.flags.only?.split(',');
const skip = new Set(cli.flags.skip?.split(',') ?? []);
const requests = new Map((JSON.parse(await readFile(resolve(repoRoot, cli.flags.objects ?? 'bench/prompts/objects-12.json'), 'utf8')) as AssetRequest[]).map((o) => [o.id, o]));
const ember = await loadModel('muse-ember-1.0-max');

const NAME_SYSTEM = `You turn a 3D model found online into a model for a mixed-reality lesson. You see four views of the model as its author made it (front, side = seen from the right, back, above), then one picture per group of its pieces, with that group in solid red and the rest of the model faint. Reply with only a JSON object:
{"title": "<short name of the object, e.g. Bicycle>",
 "bestView": "<the view a learner should see first, the one that shows the object most clearly (a bicycle from the side, a guitar from the front): front, side, back, or opposite side (the side facing away from the side view)>",
 "sizeM": <the real object's largest dimension in metres>,
 "kind": "<one of: anatomy, biology, astronomy, chemistry, mechanical, everyday, architecture, earth-science>",
 "keywords": ["<3-8 words a lesson request might use for it>"],
 "parts": {"<group number>": "<the part a teacher would label, lower case, e.g. front wheel, saddle>"}}
Name every group, with no exceptions. Give groups the same name when they are one part (both pedals: "pedals"). A group that mixes several parts gets the name of the part that covers most of it; a group that is most of the object is named after the object's main structure (e.g. "temple building", "lander body"). Use "base" for a stand or ground the object sits on.`;

function python(args: string[]): Promise<Record<string, unknown>> {
  return new Promise((done) => {
    // Trusted code: reads downloaded model files (no code in them runs) and writes library files.
    const child = spawn(join(WORKER, '.venv/bin/python3'), [join(WORKER, 'library/retrieved.py'), ...args], { cwd: join(WORKER, 'library'), stdio: ['ignore', 'pipe', 'pipe'] });
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

const rows = (await readFile(join(from, 'retrieval.jsonl'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.ok && !skip.has(r.objectId) && (!only || only.includes(r.objectId)));
for (const row of rows) {
  const id = row.objectId as string;
  const glb = join(from, 'glbs', `${id}.glb`);
  const dir = join(work, id);
  const prepared = await python(['prepare', glb, dir]);
  if (!prepared.ok) {
    console.error(`${id}: prepare failed: ${prepared.error}`);
    continue;
  }
  const legend = prepared.groups as { group: number; glb: string; surfaceShare: number }[];
  const asMade = await renderGlb(await readFile(glb));
  const highlights: Buffer[] = [];
  for (const g of legend) {
    const render = await renderGlb(await readFile(g.glb));
    if ('grid' in render) highlights.push(render.hero); // the three-quarter view from above
  }
  if (!('grid' in asMade) || highlights.length !== legend.length) {
    console.error(`${id}: render failed`);
    continue;
  }
  const request = requests.get(id);
  const messages: ChatMessage[] = [{ role: 'system', content: NAME_SYSTEM }, {
    role: 'user', content: [
      { type: 'text', text: `The model was chosen for this request: ${request?.prompt ?? id}${request ? `\nParts the lesson wants: ${request.parts.join(', ')}.` : ''}\nThe model as made:` },
      { type: 'image_url', image_url: { url: dataUrl(asMade.grid) } },
      ...legend.flatMap((g, i): ContentPart[] => [
        { type: 'text', text: `Group ${g.group} (${Math.round(g.surfaceShare * 100)}% of the surface):` },
        { type: 'image_url', image_url: { url: dataUrl(highlights[i]) } },
      ]),
    ],
  }];
  let reply = await complete(messages, ember);
  let names = parseJson<{ parts?: Record<string, string> }>(reply.text);
  const unnamed = () => legend.filter((g) => !names?.parts?.[String(g.group)]).map((g) => g.group);
  if (names?.parts && unnamed().length) {
    // Every group must have a name: an unnamed group would otherwise have no part to belong to.
    messages.push({ role: 'assistant', content: reply.text }, { role: 'user', content: `You left out group${unnamed().length > 1 ? 's' : ''} ${unnamed().join(', ')}. Reply with the whole JSON again, naming every group.` });
    reply = await complete(messages, ember);
    names = parseJson<{ parts?: Record<string, string> }>(reply.text) ?? names;
  }
  if (!names?.parts) {
    console.error(`${id}: unreadable naming reply: ${reply.text.slice(0, 200)}`);
    continue;
  }
  // Groups still unnamed become 'other' in retrieved.py, so no geometry is ever dropped.
  const choice = row.choice;
  await writeFile(join(dir, 'names.json'), JSON.stringify(names, null, 2));
  await writeFile(join(dir, 'meta.json'), JSON.stringify({
    uid: choice.uid, name: choice.name, author: choice.author, authorUrl: choice.authorUrl, viewerUrl: choice.viewerUrl,
    licence: choice.licence, similarity: choice.similarity, reason: row.reason, request: request?.prompt,
  }, null, 2));
  const result = await python(['ingest', glb, dir, '--out', LIBRARY_DIR]);
  if (!result.ok) {
    console.error(`${id}: ingest failed: ${result.error}`);
    continue;
  }
  const final = await renderGlb(await readFile(join(LIBRARY_DIR, 'assets', `${result.id}.glb`)));
  if ('grid' in final) await writeFile(join(dir, 'final.jpg'), final.grid);
  console.error(`${id}: ${result.id}, parts: ${(result.parts as string[]).join(', ')}`);
}
await closeRenderer();
