// The repo's own sound library (server/library/sounds: 30 effects and loops with a catalogue), made ready for the
// trial's games: each sound copied into a project's public/audio/library/ under its name, and the catalogue written
// as the skill reference the agent reads. No sound is generated.
// Usage: node runner/sound-library.mjs <project folder>     (also rewrites skills/xr-game-studio/references/sounds.md)
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRIAL } from './paths.mjs';

const LIBRARY = join(TRIAL, '..', '..', 'server', 'library', 'sounds');

export function catalogue() {
  const listed = JSON.parse(readFileSync(join(LIBRARY, 'catalog.json'), 'utf8'));
  return (Array.isArray(listed) ? listed : listed.sounds ?? []).filter((s) => existsSync(join(LIBRARY, `${s.id}.mp3`)));
}

/** Copy the library into a project as public/audio/library/<name>.mp3. Returns how many. */
export function installSounds(project) {
  const out = join(project, 'public', 'audio', 'library');
  mkdirSync(out, { recursive: true });
  const sounds = catalogue();
  for (const sound of sounds) copyFileSync(join(LIBRARY, `${sound.id}.mp3`), join(out, `${sound.name}.mp3`));
  return sounds.length;
}

export function soundsReference() {
  const sounds = catalogue();
  const rows = (kind) => sounds.filter((s) => s.kind === kind).map((s) => `| \`${s.name}\` | ${s.seconds} s | ${s.what} |`).join('\n');
  return `# The sound library

Every project has these sounds as files: \`public/audio/library/<name>.mp3\`. Nothing is generated; pick the nearest
fit, and leave an action without its own sound only when none fits. Register the ones the game uses in
\`src/assets.ts\` (or give an entity an \`AudioSource\` with \`src: './audio/library/<name>.mp3'\`) and play one with
\`AudioUtils.play(entity)\`. List each in the design's asset list with the action it answers.

A hand action should be heard as well as seen: one short effect per action, one for success, one for "try again",
and at most one quiet looping ambience for the place.

## Effects

| Name | Length | What it is |
|---|---|---|
${rows('effect')}

## Loops (ambience)

| Name | Length | What it is |
|---|---|---|
${sounds.filter((s) => s.kind !== 'effect').map((s) => `| \`${s.name}\` | ${s.seconds} s | ${s.what} |`).join('\n')}
`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const project = process.argv[2];
  writeFileSync(join(TRIAL, 'skills', 'xr-game-studio', 'references', 'sounds.md'), soundsReference());
  console.log(`sounds.md written (${catalogue().length} sounds)`);
  if (project) console.log(`${installSounds(resolve(project))} sounds copied into ${project}/public/audio/library`);
}
