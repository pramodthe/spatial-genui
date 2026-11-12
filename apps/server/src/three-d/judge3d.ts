// Phase 3 judge: an independent vision model (not used by any pipeline) scores the four-view render
// of each job's first model (round 0) and its critic-selected model (final round).
// Usage: npm run bench3d:judge -- <results dir> [--judge claude-opus-5-5] [--concurrency 4]
// Resumable: appends to judge.jsonl and skips renders already scored.
import { existsSync } from 'node:fs';
import { appendFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCli } from '../args.js';
import { loadModel } from '../models.js';
import type { AssetRequest } from './prompts.js';
import { judge, type Verdict } from './review.js';
import type { JobRow } from './bench3d.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const cli = parseCli(process.argv.slice(2), {
  values: ['judge', 'concurrency'],
  usage: 'npm run bench3d:judge -- <results dir> [--judge model-id] [--concurrency n]',
});
const dir = cli.positional[0] ? resolve(repoRoot, cli.positional[0]) : '';
if (!dir || !existsSync(join(dir, 'results.jsonl'))) {
  console.error('Usage: npm run bench3d:judge -- <results dir with results.jsonl> [--judge model-id]');
  process.exit(1);
}
const judgeModel = await loadModel(cli.flags.judge ?? 'claude-opus-5-5');
const concurrency = Math.max(1, Number(cli.flags.concurrency ?? 4) || 4);

export type JudgeRow = Omit<Verdict, 'ms' | 'promptTokens' | 'completionTokens'> & {
  judge: string; objectId: string; pipeline: string; variant: string; round: number;
  ms: number; promptTokens: number; completionTokens: number; error?: string;
};

const readJsonl = async <T>(file: string): Promise<T[]> =>
  existsSync(file) ? (await readFile(file, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as T) : [];

const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as { objectsFile: string };
const objects = new Map((JSON.parse(await readFile(resolve(repoRoot, meta.objectsFile), 'utf8')) as AssetRequest[]).map((o) => [o.id, o]));
const rows = (await readJsonl<JobRow>(join(dir, 'results.jsonl'))).filter((r) => !r.apiError);
const judgeFile = join(dir, 'judge.jsonl');
const key = (r: { judge: string; objectId: string; pipeline: string; variant: string; round: number }) =>
  `${r.judge}|${r.pipeline}|${r.objectId}|${r.variant}|${r.round}`;
const done = new Set((await readJsonl<JudgeRow>(judgeFile)).filter((r) => !r.error).map(key));

const jobs = rows.flatMap((row) => {
  const rounds = [...new Set([0, row.finalRound].filter((r): r is number => r !== null))];
  return rounds
    .map((round) => ({ row, round: row.rounds[round] }))
    .filter(({ round }) => round?.ok && round.grid)
    .filter(({ row, round }) => !done.has(key({ judge: judgeModel.id, objectId: row.objectId, pipeline: row.pipeline, variant: row.variant, round: round.round })));
});
console.error(`Judge ${judgeModel.id}: ${jobs.length} renders to score`);

let next = 0;
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (next < jobs.length) {
    const { row, round } = jobs[next++];
    const base = { judge: judgeModel.id, objectId: row.objectId, pipeline: row.pipeline, variant: row.variant, round: round.round };
    let out: JudgeRow;
    try {
      const v = await judge(judgeModel, objects.get(row.objectId)!, await readFile(join(dir, round.grid!)));
      out = { ...base, ...v };
    } catch (err) {
      out = {
        ...base, recognizable: NaN, accuracy: NaN, craft: NaN, overall: NaN, partsVisible: [], comment: '',
        ms: 0, promptTokens: 0, completionTokens: 0, error: String((err as Error).message ?? err).slice(0, 300),
      };
    }
    await appendFile(judgeFile, JSON.stringify(out) + '\n');
    console.error(`${row.pipeline} ${row.objectId} ${row.variant} r${round.round}: ${out.error ? `error ${out.error.slice(0, 100)}` : `${out.overall}/5`}`);
  }
}));
