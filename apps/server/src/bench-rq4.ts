// RQ4 (SPEC.md Phase 5): does splitting a lesson across parallel builders cut time-to-content without
// lowering quality? Compares one-shot A2UI runs with parallel runs (same prompts, builder model and checks):
// success, when the first content appears (one-shot: nothing until the whole lesson; parallel:
// placeholders at the plan, real content at the first part), the full lesson, tokens, and judge quality.
// Usage: npm run bench:rq4 -- --one-shot ../../bench/results/<dir> --parallel ../../bench/results/<dir>[,<dir>]
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseCli } from './args.js';
import type { BenchRow } from './bench.js';

const cli = parseCli(process.argv.slice(2), {
  values: ['one-shot', 'parallel'],
  usage: 'npm run bench:rq4 -- --one-shot <dir> --parallel <dir>[,<dir>]',
});
if (!cli.flags['one-shot'] || !cli.flags.parallel) {
  console.error('Usage: npm run bench:rq4 -- --one-shot <dir> --parallel <dir>[,<dir>]');
  process.exit(1);
}

type Judged = { model: string; promptId: string; rep: number; overall?: number; scores?: Record<string, number> };
const jsonl = async <T>(file: string): Promise<T[]> =>
  existsSync(file) ? (await readFile(file, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as T) : [];
const median = (xs: number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const sec = (ms: number | null) => (ms == null ? '-' : `${(ms / 1000).toFixed(1)} s`);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

async function load(dir: string) {
  const rows = (await jsonl<BenchRow>(join(dir, 'results.jsonl'))).filter((r) => !r.apiError);
  // Quality: the judge panel's overall score per scene, averaged over judges.
  const judged = await jsonl<Judged>(join(dir, 'judge.jsonl'));
  const quality = new Map<string, number[]>();
  for (const j of judged) {
    const score = j.overall ?? (j.scores ? mean(Object.values(j.scores)) : null);
    if (score == null) continue;
    const key = `${j.model}|${j.promptId}|${j.rep}`;
    quality.set(key, [...(quality.get(key) ?? []), score]);
  }
  return { rows, quality };
}

const lines: string[] = ['| Version | Model | n | Success | First try | First content (median) | Full lesson (median) | Output tokens (median) | Quality (judges) |', '|---|---|---|---|---|---|---|---|---|'];
const sets: [string, string][] = [['one-shot', cli.flags['one-shot']], ...cli.flags.parallel.split(',').map((d) => ['parallel', d] as [string, string])];
for (const [kind, dirArg] of sets) {
  const { rows, quality } = await load(resolve(dirArg));
  for (const model of [...new Set(rows.map((r) => r.model))]) {
    const rs = rows.filter((r) => r.model === model);
    const ok = rs.filter((r) => r.ok);
    const first = kind === 'parallel' ? ok.map((r) => r.timings?.firstPartMs ?? r.totalMs) : ok.map((r) => r.totalMs);
    const plan = kind === 'parallel' ? median(ok.map((r) => r.timings?.planMs ?? 0)) : null;
    const scores = ok.flatMap((r) => quality.get(`${r.model}|${r.promptId}|${r.rep}`) ?? []);
    const q = mean(scores);
    lines.push(`| ${kind}${plan != null ? ` (placeholders at ${sec(plan)})` : ''} | ${model} | ${rs.length} | ${ok.length}/${rs.length} | ${rs.filter((r) => r.firstTryOk).length} | ${sec(median(first))} | ${sec(median(ok.map((r) => r.totalMs)))} | ${median(ok.map((r) => r.completionTokens)) ?? '-'} | ${q == null ? 'not judged' : `${q.toFixed(2)} (n=${scores.length})`} |`);
  }
}
console.log(lines.join('\n'));
