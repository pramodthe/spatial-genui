import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { generate } from './agent.js';
import { config } from './config.js';
import { EXAMPLE_MODULE } from './prompt.js';

const MAX_BODY_BYTES = 200_000;

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/health') {
      return send(res, 200, { ok: true, model: config.model, provider: new URL(config.baseURL).host, hasKey: Boolean(config.apiKey) });
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
      });
      return send(res, 200, result);
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

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}
