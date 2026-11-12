// Run a prompt set through the agent and summarize. Every run is also logged to runs/*.jsonl.
// Usage: npm run batch -- ../../bench/prompts/dev-10.json [concurrency]
import { readFile } from 'node:fs/promises';
import { generate, type GenerationResult } from './agent.js';
import { config } from './config.js';

type PromptCase = { id: string; tier?: string; domain?: string; prompt: string };

const [file, concurrencyArg] = process.argv.slice(2);
if (!file) {
  console.error('Usage: npm run batch -- <prompts.json> [concurrency]');
  process.exit(1);
}
const cases = JSON.parse(await readFile(file, 'utf8')) as PromptCase[];
const concurrency = Math.max(1, Number(concurrencyArg) || 3);

const results: { case: PromptCase; result?: GenerationResult; error?: string }[] = [];
let next = 0;
async function worker() {
  while (next < cases.length) {
    const c = cases[next++];
    try {
      const result = await generate(c.prompt);
      results.push({ case: c, result });
      console.error(`${result.ok ? 'PASS' : 'FAIL'}  ${c.id}  ${(result.totalMs / 1000).toFixed(0)} s  ${result.attempts.map((a) => a.stage).join(' → ')}`);
    } catch (err) {
      results.push({ case: c, error: (err as Error).message });
      console.error(`ERROR ${c.id}  ${(err as Error).message}`);
    }
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));

const ok = results.filter((r) => r.result?.ok);
const firstTry = ok.filter((r) => r.result!.attempts.length === 1);
const seconds = ok.map((r) => r.result!.totalMs / 1000).sort((a, b) => a - b);
console.log(JSON.stringify({
  model: config.model,
  provider: new URL(config.baseURL).host,
  cases: cases.length,
  passed: ok.length,
  passedFirstTry: firstTry.length,
  medianSeconds: seconds.length ? seconds[Math.floor(seconds.length / 2)] : null,
  perCase: results.map((r) => ({
    id: r.case.id,
    ok: r.result?.ok ?? false,
    runId: r.result?.id,
    attempts: r.result?.attempts.map((a) => a.stage),
    seconds: r.result ? Math.round(r.result.totalMs / 1000) : null,
    stats: r.result?.stats,
    error: r.error ?? r.result?.error?.slice(0, 300),
  })),
}, null, 2));
