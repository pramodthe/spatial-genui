import { createReadStream, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { generate } from './agent.js';
import { config } from './config.js';
import { assetPath, libraryCatalog, shortCredit } from './library.js';
import type { LlmTarget } from './llm.js';
import { loadModel } from './models.js';
import { EXAMPLE_MODULE } from './prompt.js';

const MAX_BODY_BYTES = 200_000;

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/health') {
      return send(res, 200, { ok: true, model: config.model, provider: new URL(config.baseURL).host, hasKey: Boolean(config.apiKey) });
    }
    if (req.method === 'GET' && req.url === '/api/library/catalog') {
      // What the browser host needs to build asset handles: parts, anchors, credit (no file paths).
      // ?v= changes whenever a model is rebuilt, so browsers never keep a stale cached copy.
      const entries = [...libraryCatalog().values()].map((e) => ({
        ...e, creditShort: shortCredit(e), url: `/api/library/assets/${e.id}.glb?v=${Math.round(statSync(assetPath(e.id)!).mtimeMs)}`,
      }));
      return send(res, 200, { assets: entries });
    }
    const assetMatch = req.method === 'GET' && req.url?.match(/^\/api\/library\/assets\/([a-z0-9-]+)\.glb(\?v=\d+)?$/);
    if (assetMatch) {
      const path = assetPath(assetMatch[1]);
      if (!path) return send(res, 404, { error: 'Unknown asset' });
      res.writeHead(200, { 'content-type': 'model/gltf-binary', 'cache-control': 'public, max-age=3600' });
      createReadStream(path).pipe(res);
      return;
    }
    if (req.method === 'POST' && req.url === '/api/generate') {
      const body = await readJson(req);
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
      if (!prompt || prompt.length > 2000) {
        return send(res, 400, { error: 'Send { "prompt": "…" } (1–2000 characters).' });
      }
      if (prompt === '/example') {
        // Host smoke test without an API call: the system prompt's own example module.
        return send(res, 200, { ok: true, prompt, model: 'built-in example', code: EXAMPLE_MODULE, attempts: [{ stage: 'ok', ms: 0 }], totalMs: 0 });
      }
      const result = await generate(prompt, {
        previousCode: typeof body.previousCode === 'string' ? body.previousCode : undefined,
        clientError: typeof body.clientError === 'string' ? body.clientError : undefined,
        onDemand: config.onDemandAssets,
      });
      return send(res, 200, result);
    }
    // Parallel generation (SPEC.md Phase 5): the run's events as newline-delimited JSON while it happens
    // (plan with placeholders, then each part as it is ready), ending with the full result.
    if (req.method === 'POST' && req.url === '/api/generate-stream') {
      const body = await readJson(req);
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
      if (!prompt || prompt.length > 2000) {
        return send(res, 400, { error: 'Send { "prompt": "…" } (1–2000 characters).' });
      }
      res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache' });
      const line = (data: unknown) => res.write(JSON.stringify(data) + '\n');
      const result = await generate(prompt, { format: 'a2ui-parallel', planner: await parallelPlanner(), onEvent: line });
      line({ type: 'RESULT', result });
      res.end();
      return;
    }
    // On-demand assets: progress of a background model job started by a lesson request.
    const jobMatch = req.method === 'GET' && req.url?.match(/^\/api\/assets\/jobs(?:\/([a-z0-9-]+))?$/);
    if (jobMatch) {
      const { assetJob, assetJobs } = await import('./three-d/acquire.js');
      if (!jobMatch[1]) return send(res, 200, { jobs: assetJobs() });
      const job = assetJob(jobMatch[1]);
      return job ? send(res, 200, job) : send(res, 404, { error: 'Unknown job' });
    }
    send(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: (err as Error).message });
  }
});

server.listen(config.port, () => {
  console.log(`GenUI agent server on http://localhost:${config.port}`);
  console.log(`Model: ${config.model} via ${config.baseURL}${config.apiKey ? '' : '  (LLM_API_KEY is empty!)'}`);
  console.log(`On-demand assets: ${config.onDemandAssets ? 'on' : 'off (set ASSETS_ON_DEMAND=1 to fetch or generate models a lesson lacks)'}`);
});

async function readJson(req: IncomingMessage): Promise<any> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

/** A fast model plans parallel runs (PARALLEL_PLANNER, a bench/models.json id); without one, the main model plans. */
let planner: Promise<LlmTarget | undefined> | null = null;
function parallelPlanner(): Promise<LlmTarget | undefined> {
  planner ??= loadModel(process.env.PARALLEL_PLANNER || 'claude-haiku-5-5').catch((err) => {
    console.warn(`Parallel planner unavailable (${(err as Error).message}); the main model plans.`);
    return undefined;
  });
  return planner;
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}
