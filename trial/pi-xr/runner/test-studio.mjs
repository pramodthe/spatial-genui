// Tries the studio service on a project folder, as the agent's tools call it: the plan, the canvas contract and
// its check (free), and with --paid one picture (Muse Image, $0.01) and one 3D model from it (TRELLIS.2 on Modal,
// GPU time), to measure what a piece of art costs and how long it takes.
// Usage: node runner/test-studio.mjs <project folder> [--paid] [--prompt "<one object on white>"]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkCanvas } from './canvas.mjs';
import { RUNS, metaKey } from './paths.mjs';
import { startStudio } from './studio-server.mjs';

const args = process.argv.slice(2);
const game = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
const paid = args.includes('--paid');
const prompt = args.includes('--prompt') ? args[args.indexOf('--prompt') + 1]
  : 'A single friendly cartoon beaver sitting upright, three-quarter view from slightly above, the whole animal in frame with space around it, plain white background, soft even light, no shadow on the ground, no text. Smooth rounded shapes, warm brown fur, cream belly, orange teeth, like a soft clay toy.';
const run = join(RUNS, `studio-test-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
mkdirSync(run, { recursive: true });
const studio = await startStudio({ game, run, key: paid ? metaKey() : 'no-key', limits: { images: 2, models: 1, usd: 1 } });
const headers = { Authorization: `Bearer ${studio.token}`, 'Content-Type': 'application/json' };

async function call(path, body = {}) {
  const { id } = await (await fetch(`${studio.url}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })).json();
  for (;;) {
    await new Promise((done) => setTimeout(done, 1000));
    const job = await (await fetch(`${studio.url}/job/${id}`, { headers })).json();
    if (job.state === 'done') return job.result;
    if (job.state === 'failed') return { failed: job.error };
  }
}
const show = (label, result) => console.log(`${label}: ${result.failed ? `FAILED: ${result.failed}` : result.text}`);

show('update_plan', await call('/plan', { plan: [{ step: 'Design on the canvas', status: 'in_progress' }, { step: 'First playable slice', status: 'pending' }] }));
show('canvas_initialize', await call('/canvas/initialize'));
show('canvas_check (no design yet)', await call('/canvas/check'));
// A design document and a board with a picture and a model made from it, as the agent would write them.
writeFileSync(join(game, 'canvas', 'documents', 'design.md'), '# Studio test — Design\n\nA test of the canvas.\n');
writeFileSync(join(game, 'canvas', 'index.json'), `${JSON.stringify({ version: 1, mainDocumentId: 'design', boards: [{ id: 'main', name: 'Design' }], documents: [{ id: 'design', title: 'Studio test' }] }, null, 2)}\n`);
const board = JSON.parse(readFileSync(join(game, 'canvas', 'boards', 'main.json'), 'utf8'));
board.nodes = [
  { id: 'design-doc', type: 'document', title: 'Design', description: 'The main design document.', data: { documentId: 'design' } },
  { id: 'hero-picture', type: 'image', title: 'Hero: source picture', description: 'Production asset: the picture the hero model is made from.', data: { prompt, resolution: '1K', aspectRatio: '1:1', images: [] } },
  { id: 'hero', type: 'model-3d', title: 'Hero model', description: 'Production asset: the hero, grabbed by hand.', data: { operation: 'image', images: [{ type: 'node', nodeId: 'hero-picture' }], targetPolycount: 20000, texture: true, pbr: false } },
];
writeFileSync(join(game, 'canvas', 'boards', 'main.json'), `${JSON.stringify(board, null, 2)}\n`);
show('canvas_check (design and board written)', await call('/canvas/check'));
console.log(`canvas issues from the checker: ${checkCanvas(game).length}`);

if (paid) {
  const began = Date.now();
  show('generate_canvas_media (picture, then model)', await call('/canvas/generate', { boardId: 'main', nodeIds: ['hero-picture', 'hero'] }));
  show('generate_canvas_media again (same settings)', await call('/canvas/generate', { boardId: 'main', nodeIds: ['hero-picture', 'hero'] }));
  console.log(`wall time ${Math.round((Date.now() - began) / 1000)} s; spent: ${JSON.stringify({ ...studio.spent(), rows: undefined })}`);
  for (const row of studio.spent().rows) console.log(JSON.stringify({ kind: row.kind, ok: row.ok, seconds: row.seconds, usd: row.usd, path: row.path, triangles: row.triangles, size: row.size, generateS: row.generateS, error: row.error }));
}
await studio.close();
