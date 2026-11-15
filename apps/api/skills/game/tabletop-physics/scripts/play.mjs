// The gate's dry run already steps update() for ten frames with a simulated right hand.
// This prints that result so a game can see whether anything moved.
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
process.stdout.write(child.stdout || child.stderr || '');
process.exit(child.status ?? 1);
