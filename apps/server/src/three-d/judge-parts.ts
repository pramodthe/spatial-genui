// Independent check of part segmentation (M5): Claude Opus 5.5, not part of any pipeline, sees each part
// of a segmented model in solid red with the rest faint (four views) and scores how well the red region
// matches the part's name. Reads <dir>/segment.jsonl and the work folders bench3d:segment wrote.
// Usage: npm run bench3d:judge-parts -- --dir bench/results/_seg-trellis --tag trellis [--judge claude-opus-5-5]
import { existsSync } from 'node:fs';
import { appendFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCli } from '../args.js';
import { complete, type ContentPart } from '../llm.js';
import { loadModel } from '../models.js';
import { closeRenderer, renderGlb } from './render.js';
import { dataUrl } from './review.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const cli = parseCli(process.argv.slice(2), { values: ['dir', 'tag', 'judge'], usage: 'npm run bench3d:judge-parts -- --dir <dir> --tag <name> [--judge id]' });
if (!cli.flags.dir || !cli.flags.tag) {
  console.error('Usage: npm run bench3d:judge-parts -- --dir <dir> --tag <name> [--judge id]');
  process.exit(1);
}
const dir = resolve(repoRoot, cli.flags.dir);
const work = join(repoRoot, 'data/segment-work', cli.flags.tag);
const judge = await loadModel(cli.flags.judge ?? 'claude-opus-5-5');

const SYSTEM = `You check how a 3D model was divided into named parts for a mixed-reality lesson. For each part you see four views of the model (front, side, back, above) with that part in solid red and the rest of the model faint. Judge only what you see. For each part score 1-5: 5 = the red region is exactly that part; 4 = right, with small stray or missing bits; 3 = mostly right but clearly too much or too little; 2 = partly the wrong thing; 1 = wrong. Reply with only a JSON object:
{"parts": [{"name": "<part>", "score": <1-5>, "note": "<what is wrong, if anything>"}], "overall": <1-5, how usable the parts are for labelling and taking the model apart in a lesson>, "missing": ["<important parts of this object that have no part of their own>"]}`;

const rowsFile = join(dir, 'parts-judge.jsonl');
const done = new Set(existsSync(rowsFile) ? (await readFile(rowsFile, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l).objectId as string) : []);
const rows = (await readFile(join(dir, 'segment.jsonl'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.ok && !done.has(r.objectId));
for (const row of rows) {
  const parts = row.parts as string[];
  const content: ContentPart[] = [{ type: 'text', text: `Object: ${row.objectId.replace(/-/g, ' ')}. It has ${parts.length} parts.` }];
  for (let i = 0; i < parts.length; i++) {
    const render = await renderGlb(await readFile(join(work, row.objectId, `check_${i + 1}.glb`)));
    if (!('grid' in render)) continue;
    content.push({ type: 'text', text: `Part ${i + 1}: "${parts[i]}"` }, { type: 'image_url', image_url: { url: dataUrl(render.grid) } });
  }
  const reply = await complete([{ role: 'system', content: SYSTEM }, { role: 'user', content }], judge);
  const start = reply.text.indexOf('{');
  let verdict: { parts?: { name: string; score: number; note?: string }[]; overall?: number; missing?: string[] } | null = null;
  try {
    verdict = JSON.parse(reply.text.slice(start, reply.text.lastIndexOf('}') + 1));
  } catch {
    verdict = null;
  }
  await appendFile(rowsFile, JSON.stringify({ objectId: row.objectId, judge: judge.id, ...(verdict ?? { error: reply.text.slice(0, 300) }) }) + '\n');
  const scores = verdict?.parts?.map((p) => `${p.name} ${p.score}`).join(', ');
  console.error(`${row.objectId.padEnd(16)} overall ${verdict?.overall ?? '?'}: ${scores ?? 'unreadable'}`);
}
await closeRenderer();
