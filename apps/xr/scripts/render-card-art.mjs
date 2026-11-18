// Draws the pictures the headset's cards use to look like the start page's (start-page.ts), which the panel UI cannot
// draw itself: each letter and digit in Lilita One, white with an ink outline; the dotted grid paper of a card being
// made; and the wave, with its ink edge, that tops the colour rising in it, once per card colour.
// Writes public/ui/cards/. Run from apps/xr: node scripts/render-card-art.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const INK = '#12063b';
const CARD_COLORS = { green: '#19e36b', pink: '#ff4fa3', orange: '#ff8a00', aqua: '#14d9f5' }; // brand.ts CARD_COLORS
const MARKS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'];
const OUT = 'public/ui/cards';
// Sizes in the dashboard's design pixels (lesson-picker.uikitml): the picture block is 218 x 162; drawn at 2x.
const BLOCK = { width: 218, height: 162 };
const WAVE = { period: 64, height: 18 };

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 400, height: 300 } });
await page.setContent(`<!doctype html>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lilita+One&display=block">
<style>
  body { margin: 0; background: transparent; }
  #mark { display: flex; align-items: center; justify-content: center; width: 96px; height: 96px;
    font: 80px/1 'Lilita One'; color: #fff; -webkit-text-stroke: 7px ${INK}; paint-order: stroke fill; }
  #dots { width: ${BLOCK.width}px; height: ${BLOCK.height}px;
    background: radial-gradient(rgba(18, 6, 59, 0.16) 2px, transparent 2.5px) 0 0 / 20px 20px; }
  .wave { width: ${BLOCK.width + WAVE.period}px; height: ${WAVE.height}px; }
</style>
<div id="mark">A</div>
<div id="dots"></div>
${Object.keys(CARD_COLORS).map((name) => `<svg class="wave" id="wave-${name}" xmlns="http://www.w3.org/2000/svg" width="${BLOCK.width + WAVE.period}" height="${WAVE.height}">
  <defs><pattern id="p-${name}" width="${WAVE.period}" height="${WAVE.height}" patternUnits="userSpaceOnUse">
    <path d="M0 9Q16 2 32 9T64 9V18H0Z" fill="${CARD_COLORS[name]}"/>
    <path d="M0 9Q16 2 32 9T64 9" fill="none" stroke="${INK}" stroke-width="4.5"/>
  </pattern></defs>
  <rect width="100%" height="100%" fill="url(#p-${name})"/>
</svg>`).join('')}`);
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction(() => document.fonts.check("80px 'Lilita One'"));

for (const mark of MARKS) {
  await page.$eval('#mark', (node, text) => { node.textContent = text; }, mark);
  await (await page.$('#mark')).screenshot({ path: `${OUT}/mark-${mark}.png`, omitBackground: true });
}
await (await page.$('#dots')).screenshot({ path: `${OUT}/dots.png`, omitBackground: true });
for (const name of Object.keys(CARD_COLORS)) {
  await (await page.$(`#wave-${name}`)).screenshot({ path: `${OUT}/wave-${name}.png`, omitBackground: true });
}
await browser.close();
console.log(`wrote ${MARKS.length} marks, dots.png and ${Object.keys(CARD_COLORS).length} waves to ${OUT}/`);
