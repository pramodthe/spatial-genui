// Check a low-poly lesson (gate, hands, low-poly rules): node /skills/looks/low-poly/scripts/check.mjs [/work/module.js]
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const shared = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'shared', 'scripts', 'check.mjs');
const run = spawnSync('node', [shared, 'low-poly', ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(run.status ?? 1);
