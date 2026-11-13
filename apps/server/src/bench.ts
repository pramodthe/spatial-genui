// Phase 2 benchmark, generation stage: every enabled model × prompt × repetition through the
// same agent loop (system prompt, checks, repair). Results append to <out>/results.jsonl, so an
// interrupted run resumes where it stopped.
//
// Usage: npm run bench -- [--prompts ../../bench/prompts/test-12.json] [--models ../../bench/models.json]
//                         [--only id,id] [--prompt-ids id,id] [--runs 1] [--limit 12] [--concurrency 4] [--out ../../bench/results/<name>]
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { generate } from './agent.js';
import { config } from './config.js';
import type { LlmTarget } from './llm.js';
import { parseCli } from './args.js';
import { librarySection } from './library.js';
import type { Route } from './router.js';
import { SYSTEM_PROMPT } from './prompt.js';

type ModelEntry = LlmTarget & {
  family: string;
  apiKeyEnv: string;
  priceIn?: number;
  priceOut?: number;
  enabled?: boolean;
};
type PromptCase = { id: string; tier: string; domain: string; prompt: string };

export type BenchRow = {
  model: string;
  family: string;
  promptId: string;
  tier: string;
  domain: string;
  rep: number;
  ok: boolean;
  /** Passed every check on the first attempt (no repair). */
  firstTryOk: boolean;
  stages: string[];
  failureKinds: string[];
  attempts: number;
  firstAttemptMs: number;
  totalMs: number;
  promptTokens: number;
  completionTokens: number;
  costUSD: number | null;
  stats?: Record<string, unknown>;
  error?: string;
  /** The provider failed (after SDK retries), not the model's output; excluded from quality metrics. */
  apiError?: string;
  code?: string;
  route?: Route;
};

const cli = parseCli(process.argv.slice(2), {
  values: ['prompts', 'models', 'only', 'prompt-ids', 'runs', 'limit', 'concurrency', 'out'],
  booleans: ['library'],
  usage: 'npm run bench -- [--prompts f] [--models f] [--only id,id] [--prompt-ids id,id] [--runs n] [--limit n] [--concurrency n] [--out dir] [--library]',
});
const args = cli.flags;
const useLibrary = cli.booleans.has('library');
const repoRoot = resolve(import.meta.dirname, '../../..');
const promptsFile = resolve(args.prompts ?? join(repoRoot, 'bench/prompts/test-12.json'));
const modelsFile = resolve(args.models ?? join(repoRoot, 'bench/models.json'));
// Without --out, results go to a `_`-prefixed scratch folder, which .gitignore keeps out of git.
const outDir = resolve(args.out || join(repoRoot, 'bench/results', `_run-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`));
const runs = positiveInt(args.runs, 1);
const concurrency = positiveInt(args.concurrency, 4);

const promptIds = args['prompt-ids'] ? new Set(args['prompt-ids'].split(',')) : null;
const prompts = (JSON.parse(await readFile(promptsFile, 'utf8')) as PromptCase[])
  .filter((p) => !promptIds || promptIds.has(p.id))
  .slice(0, positiveInt(args.limit, Infinity));
const only = args.only ? new Set(args.only.split(',')) : null;
const allModels = (JSON.parse(await readFile(modelsFile, 'utf8')) as { models: ModelEntry[] }).models;
const models = allModels
  .filter((m) => (only ? only.has(m.id) : m.enabled))
  .map((m) => ({ ...m, apiKey: resolveKey(m) }));
const runnable = models.filter((m) => m.apiKey);
const skipped = models.filter((m) => !m.apiKey).map((m) => `${m.id} (set ${m.apiKeyEnv})`);

await mkdir(outDir, { recursive: true });
const resultsFile = join(outDir, 'results.jsonl');
const done = new Set<string>();
if (existsSync(resultsFile)) {
  for (const line of (await readFile(resultsFile, 'utf8')).split('\n').filter(Boolean)) {
    const r = JSON.parse(line) as BenchRow;
    if (!r.apiError) done.add(`${r.model}|${r.promptId}|${r.rep}`);
  }
}
// A run directory can be filled in several sittings (e.g. one model now, another when its key works).
const previousMeta = existsSync(join(outDir, 'meta.json')) ? JSON.parse(await readFile(join(outDir, 'meta.json'), 'utf8')) : {};
await writeFile(
  join(outDir, 'meta.json'),
  JSON.stringify({
    startedAt: previousMeta.startedAt ?? new Date().toISOString(), promptsFile: relative(repoRoot, promptsFile), modelsFile: relative(repoRoot, modelsFile), runs,
    models: [...new Set([...(previousMeta.models ?? []), ...runnable.map((m) => m.id)])],
    modelSettings: { ...previousMeta.modelSettings, ...Object.fromEntries(runnable.map((m) => [m.id, { model: m.model, baseURL: m.baseURL, extraBody: m.extraBody }])) },
    skipped, maxRepairs: config.maxRepairs, maxCompletionTokens: config.maxCompletionTokens,
    library: useLibrary,
    // With the library on, the router adds only the chosen models' section (recorded per row as route).
    systemPrompt: useLibrary ? SYSTEM_PROMPT + librarySection() : SYSTEM_PROMPT,
  }, null, 2),
);

const jobs = runnable.flatMap((m) =>
  prompts.flatMap((p) => Array.from({ length: runs }, (_, rep) => ({ m, p, rep }))),
).filter((j) => !done.has(`${j.m.id}|${j.p.id}|${j.rep}`));

console.error(`Models: ${runnable.map((m) => m.id).join(', ') || '(none)'}${skipped.length ? `\nSkipped (no key): ${skipped.join(', ')}` : ''}`);
console.error(`${jobs.length} generations to run (${done.size} already done) → ${outDir}`);

let next = 0;
let finished = 0;
async function worker() {
  while (next < jobs.length) {
    const { m, p, rep } = jobs[next++];
    const row = await runOne(m, p, rep);
    await appendFile(resultsFile, JSON.stringify(row) + '\n');
    finished++;
    const status = row.apiError ? `API ERROR ${row.apiError.slice(0, 80)}` : `${row.ok ? 'PASS' : 'FAIL'} ${row.stages.join('→')}`;
    console.error(`[${finished}/${jobs.length}] ${m.id.padEnd(18)} ${p.id.padEnd(15)} #${rep} ${(row.totalMs / 1000).toFixed(0).padStart(4)} s  ${status}`);
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
console.error(`Done. Summarize with: npm run bench:report -- ${outDir}`);

async function runOne(m: ModelEntry, p: PromptCase, rep: number): Promise<BenchRow> {
  const base = { model: m.id, family: m.family, promptId: p.id, tier: p.tier, domain: p.domain, rep };
  try {
    // The 3D asset library is off unless asked for, so runs stay comparable with the published ones.
    const r = await generate(p.prompt, { target: m, log: false, library: useLibrary });
    const promptTokens = r.attempts.reduce((s, a) => s + a.promptTokens, 0);
    const completionTokens = r.attempts.reduce((s, a) => s + a.completionTokens, 0);
    return {
      ...base,
      ok: r.ok,
      firstTryOk: r.attempts[0]?.stage === 'ok',
      stages: r.attempts.map((a) => a.stage),
      failureKinds: r.attempts.filter((a) => a.stage !== 'ok').map((a) => classifyFailure(a.stage, a.error ?? '', a.finishReason)),
      attempts: r.attempts.length,
      firstAttemptMs: r.attempts[0]?.ms ?? 0,
      totalMs: r.totalMs,
      promptTokens,
      completionTokens,
      costUSD:
        m.priceIn != null && m.priceOut != null
          ? round4((promptTokens * m.priceIn + completionTokens * m.priceOut) / 1e6)
          : null,
      stats: r.stats,
      error: r.ok ? undefined : r.error?.slice(0, 500),
      code: r.code,
      route: r.route,
    };
  } catch (err) {
    return {
      ...base, ok: false, firstTryOk: false, stages: [], failureKinds: [], attempts: 0, firstAttemptMs: 0,
      totalMs: 0, promptTokens: 0, completionTokens: 0, costUSD: null, apiError: (err as Error).message.slice(0, 300),
    };
  }
}

/** Coarse failure taxonomy for the paper (one label per failed attempt). */
function classifyFailure(stage: string, error: string, finishReason: string | null): string {
  if (stage === 'no-code') return finishReason === 'length' ? 'truncated' : 'no-code-block';
  if (stage === 'validate') {
    if (/^Syntax error/.test(error)) return 'syntax';
    if (/default export|export default/.test(error)) return 'contract';
    if (/plain ASCII/.test(error)) return 'unsupported-glyph';
    return 'forbidden-api';
  }
  if (/timed out/.test(error)) return 'timeout';
  if (/UIKitML/.test(error)) return 'panel-markup';
  if (/triangles|draw calls/.test(error)) return 'over-budget';
  if (/must return|default export/.test(error)) return 'contract';
  if (/not inside `root`|add `handle.object3D`/.test(error)) return 'hierarchy';
  if (/width in meters/.test(error)) return 'panel-options';
  if (/explicit width|smallest text/.test(error)) return 'panel-text-size';
  if (/tilted|turned \d+°/.test(error)) return 'panel-orientation';
  if (/empty/.test(error)) return 'empty-scene';
  if (/Runtime error/.test(error)) return 'runtime-error';
  return 'other';
}

function resolveKey(m: ModelEntry): string {
  const fromEnv = process.env[m.apiKeyEnv];
  if (fromEnv) return fromEnv;
  // Same endpoint as the app itself: reuse the app's key.
  return new URL(m.baseURL).host === new URL(config.baseURL).host ? config.apiKey : '';
}

/** A positive integer flag value, or the fallback when the flag is missing, empty or not a number. */
function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value && Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

function round4(n: number) {
  return Math.round(n * 1e4) / 1e4;
}
