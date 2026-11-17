// Host gate and in-sandbox check: static validation plus the locked-down dry run.
// JSON in on stdin: { code, knownAssets?: string[], assetIds?: string[], short?: boolean }
// JSON out: { ok, stage?, stats?, warnings?, error?, errorFile? }
// `short` keeps a long error out of the reply (the dry-run skill); the host writer leaves it off
// so a repair sees the whole error.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetStubs, libraryCatalog } from './src/library.js';
import { dryRun } from './src/sandbox.js';
import { validateModule } from './src/validate.js';

const SHORT_AT = 2000;
const CACHE = fileURLToPath(new URL('./.cache/', import.meta.url));

type GateOut = {
  ok: boolean;
  stage?: 'validate' | 'dry-run';
  stats?: unknown;
  warnings?: string[];
  error?: string;
  errorFile?: string;
};

function present(error: string, short: boolean): { error: string; errorFile?: string } {
  if (!short || error.length <= SHORT_AT) return { error };
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, `error-${Date.now().toString(36)}.txt`);
  writeFileSync(file, error);
  return {
    error: `${error.slice(0, SHORT_AT)}\n… (${error.length} characters; full output: ${file})`,
    errorFile: file,
  };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  let out: GateOut;
  try {
    const body = JSON.parse((await readStdin()) || '{}') as {
      code?: unknown; knownAssets?: unknown; assetIds?: unknown; short?: unknown;
    };
    const code = typeof body.code === 'string' ? body.code : '';
    const short = body.short === true;
    const known = new Set<string>(Array.isArray(body.knownAssets)
      ? body.knownAssets.filter((id): id is string => typeof id === 'string')
      : [...libraryCatalog().keys()]);
    const validation = validateModule(code, known);
    if (!validation.ok) {
      out = { ok: false, stage: 'validate', ...present(validation.error, short) };
    } else {
      const ids = Array.isArray(body.assetIds)
        ? body.assetIds.filter((id): id is string => typeof id === 'string')
        : validation.assets;
      const run = await dryRun(validation.transformed, assetStubs(ids));
      if (!run.ok) out = { ok: false, stage: 'dry-run', ...present(run.error, short) };
      else out = { ok: true, stats: run.stats, warnings: run.warnings };
    }
  } catch (err) {
    out = { ok: false, stage: 'dry-run', error: `Gate failed: ${(err as Error).message}` };
  }
  process.stdout.write(JSON.stringify(out));
}

await main();
