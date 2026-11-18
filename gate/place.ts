// The placement solver as a command (src/place.ts): a scene plan in, a place for every thing out.
// JSON in on stdin: { mode?: 'desk' | 'world', things: { name: { role, size: [w, h, d], count?, lift? } }, relations?: [[thing, relation, target, value?]] }
// JSON out: { ok: true, mode, places: { name: { position: [x, y, z], turn } | [...] }, notes, map } or { ok: false, mode, error, notes }
import { solve, type Layout } from './src/place.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

let out: Layout;
try {
  out = solve(JSON.parse((await readStdin()) || '{}'));
} catch (err) {
  out = { ok: false, mode: 'desk', error: `The solver failed: ${(err as Error).message}`, notes: [] };
}
process.stdout.write(JSON.stringify(out));
