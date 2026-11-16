// Runs inside the locked-down sandbox process (see sandbox.ts): reads a transformed module from
// stdin, executes the dry run, and writes the result as JSON to stdout. Never import this file.
import { dryRunUnsafe } from './dryrun.js';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  let result;
  try {
    const { transformed, assets } = JSON.parse(input);
    result = dryRunUnsafe(transformed, assets ?? {});
  } catch (err) {
    result = { ok: false, error: `Dry run crashed: ${(err as Error).message}` };
  }
  process.stdout.write(JSON.stringify(result));
});
