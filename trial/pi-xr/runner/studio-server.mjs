// The studio service of one game run: what OhMyGame's daemon does for its agent, for this headless runner. It
// makes pictures (Meta's Muse Image) and 3D models from them (TRELLIS.2 on the project's Modal), keeps the canvas
// (canvas.mjs) and the agent's plan, and holds the run's media budget. The runner starts it and owns it: it runs
// outside the agent's sandbox, so the Modal login and the picture key stay out of the agent's reach, and the agent's
// tools (studio-tools.ts) reach it on 127.0.0.1 with the run's token.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, join, normalize } from 'node:path';
import { ASPECT_RATIOS, checkCanvas, initializeCanvas, readBoard, registerAsset, writeBoard } from './canvas.mjs';
import { TRIAL } from './paths.mjs';

const IMAGE_MODEL = 'muse-image-1.0';
const IMAGE_USD = 0.01; // Meta's price per picture (dev.meta.ai/docs/pricing-rate-limits, Nov 2026)
const MODEL_HOLD_USD = 0.3; // what a 3D model is held at while it is made: a cold start's GPU time
const GPU_USD_PER_S = 0.000842; // Modal's RTX PRO 6000, the GPU the TRELLIS app runs on: an estimate from wall time
const SIZES = { '1:1': '1024x1024', '16:9': '1280x720', '9:16': '720x1280', '4:3': '1152x864', '3:4': '864x1152' };
// OpenAI's image models, used as a quality reference: sides are multiples of 16, and a picture is priced by the
// tokens the service reports (developers.openai.com, Nov 2026: $30 per million image output tokens, $5 text input).
const OPENAI_SIZES = { '1:1': '1024x1024', '16:9': '1536x864', '9:16': '864x1536', '4:3': '1280x960', '3:4': '960x1280' };
const OPENAI_LARGE = { '1:1': '1920x1920', '16:9': '2560x1440', '9:16': '1440x2560', '4:3': '2240x1680', '3:4': '1680x2240' };
const OPENAI_USD = { output: 30 / 1e6, textInput: 5 / 1e6, unknown: 0.25 };
const SERVER_ENV = join(TRIAL, '..', '..', 'server'); // the app's Python environment has the Modal client

const slug = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** Triangles and size of a GLB, read from its JSON chunk (no decoding of the mesh data). */
export function inspectGlb(file) {
  const data = readFileSync(file);
  if (data.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB file');
  const json = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString('utf8'));
  let triangles = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const position = json.accessors?.[primitive.attributes?.POSITION];
      const count = primitive.indices !== undefined ? json.accessors[primitive.indices].count : position?.count ?? 0;
      triangles += Math.floor(count / 3);
      for (let i = 0; i < 3; i++) {
        if (position?.min) min[i] = Math.min(min[i], position.min[i]);
        if (position?.max) max[i] = Math.max(max[i], position.max[i]);
      }
    }
  }
  const size = min.map((m, i) => (Number.isFinite(m) ? +(max[i] - m).toFixed(3) : 0));
  return { triangles, size, textured: (json.images ?? []).length > 0, animations: (json.animations ?? []).map((a) => a.name ?? '') };
}

/**
 * Start the service for one game. `limits` is { images, models, usd } for the run's media.
 * Returns { url, token, spent(), close() }.
 */
export async function startStudio({ game, run, key, limits = { images: 8, models: 3, usd: 1 }, previous = [], images = null }) {
  const drawnBy = images?.provider === 'openai' ? images.model : IMAGE_MODEL;
  const token = randomBytes(24).toString('hex');
  const ledgerFile = join(run, 'media.jsonl');
  const jobs = new Map();
  const ledger = [...previous]; // what the game's build already made counts against the same budget
  const used = (kind) => ledger.filter((row) => row.kind === kind && row.ok).length;
  // Generations started and not yet recorded: they count against the limits from the moment they start, so two
  // at once (a background job and a foreground one) cannot both pass. Each holds an estimate until it is recorded.
  const pending = [];
  const reserve = (kind, usd) => {
    const hold = { kind, usd };
    pending.push(hold);
    return () => pending.splice(pending.indexOf(hold), 1);
  };
  const spent = () => ({
    images: used('image'), models: used('model-3d'), usd: +ledger.reduce((sum, row) => sum + (row.usd ?? 0), 0).toFixed(4),
    pendingUsd: +pending.reduce((sum, hold) => sum + hold.usd, 0).toFixed(4), rows: ledger,
  });
  const record = (row) => { ledger.push(row); appendFileSync(ledgerFile, `${JSON.stringify(row)}\n`); };
  const overBudget = (kind) => {
    const now = spent();
    const started = pending.filter((hold) => hold.kind === kind).length;
    if (kind === 'image' && now.images + started >= limits.images) return `This game has made ${now.images} pictures, the most it may. Use the ones it has, or shapes built in code.`;
    if (kind === 'model-3d' && now.models + started >= limits.models) return `This game has made ${now.models} 3D models, the most it may. Build the rest from shapes in code.`;
    if (now.usd + now.pendingUsd >= limits.usd) return `This game's media budget ($${limits.usd}) is used. Build the rest from what exists and shapes in code.`;
    return null;
  };
  const inProject = (path) => {
    if (typeof path !== 'string' || !path || path.startsWith('/') || normalize(path).startsWith('..')) throw new Error(`"${path}" must be a path inside the project, relative to its root.`);
    return join(game, path);
  };

  async function makeImage({ prompt, aspectRatio = '1:1', name, purpose = '' }) {
    if (typeof prompt !== 'string' || prompt.trim().length < 10) throw new Error('Give a prompt that describes the picture (at least a sentence).');
    if (!ASPECT_RATIOS.includes(aspectRatio)) throw new Error(`aspectRatio is one of ${ASPECT_RATIOS.join(', ')}.`);
    const refused = overBudget('image');
    if (refused) throw new Error(refused);
    const release = reserve('image', images?.provider === 'openai' ? OPENAI_USD.unknown : IMAGE_USD);
    try {
      return await drawImage({ prompt, aspectRatio, name, purpose });
    } finally {
      release();
    }
  }

  async function drawImage({ prompt, aspectRatio, name, purpose }) {
    const id = slug(name) || `image-${ledger.length + 1}`;
    const started = Date.now();
    const reply = images?.provider === 'openai'
      ? await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST', headers: { Authorization: `Bearer ${images.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: images.model, prompt, size: (images.large ? OPENAI_LARGE : OPENAI_SIZES)[aspectRatio], quality: images.quality, n: 1, output_format: 'png' }),
        signal: AbortSignal.timeout(900000),
      })
      : await fetch('https://api.meta.ai/v1/images/generations', {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: IMAGE_MODEL, prompt, size: SIZES[aspectRatio], n: 1, response_format: 'b64_json', output_format: 'png' }),
        signal: AbortSignal.timeout(240000),
      });
    if (!reply.ok) {
      const detail = (await reply.text()).slice(0, 300);
      record({ kind: 'image', ok: false, name: id, model: drawnBy, error: `${reply.status}: ${detail}`, seconds: (Date.now() - started) / 1000, usd: 0 });
      throw new Error(`The picture was not made (${reply.status}): ${detail}`);
    }
    const answer = await reply.json();
    const item = (answer.data ?? [])[0] ?? {};
    const tokens = answer.usage ?? null;
    const usd = images?.provider !== 'openai' ? IMAGE_USD
      : tokens ? +((tokens.output_tokens ?? 0) * OPENAI_USD.output + (tokens.input_tokens ?? 0) * OPENAI_USD.textInput).toFixed(4) : OPENAI_USD.unknown;
    const bytes = item.b64_json ? Buffer.from(item.b64_json, 'base64') : item.url ? Buffer.from(await (await fetch(item.url)).arrayBuffer()) : null;
    if (!bytes) throw new Error('The picture service answered without a picture.');
    // Muse Image draws at about 2K whatever size is asked. The original is kept for the 3D step; the game and
    // the agent get a copy of at most 1024 pixels, which opens quickly and suits a headset.
    const original = join(game, 'assets', 'generated', 'originals', `${id}.png`);
    const path = `assets/generated/${id}.png`;
    mkdirSync(dirname(original), { recursive: true });
    writeFileSync(original, bytes);
    const small = spawnSync('sips', ['-Z', images?.large ? '2048' : '1024', original, '--out', join(game, path)], { encoding: 'utf8' });
    if (small.status !== 0) copyFileSync(original, join(game, path));
    const row = { kind: 'image', ok: true, name: id, path, original: `assets/generated/originals/${id}.png`, purpose, prompt, aspectRatio, model: drawnBy, ...(tokens ? { tokens: { input: tokens.input_tokens ?? 0, output: tokens.output_tokens ?? 0 } } : {}), seconds: +((Date.now() - started) / 1000).toFixed(1), usd };
    record(row);
    registerAsset(game, id, { name: name || id, path, description: purpose || undefined, prompt });
    return { assetId: id, ...row, text: `Picture saved: ${path} (asset "${id}", ${row.seconds} s, $${usd}). Read the file to see what was drawn. The game does not use it until a copy is under public/ and src/assets.ts names it. ${limits.images - spent().images} picture(s) left for this game.` };
  }

  async function makeModel({ imagePath, name, targetPolycount = 20000, texture = true }) {
    const refused = overBudget('model-3d');
    if (refused) throw new Error(refused);
    const release = reserve('model-3d', MODEL_HOLD_USD);
    try {
      return await buildModel({ imagePath, name, targetPolycount, texture });
    } finally {
      release();
    }
  }

  async function buildModel({ imagePath, name, targetPolycount, texture }) {
    const asked = inProject(imagePath);
    // The full-size original gives a better model than the 1024 copy.
    const original = join(dirname(asked), 'originals', basename(asked));
    const source = existsSync(original) ? original : asked;
    if (!existsSync(source)) throw new Error(`${imagePath} does not exist. Make the picture first (one object, whole, on a plain white background).`);
    const triangles = Math.max(500, Math.min(100000, Math.round(Number(targetPolycount) || 20000)));
    const id = slug(name) || `${slug(basename(asked, '.png'))}-model`;
    const path = `assets/generated/${id}.glb`;
    const started = Date.now();
    const result = await new Promise((done) => {
      const child = spawn('uv', ['run', '--project', SERVER_ENV, 'python', join(TRIAL, 'runner', 'trellis_client.py'), source, join(game, path), String(triangles), texture ? '1024' : '512'], { encoding: 'utf8' });
      let out = '';
      let err = '';
      child.stdout.on('data', (chunk) => { out += chunk; });
      child.stderr.on('data', (chunk) => { err += chunk; });
      const timer = setTimeout(() => child.kill('SIGTERM'), 20 * 60000);
      child.on('close', () => {
        clearTimeout(timer);
        const line = out.trim().split('\n').pop() ?? '';
        try { done(JSON.parse(line)); } catch { done({ ok: false, error: (err || out).slice(-300) || 'the 3D service gave no answer' }); }
      });
    });
    const seconds = +((Date.now() - started) / 1000).toFixed(1);
    const usd = +(seconds * GPU_USD_PER_S).toFixed(3);
    if (!result.ok) {
      record({ kind: 'model-3d', ok: false, name: id, error: result.error, seconds, usd });
      throw new Error(`The 3D model was not made: ${result.error}. Do not try the same picture again unchanged; use shapes built in code for this thing.`);
    }
    const seen = inspectGlb(join(game, path));
    const row = { kind: 'model-3d', ok: true, name: id, path, from: imagePath, triangles: seen.triangles, size: seen.size, bytes: result.bytes, seconds, generateS: result.generate_s, usd };
    record(row);
    registerAsset(game, id, { name: name || id, path, description: `3D model made from ${imagePath}`, model3d: { triangles: seen.triangles, textured: seen.textured, rigged: false, animations: seen.animations, operation: 'image' } });
    return { assetId: id, ...row, text: `3D model saved: ${path} (asset "${id}", ${seen.triangles} triangles, ${(result.bytes / 1e6).toFixed(1)} MB, ${seconds} s, about $${usd}). It is ${seen.size.join(' x ')} m as made, about 1 m across with its origin at its centre: scale it to its real size and lift it by half its height. Copy it under public/models/, register it in src/assets.ts as AssetType.GLTF, place it in the scene, and look at it in the runtime. ${limits.models - spent().models} model(s) left for this game.` };
  }

  // Art started in the background: the agent goes on with other work and collects it with a later call, which
  // waits for it. (The 3D generator takes minutes to start when it has been idle; the playable slice need not wait.)
  let background = null;
  async function generate({ boardId, nodeIds, regenerate = false, background: inBackground = false }) {
    if (!Array.isArray(nodeIds) || nodeIds.length === 0) throw new Error('"nodeIds" lists the board nodes to generate.');
    if (background) {
      const earlier = background;
      const outcome = await earlier.promise.then(() => null, (err) => String(err?.message ?? err));
      if (background === earlier) background = null;
      if (outcome) return { text: `The art started in the background failed: ${outcome}` };
    }
    if (!inBackground) return generateNodes({ boardId, nodeIds, regenerate });
    readBoard(game, boardId); // a missing board is reported now, not later
    background = { nodeIds, promise: generateNodes({ boardId, nodeIds, regenerate }) };
    background.promise.catch(() => {}); // reported when it is collected
    return { text: `Started in the background: ${nodeIds.join(', ')}. Go on with other work now. To collect them, call generate_canvas_media again with the same nodeIds (without background): it waits until they are made and returns their files.` };
  }

  /** Generate saved board nodes, each after the listed nodes whose output it uses. */
  async function generateNodes({ boardId, nodeIds, regenerate = false }) {
    let board = readBoard(game, boardId);
    const wanted = new Set(nodeIds);
    const lines = [];
    const done = new Set();
    const order = [];
    const visit = (id, path = []) => {
      if (done.has(id)) return;
      if (path.includes(id)) throw new Error(`Nodes ${[...path, id].join(' -> ')} use each other's output.`);
      const node = board.nodes.find((n) => n.id === id);
      if (!node) throw new Error(`Board "${boardId}" has no node "${id}".`);
      for (const ref of node.data?.images ?? []) if (ref.type === 'node' && wanted.has(ref.nodeId)) visit(ref.nodeId, [...path, id]);
      done.add(id);
      order.push(id);
    };
    for (const id of nodeIds) visit(id);
    // canvas/jobs.json is the generation history: which settings each node's current output came from.
    const jobsFile = join(game, 'canvas', 'jobs.json');
    const history = existsSync(jobsFile) ? JSON.parse(readFileSync(jobsFile, 'utf8')) : { version: 1, jobs: [] };
    for (const id of order) {
      board = readBoard(game, boardId);
      const node = board.nodes.find((n) => n.id === id);
      const settings = JSON.stringify({ ...node.data, assetId: undefined });
      const last = history.jobs.findLast((job) => job.boardId === boardId && job.nodeId === id);
      if (node.data.assetId && last?.settings === settings && !regenerate) { lines.push(`${id}: already generated with these settings (asset "${node.data.assetId}").`); continue; }
      let made;
      if (node.type === 'image') made = await makeImage({ prompt: node.data.prompt, aspectRatio: node.data.aspectRatio, name: id, purpose: node.description ?? node.title ?? '' });
      else if (node.type === 'model-3d') {
        const source = board.nodes.find((n) => n.id === node.data.images?.[0]?.nodeId);
        const picture = source?.data?.assetId ? `assets/generated/${source.data.assetId}.png` : null;
        if (!picture) throw new Error(`Node "${id}" makes a model from the image node "${node.data.images?.[0]?.nodeId}", which has no picture yet: generate that node first (list both).`);
        made = await makeModel({ imagePath: picture, name: id, targetPolycount: node.data.targetPolycount, texture: node.data.texture !== false });
      } else throw new Error(`Node "${id}" is a ${node.type} node: only image and model-3d nodes are generated.`);
      board = readBoard(game, boardId);
      const saved = board.nodes.find((n) => n.id === id);
      saved.data = { ...saved.data, assetId: made.assetId };
      writeBoard(game, board);
      history.jobs.push({ boardId, nodeId: id, assetId: made.assetId, settings, at: new Date().toISOString(), seconds: made.seconds, usd: made.usd });
      writeFileSync(jobsFile, `${JSON.stringify(history, null, 2)}\n`);
      lines.push(`${id}: ${made.text}`);
    }
    return { text: lines.join('\n') };
  }

  /** The play-test tools (runner/playtest.mjs) as a process of their own: they call IWSDK's command line in turn,
   * which would hold up this service if it ran here. */
  const playtest = (action, payload) => new Promise((done, failed) => {
    const child = spawn(process.execPath, [join(TRIAL, 'runner', 'playtest.mjs'), game, action, ...(payload ? [JSON.stringify(payload)] : [])]);
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    const timer = setTimeout(() => child.kill('SIGTERM'), 8 * 60000);
    child.on('close', () => {
      clearTimeout(timer);
      let result = null;
      try { result = JSON.parse(out.trim().split('\n').pop() ?? ''); } catch { /* reported below */ }
      if (result?.ok) done(result);
      else failed(new Error(result?.error ?? 'the play-test did not answer (it took too long or the runtime is down)'));
    });
  });

  const routes = {
    '/playtest/record': (body) => playtest('record', body),
    '/playtest/replay': () => playtest('replay'),
    '/playtest/view': () => playtest('view'),
    '/plan': async (body) => {
      const steps = (body.plan ?? []).map((s) => ({ step: String(s.step ?? '').trim(), status: s.status }));
      if (!steps.length || steps.some((s) => !s.step)) throw new Error('A plan is a list of { step, status }; steps cannot be blank.');
      if (steps.filter((s) => s.status === 'in_progress').length > 1) throw new Error('At most one step may be in_progress.');
      writeFileSync(join(run, 'plan.json'), `${JSON.stringify({ explanation: body.explanation ?? '', plan: steps, at: new Date().toISOString() }, null, 1)}\n`);
      return { text: `Plan saved: ${steps.filter((s) => s.status === 'completed').length} of ${steps.length} steps done.` };
    },
    '/canvas/initialize': async () => {
      const index = initializeCanvas(game);
      return { text: `Canvas ready. Read canvas/AGENTS.md and canvas/index.json. Boards: ${JSON.stringify(index.boards)}.` };
    },
    '/canvas/check': async () => {
      const issues = checkCanvas(game);
      return { text: issues.length ? issues.map((i) => `${i.file}: ${i.message}`).join('\n') : 'Canvas files and references are valid.', issues };
    },
    '/canvas/generate': generate,
    '/image': makeImage,
    '/model3d': makeModel,
  };

  const server = createServer((request, response) => {
    const send = (code, value) => { response.writeHead(code, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
    if (request.headers.authorization !== `Bearer ${token}`) return send(401, { error: 'no token' });
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname.startsWith('/job/')) {
      const job = jobs.get(url.pathname.slice(5));
      return job ? send(200, job) : send(404, { error: 'no such job' });
    }
    const route = routes[url.pathname];
    if (request.method !== 'POST' || !route) return send(404, { error: 'no such tool' });
    let text = '';
    request.on('data', (chunk) => { text += chunk; });
    request.on('end', () => {
      let body = {};
      try { body = text ? JSON.parse(text) : {}; } catch { return send(400, { error: 'the request is not JSON' }); }
      // Every call is a job the tool polls: a 3D model can take longer than one HTTP request should wait.
      const id = randomUUID();
      const job = { id, state: 'running', startedAt: Date.now() };
      jobs.set(id, job);
      route(body).then((result) => Object.assign(job, { state: 'done', result })).catch((err) => Object.assign(job, { state: 'failed', error: String(err?.message ?? err) }));
      return send(202, { id });
    });
    return undefined;
  });
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
  return { url: `http://127.0.0.1:${server.address().port}`, token, spent, close: () => new Promise((closed) => server.close(closed)) };
}
