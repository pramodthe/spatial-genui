// Serves the kit to the headset app inside the sandbox, the way the API does (`/api/kit.js`), on the port the app's dev
// server forwards /api to, and the game's generated pictures and sounds (`/api/media/<id>`) from /work/media, where
// make_sound and make_music put a copy, or from the sound library. Everything else under /api answers 404: a play-test has no courses or games.
import { createServer } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const KIT = process.env.PLAYTEST_KIT || '/opt/gate/src/kit/kit.js';
const PORT = Number(process.env.PLAYTEST_KIT_PORT || 8787);
const MEDIA = process.env.PLAYTEST_MEDIA || '/work/media';
// The sound library, baked into the image with the 3D models (data/library/sounds).
const LIBRARY = process.env.PLAYTEST_SOUND_LIBRARY || '/data/library/sounds';
const TYPES = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg' };

async function answer(req, res) {
  if (req.url?.split('?')[0] === '/api/kit.js') {
    const kit = await readFile(KIT);
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' });
    res.end(kit);
    return;
  }
  const media = /^\/api\/media\/((?:img|snd|mus)-[0-9a-f]{10})$/.exec(req.url?.split('?')[0] ?? '');
  if (media) {
    for (const dir of [MEDIA, LIBRARY]) {
      const name = (await readdir(dir).catch(() => [])).find((n) => n.startsWith(`${media[1]}.`) && !n.endsWith('.json'));
      const file = name ? await readFile(join(dir, name)).catch(() => null) : null;
      if (file) {
        res.writeHead(200, { 'content-type': TYPES[name.split('.').pop()] ?? 'application/octet-stream' });
        res.end(file);
        return;
      }
    }
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end('{"error":"not in a play-test"}');
}

// A failed read answers that one request with a 500; it never ends the server (it runs detached, so a crash would
// be silent and every later request of the play-test would fail).
createServer((req, res) => {
  answer(req, res).catch((err) => {
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: String(err?.message ?? err) }));
  });
}).listen(PORT, '127.0.0.1');
