import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { generate, type GenerationResult } from './agent.js';
import { config } from './config.js';
import { assetPath, libraryCatalog, shortCredit } from './library.js';
import type { LlmTarget } from './llm.js';
import { loadModel } from './models.js';
import { EXAMPLE_MODULE } from './prompt.js';
import { admit, admitVoice, recordSpend, spendToday, visitorOf } from './guard.js';
import { transcribe } from './voice.js';
import { getCourse, listCourses, openLesson, polishLesson, startCourse, summary } from './courses.js';

const MAX_BODY_BYTES = 200_000;
const KIT_FILE = fileURLToPath(new URL('./kit/kit.js', import.meta.url));

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/health') {
      return send(res, 200, { ok: true, model: config.model, provider: new URL(config.baseURL).host, hasKey: Boolean(config.apiKey), spend: spendToday() });
    }
    if (req.method === 'GET' && req.url?.split('?')[0] === '/api/kit.js') {
      // The paintbox for generated lessons: one source for the dry run (dryrun.ts) and the headset.
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' });
      createReadStream(KIT_FILE).pipe(res);
      return;
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
      const refusal = await admit(visitorOf(req), prompt);
      if (refusal) return send(res, refusal.status, { ok: false, error: refusal.error, reason: refusal.reason });
      const result = await generate(prompt, {
        previousCode: typeof body.previousCode === 'string' ? body.previousCode : undefined,
        clientError: typeof body.clientError === 'string' ? body.clientError : undefined,
        onDemand: config.onDemandAssets,
      });
      await spent(result);
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
      const refusal = await admit(visitorOf(req), prompt);
      if (refusal) return send(res, refusal.status, { ok: false, error: refusal.error, reason: refusal.reason });
      res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache' });
      const line = (data: unknown) => res.write(JSON.stringify(data) + '\n');
      const plannerTarget = await parallelPlanner();
      const result = await generate(prompt, { format: 'a2ui-parallel', planner: plannerTarget, onEvent: line, plannerFallback: true });
      await spent(result, plannerTarget?.id);
      line({ type: 'RESULT', result });
      res.end();
      return;
    }
    // Voice input from the headset (Quest Browser has no speech recognition): a short 16 kHz mono WAV in,
    // the transcript out. The Meta key stays on the server.
    if (req.method === 'POST' && req.url === '/api/transcribe') {
      const refusal = admitVoice(visitorOf(req));
      if (refusal) return send(res, refusal.status, { ok: false, error: refusal.error, reason: refusal.reason });
      const audio = await readBytes(req, MAX_AUDIO_BYTES);
      const result = await transcribe(audio);
      return send(res, result.ok ? 200 : 502, result);
    }
    // Saved courses (courses.ts): planned at once, lessons written in the background and kept on disk.
    if (req.method === 'POST' && req.url === '/api/courses') {
      const body = await readJson(req);
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
      if (!prompt || prompt.length > 500) return send(res, 400, { error: 'Send { "prompt": "…" } (1–500 characters).' });
      const refusal = await admit(visitorOf(req), prompt);
      if (refusal) return send(res, refusal.status, { ok: false, error: refusal.error, reason: refusal.reason });
      return send(res, 200, summary(startCourse(prompt)));
    }
    // Look-and-fix: pictures of a course lesson as the headset rendered it; the agent revises it in the background.
    const polishMatch = req.method === 'POST' && req.url?.match(/^\/api\/courses\/([a-f0-9]{8})\/lessons\/(\d)\/polish$/);
    if (polishMatch) {
      const course = getCourse(polishMatch[1]);
      if (!course) return send(res, 404, { error: 'Unknown course' });
      const body = await readJson(req, MAX_PICTURES_BYTES);
      const pictures = (Array.isArray(body.pictures) ? body.pictures : []).filter((p: unknown): p is string => typeof p === 'string' && p.startsWith('data:image/jpeg;base64,')).slice(0, 3);
      if (pictures.length === 0) return send(res, 400, { error: 'Send { "pictures": [JPEG data URLs] }.' });
      return send(res, 202, { started: polishLesson(course, Number(polishMatch[2]), pictures) });
    }
    if (req.method === 'GET' && req.url === '/api/courses') return send(res, 200, { courses: listCourses() });
    const courseMatch = req.method === 'GET' && req.url?.match(/^\/api\/courses\/([a-f0-9]{8})(?:\/lessons\/(\d))?$/);
    if (courseMatch) {
      const course = getCourse(courseMatch[1]);
      if (!course) return send(res, 404, { error: 'Unknown course' });
      if (courseMatch[2] === undefined) return send(res, 200, summary(course));
      const lesson = openLesson(course, Number(courseMatch[2]));
      return lesson ? send(res, 200, lesson) : send(res, 404, { error: 'Unknown lesson' });
    }
    // On-demand assets: progress of a background model job started by a lesson request.
    const jobMatch = req.method === 'GET' && req.url?.match(/^\/api\/assets\/jobs(?:\/([a-z0-9-]+))?$/);
    if (jobMatch) {
      const { assetJob, assetJobs } = await import('./three-d/acquire.js');
      if (!jobMatch[1]) return send(res, 200, { jobs: assetJobs() });
      const job = assetJob(jobMatch[1]);
      return job ? send(res, 200, job) : send(res, 404, { error: 'Unknown job' });
    }
    if (STATIC_DIR && req.method === 'GET' && !req.url?.startsWith('/api/')) return serveStatic(req.url ?? '/', res);
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
  if (STATIC_DIR) console.log(`Serving the XR app from ${STATIC_DIR}`);
});

// Deployment: one origin serves both the built XR app (STATIC_DIR, e.g. apps/xr/dist) and /api, the way
// the dev server's proxy does locally. Unset in development, where Vite serves the app.
const STATIC_DIR = process.env.STATIC_DIR ? resolve(process.env.STATIC_DIR) : '';
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ktx2': 'image/ktx2', '.hdr': 'application/octet-stream', '.bin': 'application/octet-stream',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.woff2': 'font/woff2', '.uikitml': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon',
};

function serveStatic(url: string, res: ServerResponse) {
  const path = decodeURIComponent(url.split('?')[0]);
  // Stay inside STATIC_DIR whatever the URL says.
  let file = normalize(join(STATIC_DIR, path));
  if (!file.startsWith(STATIC_DIR)) return send(res, 403, { error: 'Forbidden' });
  if (!existsSync(file) || statSync(file).isDirectory()) {
    if (extname(path)) return send(res, 404, { error: 'Not found' });
    file = join(STATIC_DIR, 'index.html'); // an app route
  }
  // Hashed build files never change; everything else is checked on every load.
  const immutable = path.startsWith('/assets/');
  res.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
}

// About a minute of 16 kHz mono 16-bit audio.
const MAX_AUDIO_BYTES = 2_000_000;

async function readBytes(req: IncomingMessage, limit: number): Promise<Buffer> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Recording too long.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Three review pictures of a lesson, as base64 JPEG.
const MAX_PICTURES_BYTES = 2_500_000;

async function readJson(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<any> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Request body too large.');
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

/** Count a run toward the daily budget: every call at its own model's price (planner calls at the planner's). */
function spent(result: GenerationResult, plannerId?: string) {
  return recordSpend(result.attempts.map((a) => ({
    model: a.role === 'planner' && plannerId ? plannerId : result.model,
    promptTokens: a.promptTokens,
    completionTokens: a.completionTokens,
  })));
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}
