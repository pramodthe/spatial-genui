// Start a circuit-city lesson: node /skills/looks/circuit-city/scripts/new-lesson.mjs [/work/module.js] [--force]
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const shared = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'shared', 'scripts', 'new-lesson.mjs');
const run = spawnSync('node', [shared, 'circuit-city', ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(run.status ?? 1);
