// Phase 3 benchmark: build every object with every pipeline, with and without a reference image
// (M1), then run the critic loop (M2) on each. Round 0 of a job is the pipeline alone; its last good
// round is the pipeline plus the critic, so each critic comparison is on the same starting model.
// Usage: npm run bench3d -- [--objects bench/prompts/objects-12.json] [--pipelines p1-threejs,p2-cadquery,p3-blender]
//          [--variants base,ref] [--only heart,saturn] [--critic-rounds 3] [--model muse-ember-1.0-max]
//          [--critic-model <id>] [--concurrency 4] [--out bench/results/<name>]
// Resumable: jobs already in results.jsonl are skipped (provider errors are retried).
import { existsSync, rmSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCli } from '../args.js';
import { loadModel } from '../models.js';
import { PIPELINES, missingParts, requestText, revisionText, type AssetRequest, type Pipeline } from './prompts.js';
import { defaultBackend, openSession, type Backend, type StepResult, type Usage } from './pipelines.js';
import { closeRenderer, renderGlb, type RenderStats } from './render.js';
import { critique, dataUrl, referenceImage, type Critique } from './review.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const cli = parseCli(process.argv.slice(2), {
  values: ['objects', 'pipelines', 'variants', 'only', 'critic-rounds', 'model', 'critic-model', 'concurrency', 'out', 'backend'],
  usage: 'npm run bench3d -- [--objects file] [--pipelines a,b] [--variants base,ref] [--only ids] [--critic-rounds n] [--model id] [--critic-model id] [--concurrency n] [--out dir] [--backend modal|local]',
});
const list = (v: string | undefined) => v?.split(',').map((s) => s.trim()).filter(Boolean);
const positiveInt = (v: string | undefined, fallback: number) => (v && Number(v) >= 0 && Number.isInteger(Number(v)) ? Number(v) : fallback);

const objectsFile = resolve(repoRoot, cli.flags.objects ?? 'bench/prompts/objects-12.json');
const only = list(cli.flags.only);
const objects = (JSON.parse(await readFile(objectsFile, 'utf8')) as AssetRequest[]).filter((o) => !only || only.includes(o.id));
const pipelines = (list(cli.flags.pipelines) ?? PIPELINES) as Pipeline[];
for (const p of pipelines) if (!PIPELINES.includes(p)) throw new Error(`Unknown pipeline ${p}; use ${PIPELINES.join(', ')}`);
const variants = list(cli.flags.variants) ?? ['base', 'ref'];
for (const v of variants) if (v !== 'base' && v !== 'ref') throw new Error(`Unknown variant ${v}; use base, ref`);
const criticRounds = positiveInt(cli.flags['critic-rounds'], 3);
const concurrency = Math.max(1, positiveInt(cli.flags.concurrency, 4));
const generator = await loadModel(cli.flags.model ?? 'muse-ember-1.0-max');
const critic = await loadModel(cli.flags['critic-model'] ?? generator.id);
const outDir = resolve(repoRoot, cli.flags.out ?? `bench/results/_3d-run-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`);
const backend = (cli.flags.backend ?? defaultBackend()) as Backend;
if (backend !== 'modal' && backend !== 'local') throw new Error(`Unknown backend ${backend}; use modal or local`);
// A critic score this high, with every required part named, ends the loop.
const PASS_SCORE = 8;

export type Round = {
  round: number;
  ok: boolean;
  error?: string;
  repairs: number;
  /** The build or revision step that produced this round: wall time and model usage. */
  gen: { ms: number; calls: number; promptTokens: number; completionTokens: number; toolCalls: number };
  /** Render and review time for this round. */
  ms: number;
  glb?: string;
  grid?: string;
  hero?: string;
  stats?: RenderStats;
  glbBytes?: number;
  missing?: string[];
  /** The critic's review of this round (drives the next round). */
  critique?: Omit<Critique, 'ms' | 'promptTokens' | 'completionTokens'> & { ms: number };
};

export type JobRow = {
  objectId: string;
  category: string;
  pipeline: Pipeline;
  variant: 'base' | 'ref';
  model: string;
  criticModel: string;
  ok: boolean;
  rounds: Round[];
  /** The pipeline + critic result: the round the critic scored highest (latest on ties). */
  finalRound: number | null;
  /** The last round that produced a model. */
  lastRound: number | null;
  usage: Usage;
  criticUsage: { calls: number; promptTokens: number; completionTokens: number; ms: number };
  refMs?: number;
  /** Time to the first model (round 0, including repairs): the latency a user waits. */
  firstMs?: number;
  totalMs: number;
  apiError?: string;
  /** Made outside the harness and imported (no time, cost or critic data). */
  external?: boolean;
};

function bestRound(rounds: Round[]): number | null {
  let best: Round | null = null;
  for (const r of rounds) {
    if (!r.ok || !r.glb) continue;
    if (!best || (r.critique?.score ?? 0) >= (best.critique?.score ?? 0)) best = r;
  }
  return best?.round ?? null;
}

const key = (r: { objectId: string; pipeline: string; variant: string }) => `${r.pipeline}|${r.objectId}|${r.variant}`;

async function readJsonl<T>(file: string): Promise<T[]> {
  if (!existsSync(file)) return [];
  return (await readFile(file, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as T);
}

await mkdir(join(outDir, 'refs'), { recursive: true });
// Two runs in one folder overwrite each other's files: refuse to start if another run holds the lock.
const lockFile = join(outDir, '.lock');
if (existsSync(lockFile)) {
  const pid = Number(await readFile(lockFile, 'utf8'));
  let alive = false;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch {}
  if (alive) {
    console.error(`Another run (pid ${pid}) is using ${relative(repoRoot, outDir)}. Stop it first.`);
    process.exit(1);
  }
}
await writeFile(lockFile, String(process.pid));
process.on('exit', () => rmSync(lockFile, { force: true }));
const resultsFile = join(outDir, 'results.jsonl');
const done = new Set((await readJsonl<JobRow>(resultsFile)).filter((r) => !r.apiError).map(key));
await writeFile(join(outDir, 'meta.json'), JSON.stringify({
  objectsFile: relative(repoRoot, objectsFile), pipelines, variants, criticRounds, passScore: PASS_SCORE,
  model: generator.id, criticModel: critic.id, backend, updatedAt: new Date().toISOString(),
}, null, 2));

// One reference image per object, shared by every pipeline so they start from the same picture.
const refs = new Map<string, Promise<{ jpeg: Buffer; ms: number }>>();
function reference(obj: AssetRequest) {
  let ref = refs.get(obj.id);
  if (!ref) {
    const file = join(outDir, 'refs', `${obj.id}.jpg`);
    ref = existsSync(file)
      ? readFile(file).then((jpeg) => ({ jpeg, ms: 0 }))
      : referenceImage(obj).then(async (r) => (await writeFile(file, r.jpeg), r));
    refs.set(obj.id, ref);
  }
  return ref;
}

async function runJob(obj: AssetRequest, pipeline: Pipeline, variant: 'base' | 'ref'): Promise<JobRow> {
  const started = performance.now();
  const jobDir = join(outDir, 'jobs', `${pipeline}__${obj.id}__${variant}`);
  await mkdir(jobDir, { recursive: true });
  const row: JobRow = {
    objectId: obj.id, category: obj.category, pipeline, variant, model: generator.id, criticModel: critic.id,
    ok: false, rounds: [], finalRound: null, lastRound: null, usage: { calls: 0, promptTokens: 0, completionTokens: 0, llmMs: 0, toolCalls: 0 },
    criticUsage: { calls: 0, promptTokens: 0, completionTokens: 0, ms: 0 }, totalMs: 0,
  };
  const ref = variant === 'ref' ? await reference(obj) : undefined;
  row.refMs = ref?.ms;
  const session = await openSession(pipeline, generator, jobDir, backend);
  try {
    // Usage and wall time of one build/revision step, so each round's cost is known.
    const measured = async (run: () => Promise<StepResult>) => {
      const before = { ...session.usage };
      const t0 = performance.now();
      const step = await run();
      const u = session.usage;
      return { step, gen: {
        ms: Math.round(performance.now() - t0), calls: u.calls - before.calls, promptTokens: u.promptTokens - before.promptTokens,
        completionTokens: u.completionTokens - before.completionTokens, toolCalls: u.toolCalls - before.toolCalls,
      } };
    };
    let { step, gen } = await measured(() => session.start(requestText(obj, Boolean(ref)), ref ? dataUrl(ref.jpeg) : undefined));
    row.firstMs = gen.ms;
    for (let round = 0; ; round++) {
      const t = performance.now();
      const entry: Round = { round, ok: step.ok, repairs: step.repairs, gen, ms: 0 };
      row.rounds.push(entry);
      if (!step.ok) {
        entry.error = step.error;
        break;
      }
      const glbFile = join(jobDir, `round-${round}.glb`);
      await writeFile(glbFile, step.glb);
      const render = await renderGlb(step.glb);
      if ('error' in render) {
        entry.ok = false;
        entry.error = render.error;
        break;
      }
      entry.glb = relative(outDir, glbFile);
      entry.grid = relative(outDir, join(jobDir, `round-${round}.jpg`));
      entry.hero = relative(outDir, join(jobDir, `round-${round}-hero.jpg`));
      await writeFile(join(outDir, entry.grid), render.grid);
      await writeFile(join(outDir, entry.hero), render.hero);
      entry.stats = render.stats;
      entry.glbBytes = render.glbBytes;
      entry.missing = missingParts(obj, render.stats.nodeNames);
      row.lastRound = round;
      if (criticRounds === 0) break;

      // Every round is reviewed, the last one too, so a revision that made things worse isn't kept.
      const review = await critique(critic, obj, render.grid, render.stats, entry.missing);
      entry.critique = { score: review.score, problems: review.problems, ms: review.ms };
      row.criticUsage.calls++;
      row.criticUsage.promptTokens += review.promptTokens;
      row.criticUsage.completionTokens += review.completionTokens;
      row.criticUsage.ms += review.ms;
      entry.ms = Math.round(performance.now() - t);
      if ((review.score >= PASS_SCORE && entry.missing.length === 0) || round >= criticRounds) break;
      ({ step, gen } = await measured(() => session.revise(revisionText(pipeline, review.problems, entry.missing ?? []), dataUrl(render.grid))));
    }
    row.ok = row.rounds[0]?.ok ?? false;
    row.finalRound = bestRound(row.rounds);
  } finally {
    await session.close();
  }
  row.usage = session.usage;
  row.totalMs = Math.round(performance.now() - started);
  return row;
}

const jobs = objects.flatMap((obj) => pipelines.flatMap((pipeline) => variants.map((variant) => ({ obj, pipeline, variant: variant as 'base' | 'ref' }))))
  .filter((j) => !done.has(key({ objectId: j.obj.id, pipeline: j.pipeline, variant: j.variant })));
console.error(`Phase 3 bench → ${relative(repoRoot, outDir)}: ${jobs.length} jobs (${objects.length} objects × ${pipelines.join(', ')} × ${variants.join(', ')}), generator ${generator.id}, critic ${critic.id}, ≤${criticRounds} critic rounds, concurrency ${concurrency}, 3D backend ${backend}`);

let next = 0;
let finished = 0;
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (next < jobs.length) {
    const { obj, pipeline, variant } = jobs[next++];
    let row: JobRow;
    try {
      row = await runJob(obj, pipeline, variant);
    } catch (err) {
      // Provider or harness failure, not the pipeline's: recorded, and retried on the next run.
      row = {
        objectId: obj.id, category: obj.category, pipeline, variant, model: generator.id, criticModel: critic.id, ok: false,
        rounds: [], finalRound: null, lastRound: null, usage: { calls: 0, promptTokens: 0, completionTokens: 0, llmMs: 0, toolCalls: 0 },
        criticUsage: { calls: 0, promptTokens: 0, completionTokens: 0, ms: 0 }, totalMs: 0, apiError: String((err as Error).message ?? err).slice(0, 500),
      };
    }
    await appendFile(resultsFile, JSON.stringify(row) + '\n');
    finished++;
    const scores = row.rounds.map((r) => r.critique?.score ?? (r.ok ? '·' : '✗')).join('→');
    console.error(`[${finished}/${jobs.length}] ${pipeline} ${obj.id} ${variant}: ${row.apiError ? `API error: ${row.apiError.slice(0, 120)}` : row.ok ? `ok, rounds ${scores}, ${(row.totalMs / 1000).toFixed(0)} s` : `failed: ${row.rounds[0]?.error?.slice(0, 160)}`}`);
  }
}));
await closeRenderer();
