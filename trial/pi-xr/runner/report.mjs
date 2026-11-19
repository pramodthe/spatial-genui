// Prints the trial's games as a table, beside the Nov 19 baseline they are compared with (the old pipeline on Muse
// Ember, from the side-by-side: 4 of 6 games ready). Usage: node runner/report.mjs
import { existsSync, readFileSync } from 'node:fs';
import { RESULTS } from './paths.mjs';

const BASELINE = [
  ['River dam', 'ready', 22.7, 84, 0.16], ['Kite hill', 'failed', 22.1, 135, 0.15], ['Desert canyon', 'failed', 22.4, 136, 0.17],
  ['Paper plane', 'ready', 28.0, 134, 0.15], ['Sponge cake', 'ready', 18.4, 133, 0.13], ['Car engine', 'ready', 12.0, 90, 0.09],
];
const rows = existsSync(RESULTS) ? readFileSync(RESULTS, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];

console.log('## pi + IWSDK trial\n');
console.log('| Game | Check | Agent min | Turns | Tool calls | Dollars | First move by hand (min) | Follow-ups | Replay steps | Stopped by |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  console.log(`| ${r.name} | ${r.check.ok ? 'passed' : 'failed'} | ${r.agentMinutes} | ${r.turns} | ${r.toolCalls} | $${r.usd.toFixed(2)} | ${r.firstSequenceMin ?? '-'} | ${r.followUps} | ${r.check.played} of ${r.check.steps} | ${r.stop} |`);
}
for (const r of rows.filter((x) => !x.check.ok)) console.log(`\n${r.name} failed on:\n${r.check.failures.map((f) => `- ${f}`).join('\n')}`);
console.log('\n## Baseline: the old pipeline, Muse Ember, Nov 19\n');
console.log('| Game | Result | Minutes | Model calls | Dollars |\n|---|---|---|---|---|');
for (const [game, result, minutes, calls, usd] of BASELINE) console.log(`| ${game} | ${result} | ${minutes} | ${calls} | $${usd.toFixed(2)} |`);
