// Phase 2 benchmark, quality stage: vision-model judges score each mounted scene's screenshot.
// A panel of judges from different providers reduces self-preference bias; the report shows the
// mean and per-judge scores. Appends to <dir>/judge.jsonl and resumes.
// Usage: npm run bench:judge -- ../../bench/results/<name> [--judges claude-sonnet-5-5,muse-spark-1.3,deepseek-v4.1-flash] [--concurrency 4]
import { existsSync } from 'node:fs';
import { appendFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { config } from './config.js';
import { parseCli } from './args.js';
import { complete, type LlmTarget } from './llm.js';

type ModelEntry = LlmTarget & { family: string; apiKeyEnv: string; priceIn?: number; priceOut?: number; enabled?: boolean };
type BrowserRow = { model: string; promptId: string; rep: number; mounted: boolean; shot?: string };
type PromptCase = { id: string; prompt: string };

const DIMENSIONS = ['fidelity', 'clarity', 'correctness', 'handsOn'] as const;

const JUDGE_PROMPT = `You are judging generative UI for a mixed-reality headset. An AI was asked to build an
interactive spatial component from the request below; the screenshot shows the result as seen by a seated user.

Ignore everything that is not the generated component:
- the living room (a simulated stand-in for the user's real room seen through passthrough),
- emulator controls: the top-right "Runtime / Editor" bar, the "Remote Control Active" badge,
  white outline hands and any controller or hand panels in the corners.

Score the generated component from 1 (very poor) to 5 (excellent) on:
- fidelity: does it show what was requested, with nothing important missing?
- clarity: is the text legible and the layout tidy (no overlaps, nothing clipped or hidden)?
- correctness: are the visible facts, labels and numbers correct? (5 if nothing factual is shown)
- handsOn: is it clear what the user can grab or press, and does it invite interaction?

Reply with only a JSON object: {"fidelity": n, "clarity": n, "correctness": n, "handsOn": n, "notes": "one sentence"}`;

// --looks adds a craft score, kept beside the four above (never averaged into them, so runs judged before
// it existed stay comparable). It is what a learner sees first: is the 3D model well made?
const LOOKS_PROMPT = JUDGE_PROMPT.replace(
  '\nReply with only a JSON object: {',
  `- looks: how well made is the 3D model itself, apart from the panel? 1 = a few plain boxes, spheres or
  cylinders in flat colors; 3 = recognisable, right proportions, some secondary parts and materials;
  5 = a carefully made scale model: true shapes, fine repeated detail, varied materials and surface texture.
  (3 if the request needs no 3D model.)

Reply with only a JSON object: {"looks": n, `,
);

const cli = parseCli(process.argv.slice(2), {
  values: ['judges', 'concurrency'],
  booleans: ['looks'],
  usage: 'npm run bench:judge -- <results dir> [--judges id,id] [--concurrency n] [--looks]',
});
const args = cli.flags;
const withLooks = cli.booleans.has('looks');
const dir = resolve(cli.positional[0] ?? '');
if (!existsSync(join(dir, 'browser.jsonl'))) {
  console.error('Usage: npm run bench:judge -- <results dir with browser.jsonl> [--judges id,id]');
  process.exit(1);
}
const repoRoot = resolve(import.meta.dirname, '../../..');
const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8').catch(() => '{}'));
const prompts = new Map(
  (JSON.parse(await readFile(resolve(repoRoot, meta.promptsFile ?? 'bench/prompts/test-12.json'), 'utf8')) as PromptCase[]).map((p) => [p.id, p.prompt]),
);
const catalog = (JSON.parse(await readFile(resolve(repoRoot, meta.modelsFile ?? 'bench/models.json'), 'utf8')) as { models: ModelEntry[] }).models;
const wanted = (args.judges ?? 'claude-sonnet-5-5,muse-spark-1.3,deepseek-v4.1-flash').split(',');
const judges = wanted
  .map((id) => catalog.find((m) => m.id === id))
  .filter((m): m is ModelEntry => Boolean(m))
  .map((m) => ({ ...m, apiKey: process.env[m.apiKeyEnv] || (new URL(m.baseURL).host === new URL(config.baseURL).host ? config.apiKey : '') }))
  .filter((m) => m.apiKey);
if (judges.length === 0) {
  console.error('No judge has an API key. Add keys to .env or pass --judges.');
  process.exit(1);
}

const judgeFile = join(dir, 'judge.jsonl');
const done = new Set(
  existsSync(judgeFile)
    ? (await readFile(judgeFile, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.scores).map((r) => `${r.judge}|${r.model}|${r.promptId}|${r.rep}`)
    : [],
);
const rows = (await readFile(join(dir, 'browser.jsonl'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as BrowserRow)
  .filter((r) => r.mounted && r.shot);
const jobs = judges.flatMap((judge) => rows.map((row) => ({ judge, row }))).filter(({ judge, row }) => !done.has(`${judge.id}|${row.model}|${row.promptId}|${row.rep}`));
console.error(`Judges: ${judges.map((j) => j.id).join(', ')} · ${jobs.length} scores to compute`);

let next = 0;
const concurrency = Number.isFinite(Number(args.concurrency)) && Number(args.concurrency) >= 1 ? Math.floor(Number(args.concurrency)) : 4;
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (next < jobs.length) {
    const { judge, row } = jobs[next++];
    const base = { judge: judge.id, judgeFamily: judge.family, model: row.model, promptId: row.promptId, rep: row.rep };
    try {
      // Inside the try: a missing screenshot becomes an error row, not a crash of the whole run.
      const image = (await readFile(join(dir, row.shot!))).toString('base64');
      const reply = await complete([
        { role: 'system', content: withLooks ? LOOKS_PROMPT : JUDGE_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Request: "${prompts.get(row.promptId) ?? row.promptId}"` },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${image}` } },
          ],
        },
      ], judge);
      const parsed = JSON.parse(reply.text.match(/\{[\s\S]*\}/)?.[0] ?? 'null');
      const scores = Object.fromEntries(DIMENSIONS.map((d) => [d, Number(parsed?.[d])]));
      if (!DIMENSIONS.every((d) => scores[d] >= 1 && scores[d] <= 5)) throw new Error(`Unparseable reply: ${reply.text.slice(0, 200)}`);
      const looks = withLooks ? Number(parsed?.looks) : undefined;
      if (withLooks && !(looks! >= 1 && looks! <= 5)) throw new Error(`No looks score in the reply: ${reply.text.slice(0, 200)}`);
      await appendFile(judgeFile, JSON.stringify({ ...base, scores, looks, notes: String(parsed.notes ?? '').slice(0, 300) }) + '\n');
      console.error(`${judge.id.padEnd(18)} ${row.model.padEnd(18)} ${row.promptId.padEnd(15)} ${DIMENSIONS.map((d) => scores[d]).join(' ')}`);
    } catch (err) {
      await appendFile(judgeFile, JSON.stringify({ ...base, error: (err as Error).message.slice(0, 300) }) + '\n');
      console.error(`${judge.id.padEnd(18)} ${row.model.padEnd(18)} ${row.promptId.padEnd(15)} ERROR ${(err as Error).message.slice(0, 100)}`);
    }
  }
}));

