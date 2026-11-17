// Join the game's parts (/work/parts: identity.js, sounds.js, any other
// *.js) into the module's parts block, above the game's code, and check each part's shape. The check runs this
// first, so the module always carries the latest parts. Usage: node assemble.mjs [/work/module.js] [--check]
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

export const PARTS_START = '// ---- parts (from /work/parts, joined by scripts/assemble.mjs: edit the part files, not this block) ----';
export const PARTS_END = '// ---- end of parts ----';
const HEX = /^#[0-9a-fA-F]{6}$/;
const CLIP_ID = /^(snd|mus)-[0-9a-f]{10}$/;
const EFFECTS = new Set(['pop', 'click', 'good', 'bad', 'whoosh', 'tick', 'win', 'coin', 'bounce', 'splash']);

/** Problems with one part's values (empty when it is fine). */
function partProblems(name, code) {
  const problems = [];
  let value;
  try {
    const box = vm.createContext({});
    vm.runInContext(`${code}\n;globalThis.__part = (typeof IDENTITY !== 'undefined' && '${name}' === 'identity') ? IDENTITY : (typeof SOUNDS !== 'undefined' && '${name}' === 'sounds') ? SOUNDS : undefined;`, box, { timeout: 500 });
    value = box.__part;
  } catch (err) {
    return [`parts/${name}.js does not run: ${String(err?.message ?? err).slice(0, 200)}`];
  }
  if (name === 'identity') {
    if (!value) return ['parts/identity.js must define const IDENTITY = { title, eyebrow, pitch, skin, resultSign }.'];
    if (typeof value.title !== 'string' || value.title.trim().split(/\s+/).length > 4) problems.push('IDENTITY.title: the game\'s name, 1 to 4 words.');
    if (typeof value.pitch !== 'string' || value.pitch.trim().split(/\s+/).length > 22) problems.push('IDENTITY.pitch: the whole game in one sentence of about 15 words.');
    for (const key of ['skin', 'resultSign']) {
      const colours = value[key];
      if (!colours || typeof colours !== 'object') { problems.push(`IDENTITY.${key} is missing.`); continue; }
      for (const [k, v] of Object.entries(colours)) if (k !== 'round' && k !== 'poster' && !HEX.test(String(v))) problems.push(`IDENTITY.${key}.${k}: write colours as "#rrggbb" (got ${JSON.stringify(v)}).`);
    }
  }
  if (name === 'sounds') {
    if (!value) return ['parts/sounds.js must define const SOUNDS = { event: [effect, options], ... }.'];
    const check = (event, entry) => {
      if (Array.isArray(entry) && typeof entry[0] === 'string') { if (!EFFECTS.has(entry[0])) problems.push(`SOUNDS.${event}: no effect "${entry[0]}" (${[...EFFECTS].join(', ')}).`); return; }
      if (Array.isArray(entry)) { entry.forEach((e) => check(event, e)); return; }
      if (entry && (typeof entry.note === 'string' || typeof entry.tone === 'number')) return;
      if (entry && typeof entry.clip === 'string') {
        if (!CLIP_ID.test(entry.clip)) problems.push(`SOUNDS.${event}: clip "${entry.clip}" is not an id make_sound or make_music returned.`);
        return;
      }
      problems.push(`SOUNDS.${event}: an entry is [effect, options], { note: 'C4' }, { tone: 440 } or { clip: id }.`);
    };
    for (const [event, entry] of Object.entries(value)) check(event, entry);
  }
  return problems;
}

/** Rewrite the module's parts block from the part files; returns the problems found. */
export function assembleParts(file) {
  const dir = join(dirname(file), 'parts');
  const order = ['identity.js', 'sounds.js'];
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.js')).sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b)) : [];
  // A module copied away from its parts (a saved game, a test copy) keeps the block it already has.
  if (!names.length) return [];
  const problems = [];
  const blocks = names.map((n) => {
    const code = readFileSync(join(dir, n), 'utf8').trim();
    problems.push(...partProblems(n.replace(/\.js$/, ''), code));
    return code;
  });
  const module = readFileSync(file, 'utf8');
  const start = module.indexOf(PARTS_START);
  const end = module.indexOf(PARTS_END);
  if (start < 0 || end < start) return ['The module has no parts block: start it with scripts/new-game.mjs.'];
  writeFileSync(file, `${module.slice(0, start)}${PARTS_START}\n${blocks.join('\n\n')}\n${module.slice(end)}`);
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '/work/module.js';
  const problems = assembleParts(file);
  for (const p of problems) console.log(`FIX: ${p}`);
  if (!problems.length) console.log('parts ok');
  process.exit(problems.length ? 1 : 0);
}
