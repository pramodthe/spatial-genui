// The start page's sticker pictures (public/games/<id>.jpg, public/lessons/<id>.jpg): a world game as the player
// sees it on opening (the page hidden, the title card faded), a desk game or a lesson from the host's own camera.
// Run it again when an example changes, against a running copy of the app:
//   node scripts/capture-stickers.mjs http://localhost:8787/ public [paper-plane,heart,...]
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
const [base, outDir, which = 'all'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
await page.goto(base);
await page.waitForFunction(() => window.genui?.capture, null, { timeout: 30000 });
const items = [
  ...['paper-plane', 'river-dam', 'kite-hill', 'desert-canyon'].map((slug) => ({ kind: 'game', slug, url: `games/${slug}.json` })),
  ...['heart', 'microscope', 'gears', 'flower'].map((slug) => ({ kind: 'lesson', slug, url: `lessons/${slug}.json` })),
].filter((it) => which === 'all' || which.split(',').includes(it.slug));
for (const it of items) {
  const folder = `${outDir}/${it.kind === 'game' ? 'games' : 'lessons'}`;
  mkdirSync(folder, { recursive: true });
  const file = `${folder}/${it.slug}.jpg`;
  const data = await page.evaluate(async ({ it }) => {
    for (const id of ['start-page', 'start-bar']) { const el = document.getElementById(id); if (el) el.style.visibility = 'hidden'; }
    window.genui.setOverlayHidden?.(true);
    const saved = await fetch(it.url).then((r) => r.json());
    await window.genui.openWritten(saved.code, saved.request ?? saved.prompt ?? it.slug, it.kind);
    await new Promise((r) => setTimeout(r, 4500));
    // A world is what the player sees on opening; a desk game or a lesson is the host's camera from outside.
    if (window.genui.inspect()?.world) return null;
    return window.genui.capture({ width: 960, height: 720, azimuth: 16, elevation: it.kind === 'game' ? 34 : 22, subject: it.kind === 'game' ? 'all' : 'model', zoom: it.kind === 'game' ? 1.75 : 1.25, background: '#dff2ff', quality: 0.86 });
  }, { it });
  if (data) writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
  else await page.screenshot({ path: file, type: 'jpeg', quality: 84 });
  console.log(it.slug, file.split('/').slice(-2).join('/'));
}
await browser.close();
