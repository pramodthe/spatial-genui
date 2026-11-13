// M5 self-check (section 4.7 verification, first piece): before named parts reach a lesson, Muse Ember
// looks at each part again, in solid red with the rest of the model faint, and keeps it, renames it,
// or merges it into the main body (not a meaningful part, or it can't tell what it is). A wrong label
// teaches something false, so it is told to be strict. Runs on work folders from bench3d:name-regions.
// Usage: npm run bench3d:verify-parts -- --glbs <dir of <id>.glb> --tag <work tag> --out <dir> [--only id,id]
// Writes <out>/segment.jsonl (for bench3d:judge-parts) and <out>/parts/<id>.jpg.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCli } from '../args.js';
import { complete, type ContentPart } from '../llm.js';
import { loadModel } from '../models.js';
import { closeRenderer, renderGlb } from './render.js';
import { dataUrl } from './review.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const WORKER = join(repoRoot, 'apps/worker3d');
const cli = parseCli(process.argv.slice(2), {
  values: ['glbs', 'tag', 'out', 'only'],
  usage: 'npm run bench3d:verify-parts -- --glbs <dir> --tag <work tag> --out <dir> [--only id,id]',
});
if (!cli.flags.glbs || !cli.flags.tag || !cli.flags.out) {
  console.error('Usage: npm run bench3d:verify-parts -- --glbs <dir> --tag <work tag> --out <dir> [--only id,id]');
  process.exit(1);
}
const glbDir = resolve(repoRoot, cli.flags.glbs);
const work = join(repoRoot, 'data/segment-work', cli.flags.tag);
const outDir = resolve(repoRoot, cli.flags.out);
const ember = await loadModel('muse-ember-1.0-max');

const SYSTEM = `You check the parts of a 3D model before it is used in a lesson. For each part you see four views of the model (front, side, back, above) with that part in solid red and the rest faint. Be strict: a wrong label teaches a student something false. For each part decide:
- "keep": the red region is that part (small stray bits are fine);
- "rename": the red region is clearly a different part; give its correct name;
- "merge": it is not a meaningful part on its own, it mixes several parts, or you can't tell what it is.
Reply with only a JSON object: {"parts": [{"name": "<part>", "verdict": "keep" | "rename" | "merge", "newName": "<only for rename>", "reason": "<short>"}]}`;

function python(args: string[]): Promise<Record<string, unknown>> {
  return new Promise((done) => {
    // Trusted code: reads model files and writes work files.
    const child = spawn(join(WORKER, '.venv/bin/python3'), [join(WORKER, 'library/segment.py'), ...args], { cwd: join(WORKER, 'library'), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('close', () => {
      const last = out.trim().split('\n').filter((l) => l.startsWith('{')).at(-1);
      try {
        done(last ? JSON.parse(last) : { ok: false, error: 'no output' });
      } catch {
        done({ ok: false, error: 'unreadable output' });
      }
    });
  });
}

await mkdir(join(outDir, 'parts'), { recursive: true });
const rowsFile = join(outDir, 'segment.jsonl');
const done = new Set(existsSync(rowsFile) ? (await readFile(rowsFile, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l).objectId as string) : []);
const ids = (await readdir(work)).filter((id) => existsSync(join(work, id, 'regions-merged.npy')) && existsSync(join(glbDir, `${id}.glb`)))
  .filter((id) => !done.has(id) && (!cli.flags.only || cli.flags.only.split(',').includes(id)));

for (const id of ids) {
  const started = performance.now();
  const glbPath = join(glbDir, `${id}.glb`);
  const dir = join(work, id);
  const row: Record<string, unknown> = { objectId: id };
  try {
    // The parts as named, with their surface shares (finalize is deterministic, so this re-creates them).
    const before = await python(['finalize', glbPath, dir]);
    if (!before.ok) throw new Error(`finalize: ${before.error}`);
    const parts = before.parts as string[];
    const shares = before.shares as number[];
    const content: ContentPart[] = [{ type: 'text', text: `Object: ${id.replace(/-/g, ' ')}. It has ${parts.length} parts.` }];
    for (let i = 0; i < parts.length; i++) {
      const render = await renderGlb(await readFile(join(dir, `check_${i + 1}.glb`)));
      if (!('grid' in render)) throw new Error(`render of part ${i + 1} failed`);
      content.push({ type: 'text', text: `Part ${i + 1}: "${parts[i]}"` }, { type: 'image_url', image_url: { url: dataUrl(render.grid) } });
    }
    const reply = await complete([{ role: 'system', content: SYSTEM }, { role: 'user', content }], ember);
    const start = reply.text.indexOf('{');
    const verdicts = (JSON.parse(reply.text.slice(start, reply.text.lastIndexOf('}') + 1)) as { parts?: { name: string; verdict: string; newName?: string; reason?: string }[] }).parts ?? [];
    // Merged parts join the main body: the largest part that is not itself merged. Names compare the way
    // segment.py writes them (region names may use underscores).
    const norm = (name: string) => name.toLowerCase().replace(/[_\s]+/g, ' ').trim();
    const verdictOf = new Map(verdicts.map((v) => [norm(v.name), v]));
    const kept = parts.map((p, i) => ({ p, share: shares[i] })).filter(({ p }) => verdictOf.get(p)?.verdict !== 'merge');
    const main = (kept.length ? kept : parts.map((p, i) => ({ p, share: shares[i] }))).sort((a, b) => b.share - a.share)[0].p;
    const finalName = (p: string) => {
      const v = verdictOf.get(p);
      if (v?.verdict === 'merge') return main;
      if (v?.verdict === 'rename' && v.newName) return norm(v.newName);
      return p;
    };
    const namesPath = join(dir, 'names.json');
    const names = JSON.parse(await readFile(namesPath, 'utf8'));
    const regionNames = Object.fromEntries(Object.entries(names.regionNames as Record<string, string>).map(([r, n]) => [r, finalName(norm(n))]));
    await writeFile(namesPath, JSON.stringify({ ...names, regionNames, verified: { by: ember.id, verdicts } }, null, 2));
    const after = await python(['finalize', glbPath, dir]);
    if (!after.ok) throw new Error(`finalize: ${after.error}`);
    const preview = await renderGlb(await readFile(join(dir, 'parts.glb')));
    if ('grid' in preview) await writeFile(join(outDir, 'parts', `${id}.jpg`), preview.grid);
    Object.assign(row, { ok: true, before: parts, parts: after.parts, verdicts });
  } catch (err) {
    Object.assign(row, { ok: false, error: (err as Error).message.slice(0, 300) });
  }
  row.ms = Math.round(performance.now() - started);
  await appendFile(rowsFile, JSON.stringify(row) + '\n');
  const changes = ((row.verdicts as { name: string; verdict: string; newName?: string }[] | undefined) ?? []).filter((v) => v.verdict !== 'keep').map((v) => `${v.name} ${v.verdict}${v.newName ? ` -> ${v.newName}` : ''}`);
  console.error(`${id.padEnd(16)} ${row.ok ? `${(row.parts as string[]).join(', ')}${changes.length ? `  [${changes.join('; ')}]` : ''}` : `failed: ${row.error}`}  ${((row.ms as number) / 1000).toFixed(0)} s`);
}
await closeRenderer();
