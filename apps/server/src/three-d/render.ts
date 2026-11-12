import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * One headless Chromium with the render page (render-page.ts) loaded: renders GLBs from four angles
 * and exports P1 Three.js modules to GLB. Generated module code only ever runs inside the browser's
 * sandbox here, never in Node.
 */

const CACHE = fileURLToPath(new URL('../../.cache/', import.meta.url));
const PAGE_SOURCE = fileURLToPath(new URL('./render-page.ts', import.meta.url));
const TASK_TIMEOUT_MS = 60_000;

export type RenderStats = {
  triangles: number;
  drawCalls: number;
  meshes: number;
  materials: number;
  size: [number, number, number];
  nodeNames: string[];
  namedParts: string[];
};

export type Render = { grid: Buffer; hero: Buffer; stats: RenderStats; glbBytes: number };

let ready: Promise<Page> | null = null;
let browser: Browser | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function openPage(): Promise<Page> {
  mkdirSync(CACHE, { recursive: true });
  await build({
    entryPoints: [PAGE_SOURCE], outfile: `${CACHE}render-page.js`, bundle: true, format: 'iife',
    platform: 'browser', target: 'chrome120', logLevel: 'silent',
  });
  writeFileSync(`${CACHE}render.html`, '<!doctype html><body style="margin:0"><script src="render-page.js"></script></body>');
  browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage();
  page.on('pageerror', (err) => console.error('[render page]', err.message));
  await page.goto(pathToFileURL(`${CACHE}render.html`).href);
  await page.waitForFunction(() => typeof (window as any).renderGlb === 'function');
  return page;
}

/** One page renders one model at a time (it reuses a single WebGL canvas). */
function serialized<T>(task: (page: Page) => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    ready ??= openPage();
    const page = await ready;
    // A model that hangs the page (e.g. an endless loop) must not stall every job queued behind it.
    const watchdog = setTimeout(() => void browser?.close(), TASK_TIMEOUT_MS);
    try {
      return await task(page);
    } catch (err) {
      // A crashed or closed browser is relaunched for the next model instead of failing every job after it.
      if (page.isClosed() || !browser?.isConnected()) {
        await browser?.close().catch(() => undefined);
        browser = null;
        ready = null;
      }
      throw err;
    } finally {
      clearTimeout(watchdog);
    }
  });
  queue = run.catch(() => undefined);
  return run;
}

const decode = (dataUrl: string) => Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');

export function renderGlb(glb: Buffer): Promise<Render | { error: string; stats?: RenderStats }> {
  return serialized(async (page) => {
    const out = await page.evaluate((b64) => (window as any).renderGlb(b64), glb.toString('base64'));
    if (out.error) return { error: out.error, stats: out.stats };
    return { grid: decode(out.grid), hero: decode(out.hero), stats: out.stats, glbBytes: glb.length };
  });
}

/** P1: build a validated Three.js module in the browser and export its root as GLB. */
export function exportModuleToGlb(code: string): Promise<{ glb: Buffer } | { error: string }> {
  return serialized(async (page) => {
    const out = await page.evaluate((c) => (window as any).exportModule(c), code);
    return out.error ? { error: out.error } : { glb: Buffer.from(out.glb, 'base64') };
  });
}

export async function closeRenderer() {
  await browser?.close();
  browser = null;
  ready = null;
}
