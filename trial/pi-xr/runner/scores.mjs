// A benchmark prompt's scores side by side: one row per requirement of its rubric, one column per build that was
// scored against it. The rubric (benchmarks/<name>.rubric.json) lists the prompt's requirements; a score file
// (benchmarks/scores/<game>.json) gives a verdict for each, with what backs it. Prints a Markdown table and saves
// it as benchmarks/<name>.scores.md in the archive.
// Usage: node runner/scores.mjs <rubric name>
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ARCHIVE } from './paths.mjs';

const BENCHMARKS = join(ARCHIVE, 'benchmarks');
const SHORT = { met: 'met', partly: 'partly', 'not met': 'NOT MET' };

/** A game's score counts, or null when it has not been scored: { rubric, met, partly, notMet, total }. */
export function scoreOf(game) {
  const file = join(BENCHMARKS, 'scores', `${game}.json`);
  if (!existsSync(file)) return null;
  const items = JSON.parse(readFileSync(file, 'utf8')).items ?? [];
  const count = (verdict) => items.filter((item) => item.verdict === verdict).length;
  return { rubric: JSON.parse(readFileSync(file, 'utf8')).rubric, met: count('met'), partly: count('partly'), notMet: count('not met'), total: items.length };
}

export function table(name) {
  const rubric = JSON.parse(readFileSync(join(BENCHMARKS, `${name}.rubric.json`), 'utf8'));
  const dir = join(BENCHMARKS, 'scores');
  const scores = (existsSync(dir) ? readdirSync(dir) : []).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))).filter((s) => s.rubric === name);
  const cell = (score, id) => {
    const item = (score.items ?? []).find((i) => i.id === id);
    return item ? `${SHORT[item.verdict] ?? item.verdict}${item.note ? `: ${item.note.replace(/\|/g, '/')}` : ''}` : 'not scored';
  };
  const lines = [
    `# ${name}: scores`, '', `Prompt: \`${rubric.prompt}\` (${rubric.source}). Scored by ${[...new Set(scores.map((s) => s.method))].join('; ') || 'nobody yet'}.`, '',
    `| | Requirement | ${scores.map((s) => s.game).join(' | ')} |`, `|---|---|${scores.map(() => '---').join('|')}|`,
    ...rubric.requirements.map((r) => `| ${r.id} | ${r.text.replace(/\|/g, '/')} | ${scores.map((s) => cell(s, r.id)).join(' | ')} |`),
    `| | **Met / partly / not met** | ${scores.map((s) => { const c = scoreOf(s.game); return `**${c.met} / ${c.partly} / ${c.notMet}** of ${c.total}`; }).join(' | ')} |`,
  ];
  return `${lines.join('\n')}\n`;
}

if (process.argv[1]?.endsWith('scores.mjs')) {
  const name = process.argv[2];
  if (!name || !existsSync(join(BENCHMARKS, `${name}.rubric.json`))) {
    console.log(`Usage: node runner/scores.mjs <rubric name>   (rubrics: ${readdirSync(BENCHMARKS).filter((f) => f.endsWith('.rubric.json')).map((f) => f.replace('.rubric.json', '')).join(', ')})`);
    process.exit(2);
  }
  const text = table(name);
  writeFileSync(join(BENCHMARKS, `${name}.scores.md`), text);
  console.log(text);
}
