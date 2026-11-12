// Phase 2 benchmark report: merge results.jsonl (generation), browser.jsonl (emulator mount and
// interaction probes) and judge.jsonl (vision-model quality scores) into summary.json + summary.md.
// Usage: npm run bench:report -- ../../bench/results/<name> [--judge claude-opus-5-5]
// --judge picks the independent judge used for the main quality column (default: Opus 5.5 if present).
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import type { BenchRow } from './bench.js';

type BrowserRow = {
  model: string; promptId: string; rep: number;
  mounted: boolean; runtimeErrors: string[]; harnessError?: string;
  grab?: { tested: boolean; held?: boolean; mode?: string };
  press?: { tested: boolean; fired?: boolean };
  panelPress?: { tested: number; worked: number };
};
type JudgeRow = { model: string; promptId: string; rep: number; judge: string; judgeFamily?: string; scores?: Record<string, number>; error?: string };

const dir = resolve(process.argv[2] ?? '');
const judgeArg = process.argv.indexOf('--judge');
const requestedJudge = judgeArg > 0 ? process.argv[judgeArg + 1] : 'claude-opus-5-5';
if (!existsSync(join(dir, 'results.jsonl'))) {
  console.error('Usage: npm run bench:report -- <results dir containing results.jsonl>');
  process.exit(1);
}
const rows = await readJsonl<BenchRow>(join(dir, 'results.jsonl'));
const browser = await readJsonl<BrowserRow>(join(dir, 'browser.jsonl'));
const judged = await readJsonl<JudgeRow>(join(dir, 'judge.jsonl'));
const key = (r: { model: string; promptId: string; rep: number }) => `${r.model}|${r.promptId}|${r.rep}`;
const browserBy = new Map(browser.map((b) => [key(b), b]));
// A generation that passed the server checks but crashed when mounted in the emulator is a failure.
const crashed = (r: BenchRow) => {
  const b = browserBy.get(key(r));
  return Boolean(b && !b.harnessError && (!b.mounted || b.runtimeErrors.length > 0));
};
const works = (r: BenchRow) => r.ok && !crashed(r);
// Failed scenes have nothing to judge; they score the minimum so every model's quality average
// covers all of its scenes (otherwise failing on hard requests would raise a model's average).
const FAILED_SCENE_SCORE = 1;
const withFailures = (scores: number[], failed: number) => [...scores, ...Array(failed).fill(FAILED_SCENE_SCORE)];

const models = [...new Set(rows.map((r) => r.model))];
// Judges grade on different curves (one may give everything ~4.7, another ~3.8). Shift each judge's
// scores so its average equals the grand average, then compare models on the shifted scores.
const judgeScore = (j: JudgeRow) => mean(Object.values(j.scores!));
const scoredJudgements = judged.filter((j) => j.scores);
// The independent judge (not a contestant) gives the main quality score; the contestant panel is a cross-check.
const primaryJudge = scoredJudgements.some((j) => j.judge === requestedJudge) ? requestedJudge : null;
// If the independent judge is also a contestant, its scores of its own scenes never count.
const primaryIsContestant = primaryJudge != null && rows.some((r) => r.model === primaryJudge);
const panel = scoredJudgements.filter((j) => j.judge !== primaryJudge);
const grandMean = mean(panel.map(judgeScore));
const judgeShift = new Map(
  [...new Set(panel.map((j) => j.judge))].map((judge) => [
    judge, grandMean - mean(panel.filter((j) => j.judge === judge).map(judgeScore)),
  ]),
);
const summary = models.map((model) => {
  const all = rows.filter((r) => r.model === model);
  const scored = all.filter((r) => !r.apiError);
  const ok = scored.filter(works);
  const failed = scored.length - ok.length;
  const b = scored.map((r) => browserBy.get(key(r))).filter((x): x is BrowserRow => Boolean(x) && !x!.harnessError);
  const grabTests = b.filter((x) => x.grab?.tested);
  const pressTests = b.filter((x) => x.press?.tested);
  const judgedHere = panel.filter((j) => j.model === model);
  const primary = primaryJudge && model !== primaryJudge ? scoredJudgements.filter((j) => j.judge === primaryJudge && j.model === model) : [];
  const quality = judgedHere.map((j) => mean(Object.values(j.scores!)));
  // Self-preference control: only judges from a different provider family than the model.
  const crossJudged = judgedHere.filter((j) => j.judgeFamily && j.judgeFamily !== all[0]?.family);
  const crossQuality = crossJudged.map(judgeScore);
  const crossAdjusted = crossJudged.map((j) => judgeScore(j) + (judgeShift.get(j.judge) ?? 0));
  const priced = scored.filter((r) => r.costUSD != null);
  return {
    model,
    family: all[0]?.family,
    n: scored.length,
    apiErrors: all.length - scored.length,
    // pass@1 as in XR Blocks: valid on the first try, no repair.
    passAt1: rate(scored.filter((r) => r.firstTryOk && !crashed(r)).length, scored.length),
    successWithRepair: rate(ok.length, scored.length),
    failedScenes: failed,
    meanAttempts: round(mean(scored.map((r) => r.attempts)), 2),
    mountedClean: b.length ? rate(b.filter((x) => x.mounted && x.runtimeErrors.length === 0).length, b.length) : null,
    grabWorks: grabTests.length ? rate(grabTests.filter((x) => x.grab!.held).length, grabTests.length) : null,
    pressWorks: pressTests.length ? rate(pressTests.filter((x) => x.press!.fired).length, pressTests.length) : null,
    // Share of probed panel buttons (up to 3 per scene) whose generated click handler ran.
    panelButtonsWork: b.some((x) => x.panelPress?.tested) ? rate(sum(b.map((x) => x.panelPress?.worked ?? 0)), sum(b.map((x) => x.panelPress?.tested ?? 0))) : null,
    qualityPrimary: primary.length ? round(mean(withFailures(primary.map(judgeScore), failed)), 2) : null,
    quality1to5: quality.length ? round(mean(withFailures(quality, failed)), 2) : null,
    qualityOtherJudges: crossQuality.length ? round(mean(withFailures(crossQuality, failed)), 2) : null,
    qualityOtherJudgesAdjusted: crossAdjusted.length ? round(mean(withFailures(crossAdjusted, failed)), 2) : null,
    medianFirstAttemptS: round(median(scored.map((r) => r.firstAttemptMs / 1000)), 1),
    medianTotalS: round(median(scored.map((r) => r.totalMs / 1000)), 1),
    meanOutputTokens: Math.round(mean(scored.map((r) => r.completionTokens))),
    // null when the model has no listed price (unknown, not free).
    costUSD: priced.length ? round(priced.reduce((s, r) => s + r.costUSD!, 0), 3) : null,
    costPerSuccessUSD: priced.length && ok.length ? round(priced.reduce((s, r) => s + r.costUSD!, 0) / ok.length, 4) : null,
    meanCrowdedGrabPairs: round(mean(ok.map((r) => Number((r.stats as { crowdedGrabPairs?: number })?.crowdedGrabPairs ?? 0))), 2),
  };
}).sort((a, b) => (b.successWithRepair - a.successWithRepair) || ((b.qualityPrimary ?? 0) - (a.qualityPrimary ?? 0)) || (b.passAt1 - a.passAt1));

const kinds = [...new Set(rows.flatMap((r) => r.failureKinds))].sort();
const taxonomy = models.map((model) => ({
  model,
  ...Object.fromEntries(kinds.map((k) => [k, rows.filter((r) => r.model === model).flatMap((r) => r.failureKinds).filter((x) => x === k).length])),
}));

const tiers = [...new Set(rows.map((r) => r.tier))].sort();
const byTier = models.map((model) => ({
  model,
  ...Object.fromEntries(tiers.map((t) => {
    const s = rows.filter((r) => r.model === model && r.tier === t && !r.apiError);
    return [t, s.length ? `${s.filter(works).length}/${s.length}` : '–'];
  })),
}));

await writeFile(join(dir, 'summary.json'), JSON.stringify({ summary, taxonomy, byTier }, null, 2));
const pct = (x: number | null) => (x == null ? '–' : `${Math.round(x * 100)}%`);
const md = [
  `# Benchmark summary`,
  ``,
  `Source: \`${relative(resolve(import.meta.dirname, '../../..'), dir)}\` · ${rows.length} generations · ${browser.filter((b) => b.mounted).length} of ${browser.length} mounted in the emulator · ${scoredJudgements.length} judge scores`,
  ``,
  `Success and pass@1 count a scene only if it passed the checks **and** ran in the emulator without errors. Failed scenes score ${FAILED_SCENE_SCORE}/5 in every quality column, so each model's average covers all its scenes.${primaryIsContestant ? ` ${primaryJudge} is also a contestant; its own scenes are not given a headline score.` : ''}`,
  ``,
  `| Model | n | pass@1 | Success (≤2 repairs) | Failed scenes | Mounted clean | Grab works | Press works | Panel buttons work | Quality: ${primaryJudge ?? 'independent judge'} (1–5) | Panel quality (all) | Panel, other-provider judges | Panel, adjusted for strictness | Median first try | Median total | Output tokens | Cost | Cost / success |`,
  `|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`,
  ...summary.map((s) =>
    `| ${s.model} | ${s.n}${s.apiErrors ? ` (+${s.apiErrors} API err)` : ''} | ${pct(s.passAt1)} | ${pct(s.successWithRepair)} | ${s.failedScenes} | ${pct(s.mountedClean)} | ${pct(s.grabWorks)} | ${pct(s.pressWorks)} | ${pct(s.panelButtonsWork)} | ${s.qualityPrimary ?? '–'} | ${s.quality1to5 ?? '–'} | ${s.qualityOtherJudges ?? '–'} | ${s.qualityOtherJudgesAdjusted ?? '–'} | ${s.medianFirstAttemptS} s | ${s.medianTotalS} s | ${s.meanOutputTokens} | ${s.costUSD == null ? '–' : `$${s.costUSD}`} | ${s.costPerSuccessUSD == null ? '–' : `$${s.costPerSuccessUSD}`} |`),
  ``,
  `## Mean score each judge gave each model (rows = judge; judges grade on different curves)`,
  ``,
  `| Judge | ${models.join(' | ')} |`,
  `|---|${models.map(() => '---').join('|')}|`,
  ...[...(primaryJudge ? [primaryJudge] : []), ...judgeShift.keys()].map((judge) => `| ${judge}${judge === primaryJudge ? (primaryIsContestant ? ' (main judge, also a contestant)' : ' (independent)') : ''} | ${models.map((m) => {
    const xs = scoredJudgements.filter((j) => j.judge === judge && j.model === m).map(judgeScore);
    const self = scoredJudgements.find((j) => j.judge === judge)?.judgeFamily === rows.find((r) => r.model === m)?.family;
    return xs.length ? `${round(mean(xs), 2)}${self ? (judge === primaryJudge ? ' (same company)' : ' (own model)') : ''}` : '–';
  }).join(' | ')} |`),
  ``,
  `## Success by tier (T1 single component · T2 composed scene · T3 interactive with state)`,
  ``,
  `| Model | ${tiers.join(' | ')} |`,
  `|---|${tiers.map(() => '---').join('|')}|`,
  ...byTier.map((t) => `| ${t.model} | ${tiers.map((k) => (t as Record<string, string>)[k]).join(' | ')} |`),
  ``,
  `## Failed attempts by kind (before repair)`,
  ``,
  kinds.length
    ? [`| Model | ${kinds.join(' | ')} |`, `|---|${kinds.map(() => '---').join('|')}|`,
        ...taxonomy.map((t) => `| ${t.model} | ${kinds.map((k) => (t as Record<string, number | string>)[k]).join(' | ')} |`)].join('\n')
    : '_No failed attempts._',
  ``,
].join('\n');
await writeFile(join(dir, 'summary.md'), md);
console.log(md);

async function readJsonl<T>(file: string): Promise<T[]> {
  if (!existsSync(file)) return [];
  return (await readFile(file, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as T);
}
function mean(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function sum(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0);
}
function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}
function rate(a: number, b: number) {
  return b ? a / b : 0;
}
function round(n: number, d = 2) {
  return Math.round(n * 10 ** d) / 10 ** d;
}
