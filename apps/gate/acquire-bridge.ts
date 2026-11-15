// One acquire job, driven by the Python API. The stage functions (reference picture, retrieval,
// naming, the Node GLB renderer) live in src/three-d; this process
// only runs them and prints newline-delimited JSON: event lines, then { "type": "result", "result" }.
import { acquireAsset, type AcquireEvent, type AcquireOptions, type AssetWanted } from './src/three-d/acquire.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const body = JSON.parse((await readStdin()) || '{}') as { wanted?: AssetWanted; options?: AcquireOptions };
const wanted = body.wanted;
if (!wanted || typeof wanted.name !== 'string') {
  process.stdout.write(JSON.stringify({ type: 'result', result: { ok: false, error: 'Send { wanted: { name, describe, parts? } }.', stage: 'reference', ms: 0 } }) + '\n');
  process.exit(0);
}
const line = (data: unknown) => process.stdout.write(JSON.stringify(data) + '\n');
const result = await acquireAsset(wanted, (event: AcquireEvent) => line({ type: 'event', event }), body.options ?? {});
line({ type: 'result', result });
