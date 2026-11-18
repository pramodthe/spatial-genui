// Writes public/ui/muse.svg, the dashboard panel's first picture of Muse, from the mascot's own drawing
// (src/genui/mascot.ts). Run it again when the drawing changes: node scripts/write-muse.mjs
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';

const out = await build({ entryPoints: ['src/genui/mascot.ts'], bundle: true, format: 'esm', write: false, platform: 'neutral' });
const { mascotSvg } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
writeFileSync('public/ui/muse.svg', `${mascotSvg()}\n`);
console.log('wrote public/ui/muse.svg');
