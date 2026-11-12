import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
};

export type LibraryEntry = {
  id: string;
  title: string;
  tier: string;
  sizeM: [number, number, number];
  triangles: number;
  parts: LibraryPart[];
  licence: string;
  credit: string;
};

let cache: Map<string, LibraryEntry> | null = null;
// Rebuilt catalogue files are picked up by restarting the server (tsx watch restarts on code edits only).

/** Every catalogued asset whose GLB exists. Read once per process. */
export function libraryCatalog(): Map<string, LibraryEntry> {
  if (cache) return cache;
  cache = new Map();
  const dir = join(LIBRARY_DIR, 'catalog');
  if (!existsSync(dir)) return cache;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const entry = JSON.parse(readFileSync(join(dir, file), 'utf8')) as LibraryEntry;
    if (existsSync(join(LIBRARY_DIR, 'assets', `${entry.id}.glb`))) cache.set(entry.id, entry);
  }
  return cache;
}

export function assetPath(id: string): string | null {
  return /^[a-z0-9-]+$/.test(id) && libraryCatalog().has(id) ? join(LIBRARY_DIR, 'assets', `${id}.glb`) : null;
}

/** Short attribution for panels, e.g. "Model: BodyParts3D, CC BY 4.0". */
export function shortCredit(entry: LibraryEntry): string {
  return `Model: ${entry.credit.split(',')[0]}, ${entry.licence}`;
}

/** The part of the system prompt that documents `assets` and lists what the library holds. */
export function librarySection(): string {
  const entries = [...libraryCatalog().values()];
  if (entries.length === 0) return '';
  const list = entries.map((e) => {
    const size = e.sizeM.map((m) => Math.round(m * 100)).join(' x ');
    return `- '${e.id}': ${e.title}, real size ${size} cm. Parts: ${e.parts.map((p) => p.node).join(', ')}.`;
  });
  return `

## Accurate 3D models from the library
When the request is about something in this list, use the library model instead of building it from shapes: it comes from real scan or measurement data, so it is scientifically accurate, and every part is a separate, named mesh.
${list.join('\n')}

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
heart.reset();                         // assembled, solid, no highlight, pulled-out parts back in place
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
