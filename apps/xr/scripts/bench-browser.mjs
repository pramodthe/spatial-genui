// Run tests/bench-browser.mjs in batches until every successful generation in a results
// directory has been mounted and probed (each managed-browser lease is time-limited).
// Usage: node scripts/bench-browser.mjs /abs/path/to/bench/results/<name>
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const dir = process.argv[2] && resolve(process.argv[2]);
if (!dir) {
  console.error('Usage: node scripts/bench-browser.mjs <results dir>');
  process.exit(1);
}

for (let batch = 1; batch <= 200; batch++) {
  const res = spawnSync('npx', ['@iwsdk/cli', 'browser', 'run', 'tests/bench-browser.mjs', '--timeout', '105000'], {
    env: { ...process.env, GENUI_BENCH_DIR: dir },
    encoding: 'utf8',
  });
  let out;
  try {
    out = JSON.parse(res.stdout);
  } catch {
    console.error(res.stdout || res.stderr);
    process.exit(1);
  }
  const result = out?.data?.result;
  if (!out.ok || !result || result.error) {
    console.error(JSON.stringify(out.error ?? result, null, 2));
    process.exit(1);
  }
  console.error(`batch ${batch}: ${result.processed} processed, ${result.remaining} remaining`);
  if (result.remaining === 0) break;
  if (result.processed === 0) {
    console.error('No progress in this batch; stopping.');
    process.exit(1);
  }
}
