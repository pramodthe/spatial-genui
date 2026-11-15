import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The 3D asset library (tier A of docs/3d-architecture.md): accurate models with named parts, built
 * by apps/worker3d/library from authoritative data. Generated modules use them via `assets.get(id)`.
 * Files: <LIBRARY_DIR>/catalog/<id>.json and <LIBRARY_DIR>/assets/<id>.glb.
 */

export const LIBRARY_DIR = process.env.LIBRARY_DIR || fileURLToPath(new URL('../../../data/library/', import.meta.url));

export type LibraryPart = {
  node: string;
  name: string;
  group?: string | null;
  fma?: string[];
  centroid: [number, number, number];
  labelAnchor: [number, number, number];
  explodeDir: [number, number, number];
  triangles: number;
  /** A part that moves in the real object (rotate about its pivot, or slide along its axis). */
  motion?: { type: 'rotate' | 'slide'; axis: [number, number, number]; range: [number, number]; unit?: string };
  pivot?: [number, number, number];
  teeth?: number;
};

export type LibraryEntry = {
  id: string;
  title: string;
  tier: string;
  kind?: string;
  keywords?: string[];
  sizeM: [number, number, number];
  triangles: number;
  parts: LibraryPart[];
  licence: string;
  credit: string;
};

let cache: { mtimeMs: number; entries: Map<string, LibraryEntry> } | null = null;

/**
 * Every catalogued asset whose GLB exists. Re-read when the catalogue folder changes, so a model
 * built by any process (the router builds molecules on demand) is seen by all of them.
 */
export function libraryCatalog(): Map<string, LibraryEntry> {
  const dir = join(LIBRARY_DIR, 'catalog');
  const mtimeMs = existsSync(dir) ? statSync(dir).mtimeMs : 0;
  if (cache?.mtimeMs === mtimeMs) return cache.entries;
  const entries = new Map<string, LibraryEntry>();
  if (mtimeMs) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      const entry = JSON.parse(readFileSync(join(dir, file), 'utf8')) as LibraryEntry;
      if (existsSync(join(LIBRARY_DIR, 'assets', `${entry.id}.glb`))) entries.set(entry.id, entry);
    }
  }
  cache = { mtimeMs, entries };
  return entries;
}

export function assetPath(id: string): string | null {
  return /^[a-z0-9-]+$/.test(id) && libraryCatalog().has(id) ? join(LIBRARY_DIR, 'assets', `${id}.glb`) : null;
}

/** Short attribution for panels, e.g. "Model: BodyParts3D, CC BY 4.0". */
export function shortCredit(entry: LibraryEntry): string {
  return `Model: ${entry.credit.split(',')[0]}, ${entry.licence}`;
}

/** The library part of the system prompt, for the given assets (default: the whole catalogue). */
export function librarySection(ids?: string[]): string {
  const catalog = libraryCatalog();
  const entries = ids ? ids.flatMap((id) => (catalog.has(id) ? [catalog.get(id)!] : [])) : [...catalog.values()];
  if (entries.length === 0) return '';
  const list = entries.map((e) => {
    const size = e.sizeM.map((m) => Math.round(m * 100)).join(' x ');
    const notes = (e as LibraryEntry & { provenance?: { notes?: string[] } }).provenance?.notes ?? [];
    const moving = e.parts.filter((p) => p.motion).map((p) => `${p.node} (${p.motion!.type === 'rotate' ? 'turns' : 'slides'}${p.teeth ? `, ${p.teeth} teeth` : ''})`);
    return `- '${e.id}': ${e.title}, ${size} cm. Parts: ${e.parts.map((p) => p.node).join(', ')}.${moving.length ? ` Moving parts: ${moving.join(', ')}.` : ''}${notes.length ? ` Notes: ${notes.join(' ')}` : ''}`;
  });
  // Several models (e.g. the molecules of a reaction): the host preloads only ids written as literals.
  const several = entries.length > 1
    ? `\nThis lesson has ${entries.length} models: get each one with its own call and its id written out (\`const second = assets.get('${entries[1].id}');\`), never in a loop over ids, and set them side by side along x with a gap between them.`
    : '';
  // Only models with moving parts get the move() lines: on any other model the call is an error.
  const moveDocs = entries.some((e) => e.parts.some((p) => p.motion))
    ? `
engine.move('piston', (1 - Math.cos(time * 2)) / 2); // moving parts only (listed above): 0..1 sweeps the motion; call it in update(time)
gears.move('drive_gear', time / 4);    // a turning part keeps turning as t grows past 1`
    : '';
  return `

## Accurate 3D models from the library
Use these models for the objects they show instead of building those from shapes: they come from real scan or measurement data, so they are scientifically accurate, and every part is a separate, named mesh. If a model's notes say it is not to scale, say so in the lesson. Everything else in the lesson (panels, extra shapes, effects) is yours to build with the kit.
${list.join('\n')}${several}

How to use one (the id must be written as a string; the host loads the model before build() runs):
\`\`\`js
const heart = assets.get('heart-bp3d');
root.add(heart.object3D);              // add it to root first; real size in metres, standing on y = 0, front facing the user (+Z)
heart.object3D.scale.setScalar(1.6);   // scale it 1.5-2x so its parts are easy to see and grab
heart.labelParts(['left_ventricle', 'aortic_valve']); // labels with leader lines, placed beside the model by the host so they never overlap
heart.label('mitral_valve', 'Mitral valve');           // one label, optional custom text; returns { object3D, set(text), setVisible(bool) }
heart.explode(0.6);                    // 0 = assembled, 1 = parts spread apart; call it every frame in update() to animate
heart.cutaway(true);                   // slice away the half facing the user to show the inside (follows the model as it turns); cutaway(false) closes it
heart.xray(true, ['mitral_valve']);    // everything see-through except the listed parts; xray(false) makes it solid
heart.highlight('left_ventricle');     // make one part glow; highlight(null) clears it
heart.reset();                         // assembled, solid, no highlight, pulled-out parts back in place${moveDocs}
traits(heart.part('aortic_valve'), { grab: true }); // let the learner pull one part out by hand
heart.parts;                           // [{ id, name, group, object3D, labelAnchor, explodeDir }] for every part
heart.anchor('left_ventricle');        // THREE.Vector3 on the part's outside, in root's coordinates
heart.credit;                          // short attribution, e.g. "Model: BodyParts3D, CC BY 4.0"
\`\`\`
Use these tools instead of building your own label panels or moving parts by hand: the host places labels and moves parts correctly. Layout: the model is already upright and facing the user, so keep it centred at x = 0 and don't rotate it. The host arranges a library lesson for you: labels go in two columns beside the model, your main panel (the one you place highest) goes centred above them, and any other panels stack beyond the labels on the side you put them. So keep it to one main panel with the lesson text and buttons, plus at most one side panel (e.g. a quiz). Wire them to panel buttons (e.g. "Explode", "Cut open", "X-ray", "Reset"). Show at most 6 labels at a time: label the parts of the current step and use setVisible() to swap labels as the learner moves through the lesson, so the model is never buried in labels. Put the asset's credit as the last line of your main panel.`;
}

/** Lightweight stand-ins for the dry run: named, positioned parts without the real meshes. */
export function assetStubs(ids: string[]): Record<string, LibraryEntry & { creditShort: string }> {
  const catalog = libraryCatalog();
  return Object.fromEntries(ids.filter((id) => catalog.has(id)).map((id) => {
    const entry = catalog.get(id)!;
    return [id, { ...entry, creditShort: shortCredit(entry) }];
  }));
}
