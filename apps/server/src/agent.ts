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
import { checkSurface, compileSurface, extractJson, surfaceFrom, type Surface } from './a2ui/catalog.js';
import { A2UI_SYSTEM_PROMPT, TEMPLATE_SYSTEM_PROMPT, jsonRepairMessage } from './a2ui/prompts.js';
import { expandTemplate } from './a2ui/templates.js';

/**
 * What the agent writes (RQ1's three GenUI types): 'code' = a full module (open, version A),
 * 'a2ui' = A2UI v1.0 JSON on the spatial catalog (declarative, C), 'template' = one hand-built lesson
 * component filled with data (controlled, D). C and D compile to a module, so everything after is shared.
 */
export type GenUIFormat = 'code' | 'a2ui' | 'template';

export function systemPromptFor(format: GenUIFormat): string {
  return format === 'a2ui' ? A2UI_SYSTEM_PROMPT : format === 'template' ? TEMPLATE_SYSTEM_PROMPT : SYSTEM_PROMPT;
}

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
  format: GenUIFormat;
  /** What the agent wrote for formats a2ui and template (the JSON); `code` is then the compiled module. */
  source?: string;
  code?: string;
  stats?: SceneStats;
  warnings?: string[];
  error?: string;
  attempts: Attempt[];
  totalMs: number;
  /** Which library models the router chose for this request (library on only). */
  route?: Route;
  /** On-demand assets: models being fetched or generated in the background for this lesson (see three-d/acquire.ts). */
  pendingAssets?: { jobId: string; name: string }[];
};

/**
 * Open Generative UI agent: the model writes the full component module, the host
 * checks it statically and in a sandboxed dry run, and failures go back to the
 * model for repair. `clientError` continues a run whose code failed in the browser.
 */
export async function generate(
  prompt: string,
  options: { previousCode?: string; clientError?: string; target?: LlmTarget; log?: boolean; library?: boolean; onDemand?: boolean; format?: GenUIFormat } = {},
): Promise<GenerationResult> {
  const target = options.target ?? defaultTarget;
  const format = options.format ?? 'code';
  // The asset library is on for the app; benchmarks turn it off so their prompt stays as published.
  // The A2UI catalog and the templates have no library models, so they always run without it.
  const useLibrary = (options.library ?? true) && format === 'code';
  const started = performance.now();
  // Route first: only the models this request needs go into the prompt (molecules get built here).
  const route = useLibrary && !options.previousCode ? await routeAssets(prompt, target, { wantObjects: options.onDemand }) : undefined;
  // On-demand assets: a real object the library lacks is fetched or generated in the background. This
  // lesson is written now without it; the client can ask again once the model is in the library.
  let pendingAssets: GenerationResult['pendingAssets'];
  if (options.onDemand && route?.wanted?.length) {
    const { startAssetJob } = await import('./three-d/acquire.js');
    for (const wanted of route.wanted) {
      const job = startAssetJob(wanted);
      // Already built (the router didn't recognise it under this name): use it in this lesson.
      if (job.status === 'done' && job.assetId && libraryCatalog().has(job.assetId)) route.assets.push(job.assetId);
      else if (job.status !== 'failed') (pendingAssets ??= []).push({ jobId: job.id, name: job.name });
    }
  }
  const knownAssets = useLibrary ? new Set(libraryCatalog().keys()) : new Set<string>();
  const messages: ChatMessage[] = [
    { role: 'system', content: useLibrary ? SYSTEM_PROMPT + librarySection(route?.assets ?? []) : systemPromptFor(format) },
    { role: 'user', content: prompt },
  ];
  const repair = format === 'code' ? repairMessage : jsonRepairMessage;
  if (options.previousCode && options.clientError && format === 'code') {
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
    format,
    attempts,
    totalMs: 0,
    route,
    pendingAssets,
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

    let code: string | null;
    if (format === 'code') {
      code = extractCode(reply.text);
    } else {
      // Declarative and controlled: parse and check the JSON, then compile it with the shared renderer.
      const parsed = extractJson(reply.text);
      if (parsed == null) {
        code = null;
      } else {
        result.source = JSON.stringify(parsed);
        const compiled = compileJson(format, parsed);
        if (!compiled.surface) {
          attempt.stage = 'validate';
          attempt.error = compiled.problems.join('\n');
          messages.push({ role: 'user', content: repair(attempt.error) });
          continue;
        }
        code = compileSurface(compiled.surface);
      }
    }
    if (!code) {
      attempt.stage = 'no-code';
      attempt.error = reply.finishReason === 'length'
        ? `The reply was cut off before the ${format === 'code' ? 'code block' : 'JSON'} finished. Write a shorter ${format === 'code' ? 'module' : 'reply'}.`
        : format === 'code' ? 'No ```js code block found in the reply.' : 'No valid JSON found in the reply (one ```json block).';
      messages.push({ role: 'user', content: repair(attempt.error) });
      continue;
    }
    result.code = code;

    const validation = validateModule(code, knownAssets);
    if (!validation.ok) {
      attempt.stage = 'validate';
      attempt.error = validation.error;
      messages.push({ role: 'user', content: repair(validation.error) });
      continue;
    }

    const run = await dryRun(validation.transformed, assetStubs(validation.assets));
    if (!run.ok) {
      attempt.stage = 'dry-run';
      attempt.error = run.error;
      messages.push({ role: 'user', content: repair(run.error) });
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

/** A2UI messages or a filled template, as a checked surface (or the problems to send back). */
function compileJson(format: GenUIFormat, parsed: unknown): { surface?: Surface; problems: string[] } {
  if (format === 'a2ui') {
    const { surface, error } = surfaceFrom(parsed);
    if (!surface) return { problems: [error ?? 'Not a valid A2UI surface.'] };
    const problems = checkSurface(surface);
    return problems.length ? { problems } : { surface, problems };
  }
  const expanded = expandTemplate(parsed);
  if (!expanded.surface) return expanded;
  // Templates are ours, but their text comes from the agent: the same checks still apply (font, ids).
  const problems = checkSurface(expanded.surface);
  return problems.length ? { problems } : expanded;
}

// Every run is kept as JSONL: the raw material for the Phase 2 benchmark and the paper.
async function logRun(result: GenerationResult) {
  await mkdir(config.runsDir, { recursive: true });
  const file = join(config.runsDir, `${result.id.slice(0, 10)}.jsonl`);
  await appendFile(file, JSON.stringify(result) + '\n');
}
