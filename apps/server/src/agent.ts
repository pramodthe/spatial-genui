import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import type { SceneStats } from './dryrun.js';
import { dryRun } from './sandbox.js';
import { complete, defaultTarget, type ChatMessage, type LlmTarget } from './llm.js';
import { assetStubs, librarySection, libraryCatalog } from './library.js';
import { routeAssets, type Route } from './router.js';
import { SYSTEM_PROMPT, repairMessage } from './prompt.js';
import { extractCode, validateModule } from './validate.js';

export type Attempt = {
  ms: number;
  promptTokens: number;
  completionTokens: number;
  finishReason: string | null;
  stage: 'ok' | 'no-code' | 'validate' | 'dry-run';
  error?: string;
};

export type GenerationResult = {
  id: string;
  ok: boolean;
  prompt: string;
  model: string;
  provider: string;
  code?: string;
  stats?: SceneStats;
  warnings?: string[];
  error?: string;
  attempts: Attempt[];
  totalMs: number;
  /** Which library models the router chose for this request (library on only). */
  route?: Route;
};

/**
 * Open Generative UI agent: the model writes the full component module, the host
 * checks it statically and in a sandboxed dry run, and failures go back to the
 * model for repair. `clientError` continues a run whose code failed in the browser.
 */
export async function generate(
  prompt: string,
  options: { previousCode?: string; clientError?: string; target?: LlmTarget; log?: boolean; library?: boolean } = {},
): Promise<GenerationResult> {
  const target = options.target ?? defaultTarget;
  // The asset library is on for the app; benchmarks turn it off so their prompt stays as published.
  const useLibrary = options.library ?? true;
  const started = performance.now();
  // Route first: only the models this request needs go into the prompt (molecules get built here).
  const route = useLibrary && !options.previousCode ? await routeAssets(prompt, target) : undefined;
  const knownAssets = useLibrary ? new Set(libraryCatalog().keys()) : new Set<string>();
  const messages: ChatMessage[] = [
    { role: 'system', content: useLibrary ? SYSTEM_PROMPT + librarySection(route?.assets ?? []) : SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ];
  if (options.previousCode && options.clientError) {
    messages.push(
      { role: 'assistant', content: '```js\n' + options.previousCode + '\n```' },
      { role: 'user', content: repairMessage(`In the headset runtime: ${options.clientError}`) },
    );
  }

  const attempts: Attempt[] = [];
  const result: GenerationResult = {
    id: `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 6)}`,
    ok: false,
    prompt,
    model: target.id,
    provider: new URL(target.baseURL).host,
    attempts,
    totalMs: 0,
    route,
  };

  for (let i = 0; i <= config.maxRepairs; i++) {
    const reply = await complete(messages, target);
    const attempt: Attempt = {
      ms: reply.ms,
      promptTokens: reply.promptTokens,
      completionTokens: reply.completionTokens,
      finishReason: reply.finishReason,
      stage: 'ok',
    };
    attempts.push(attempt);
    messages.push({ role: 'assistant', content: reply.text });

    const code = extractCode(reply.text);
    if (!code) {
      attempt.stage = 'no-code';
      attempt.error = reply.finishReason === 'length'
        ? 'The reply was cut off before the code block finished. Write a shorter module.'
        : 'No ```js code block found in the reply.';
      messages.push({ role: 'user', content: repairMessage(attempt.error) });
      continue;
    }
    result.code = code;

    const validation = validateModule(code, knownAssets);
    if (!validation.ok) {
      attempt.stage = 'validate';
      attempt.error = validation.error;
      messages.push({ role: 'user', content: repairMessage(validation.error) });
      continue;
    }

    const run = await dryRun(validation.transformed, assetStubs(validation.assets));
    if (!run.ok) {
      attempt.stage = 'dry-run';
      attempt.error = run.error;
      messages.push({ role: 'user', content: repairMessage(run.error) });
      continue;
    }

    result.ok = true;
    result.stats = run.stats;
    result.warnings = run.warnings;
    break;
  }

  if (!result.ok) result.error = attempts.at(-1)?.error ?? 'Generation failed.';
  result.totalMs = Math.round(performance.now() - started);
  if (options.log !== false) await logRun(result);
  return result;
}

// Every run is kept as JSONL: the raw material for the Phase 2 benchmark and the paper.
async function logRun(result: GenerationResult) {
  await mkdir(config.runsDir, { recursive: true });
  const file = join(config.runsDir, `${result.id.slice(0, 10)}.jsonl`);
  await appendFile(file, JSON.stringify(result) + '\n');
}
