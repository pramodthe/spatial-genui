import { AssetManager, Vector3, type Object3D } from '@iwsdk/core';

/**
 * Library assets for generated modules: accurate models with named parts, served by the agent server
 * (/api/library). The host loads every asset a module names before build() runs, so `assets.get(id)`
 * can stay synchronous inside build(). The handle matches the server's dry-run stand-in (dryrun.ts).
 */

type CatalogPart = {
  node: string;
  name: string;
  group?: string | null;
  labelAnchor: [number, number, number];
  explodeDir: [number, number, number];
};
type CatalogEntry = { id: string; title: string; url: string; creditShort: string; credit: string; parts: CatalogPart[] };

export type AssetHandle = {
  object3D: Object3D;
  parts: { id: string; name: string; group: string | null; object3D: Object3D; labelAnchor: Vector3; explodeDir: Vector3 }[];
  part(id: string): Object3D;
  anchor(id: string): Vector3;
  credit: string;
};

let catalog: Promise<Map<string, CatalogEntry>> | null = null;

function loadCatalog(): Promise<Map<string, CatalogEntry>> {
  catalog ??= fetch('/api/library/catalog')
    .then((res) => {
      if (!res.ok) throw new Error(`catalog request failed (${res.status})`);
      return res.json() as Promise<{ assets: CatalogEntry[] }>;
    })
    .then((data) => new Map(data.assets.map((entry) => [entry.id, entry])))
    .catch((err) => {
      catalog = null; // retry on the next mount
      throw err;
    });
  return catalog;
}

const cacheKey = (id: string) => `genui-library:${id}`;

/** The asset ids a module asks for. The server's validator guarantees they are literal strings. */
export function assetIdsIn(code: string): string[] {
  return [...new Set([...code.matchAll(/assets\s*\.\s*get\(\s*['"`]([a-z0-9-]+)['"`]\s*\)/g)].map((m) => m[1]))];
}

/** Load (once) every asset a module needs. Rejects with a readable message if one is unavailable. */
export async function preloadAssets(ids: string[]): Promise<Map<string, CatalogEntry>> {
  const entries = await loadCatalog();
  await Promise.all(ids.map(async (id) => {
    const entry = entries.get(id);
    if (!entry) throw new Error(`There is no library asset '${id}'. Available: ${[...entries.keys()].join(', ')}.`);
    if (!AssetManager.getGLTF(cacheKey(id), { shared: true })) await AssetManager.loadGLTF(entry.url, cacheKey(id));
  }));
  return entries;
}

/** A fresh copy of a preloaded asset, with its parts found by node name. */
export function assetHandle(entries: Map<string, CatalogEntry>, id: string): AssetHandle {
  const entry = entries.get(id);
  const gltf = entry && AssetManager.getGLTF(cacheKey(id));
  if (!entry || !gltf) throw new Error(`Library asset '${id}' was not loaded.`);
  const object3D = gltf.scene;
  object3D.name = id;
  const parts = entry.parts.flatMap((p) => {
    const mesh = object3D.getObjectByName(p.node);
    return mesh ? [{
      id: p.node, name: p.name, group: p.group ?? null, object3D: mesh,
      labelAnchor: new Vector3(...p.labelAnchor), explodeDir: new Vector3(...p.explodeDir),
    }] : [];
  });
  const find = (partId: string) => {
    const part = parts.find((p) => p.id === partId);
    if (!part) throw new Error(`Asset '${id}' has no part '${partId}'. Parts: ${parts.map((p) => p.id).join(', ')}.`);
    return part;
  };
  return {
    object3D, parts, credit: entry.creditShort,
    part: (partId) => find(partId).object3D,
    anchor(partId) {
      object3D.updateMatrix();
      return find(partId).labelAnchor.clone().applyMatrix4(object3D.matrix);
    },
  };
}

/** Full attribution lines for the assets in use (shown by the overlay; CC BY requires credit). */
export function creditsFor(entries: Map<string, CatalogEntry>, ids: string[]): string[] {
  return ids.flatMap((id) => (entries.get(id) ? [`${entries.get(id)!.title}: ${entries.get(id)!.credit}`] : []));
}
