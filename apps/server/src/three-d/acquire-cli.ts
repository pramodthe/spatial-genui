// Get one object into the library through the on-demand path (acquire.ts), from the command line: for
// testing the path, and for building library models ahead of time.
// Usage: npm run assets:acquire -- --name microscope --describe "A compound light microscope on a desk" [--parts eyepiece,stage] [--top 6] [--no-search]
// --no-search skips the Objaverse search and generates the model with TRELLIS.2.
import { parseCli } from '../args.js';
import { acquireAsset } from './acquire.js';
import { closeRenderer } from './render.js';

const cli = parseCli(process.argv.slice(2), {
  values: ['name', 'describe', 'parts', 'top'],
  booleans: ['no-search'],
  usage: 'npm run assets:acquire -- --name <object> --describe "<one line>" [--parts a,b] [--top n] [--no-search]',
});
if (!cli.flags.name) {
  console.error('Usage: npm run assets:acquire -- --name <object> --describe "<one line>" [--parts a,b] [--top n]');
  process.exit(1);
}
const started = Date.now();
const result = await acquireAsset(
  { name: cli.flags.name, describe: cli.flags.describe ?? cli.flags.name, parts: cli.flags.parts?.split(',').map((p) => p.trim()).filter(Boolean) },
  (event) => console.error(`[${((Date.now() - started) / 1000).toFixed(0).padStart(4)} s] ${event.stage}: ${event.message}`),
  { top: cli.flags.top ? Number(cli.flags.top) : undefined, search: !cli.booleans.has('no-search') },
);
console.log(JSON.stringify(result));
await closeRenderer();
process.exit(result.ok ? 0 : 1);
