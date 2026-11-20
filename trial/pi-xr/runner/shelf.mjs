// The shelf: every built game behind one address, to try on a headset. It serves each game's production build
// (its dist/ folder, which the check makes with `npm run build`) at /<name>/, and a page that lists the games with
// who built them, how long it took and what it cost. There is no emulator and no dev server in these builds: this
// is what a headset gets.
//   http://localhost:8092/     over USB, after `adb reverse tcp:8092 tcp:8092` (localhost counts as secure, so WebXR works)
//   https://<this Mac>:8093/   over Wi-Fi, with a certificate warning to accept once
// Usage: node runner/shelf.mjs [--port 8092]
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { networkInterfaces } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { GAMES, RESULTS } from './paths.mjs';
import { scoreOf } from './scores.mjs';

const args = process.argv.slice(2);
const PORT = args.includes('--port') ? Number(args[args.indexOf('--port') + 1]) : 8092;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.map': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.ktx2': 'image/ktx2', '.hdr': 'application/octet-stream', '.exr': 'application/octet-stream', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
const escape = (text) => String(text ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** The built games, newest first, each with what its runs recorded (results.jsonl: a build and its follow-ups). */
function games() {
  const rows = existsSync(RESULTS) ? readFileSync(RESULTS, 'utf8').split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean) : [];
  return readdirSync(GAMES).filter((name) => existsSync(join(GAMES, name, 'dist', 'index.html'))).map((name) => {
    // A snapshot (snapshot.mjs) is a game kept as it was at a moment: it has the runs of its game up to then.
    const kept = existsSync(join(GAMES, name, '.pi-xr-snapshot.json')) ? JSON.parse(readFileSync(join(GAMES, name, '.pi-xr-snapshot.json'), 'utf8')) : null;
    const runs = rows.filter((row) => row.name === (kept?.of ?? name) && (!kept || Date.parse(row.started) <= Date.parse(kept.at)));
    const [first, last] = [runs[0], runs.at(-1)];
    return {
      name, note: kept?.note ?? '', built: statSync(join(GAMES, name, 'dist', 'index.html')).mtimeMs, request: first?.request ?? '',
      model: first?.model ?? null, thinking: last?.thinking ?? null, imageModel: last?.imageModel ?? (first ? 'muse-image-1.0' : null),
      minutes: +runs.reduce((sum, row) => sum + (row.agentMinutes ?? 0), 0).toFixed(1),
      // A follow-up's row repeats the art its game already paid for: the model cost adds up, the art cost is the last.
      usd: +(runs.reduce((sum, row) => sum + (row.modelUsd ?? 0), 0) + (last?.media?.usd ?? 0)).toFixed(2),
      passed: last ? last.check?.ok === true : null, followUps: runs.length - 1, score: scoreOf(name),
    };
  }).sort((a, b) => b.built - a.built);
}

function index() {
  const cards = games().map((g) => `
  <a class="card" href="/${g.name}/">
    <h2>${escape(g.name)}</h2>
    <p class="who">${g.model ? `${escape(g.model)}${g.thinking ? `, thinking ${escape(g.thinking)}` : ''} · pictures by ${escape(g.imageModel)}` : 'no run on record'}</p>
    <p class="what">${escape(g.request.replace(/\s+/g, ' ').slice(0, 220))}${g.request.length > 220 ? '…' : ''}</p>${g.note ? `
    <p class="note-line">${escape(g.note)}</p>` : ''}
${g.score ? `
    <p class="score">Specification (${escape(g.score.rubric)}): ${g.score.met} of ${g.score.total} met, ${g.score.partly} partly, ${g.score.notMet} not met</p>` : ''}
    <p class="facts">${g.model ? `${g.minutes} min · $${g.usd.toFixed(2)} · check ${g.passed ? 'passed' : 'FAILED'}${g.followUps ? ` · ${g.followUps} follow-up${g.followUps > 1 ? 's' : ''}` : ''} · ` : ''}built ${new Date(g.built).toLocaleString()}</p>
  </a>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Game shelf</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f4ee; --card: #ffffff; --ink: #1d1b16; --soft: #5d584c; --line: #dcd7c9; --go: #0b6e4f; }
  @media (prefers-color-scheme: dark) { :root { --bg: #15140f; --card: #211f18; --ink: #f1eee4; --soft: #b3ad9c; --line: #3a372c; --go: #5fd0a4; } }
  body { margin: 0; padding: 24px 16px 48px; background: var(--bg); color: var(--ink); font: 18px/1.45 system-ui, sans-serif; }
  main { max-width: 860px; margin: 0 auto; }
  h1 { font-size: 28px; margin: 0 0 4px; } .note { color: var(--soft); margin: 0 0 20px; }
  .card { display: block; padding: 18px 20px; margin: 0 0 14px; background: var(--card); border: 1px solid var(--line); border-radius: 14px; color: inherit; text-decoration: none; }
  .card:hover, .card:focus { border-color: var(--go); }
  .card h2 { margin: 0 0 4px; font-size: 24px; color: var(--go); } .card p { margin: 4px 0 0; }
  .who { font-weight: 600; } .what { color: var(--soft); } .note-line { font-style: italic; } .score { font-weight: 600; } .facts { font-size: 16px; font-variant-numeric: tabular-nums; }
</style></head><body><main>
<h1>Game shelf</h1><p class="note">Production builds of the trial's games. Open one, then press its Enter XR button.</p>${cards || '<p>No built game yet.</p>'}
</main></body></html>`;
}

function serve(request, response) {
  let path;
  try { path = decodeURIComponent(new URL(request.url, 'http://shelf').pathname); } catch { path = '/'; }
  const send = (status, type, body) => { response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); response.end(body); };
  if (path === '/') return send(200, TYPES['.html'], index());
  const [, name, ...rest] = path.split('/');
  const dist = join(GAMES, name, 'dist');
  if (!/^[a-z0-9-]+$/.test(name) || !existsSync(join(dist, 'index.html'))) return send(404, TYPES['.txt'], 'No such game on the shelf.');
  if (rest.length === 0) { response.writeHead(301, { Location: `/${name}/` }); return response.end(); } // relative asset paths need the slash
  let file = resolve(dist, rest.join('/'));
  if (file !== dist && !file.startsWith(dist + sep)) return send(403, TYPES['.txt'], 'Outside the game.');
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) return send(404, TYPES['.txt'], 'Not in this game.');
  response.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'Content-Length': statSync(file).size, 'Cache-Control': 'no-store' });
  if (request.method === 'HEAD') return response.end();
  return createReadStream(file).pipe(response);
}

const lan = Object.values(networkInterfaces()).flat().find((address) => address && address.family === 'IPv4' && !address.internal)?.address ?? null;
createServer(serve).listen(PORT, '0.0.0.0', () => console.log(`shelf: http://localhost:${PORT}/   (Quest over USB: adb reverse tcp:${PORT} tcp:${PORT}, then open this address in its browser)`));
// The dev runtime's own certificate (a key and a certificate in one file) serves HTTPS on the network.
const certificate = readdirSync(GAMES).map((name) => join(GAMES, name, '.iwsdk', 'https', '_cert.pem')).find((file) => existsSync(file));
if (certificate) {
  const pem = readFileSync(certificate);
  createSecureServer({ key: pem, cert: pem }, serve).listen(PORT + 1, '0.0.0.0', () => console.log(`shelf: https://${lan ?? 'this-mac'}:${PORT + 1}/   (Quest over Wi-Fi: accept the certificate warning once)`));
}
console.log(`shelf: ${games().length} built game(s): ${games().map((g) => g.name).join(', ')}`);
