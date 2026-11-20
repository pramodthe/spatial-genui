// Makes the starter project every trial game is cloned from, once: IWSDK's own scaffold at the headset app's
// version (VR, hands, grabbing, walking), on the trial's port, with IWSDK's agent guidance (AGENTS.md, the nested
// AGENTS.md files and .agents/skills, which pi reads) and without the other coding tools' files. Then a smoke test
// with no model: the runtime comes up, enters XR, takes a picture, and the project builds.
// Usage: node runner/make-template.mjs [--no-smoke]
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { consoleErrors, down, enterXR, screenshot, up } from './iwsdk.mjs';
import { ARCHIVE, IWSDK_VERSION, PORT, TEMPLATE } from './paths.mjs';
import { installSounds } from './sound-library.mjs';

// What the scaffold writes for Claude Code, Cursor, Codex, Copilot and OpenCode; pi needs none of it.
const OTHER_TOOLS = ['CLAUDE.md', '.claude', '.cursor', '.codex', '.github', '.vscode', '.mcp.json', 'opencode.json'];
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16);

mkdirSync(ARCHIVE, { recursive: true });
if (!existsSync(join(TEMPLATE, 'package.json'))) {
  console.log(`Scaffolding IWSDK ${IWSDK_VERSION} into ${TEMPLATE} (installs about 760 MB) ...`);
  const made = spawnSync('npx', ['--yes', `@iwsdk/create@${IWSDK_VERSION}`, 'template', '--yes', '--target', 'vr', '--language', 'ts',
    '--locomotion', '--grabbing', '--no-physics', '--no-git', '--install'], { cwd: ARCHIVE, stdio: 'inherit' });
  if (made.status !== 0) throw new Error('The IWSDK scaffold failed.');
}

for (const name of OTHER_TOOLS) rmSync(join(TEMPLATE, name), { recursive: true, force: true });
rmSync(join(TEMPLATE, '.iwsdk', 'runtime'), { recursive: true, force: true });

const viteFile = join(TEMPLATE, 'vite.config.ts');
const vite = readFileSync(viteFile, 'utf8');
if (!/port:\s*\d+/.test(vite)) throw new Error('vite.config.ts has no server port to set.');
writeFileSync(viteFile, vite.replace(/port:\s*\d+/, `port: ${PORT}`));

const config = JSON.parse(readFileSync(join(TEMPLATE, 'iwsdk.config.json'), 'utf8'));
const xr = config.world?.xr ?? {};
if (xr.mode !== 'vr' || xr.offer !== 'always' || xr.features?.handTracking !== true) {
  throw new Error(`iwsdk.config.json is not VR with hands offered always: ${JSON.stringify(xr)}`);
}
for (const needed of ['AGENTS.md', 'src/AGENTS.md', '.agents/skills/iwsdk-dev/SKILL.md']) {
  if (!existsSync(join(TEMPLATE, needed))) throw new Error(`The scaffold has no ${needed}.`);
}

// The repo's own sounds, as files every game has (skills/xr-game-studio/references/sounds.md is their catalogue).
console.log(`${installSounds(TEMPLATE)} library sounds in public/audio/library`);

// The check refuses a game whose package.json or vite.config.ts changed (the agent may not touch them).
const stamp = { iwsdk: IWSDK_VERSION, port: PORT, packageJson: hash(join(TEMPLATE, 'package.json')), viteConfig: hash(viteFile) };
writeFileSync(join(TEMPLATE, '.pi-xr-template.json'), `${JSON.stringify(stamp, null, 1)}\n`);
console.log(`template ready: VR, hands, port ${PORT}`);

if (!process.argv.includes('--no-smoke')) {
  const fail = (text) => { down(TEMPLATE); console.log(`SMOKE FAILED: ${text}`); process.exit(1); };
  if (!(await up(TEMPLATE, { window: false }))) fail('the runtime did not come up (iwsdk dev status)');
  const xrIn = await enterXR(TEMPLATE);
  if (!xrIn.ok) fail(`XR was not entered: ${xrIn.error}`);
  const shot = screenshot(TEMPLATE, join(ARCHIVE, 'template-smoke.png'));
  const errors = consoleErrors(TEMPLATE);
  down(TEMPLATE);
  const built = spawnSync('npm', ['run', 'build'], { cwd: TEMPLATE, encoding: 'utf8' });
  rmSync(join(TEMPLATE, 'dist'), { recursive: true, force: true });
  rmSync(join(TEMPLATE, '.iwsdk', 'runtime'), { recursive: true, force: true });
  if (built.status !== 0) fail(`npm run build failed: ${(built.stdout + built.stderr).slice(-400)}`);
  console.log(`smoke ok: entered XR, built, ${errors.length} console error(s), picture ${shot}`);
  for (const e of errors) console.log(`  console: ${e}`);
}
