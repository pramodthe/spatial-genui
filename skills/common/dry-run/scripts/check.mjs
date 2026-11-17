// Runs the gate on one module. Absolute path: the execute working directory is not guaranteed.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const file = process.argv[2] || '/work/module.js';
const code = readFileSync(file, 'utf8');
const tsx = process.env.GATE_TSX || 'tsx';
const gate = process.env.GATE_ENTRY || '/opt/gate/gate.ts';
const child = spawnSync(tsx, [gate], {
  input: JSON.stringify({ code, short: true }),
  encoding: 'utf8',
});
// The gate did not start at all (no tsx, or no gate at GATE_ENTRY): say so rather than exit 1 in silence.
if (child.error) {
  process.stderr.write(`The gate did not start: ${child.error.message}\n`);
  process.exit(1);
}
process.stdout.write(child.stdout || '');
if (child.stderr) process.stderr.write(child.stderr);
process.exit(child.status ?? 1);
