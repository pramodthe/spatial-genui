// Phase 3 report: merge results.jsonl (pipelines) and judge.jsonl (independent judge) into
// summary.md/json, plus a gallery (gallery.md, gallery.html, gallery/*.jpg) for reviewing by eye.
// Usage: npm run bench3d:report -- <results dir> [--judge claude-opus-5-5]
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCli } from '../args.js';
import { MODELS_FILE, type ModelEntry } from '../models.js';
import type { JobRow, Round } from './bench3d.js';
import type { JudgeRow } from './judge3d.js';
import { PIPELINES, type AssetRequest, type Pipeline } from './prompts.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const cli = parseCli(process.argv.slice(2), {
  values: ['judge', 'baseline'],
  usage: 'npm run bench3d:report -- <results dir> [--judge model-id] [--baseline <another results dir>]',
});
const dir = cli.positional[0] ? resolve(repoRoot, cli.positional[0]) : '';
if (!dir || !existsSync(join(dir, 'results.jsonl'))) {
  console.error('Usage: npm run bench3d:report -- <results dir with results.jsonl> [--judge model-id]');
  process.exit(1);
}
const JUDGE = cli.flags.judge ?? 'claude-opus-5-5';
const IMAGE_PRICE = 0.01; // Muse Image, per image (Meta API pricing page, Nov 2026)

const readJsonl = async <T>(file: string): Promise<T[]> =>
  existsSync(file) ? (await readFile(file, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as T) : [];

const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as { objectsFile: string; model: string; criticModel: string; criticRounds: number; passScore: number };
type RunMeta = { model: string; criticModel: string; criticRounds: number; passScore: number | null; backend?: string };
const describeRun = (m: RunMeta) => m.backend === 'external'
  ? `imported models: ${m.model}`
  : `generator \`${m.model}\` · critic \`${m.criticModel}\` (≤${m.criticRounds} rounds, stops at ${m.passScore}/10 with all parts named)`;
const objects = JSON.parse(await readFile(resolve(repoRoot, meta.objectsFile), 'utf8')) as AssetRequest[];
const objectById = new Map(objects.map((o) => [o.id, o]));
// Each row remembers its run folder, so a baseline run's renders are found in its own folder.
type SourcedRow = JobRow & { sourceDir: string };
const ownRows: SourcedRow[] = (await readJsonl<JobRow>(join(dir, 'results.jsonl'))).filter((r) => !r.apiError).map((r) => ({ ...r, sourceDir: dir }));
const verdicts = (await readJsonl<JudgeRow>(join(dir, 'judge.jsonl'))).filter((v) => v.judge === JUDGE && !v.error);
// --baseline: compare against another run on the same objects (e.g. imported Tripo models vs the agent's pipelines).
const baselineDir = cli.flags.baseline ? resolve(repoRoot, cli.flags.baseline) : null;
const ownObjects = new Set(ownRows.map((r) => r.objectId));
const baselineRows: SourcedRow[] = baselineDir
  ? (await readJsonl<JobRow>(join(baselineDir, 'results.jsonl'))).filter((r) => !r.apiError && ownObjects.has(r.objectId)).map((r) => ({ ...r, sourceDir: baselineDir }))
  : [];
if (baselineDir) verdicts.push(...(await readJsonl<JudgeRow>(join(baselineDir, 'judge.jsonl'))).filter((v) => v.judge === JUDGE && !v.error && ownObjects.has(v.objectId)));
const rows: SourcedRow[] = [...baselineRows, ...ownRows];
const baselineMeta = baselineDir ? (JSON.parse(await readFile(join(baselineDir, 'meta.json'), 'utf8')) as RunMeta) : null;
const verdictFor = (r: JobRow, round: number | null) =>
  round === null ? undefined : verdicts.find((v) => v.objectId === r.objectId && v.pipeline === r.pipeline && v.variant === r.variant && v.round === round);

const models = (JSON.parse(await readFile(MODELS_FILE, 'utf8')) as { models: ModelEntry[] }).models;
const price = (id: string) => models.find((m) => m.id === id);
const tokenCost = (id: string, input: number, output: number) => {
  const m = price(id);
  return m?.priceIn !== undefined && m.priceOut !== undefined ? (input * m.priceIn + output * m.priceOut) / 1e6 : NaN;
};

type Condition = { id: string; label: string; variant: 'base' | 'ref'; critic: boolean };
const CONDITIONS: Condition[] = [
  { id: 'none', label: 'none', variant: 'base', critic: false },
  { id: 'critic', label: 'critic (M2)', variant: 'base', critic: true },
  { id: 'ref', label: 'reference image (M1)', variant: 'ref', critic: false },
  { id: 'ref+critic', label: 'reference + critic', variant: 'ref', critic: true },
];

/** The model a condition delivers: round 0 without the critic, the critic-selected round with it. */
function roundFor(r: JobRow, c: Condition): Round | undefined {
  const index = c.critic ? r.finalRound : r.rounds[0]?.ok ? 0 : null;
  return index === null ? undefined : r.rounds[index];
}

/** Wall time until the user has the condition's model: reference image first, then the build (and critic loop). */
function timeFor(r: JobRow, c: Condition): number {
  if (r.external) return NaN;
  const loop = r.rounds.reduce((sum, rd) => sum + rd.gen.ms + rd.ms, 0);
  return (c.variant === 'ref' ? r.refMs ?? 0 : 0) + (c.critic ? loop : r.firstMs ?? loop);
}

function costFor(r: JobRow, c: Condition): number {
  if (r.external) return NaN;
  const gen = c.critic
    ? tokenCost(r.model, r.usage.promptTokens, r.usage.completionTokens) + tokenCost(r.criticModel, r.criticUsage.promptTokens, r.criticUsage.completionTokens)
    : tokenCost(r.model, r.rounds[0]?.gen.promptTokens ?? 0, r.rounds[0]?.gen.completionTokens ?? 0);
  return gen + (c.variant === 'ref' ? IMAGE_PRICE : 0);
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmt = (n: number, digits = 2) => (Number.isFinite(n) ? n.toFixed(digits) : '–');
const pct = (n: number) => (Number.isFinite(n) ? `${Math.round(n * 100)}%` : '–');
const seconds = (ms: number) => (Number.isFinite(ms) ? `${Math.round(ms / 1000)} s` : '–');

type Cell = {
  pipeline: Pipeline; condition: string; jobs: number; works: number; judged: number;
  overall: number; recognizable: number; accuracy: number; craft: number;
  partsNamed: number; partsVisible: number; triangles: number; meshes: number; glbKB: number;
  medianTimeS: number; costPerModel: number;
};

/** One pipeline under one condition. A job without a model scores 1/5 and 0 parts, so every mean covers all jobs. */
function cell(pipeline: Pipeline, c: Condition, subset = rows): Cell {
  // Imported models have no critic rounds, so they only appear in the conditions without the critic.
  const jobs = subset.filter((r) => r.pipeline === pipeline && r.variant === c.variant && !(c.critic && r.external));
  const delivered = jobs.map((r) => ({ r, round: roundFor(r, c) }));
  const ok = delivered.filter((d) => d.round?.ok);
  const judged = ok.map((d) => ({ ...d, v: verdictFor(d.r, d.round!.round) })).filter((d) => d.v);
  const failedCount = jobs.length - ok.length;
  const partsNamed = delivered.map(({ r, round }) => {
    const parts = objectById.get(r.objectId)!.parts.length;
    return round?.ok ? (parts - (round.missing?.length ?? parts)) / parts : 0;
  });
  const partsVisible = [
    ...judged.map(({ r, v }) => {
      const required = objectById.get(r.objectId)!.parts;
      return required.filter((p) => v!.partsVisible.some((s) => s.toLowerCase().replace(/[\s-]+/g, '_').startsWith(p))).length / required.length;
    }),
    ...Array(failedCount).fill(0),
  ];
  return {
    pipeline, condition: c.id, jobs: jobs.length, works: ok.length, judged: judged.length,
    overall: mean([...judged.map((d) => d.v!.overall), ...Array(failedCount).fill(1)]),
    recognizable: mean(judged.map((d) => d.v!.recognizable)),
    accuracy: mean(judged.map((d) => d.v!.accuracy)),
    craft: mean(judged.map((d) => d.v!.craft)),
    partsNamed: mean(partsNamed),
    partsVisible: judged.length ? mean(partsVisible) : NaN,
    triangles: median(ok.map((d) => d.round!.stats!.triangles)),
    meshes: median(ok.map((d) => d.round!.stats!.meshes)),
    glbKB: median(ok.map((d) => d.round!.glbBytes! / 1024)),
    medianTimeS: median(jobs.map((r) => timeFor(r, c))) / 1000,
    costPerModel: mean(jobs.map((r) => costFor(r, c))),
  };
}

const pipelines = [...PIPELINES, ...new Set(rows.map((r) => r.pipeline).filter((p) => !PIPELINES.includes(p)))];
const cells = pipelines.flatMap((p) => CONDITIONS.filter((c) => rows.some((r) => r.variant === c.variant)).map((c) => cell(p, c))).filter((c) => c.jobs > 0);
const condLabel = (id: string) => CONDITIONS.find((c) => c.id === id)!.label;

// Critic effect on the same starting model: final (critic-selected) vs round 0, per job.
const criticEffect = pipelines.flatMap((p) => (['base', 'ref'] as const).filter((v) => rows.some((r) => r.variant === v)).map((variant) => {
  const pairs = rows.filter((r) => r.pipeline === p && r.variant === variant && r.rounds[0]?.ok)
    .map((r) => ({ r, before: verdictFor(r, 0)?.overall, after: verdictFor(r, r.finalRound)?.overall }))
    .filter((x): x is { r: SourcedRow; before: number; after: number } => x.before !== undefined && x.after !== undefined);
  return {
    pipeline: p, variant, pairs: pairs.length,
    improved: pairs.filter((x) => x.after > x.before).length,
    worse: pairs.filter((x) => x.after < x.before).length,
    meanDelta: mean(pairs.map((x) => x.after - x.before)),
    roundsUsed: mean(pairs.map((x) => x.r.rounds.length - 1)),
    revisionFailures: rows.filter((r) => r.pipeline === p && r.variant === variant && r.rounds.slice(1).some((rd) => !rd.ok)).length,
  };
})).filter((e) => e.pairs > 0);

// Does the in-loop critic agree with the independent judge? (critic 1-10 vs judge 1-5, same render)
const agreement = verdicts.map((v) => {
  const r = rows.find((x) => x.objectId === v.objectId && x.pipeline === v.pipeline && x.variant === v.variant);
  const score = r?.rounds[v.round]?.critique?.score;
  return score === undefined ? null : [score, v.overall] as const;
}).filter((x): x is readonly [number, number] => x !== null);
function pearson(pairs: readonly (readonly [number, number])[]) {
  if (pairs.length < 3) return NaN;
  const mx = mean(pairs.map((p) => p[0]));
  const my = mean(pairs.map((p) => p[1]));
  const cov = pairs.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0);
  const sx = Math.sqrt(pairs.reduce((s, [x]) => s + (x - mx) ** 2, 0));
  const sy = Math.sqrt(pairs.reduce((s, [, y]) => s + (y - my) ** 2, 0));
  return cov / (sx * sy);
}

// Router input: judge overall by category, all conditions pooled.
const categories = [...new Set(objects.map((o) => o.category))];
const byCategory = categories.map((category) => ({
  category,
  objects: objects.filter((o) => o.category === category).map((o) => o.id),
  scores: Object.fromEntries(pipelines.map((p) => [p, mean(CONDITIONS.map((c) => cell(p, c, rows.filter((r) => r.category === category)).overall).filter(Number.isFinite))])),
}));

const failures = rows.flatMap((r) => r.rounds.filter((rd) => !rd.ok).map((rd) => ({ pipeline: r.pipeline, objectId: r.objectId, variant: r.variant, round: rd.round, error: rd.error ?? '' })));

const md: string[] = [
  `# Phase 3 benchmark: 3D generation pipelines`,
  ``,
  `Source: \`${relative(repoRoot, dir)}\`${baselineDir ? ` compared with \`${relative(repoRoot, baselineDir)}\` on the same ${ownObjects.size} objects` : ''} · ${rows.length} jobs (${new Set(rows.map((r) => r.objectId)).size} objects × ${pipelines.length} pipelines × ${new Set(rows.map((r) => r.variant)).size} variants) · ${describeRun(meta)}${baselineMeta ? ` · baseline: ${describeRun(baselineMeta)}` : ''} · judge \`${JUDGE}\` on four-view renders`,
  ``,
  `A job that produced no model counts as 1/5 in the judge average and 0 in the parts columns, so every average covers all jobs. "Parts named" is checked in the GLB file (required parts present as separately named nodes); "parts visible" is the judge's call from the renders. With the critic, the delivered model is the round the critic scored highest; time and cost include the whole loop.`,
  ``,
  `| Pipeline | Add-ons | Works | Judge overall (1–5) | Recognizable | Accuracy | Craft | Parts named | Parts visible | Triangles (median) | Meshes (median) | GLB (median) | Time to model (median) | Cost / model |`,
  `|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`,
  ...cells.map((c) => `| ${c.pipeline} | ${condLabel(c.condition)} | ${c.works}/${c.jobs} | **${fmt(c.overall)}** | ${fmt(c.recognizable)} | ${fmt(c.accuracy)} | ${fmt(c.craft)} | ${pct(c.partsNamed)} | ${pct(c.partsVisible)} | ${fmt(c.triangles, 0)} | ${fmt(c.meshes, 0)} | ${fmt(c.glbKB, 0)} KB | ${fmt(c.medianTimeS, 0)} s | $${fmt(c.costPerModel, 3)} |`),
  ``,
  `## Critic effect (same starting model, judge overall after − before)`,
  ``,
  `| Pipeline | Variant | Jobs | Improved | Worse | Mean change | Revision rounds (mean) | Jobs with a failed revision |`,
  `|---|---|---|---|---|---|---|---|`,
  ...criticEffect.map((e) => `| ${e.pipeline} | ${e.variant} | ${e.pairs} | ${e.improved} | ${e.worse} | ${e.meanDelta >= 0 ? '+' : ''}${fmt(e.meanDelta)} | ${fmt(e.roundsUsed, 1)} | ${e.revisionFailures} |`),
  ``,
  `Critic vs judge on the same renders: Pearson r = ${fmt(pearson(agreement))} (n = ${agreement.length}).`,
  ``,
  `## By category (judge overall, all four conditions pooled)`,
  ``,
  `| Category | Objects | ${pipelines.join(' | ')} |`,
  `|---|---|${pipelines.map(() => '---').join('|')}|`,
  ...byCategory.map((b) => `| ${b.category} | ${b.objects.join(', ')} | ${pipelines.map((p) => fmt(b.scores[p])).join(' | ')} |`),
  ``,
  `## Failures (${failures.length})`,
  ``,
  ...(failures.length ? failures.map((f) => `- ${f.pipeline} · ${f.objectId} · ${f.variant} · round ${f.round}: ${f.error.replace(/\s+/g, ' ').slice(0, 200)}`) : ['None.']),
  ``,
  `Gallery: [gallery.md](gallery.md) · [gallery.html](gallery.html). The per-job folders (\`jobs/\`: every code version, GLB and four-view render) and full-size reference images (\`refs/\`) are not committed; \`npm run bench3d\` regenerates them.`,
  ``,
];
await writeFile(join(dir, 'summary.md'), md.join('\n'));
await writeFile(join(dir, 'summary.json'), JSON.stringify({ meta, judge: JUDGE, cells, criticEffect, criticJudgeAgreement: { r: pearson(agreement), n: agreement.length }, byCategory, failures }, null, 2));

// Gallery: every object, every pipeline, each condition's delivered model (hero view) with its judge score.
await mkdir(join(dir, 'gallery'), { recursive: true });
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
async function heroFor(r: SourcedRow, c: Condition): Promise<{ img: string; caption: string } | null> {
  if (c.critic && r.external) return null;
  const round = roundFor(r, c);
  if (!round?.ok || !round.hero) return null;
  const name = `${r.pipeline}__${r.objectId}__${c.id}.jpg`;
  // A committed run has no jobs/ folder; its gallery holds the same image under this name.
  const heroFile = [join(r.sourceDir, round.hero), join(r.sourceDir, 'gallery', name)].find((f) => existsSync(f));
  if (!heroFile) return null;
  await copyFile(heroFile, join(dir, 'gallery', name));
  const v = verdictFor(r, round.round);
  return { img: `gallery/${name}`, caption: `${v ? `**${v.overall}/5**` : 'not judged'} · round ${round.round} · ${round.stats!.triangles.toLocaleString('en-US')} tris · ${round.missing?.length ? `missing ${round.missing.join(', ')}` : 'all parts named'}` };
}
const galleryMd: string[] = [`# Phase 3 gallery`, ``, `Each cell is the model a pipeline delivers under that condition, seen from above at three-quarters, with the judge's score (${JUDGE}). Four-view renders are in each job folder.`, ``];
const html: string[] = [];
for (const obj of objects.filter((o) => rows.some((r) => r.objectId === o.id))) {
  // The reference image: this run's, else the baseline's (full size, or the copy in its committed gallery).
  const refFile = [join(dir, 'refs', `${obj.id}.jpg`), ...(baselineDir ? [join(baselineDir, 'refs', `${obj.id}.jpg`), join(baselineDir, 'gallery', `ref__${obj.id}.jpg`)] : [])]
    .find((f) => existsSync(f));
  let refImg = '';
  if (refFile) {
    refImg = `gallery/ref__${obj.id}.jpg`;
    // References are 1024 px (~0.5 MB); 512 px is plenty next to the 512 px renders. sips is macOS-only.
    const shrunk = spawnSync('sips', ['-Z', '512', '-s', 'formatOptions', '75', refFile, '--out', join(dir, refImg)]);
    if (shrunk.status !== 0) await copyFile(refFile, join(dir, refImg));
  }
  galleryMd.push(`## ${obj.id} (${obj.category})`, ``, `“${obj.prompt}” · parts: ${obj.parts.join(', ')}${refImg ? ` · [reference image](${refImg})` : ''}`, ``,
    `| Pipeline | ${CONDITIONS.map((c) => c.label).join(' | ')} |`, `|---|${CONDITIONS.map(() => '---').join('|')}|`);
  html.push(`<h2>${esc(obj.id)} <small>${esc(obj.category)}</small></h2><p>“${esc(obj.prompt)}” · parts: ${esc(obj.parts.join(', '))}</p><table><tr><th>Pipeline</th>${CONDITIONS.map((c) => `<th>${esc(c.label)}</th>`).join('')}${refImg ? '<th>reference</th>' : ''}</tr>`);
  for (const p of pipelines) {
    const r = (variant: string) => rows.find((x) => x.objectId === obj.id && x.pipeline === p && x.variant === variant);
    const cellsHtml: string[] = [];
    const cellsMd: string[] = [];
    for (const c of CONDITIONS) {
      const row = r(c.variant);
      const hero = row ? await heroFor(row, c) : null;
      const failed = row ? (row.rounds[0]?.error ?? 'failed').slice(0, 120) : 'not run';
      cellsMd.push(hero ? `<img src="${hero.img}" width="220" alt="${esc(`${p} ${obj.id} ${c.label}`)}"><br>${hero.caption}` : `✗ ${esc(failed)}`);
      cellsHtml.push(hero ? `<td><img src="${hero.img}" alt="${esc(`${p} ${obj.id} ${c.label}`)}"><div>${esc(hero.caption.replace(/\*\*/g, ''))}</div></td>` : `<td class="fail">✗ ${esc(failed)}</td>`);
    }
    galleryMd.push(`| ${p} | ${cellsMd.join(' | ')} |`);
    html.push(`<tr><th>${esc(p)}</th>${cellsHtml.join('')}${refImg && p === pipelines[0] ? `<td rowspan="${pipelines.length}"><img src="${refImg}" alt="reference"></td>` : ''}</tr>`);
  }
  galleryMd.push(``);
  html.push(`</table>`);
}
await writeFile(join(dir, 'gallery.md'), galleryMd.join('\n'));
await writeFile(join(dir, 'gallery.html'), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Phase 3 gallery</title><style>
body{font:14px system-ui,sans-serif;margin:16px;background:#f4f5f7;color:#1d2025}table{border-collapse:collapse;margin-bottom:28px}th,td{border:1px solid #d5d8dd;padding:6px;vertical-align:top;background:#fff}td img{width:220px;display:block}td div{max-width:220px;font-size:12px;margin-top:4px}td.fail{color:#a33;max-width:220px}h2 small{color:#667;font-weight:400}
@media (prefers-color-scheme: dark){body{background:#16181b;color:#e6e8eb}th,td{background:#202328;border-color:#3a3e45}}
</style></head><body><h1>Phase 3 gallery</h1><p>Judge: ${esc(JUDGE)} · <a href="summary.md">summary</a></p>${html.join('\n')}</body></html>`);
console.log(md.slice(0, 6 + cells.length).join('\n'));
console.error(`Wrote summary.md, summary.json, gallery.md, gallery.html and ${basename(join(dir, 'gallery'))}/ in ${relative(repoRoot, dir)}`);
