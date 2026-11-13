import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { complete, type LlmTarget } from './llm.js';
import { LIBRARY_DIR, libraryCatalog } from './library.js';

/**
 * Asset router (concept grounding, docs/3d-architecture.md section 4.1): before a lesson is written,
 * decide which accurate models it needs. Library models are matched by a quick model call over a
 * compact catalogue; molecules not yet in the library are built from PubChem on the spot. Only the
 * chosen assets go into the agent's prompt, so the prompt stays small as the library grows.
 */

const WORKER = fileURLToPath(new URL('../../worker3d/', import.meta.url));
const PYTHON = join(WORKER, '.venv/bin/python3');

export type Route = {
  assets: string[];
  built: string[];
  failed: string[];
  ms: number;
  method: 'model' | 'keywords';
};

const ROUTER_SYSTEM = `You pick accurate 3D models for a mixed-reality lesson. You get the lesson request and a catalogue of models built from scientific data. Reply with only a JSON object:
{"assets": ["<catalogue ids the lesson should show>"], "molecules": ["<English names of chemical compounds the lesson needs as 3D molecules that are not in the catalogue>"]}
Choose only what the lesson needs (usually 1, at most 4). Use the catalogue when an entry fits the request; list molecules only for real chemical compounds (e.g. "caffeine", "glucose", "carbon dioxide"). If nothing fits, return empty lists.`;

function catalogueText(): string {
  return [...libraryCatalog().values()]
    .map((e) => `- ${e.id}: ${e.title}${e.keywords?.length ? ` [${e.keywords.slice(0, 10).join(', ')}]` : ''}`)
    .join('\n');
}

/** Molecules already built, matched by name, formula or IUPAC name (case-insensitive). */
function moleculeInLibrary(name: string): string | null {
  const wanted = name.toLowerCase().trim();
  for (const e of libraryCatalog().values()) {
    if (e.kind === 'chemistry' && (e.keywords ?? []).includes(wanted)) return e.id;
  }
  return null;
}

// One build at a time, so concurrent lessons asking for the same molecule build it once.
let buildQueue: Promise<unknown> = Promise.resolve();

function buildMolecule(name: string): Promise<{ ok: boolean; id?: string; existed?: boolean; error?: string }> {
  const run = buildQueue.then(() => {
    const existing = moleculeInLibrary(name);
    return existing ? { ok: true, id: existing, existed: true } : spawnBuild(name);
  });
  buildQueue = run.catch(() => undefined);
  return run;
}

function spawnBuild(name: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  return new Promise((resolve) => {
    // Trusted code with no model-written input except a compound name passed as one argument.
    const child = spawn(PYTHON, [join(WORKER, 'library/molecule_build.py'), name, '--out', LIBRARY_DIR], {
      cwd: join(WORKER, 'library'), env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.on('close', () => {
      clearTimeout(timer);
      const last = out.trim().split('\n').filter((l) => l.startsWith('{')).at(-1);
      try {
        resolve(last ? JSON.parse(last) : { ok: false, error: 'no output' });
      } catch {
        resolve({ ok: false, error: 'unreadable output' });
      }
    });
  });
}

/** Fallback when the model call fails: catalogue entries whose keywords appear in the request. */
function keywordRoute(prompt: string): string[] {
  const text = prompt.toLowerCase();
  return [...libraryCatalog().values()]
    .map((e) => ({ id: e.id, hits: (e.keywords ?? []).filter((k) => k.length > 2 && text.includes(k)).length }))
    .filter((e) => e.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 2)
    .map((e) => e.id);
}

export async function routeAssets(prompt: string, target: LlmTarget): Promise<Route> {
  const started = performance.now();
  const known = libraryCatalog();
  let assets: string[] = [];
  let molecules: string[] = [];
  let method: Route['method'] = 'model';
  try {
    // A small decision: low reasoning keeps routing to a few seconds.
    const router = { ...target, extraBody: { ...target.extraBody, reasoning_effort: 'low' } };
    const reply = await complete([
      { role: 'system', content: ROUTER_SYSTEM },
      { role: 'user', content: `Lesson request: ${prompt}\n\nCatalogue:\n${catalogueText()}` },
    ], router);
    const json = reply.text.slice(reply.text.indexOf('{'), reply.text.lastIndexOf('}') + 1);
    const parsed = JSON.parse(json) as { assets?: unknown; molecules?: unknown };
    assets = (Array.isArray(parsed.assets) ? parsed.assets : []).map(String).filter((id) => known.has(id));
    molecules = (Array.isArray(parsed.molecules) ? parsed.molecules : []).map(String).filter((m) => /^[\w ,'()+-]{2,60}$/.test(m)).slice(0, 4);
  } catch {
    method = 'keywords';
    assets = keywordRoute(prompt);
  }

  const built: string[] = [];
  const failed: string[] = [];
  for (const name of molecules) {
    const existing = moleculeInLibrary(name);
    if (existing) {
      assets.push(existing);
      continue;
    }
    const result = await buildMolecule(name);
    if (result.ok && result.id) {
      assets.push(result.id);
      if (!result.existed) built.push(result.id);
    } else {
      failed.push(`${name}: ${result.error}`);
    }
  }
  // At most 4: e.g. photosynthesis needs carbon dioxide and water in, glucose and oxygen out.
  return { assets: [...new Set(assets)].slice(0, 4), built, failed, ms: Math.round(performance.now() - started), method };
}
