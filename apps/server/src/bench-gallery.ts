// Side-by-side gallery of a benchmark run: one row per prompt, one column per model, with the
// screenshot, timing, hand-probe results and judge scores. Writes <dir>/gallery.html (open locally).
// Usage: npm run bench:gallery -- ../../bench/results/<name>
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

type Row = { model: string; family: string; promptId: string; tier: string; rep: number; ok: boolean; firstTryOk: boolean; stages: string[]; totalMs: number; costUSD: number | null };
type Browser = { model: string; promptId: string; rep: number; mounted: boolean; runtimeErrors: string[]; shot?: string;
  grab?: { tested: boolean; held?: boolean; mode?: string }; press?: { tested: boolean; fired?: boolean } };
type Judge = { model: string; promptId: string; rep: number; judge: string; judgeFamily?: string; scores?: Record<string, number>; notes?: string };

const dir = resolve(process.argv[2] ?? '');
if (!existsSync(join(dir, 'results.jsonl'))) {
  console.error('Usage: npm run bench:gallery -- <results dir>');
  process.exit(1);
}
const read = async <T>(f: string): Promise<T[]> =>
  existsSync(join(dir, f)) ? (await readFile(join(dir, f), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as T) : [];
const rows = await read<Row>('results.jsonl');
const browser = await read<Browser>('browser.jsonl');
const judges = (await read<Judge>('judge.jsonl')).filter((j) => j.scores);
// The independent judge (not a contestant) gives the headline score when present.
const PRIMARY = 'claude-opus-5-5';
const hasPrimary = judges.some((j) => j.judge === PRIMARY);
const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8').catch(() => '{}'));
const repoRoot = resolve(import.meta.dirname, '../../..');
const promptsPath = meta.promptsFile ? resolve(repoRoot, meta.promptsFile) : '';
const prompts: { id: string; tier: string; prompt: string }[] = promptsPath && existsSync(promptsPath)
  ? JSON.parse(await readFile(promptsPath, 'utf8'))
  : [...new Set(rows.map((r) => r.promptId))].map((id) => ({ id, tier: '', prompt: id }));

const key = (r: { model: string; promptId: string; rep: number }) => `${r.model}|${r.promptId}|${r.rep}`;
const browserBy = new Map(browser.map((b) => [key(b), b]));
const models = [...new Set(rows.map((r) => r.model))];
const reps = [...new Set(rows.map((r) => r.rep))].sort();
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

// Per-model overall: mean quality from judges of other families (self-preference excluded).
const overall = models.map((m) => {
  const family = rows.find((r) => r.model === m)?.family;
  const cross = judges.filter((j) => j.model === m && (hasPrimary ? j.judge === PRIMARY : j.judgeFamily !== family)).map((j) => avg(Object.values(j.scores!)));
  const mine = rows.filter((r) => r.model === m);
  return { m, quality: avg(cross), medianS: median(mine.map((r) => r.totalMs / 1000)) };
});

function cell(model: string, promptId: string, rep: number) {
  const r = rows.find((x) => x.model === model && x.promptId === promptId && x.rep === rep);
  if (!r) return '<td class="empty">not run</td>';
  const b = browserBy.get(key(r));
  const family = r.family;
  const js = judges.filter((j) => key(j) === key(r));
  const cross = js.filter((j) => (hasPrimary ? j.judge === PRIMARY : j.judgeFamily !== family));
  const q = avg(cross.map((j) => avg(Object.values(j.scores!))));
  const badges = [
    r.ok ? (r.firstTryOk ? '<b class="ok">✓ first try</b>' : `<b class="warn">✓ after ${r.stages.length - 1} repair</b>`) : '<b class="bad">✗ failed</b>',
    `${(r.totalMs / 1000).toFixed(0)} s`,
    b && b.runtimeErrors.length ? '<b class="bad">crashed in browser</b>' : '',
    b?.grab?.tested ? (b.grab.held ? `<b class="ok">grab ✓</b>` : `<b class="bad">grab ✗</b>`) : '',
    b?.press?.tested ? (b.press.fired ? `<b class="ok">press ✓</b>` : `<b class="bad">press ✗</b>`) : '',
    Number.isFinite(q) ? `<b class="q">quality ${q.toFixed(1)}/5</b>` : '',
  ].filter(Boolean).join(' ');
  const notes = js.map((j) => {
    const s = j.scores!;
    const label = j.judge === PRIMARY ? ' (independent judge, used for the score)' : hasPrimary ? ' (contestant panel, cross-check)' : j.judgeFamily === family ? ' (same company, not counted)' : '';
    return `<li><span class="judge">${esc(j.judge)}${label}</span> fidelity ${s.fidelity} · clarity ${s.clarity} · correctness ${s.correctness} · hands-on ${s.handsOn}<br>${esc(j.notes ?? '')}</li>`;
  }).join('');
  const img = b?.shot ? `<a href="${esc(b.shot)}" target="_blank"><img loading="lazy" src="${esc(b.shot)}" alt="${esc(model)} – ${esc(promptId)}"></a>` : '<div class="noshot">no screenshot</div>';
  const err = b?.runtimeErrors.length ? `<div class="err">${esc(b.runtimeErrors[0])}</div>` : '';
  return `<td>${img}<div class="badges">${badges}</div>${err}${notes ? `<details><summary>Judges' comments</summary><ul>${notes}</ul></details>` : ''}</td>`;
}

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Benchmark Gallery</title>
<style>
  :root { --bg:#f6f7f9; --fg:#1b1d22; --muted:#5b6170; --card:#fff; --line:#dfe2e8; --ok:#137a3a; --warn:#9a6200; --bad:#b42318; --q:#2d4fc7; }
  @media (prefers-color-scheme: dark) { :root { --bg:#14161a; --fg:#eceef2; --muted:#a0a6b3; --card:#1d2026; --line:#2e323a; --ok:#4cc27a; --warn:#e2a84a; --bad:#ff7b6b; --q:#8ea8ff; } }
  body { margin:0; padding:16px; background:var(--bg); color:var(--fg); font:14px/1.45 system-ui,sans-serif; }
  h1 { font-size:20px; margin:0 0 4px; } p.sub { color:var(--muted); margin:0 0 12px; }
  .controls { margin:8px 0 16px; display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
  table { border-collapse:separate; border-spacing:8px; width:100%; table-layout:fixed; }
  th { text-align:left; vertical-align:bottom; font-size:15px; }
  th small { display:block; color:var(--muted); font-weight:400; }
  td { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:8px; vertical-align:top; }
  td.prompt { width:200px; background:transparent; border:0; }
  td.prompt .tier { color:var(--muted); font-size:12px; }
  img { width:100%; border-radius:6px; display:block; }
  .badges { margin-top:6px; display:flex; flex-wrap:wrap; gap:6px; font-size:12px; color:var(--muted); }
  .badges b { font-weight:600; } .ok { color:var(--ok); } .warn { color:var(--warn); } .bad { color:var(--bad); } .q { color:var(--q); }
  .err { color:var(--bad); font-size:12px; margin-top:4px; font-family:ui-monospace,monospace; }
  details { margin-top:6px; font-size:12px; } details ul { padding-left:16px; margin:6px 0 0; } .judge { font-weight:600; }
  .empty, .noshot { color:var(--muted); }
  tr.rep { display:none; } body[data-rep="${reps[0]}"] tr.rep-${reps[0]}${reps.slice(1).map((r) => `, body[data-rep="${r}"] tr.rep-${r}`).join('')} { display:table-row; }
</style></head>
<body data-rep="${reps[0]}">
<h1>Which model built what</h1>
<p class="sub">${esc(dir.split('/').pop() ?? '')} · each column is one model, each row one request · ${hasPrimary ? 'quality is scored by Claude Opus 5.5, an independent judge that is not a contestant (it is made by Anthropic, like Sonnet); the contestants\' own scores are under “Judges’ comments” as a cross-check' : 'quality is the mean of judges from <i>other</i> companies (a model\'s own family never scores it)'} · click a picture to open it full size</p>
<div class="controls">Repetition: ${reps.map((r) => `<label><input type="radio" name="rep" value="${r}" ${r === reps[0] ? 'checked' : ''}> ${r + 1}</label>`).join(' ')}</div>
<table>
<tr><td class="prompt"></td>${overall.map((o) => `<th>${esc(o.m)}<small>${Number.isFinite(o.quality) ? `quality ${o.quality.toFixed(2)}/5 · ` : ''}median ${o.medianS.toFixed(0)} s</small></th>`).join('')}</tr>
${reps.map((rep) => prompts.map((p) => `<tr class="rep rep-${rep}"><td class="prompt"><div class="tier">${esc(p.tier)} · ${esc(p.id)}</div>“${esc(p.prompt)}”</td>${models.map((m) => cell(m, p.id, rep)).join('')}</tr>`).join('\n')).join('\n')}
</table>
<script>
  for (const input of document.querySelectorAll('input[name=rep]')) input.addEventListener('change', (e) => (document.body.dataset.rep = e.target.value));
</script>
</body></html>`;

await writeFile(join(dir, 'gallery.html'), html);
console.log(join(dir, 'gallery.html'));

function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}
