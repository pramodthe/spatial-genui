// Place the scene plan: reads /work/parts/scene.js (SCENE: what stands in the scene and how the things stand to each
// other), asks the app's placement solver for a place for every thing, and writes them under it as PLACES. Prints
// the layout from above and the solver's notes. When the plan cannot be placed it says which thing and why, and
// exits 1. Usage: node layout.mjs [/work/module.js]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

export const PLACES_START = '// ---- places (written by scripts/layout.mjs from SCENE above: never edit) ----';
export const PLACES_END = '// ---- end of places ----';

/** A short mark of a plan, kept with its places: a plan changed since then has to be placed again. */
export const stampOf = (scene) => createHash('sha256').update(JSON.stringify(scene)).digest('hex').slice(0, 12);

/** A scene part: its SCENE, the PLACES under it (or null), and whether those were solved from this SCENE. */
export function readScene(file) {
  const code = readFileSync(file, 'utf8');
  const box = vm.createContext({});
  vm.runInContext(`${code}\n;globalThis.__scene = typeof SCENE === 'undefined' ? null : SCENE; globalThis.__places = typeof PLACES === 'undefined' ? null : PLACES;`, box, { timeout: 2000 });
  const scene = box.__scene ? JSON.parse(JSON.stringify(box.__scene)) : null;
  const stamp = (code.match(/^\/\/ plan: ([0-9a-f]{12})$/m) ?? [])[1] ?? null;
  return { code, scene, places: box.__places ? JSON.parse(JSON.stringify(box.__places)) : null, fresh: Boolean(scene) && stamp === stampOf(scene) };
}

/** Solve the plan in a scene part and write its places back. Returns { ok, text }: the text is for the coder. */
export function layoutScene(file) {
  let part;
  try {
    part = readScene(file);
  } catch (err) {
    return { ok: false, text: `${file} does not run: ${String(err?.message ?? err).slice(0, 200)}` };
  }
  if (!part.scene) return { ok: false, text: `${file} must define const SCENE = { mode, things, relations } (references/scene.md).` };
  const tsx = process.env.GATE_TSX || 'tsx';
  const solver = process.env.GATE_PLACE || (process.env.GATE_ENTRY ? join(dirname(process.env.GATE_ENTRY), 'place.ts') : '/opt/gate/place.ts');
  const child = spawnSync(tsx, [solver], { input: JSON.stringify(part.scene), encoding: 'utf8' });
  let layout;
  try {
    layout = JSON.parse(child.stdout);
  } catch {
    return { ok: false, text: `The placement solver did not answer (${child.error?.message ?? child.stderr?.trim().split('\n').pop() ?? 'no output'}).` };
  }
  // A plan that cannot be placed leaves the last places as they were (the game still builds while the plan is
  // mended); the check then says the plan has changed since it was placed.
  if (!layout.ok) return { ok: false, text: `LAYOUT: not placed.\n${layout.error}${layout.notes?.length ? `\n${layout.notes.join('\n')}` : ''}` };
  // Each place carries the size it was solved for, so sceneAt can stand the thing on its base.
  const places = Object.fromEntries(Object.entries(layout.places).map(([name, placed]) => {
    const size = part.scene.things[name].size;
    return [name, Array.isArray(placed) ? placed.map((p) => ({ ...p, size })) : { ...placed, size }];
  }));
  const at = part.code.indexOf(PLACES_START);
  const head = (at < 0 ? part.code : part.code.slice(0, at)).replace(/\n+$/, '');
  writeFileSync(file, `${head}\n${PLACES_START}\n// plan: ${stampOf(part.scene)}\nconst PLACES = ${JSON.stringify(places)};\n${PLACES_END}\n`);
  const count = Object.values(places).reduce((sum, p) => sum + (Array.isArray(p) ? p.length : 1), 0);
  const lines = Object.entries(places).map(([name, p]) => `  ${name}: ${Array.isArray(p) ? `${p.length} places, the first at` : 'at'} (${(Array.isArray(p) ? p[0] : p).position.join(', ')})`);
  return { ok: true, text: [`layout ok: ${count} things placed (${layout.mode}). From above, the far side at the top:`, layout.map, ...lines, ...layout.notes.map((n) => `NOTE: ${n}`)].join('\n') };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const module = process.argv[2] ?? '/work/module.js';
  const file = join(dirname(module), 'parts', 'scene.js');
  if (!existsSync(file)) {
    console.log(`${file} is not there: this game has no scene plan.`);
    process.exit(1);
  }
  const result = layoutScene(file);
  console.log(result.text);
  process.exit(result.ok ? 0 : 1);
}
