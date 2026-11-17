// Draws the Muse's Lab logo and icon and writes them as PNG files: docs/brand/*.png for the README and the video,
// public/logo.png and public/icon-*.png for the web app. The logo is made for the sky-blue ground: Muse and its name
// are white with an ink outline. docs/brand/banner.png puts it on that ground, for pages that are white. Muse is the mascot's own drawing (public/ui/muse.svg, from mascot.ts), here
// holding a lab flask; the name is set in Lilita One, the start page's display face, loaded from Google Fonts.
// Run from apps/xr after the drawing changes: node scripts/write-muse.mjs && node scripts/render-brand.mjs
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';

const INK = '#12063b';
const PAPER = '#ffffff';
const SUN = '#ffd60a';
const SKY = '#b5e2ff';
const AQUA = '#14d9f5';
const PINK = '#ff4fa3';
const TAGLINE = 'Ask Muse anything. Learn it with your hands.';

// The mascot's drawing without its own <svg> wrapper, to place inside the logo.
const muse = readFileSync('public/ui/muse.svg', 'utf8');
const museInner = muse.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const MUSE_VIEWBOX = '-16 -20 232 250';

/** Muse with a flask in the right hand: the flask is drawn first, so the hand holds it. 300 x 300 units. */
function museWithFlask() {
  // A round-bottom flask with aqua liquid and three bubbles rising out of it, as a sticker (white edge, ink line).
  const flask = (stroke, width) => `
    <path d="M222 118 h30 v40 a42 42 0 1 1 -30 0 z" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round"/>`;
  return `
  <g>
    ${flask(PAPER, 26)}
    <circle cx="246" cy="88" r="9" fill="${PAPER}"/><circle cx="262" cy="62" r="7" fill="${PAPER}"/><circle cx="240" cy="40" r="6" fill="${PAPER}"/>
    <path d="M222 118 h30 v40 a42 42 0 1 1 -30 0 z" fill="${PAPER}"/>
    <path d="M196 196 a42 42 0 0 0 82 0 z" fill="${AQUA}"/>
    <circle cx="226" cy="214" r="6" fill="${PAPER}" fill-opacity="0.85"/><circle cx="248" cy="204" r="4" fill="${PAPER}" fill-opacity="0.85"/>
    ${flask(INK, 7)}
    <rect x="216" y="110" width="42" height="12" rx="6" fill="${PAPER}" stroke="${INK}" stroke-width="6"/>
    <circle cx="246" cy="88" r="8" fill="${AQUA}" stroke="${INK}" stroke-width="4"/>
    <circle cx="262" cy="62" r="6" fill="${PINK}" stroke="${INK}" stroke-width="4"/>
    <circle cx="240" cy="40" r="5" fill="${SUN}" stroke="${INK}" stroke-width="4"/>
    <svg x="-24" y="-12" width="260" height="280" viewBox="${MUSE_VIEWBOX}" overflow="visible">${museInner}</svg>
  </g>`;
}

/** The name as a sticker: white outer edge, a hard ink shadow under it, ink outline, colour fill. */
function wordmark(x, y, size) {
  const word = (text, fill, dx) => `
    <text x="${x + dx}" y="${y + size * 0.075}" font-size="${size}" fill="${INK}" stroke="${INK}" stroke-width="${size * 0.16}" stroke-linejoin="round" paint-order="stroke">${text}</text>
    <text x="${x + dx}" y="${y}" font-size="${size}" fill="${PAPER}" stroke="${PAPER}" stroke-width="${size * 0.2}" stroke-linejoin="round" paint-order="stroke">${text}</text>
    <text x="${x + dx}" y="${y}" font-size="${size}" fill="${fill}" stroke="${INK}" stroke-width="${size * 0.075}" stroke-linejoin="round" paint-order="stroke">${text}</text>`;
  // "Muse's" in white, "Lab" in yellow; the gap is measured in the page (see below).
  return `<g class="wordmark" font-family="'Lilita One'" data-size="${size}">${word('Muse’s', PAPER, 0)}<g class="lab">${word('Lab', SUN, 0)}</g></g>`;
}

const page = `<!doctype html><html><head>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Next:wght@700&family=Lilita+One&display=block" rel="stylesheet">
<style>
  body { margin: 0; background: transparent; }
  .art { display: block; margin: 0 0 40px; }
</style></head><body>
<svg id="logo" class="art" width="1270" height="360" viewBox="0 0 1270 360">
  <g transform="translate(40 30)">${museWithFlask()}</g>
  ${wordmark(360, 245, 168)}
</svg>
<svg id="logo-tagline" class="art" width="1270" height="410" viewBox="0 0 1270 410">
  <g transform="translate(40 30)">${museWithFlask()}</g>
  ${wordmark(360, 245, 168)}
  <text x="368" y="372" font-family="'Atkinson Hyperlegible Next'" font-weight="700" font-size="40" fill="${INK}" stroke="${PAPER}" stroke-width="12" stroke-linejoin="round" paint-order="stroke">${TAGLINE}</text>
</svg>
<svg id="banner" class="art" width="1400" height="520" viewBox="0 0 1400 520">
  <defs><pattern id="dots" width="44" height="44" patternUnits="userSpaceOnUse"><circle cx="22" cy="22" r="3.2" fill="${PAPER}" fill-opacity="0.6"/></pattern></defs>
  <rect x="8" y="8" width="1384" height="504" rx="56" fill="${SKY}" stroke="${INK}" stroke-width="8"/>
  <rect x="8" y="8" width="1384" height="504" rx="56" fill="url(#dots)"/>
  <g transform="translate(105 95)">
    <g transform="translate(40 30)">${museWithFlask()}</g>
    ${wordmark(360, 245, 168)}
    <text x="368" y="372" font-family="'Atkinson Hyperlegible Next'" font-weight="700" font-size="40" fill="${INK}">${TAGLINE}</text>
  </g>
</svg>
<svg id="icon" class="art" width="512" height="512" viewBox="0 0 512 512">
  <rect x="16" y="16" width="480" height="480" rx="112" fill="${SKY}" stroke="${INK}" stroke-width="16"/>
  <g transform="translate(61 78) scale(1.3)">${museWithFlask()}</g>
</svg>
</body></html>`;

const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 1420, height: 2100 }, deviceScaleFactor: 2 });
await tab.setContent(page, { waitUntil: 'networkidle' });
await tab.evaluate(() => document.fonts.ready);
// Place "Lab" a word space after "Muse's", now that the font is in and the first word can be measured.
await tab.evaluate(() => {
  for (const mark of document.querySelectorAll('.wordmark')) {
    const size = Number(mark.getAttribute('data-size'));
    const first = mark.querySelector(':scope > text:last-of-type');
    const width = first.getComputedTextLength();
    mark.querySelector('.lab').setAttribute('transform', `translate(${width + size * 0.28} 0)`);
  }
});
mkdirSync('../../docs/brand', { recursive: true });
for (const id of ['logo', 'logo-tagline', 'banner', 'icon']) {
  await tab.locator(`#${id}`).screenshot({ path: `../../docs/brand/${id}.png`, omitBackground: true });
}
// The start page's name, top left.
await tab.locator('#logo').screenshot({ path: 'public/logo.png', omitBackground: true });
// The web app's icons, from the same drawing.
for (const size of [192, 512]) {
  const small = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await small.setContent(page.replace('<body>', `<body style="zoom:${size / 512}">`), { waitUntil: 'networkidle' });
  await small.locator('#icon').screenshot({ path: `public/icon-${size}.png`, omitBackground: true });
  await small.close();
}
await browser.close();
console.log('wrote docs/brand/logo.png, logo-tagline.png, icon.png and public/logo.png, icon-192.png, icon-512.png');
