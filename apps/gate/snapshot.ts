// Live preview of a module still being written (src/snapshot.ts): its runnable prefix, through the same gate.
// JSON in on stdin: { reply, knownAssets?: string[] }   (reply: the model's text so far)
// JSON out: { ok, code?, meshes?, error? }
import { assetStubs } from './src/library.js';
import { dryRun } from './src/sandbox.js';
import { runnablePrefix } from './src/snapshot.js';
import { validateModule } from './src/validate.js';

type SnapshotOut = { ok: boolean; code?: string; meshes?: number; error?: string };

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  let out: SnapshotOut;
  try {
    const body = JSON.parse((await readStdin()) || '{}') as { reply?: unknown; knownAssets?: unknown };
    const code = runnablePrefix(typeof body.reply === 'string' ? body.reply : '');
    if (!code) {
      out = { ok: false, error: 'nothing runnable yet' };
    } else {
      // Like the final gate: no assets unless the caller lists them, so a preview never shows what it would reject.
      const known = new Set<string>(Array.isArray(body.knownAssets)
        ? body.knownAssets.filter((id): id is string => typeof id === 'string')
        : []);
      const validation = validateModule(code, known);
      if (!validation.ok) {
        out = { ok: false, error: validation.error };
      } else {
        const run = await dryRun(validation.transformed, assetStubs(validation.assets));
        out = run.ok
          ? { ok: true, code, meshes: Number((run.stats as { meshes?: number } | undefined)?.meshes ?? 0) }
          : { ok: false, error: run.error };
      }
    }
  } catch (err) {
    out = { ok: false, error: `Snapshot failed: ${(err as Error).message}` };
  }
  process.stdout.write(JSON.stringify(out));
}

await main();
