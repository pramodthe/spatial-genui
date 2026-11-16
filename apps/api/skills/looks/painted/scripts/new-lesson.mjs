// Start a painted lesson: node /skills/looks/painted/scripts/new-lesson.mjs [/work/module.js] [--force]
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const shared = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'shared', 'scripts', 'new-lesson.mjs');
const run = spawnSync('node', [shared, 'painted', ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(run.status ?? 1);
