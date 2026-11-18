// Draws the 3D Muse (src/genui/muse3d.ts) waving and looking about, and writes it as an animated PNG for the
// README: .github/assets/muse.png. Run from headset: node scripts/render-muse.mjs
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';

const SIZE = { width: 400, height: 400 };
const FPS = 16;
const FRAMES = 48;

// Muse and the bits of three.js the page needs, as one module.
const bundle = await build({
  stdin: { contents: "export { createMuse3D } from './src/genui/muse3d.ts'; export { WebGLRenderer, Scene, PerspectiveCamera, Vector3 } from 'three';", resolveDir: process.cwd(), loader: 'js' },
  bundle: true, format: 'esm', write: false, logLevel: 'warning',
});
const code = bundle.outputFiles[0].text;

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: SIZE });
await page.setContent(`<body style="margin:0;background:transparent"><canvas id="c" width="${SIZE.width}" height="${SIZE.height}" style="width:${SIZE.width}px;height:${SIZE.height}px"></canvas></body>`);
const frames = await page.evaluate(async ({ code, frames, fps }) => {
  const M = await import(`data:text/javascript;base64,${btoa(unescape(encodeURIComponent(code)))}`);
  const canvas = document.getElementById('c');
  const renderer = new M.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  const scene = new M.Scene();
  const camera = new M.PerspectiveCamera(24, canvas.width / canvas.height, 0.1, 20);
  camera.position.set(0, 0.6, 3.3);
  camera.lookAt(0, 0.56, 0);
  const muse = M.createMuse3D();
  muse.object.rotation.y = 0.15;
  scene.add(muse.object);
  const look = new M.Vector3();
  const out = [];
  for (let i = 0; i < frames; i++) {
    const t = i / fps;
    if (i === 3) muse.wave();
    // Looks at you, then left, then right, then back.
    const x = t < 1.4 ? 0 : t < 2.1 ? -2 : t < 2.6 ? 2 : 0;
    look.set(x, 0.8, 3);
    muse.update(1 / fps, 'idle', look);
    renderer.render(scene, camera);
    out.push(canvas.toDataURL('image/png').split(',')[1]);
  }
  return out;
}, { code, frames: FRAMES, fps: FPS });
await browser.close();

// An animated PNG from the frames: the first frame's header, then each frame's image data in turn.
const chunks = (png) => {
  const list = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    list.push({ type: png.toString('latin1', at + 4, at + 8), data: png.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  return list;
};
const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0);
  return Buffer.concat([head, data, crc]);
};
const pngs = frames.map((b64) => Buffer.from(b64, 'base64'));
const first = chunks(pngs[0]);
const ihdr = first.find((c) => c.type === 'IHDR').data;
const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr)];
const actl = Buffer.alloc(8);
actl.writeUInt32BE(pngs.length, 0);
parts.push(chunk('acTL', actl));
let seq = 0;
pngs.forEach((png, i) => {
  const fctl = Buffer.alloc(26);
  fctl.writeUInt32BE(seq++, 0);
  fctl.writeUInt32BE(ihdr.readUInt32BE(0), 4);
  fctl.writeUInt32BE(ihdr.readUInt32BE(4), 8);
  fctl.writeUInt16BE(1, 20); // delay: 1 / FPS seconds
  fctl.writeUInt16BE(FPS, 22);
  fctl[24] = 1; // clear to transparent before the next frame
  fctl[25] = 0;
  parts.push(chunk('fcTL', fctl));
  for (const c of chunks(png).filter((c) => c.type === 'IDAT')) {
    if (i === 0) parts.push(chunk('IDAT', c.data));
    else {
      const seqBuf = Buffer.alloc(4);
      seqBuf.writeUInt32BE(seq++);
      parts.push(chunk('fdAT', Buffer.concat([seqBuf, c.data])));
    }
  }
});
parts.push(chunk('IEND', Buffer.alloc(0)));
writeFileSync('../.github/assets/muse.png', Buffer.concat(parts));
console.log(`wrote .github/assets/muse.png (${FRAMES} frames)`);
