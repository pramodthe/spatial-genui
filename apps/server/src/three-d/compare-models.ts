// Head-to-head check of two versions of the same models (e.g. generated from unchecked and from checked
// reference pictures). For each object the independent judge (Claude Opus 5.5, not part of any pipeline)
// sees the request, the parts the lesson must show and both versions' four-view renders, and says which
// a teacher would rather use. Each pair is judged twice, in both orders, so position can't decide it; a
// version wins an object only if it wins both orders.
// Usage: npm run bench3d:compare -- --a <dir of <id>.glb> --b <dir of <id>.glb> [--labels old,new]
//          [--objects bench/prompts/objects-12.json] [--only id,id] [--out bench/results/_compare] [--judge claude-opus-5-5]
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseCli } from '../args.js';
import { complete } from '../llm.js';
import { loadModel } from '../models.js';
import type { AssetRequest } from './prompts.js';
import { closeRenderer, renderGlb } from './render.js';
import { dataUrl } from './review.js';
import { parseJson, repoRoot } from './stages.js';

const cli = parseCli(process.argv.slice(2), {
  values: ['a', 'b', 'labels', 'objects', 'only', 'out', 'judge'],
  usage: 'npm run bench3d:compare -- --a <dir> --b <dir> [--labels old,new] [--objects file] [--only id,id] [--out dir] [--judge id]',
});
if (!cli.flags.a || !cli.flags.b) {
  console.error('Usage: npm run bench3d:compare -- --a <dir of <id>.glb> --b <dir of <id>.glb> [--labels old,new] [--out dir]');
  process.exit(1);
}
const dirs = { a: resolve(repoRoot, cli.flags.a), b: resolve(repoRoot, cli.flags.b) };
const [labelA, labelB] = (cli.flags.labels ?? 'a,b').split(',');
const outDir = resolve(repoRoot, cli.flags.out ?? 'bench/results/_compare');
const judge = await loadModel(cli.flags.judge ?? 'claude-opus-5-5');
const objects = (JSON.parse(await readFile(resolve(repoRoot, cli.flags.objects ?? 'bench/prompts/objects-12.json'), 'utf8')) as AssetRequest[])
  .filter((o) => (!cli.flags.only || cli.flags.only.split(',').includes(o.id)) && existsSync(join(dirs.a, `${o.id}.glb`)) && existsSync(join(dirs.b, `${o.id}.glb`)));

const SYSTEM = `You compare two 3D models of the same object, made for a mixed-reality lesson. You see the request, the parts the lesson must show, and four-view renders (front, side, back, above) of model 1 and model 2. Judge only what you see. Which would a teacher rather use: which is the more accurate and complete model for this lesson (the right object, a correct structure, the listed parts present and in the right place)? Craft and looks matter only when accuracy is equal. Reply with only a JSON object:
{"better": <1, 2, or 0 when there is no real difference>, "accuracy1": <1-5>, "accuracy2": <1-5>, "reason": "<one sentence naming the deciding difference>"}`;

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'compare.jsonl'), '');
const tally = { [labelA]: 0, [labelB]: 0, split: 0, tie: 0 };
for (const obj of objects) {
  const grids: Record<'a' | 'b', Buffer> = { a: Buffer.alloc(0), b: Buffer.alloc(0) };
  for (const side of ['a', 'b'] as const) {
    const render = await renderGlb(await readFile(join(dirs[side], `${obj.id}.glb`)));
    if (!('grid' in render)) throw new Error(`render of ${obj.id} (${side}) failed: ${render.error}`);
    grids[side] = render.grid;
    await writeFile(join(outDir, `${obj.id}__${side === 'a' ? labelA : labelB}.jpg`), render.grid);
  }
  const votes: { order: string; winner: string; reason: string; accuracy: Record<string, number> }[] = [];
  for (const order of [['a', 'b'], ['b', 'a']] as const) {
    const reply = await complete([{ role: 'system', content: SYSTEM }, {
      role: 'user', content: [
        { type: 'text', text: `Request: ${obj.prompt}\nParts the lesson must show: ${obj.parts.map((p) => p.replace(/_/g, ' ')).join(', ')}.\nModel 1:` },
        { type: 'image_url', image_url: { url: dataUrl(grids[order[0]]) } },
        { type: 'text', text: 'Model 2:' },
        { type: 'image_url', image_url: { url: dataUrl(grids[order[1]]) } },
      ],
    }], judge);
    const verdict = parseJson<{ better?: number; accuracy1?: number; accuracy2?: number; reason?: string }>(reply.text);
    const label = (side: 'a' | 'b') => (side === 'a' ? labelA : labelB);
    votes.push({
      order: `${label(order[0])} first`, winner: verdict?.better === 1 ? label(order[0]) : verdict?.better === 2 ? label(order[1]) : 'tie',
      reason: verdict?.reason ?? reply.text.slice(0, 200),
      accuracy: { [label(order[0])]: verdict?.accuracy1 ?? 0, [label(order[1])]: verdict?.accuracy2 ?? 0 },
    });
  }
  const winners = new Set(votes.map((v) => v.winner));
  const outcome = winners.size === 1 ? [...winners][0] : winners.has('tie') ? [...winners].find((w) => w !== 'tie')! : 'split';
  tally[outcome as keyof typeof tally]++;
  await appendFile(join(outDir, 'compare.jsonl'), JSON.stringify({ objectId: obj.id, outcome, votes }) + '\n');
  console.error(`${obj.id.padEnd(16)} ${outcome.padEnd(6)} ${votes.map((v) => `[${v.order}: ${v.winner}, ${Object.entries(v.accuracy).map(([k, n]) => `${k} ${n}`).join(' vs ')}]`).join(' ')}  ${votes[0].reason.slice(0, 140)}`);
}
console.error(`\n${objects.length} objects: ${Object.entries(tally).map(([k, n]) => `${k} ${n}`).join(', ')}  (judge ${judge.id}; a version wins an object when it wins in both orders, or once with a tie)`);
await closeRenderer();
