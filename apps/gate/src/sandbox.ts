import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { AssetStub, DryRunResult } from './dryrun.js';

/**
 * Executes agent-written code in a separate, locked-down Node process.
 *
 * Node's `vm` is not a security boundary: generated code can reach the host's `Function` through
 * any object we pass in (e.g. `ui[c](...)` with `c = 'constr' + 'uctor'`) and read `process.env`,
 * where our API keys live. Static checks can't rule that out (`obj[variable]` is normal code), so
 * the dry run runs in a child process with no environment variables, file reads limited to this
 * app's own code (not the repo's .env), no file writes or child processes, and a hard kill on timeout.
 */

const SERVER_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHILD_SOURCE = fileURLToPath(new URL('./sandbox-child.ts', import.meta.url));
const CHILD_BUNDLE = fileURLToPath(new URL('../.cache/sandbox-child.mjs', import.meta.url));
const KILL_AFTER_MS = 15_000;

let bundled: Promise<void> | null = null;

/** The child runs plain JavaScript: tsx can't work under the permission model (it probes paths outside SERVER_ROOT). */
function ensureBundle(): Promise<void> {
  bundled ??= (async () => {
    mkdirSync(fileURLToPath(new URL('../.cache/', import.meta.url)), { recursive: true });
    await build({
      entryPoints: [CHILD_SOURCE],
      outfile: CHILD_BUNDLE,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      // Resolved from this app's node_modules, which the sandbox may read.
      external: ['three', '@drawcall/uikitml'],
      logLevel: 'silent',
    });
  })();
  return bundled;
}

export async function dryRun(transformed: string, assets: Record<string, AssetStub> = {}): Promise<DryRunResult> {
  await ensureBundle();
  if (!existsSync(CHILD_BUNDLE)) return { ok: false, error: 'Sandbox bundle missing.' };

  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['--experimental-permission', `--allow-fs-read=${SERVER_ROOT}`, '--no-warnings', CHILD_BUNDLE],
      { env: {}, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), KILL_AFTER_MS);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(stdout) as DryRunResult);
      } catch {
        const reason = signal === 'SIGKILL' ? `killed after ${KILL_AFTER_MS / 1000} s` : `exit ${code}: ${stderr.trim().split('\n').slice(-2).join(' ')}`;
        resolve({ ok: false, error: `Sandbox failed (${reason}).` });
      }
    });
    child.stdin.end(JSON.stringify({ transformed, assets }));
  });
}
