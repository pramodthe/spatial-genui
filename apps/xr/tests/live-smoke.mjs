// Live preview: a game written on a test API builds up on the desk while it is written, then opens to play.
// The page's /api calls go to GENUI_LIVE_API (a second API with its own data), so the dev server's API is untouched.
// A browser script may run 110 s, a game takes longer: GENUI_STEP=start begins it, then GENUI_STEP=watch (run it
// again until it reports done) records what the desk shows.
// Usage: GENUI_LIVE_API=http://127.0.0.1:8788 GENUI_STEP=start|watch [GENUI_OUT=/abs/prefix] [GENUI_PROMPT="…"]
//        npx @iwsdk/cli browser run tests/live-smoke.mjs --timeout 110000
import { writeFile } from 'node:fs/promises';

const API = process.env.GENUI_LIVE_API || 'http://127.0.0.1:8788';
const PROMPT = process.env.GENUI_PROMPT || 'tabletop bowling: ten pins, roll the ball with a pinch';
const OUT = process.env.GENUI_OUT;
const WATCH_MS = 95_000;

async function routeApi(page) {
  await page.unroute('**/api/**').catch(() => {});
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    try {
      const res = await fetch(API + url.pathname + url.search, {
        method: route.request().method(),
        headers: { 'content-type': 'application/json' },
        body: route.request().postData() ?? undefined,
      });
      await route.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' } });
    } catch {
      await route.abort();
    }
  });
}

export default async function run({ frame, page }) {
  const target = frame ?? page;
  await routeApi(page);
  await target.waitForFunction(() => Boolean(window.genui?.watchLive), null, { timeout: 30000 });

  if (process.env.GENUI_STEP === 'start') {
    await target.evaluate(() => window.genui.clear());
    const game = await (await fetch(`${API}/api/games`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: PROMPT }) })).json();
    await target.evaluate(([id, prompt]) => {
      window.liveSmoke = { started: Date.now(), timeline: [], shots: 0, lastMeshes: -1 };
      void window.genui.watchLive(`game-${id}`, prompt, 'game', async () => {
        const now = (await (await fetch('/api/games')).json()).games.find((g) => g.id === id);
        if (!now) return null; // between browser scripts the route is off and the dev server's API answers
        if (now.status === 'failed') return { failed: now.error ?? 'failed' };
        if (now.status !== 'ready') return null;
        const full = await (await fetch(`/api/games/${id}`)).json();
        return full.code ? { code: full.code } : null;
      });
    }, [game.id, PROMPT]);
    return { started: game.id };
  }

  const until = Date.now() + WATCH_MS;
  for (;;) {
    await new Promise((res) => setTimeout(res, 1500));
    const entry = await target.evaluate(() => {
      const status = window.genui.lessonStatus();
      const root = window.genui.debugRoot();
      let meshes = 0;
      root?.traverse((o) => { if (o.isMesh || o.isInstancedMesh) meshes++; });
      const record = window.liveSmoke;
      const entry = { s: Math.round((Date.now() - record.started) / 1000), phase: status.phase, message: status.message, meshes: root ? meshes : null, errors: window.genui.state.runtimeErrors.length };
      const last = record.timeline[record.timeline.length - 1];
      const plain = (m) => m.replace(/\(\d+:\d+\)/, '');
      if (!last || last.phase !== entry.phase || plain(last.message) !== plain(entry.message) || last.meshes !== entry.meshes) record.timeline.push(entry);
      return entry;
    });
    const shoot = await target.evaluate((meshes) => {
      const record = window.liveSmoke;
      if (meshes == null || meshes === record.lastMeshes || record.shots >= 8) return null;
      record.lastMeshes = meshes;
      return ++record.shots;
    }, entry.meshes);
    if (OUT && shoot) {
      await new Promise((res) => setTimeout(res, 500)); // let new parts finish growing in
      const dataUrl = await target.evaluate(() => window.genui.capture({ subject: 'all', azimuth: 0, elevation: 20 }));
      if (dataUrl) await writeFile(`${OUT}-${String(shoot).padStart(2, '0')}-${entry.meshes}.jpg`, Buffer.from(dataUrl.split(',')[1], 'base64'));
    }
    const done = entry.phase === 'ready' || entry.phase === 'failed';
    if (done || Date.now() > until) {
      const timeline = await target.evaluate(() => window.liveSmoke.timeline);
      return { done, ok: entry.phase === 'ready', seconds: entry.s, timeline };
    }
  }
}
