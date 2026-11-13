// Look-and-fix, by hand: show the agent pictures of a lesson it wrote and let it revise the lesson once.
// Usage: npm run review -- --code lesson.js --prompt "the request" --out revised.js picture.jpg [picture.jpg ...]
// Pictures come from the lesson camera (apps/xr/tests/capture-module.mjs).
import { readFile, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { generate } from './agent.js';
import { parseCli } from './args.js';

const cli = parseCli(process.argv.slice(2), {
  values: ['code', 'prompt', 'out'],
  usage: 'npm run review -- --code lesson.js --prompt "the request" --out revised.js picture.jpg [picture.jpg ...]',
});
const { code, prompt, out } = cli.flags;
if (!code || !prompt || !out || cli.positional.length === 0) {
  console.error('Usage: npm run review -- --code lesson.js --prompt "the request" --out revised.js picture.jpg [picture.jpg ...]');
  process.exit(1);
}
const pictures = await Promise.all(cli.positional.map(async (file) =>
  `data:image/${extname(file).toLowerCase() === '.png' ? 'png' : 'jpeg'};base64,${(await readFile(file)).toString('base64')}`));
const result = await generate(prompt, { previousCode: await readFile(code, 'utf8'), pictures, library: false });
if (result.ok && result.code) await writeFile(out, result.code);
const { code: _code, ...summary } = result;
console.log(JSON.stringify(summary, null, 2));
process.exit(result.ok ? 0 : 1);
