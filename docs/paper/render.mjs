// Prints the paper to PDF: docs/paper/paper.pdf. Run from the repository root after analysis.py:
//   node docs/paper/render.mjs [--png]      (--png also writes one picture per page to docs/paper/pages/ for checking)
// Uses Playwright from apps/xr (npm install there first) and the installed Google Chrome.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '..', '..', 'apps', 'xr', 'package.json'));
const { chromium } = require('playwright');

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 816, height: 1056 } });
await page.goto(pathToFileURL(join(here, 'paper.html')).href);
await page.waitForFunction(() => window.__figuresDone && window.__tablesDone);
await page.evaluate(() => document.fonts.ready);
await page.pdf({
  path: join(here, 'paper.pdf'),
  format: 'Letter',
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate: '<div style="width:100%;text-align:center;font:9px \'STIX Two Text\',serif;color:#55534e"><span class="pageNumber"></span></div>',
});
if (process.argv.includes('--png')) {
  // Screen pictures of the printed layout, one per page, by emulating print media at page width.
  mkdirSync(join(here, 'pages'), { recursive: true });
  await page.emulateMedia({ media: 'print' });
  await page.setViewportSize({ width: 624, height: 900 });
  await page.screenshot({ path: join(here, 'pages', 'all.png'), fullPage: true });
}
await browser.close();
console.log('wrote docs/paper/paper.pdf');
