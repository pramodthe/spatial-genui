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
root.add(heart.object3D);              // real size in metres, standing on y = 0, front facing the user (+Z); you may scale it up to ~2x
heart.parts;                           // [{ id, name, group, object3D, labelAnchor, explodeDir }] for every part
heart.part('left_ventricle');          // that part's mesh: recolour or hide it to highlight, or make it grabbable with traits()
heart.anchor('left_ventricle');        // THREE.Vector3 on the part's outside, in the coordinates of the model's parent (root): put its label there
heart.parts[0].explodeDir;             // unit THREE.Vector3 from the model's centre outwards: move parts along it to explode the model
heart.credit;                          // short attribution, e.g. "Model: BodyParts3D, CC BY 4.0"
\`\`\`
Keep the model's parts where they are unless the lesson moves them on purpose (explode, pull out a part). Put the asset's credit as the last line of your main panel.`;
}

/** Lightweight stand-ins for the dry run: named, positioned parts without the real meshes. */
export function assetStubs(ids: string[]): Record<string, LibraryEntry & { creditShort: string }> {
  const catalog = libraryCatalog();
  return Object.fromEntries(ids.filter((id) => catalog.has(id)).map((id) => {
    const entry = catalog.get(id)!;
    return [id, { ...entry, creditShort: shortCredit(entry) }];
  }));
}
