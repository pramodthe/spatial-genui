// Repair stage (v2 architecture, after part segmentation): a strong model fixes a generated library
// model in a sandboxed, headless Blender (the Phase 3 Blender MCP server). TRELLIS.2 gives realistic
// shape and texture but wrong or missing parts; the agent corrects part boundaries and names, builds
// missing parts from primitives and fixes the structure (e.g. gears that don't mesh), keeping the
// generated look. (Motion is out of scope for now: models first.) A Muse Ember critic reviews each
// round from renders; the best round wins, and the model as it came in counts as round 0, so a repair
// never makes it worse by the critic's measure.
//
// The agent starts from what the pipeline already knows, so it spends its turns on decisions:
// - each segmentation region is its own mesh piece under its part (retrieved.py --split-regions), so
//   most fixes are moving a whole piece to another part, not cutting meshes;
// - the first message carries every piece's measurements;
// - helpers for the routine steps are preloaded (apps/worker3d/repair_kit.py);
// - a `look` tool shows it the model as the critic sees it.
//
// Usage: npm run bench3d:repair -- [--cases bench/prompts/repair-pilot.json] [--out bench/results/_repair]
//          [--agent muse-spark-1.3-contributor] [--rounds 3] [--only asset,asset]
// The default agent runs in Meta's contributor mode: discounted, and Meta may use the prompts, renders and
// replies to train future models. Meta's prompt cache is automatic; each job keeps one cache key.
import { spawn } from 'node:child_process';
import { appendFile, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCli } from '../args.js';
import { complete, type ContentPart } from '../llm.js';
import { loadModel } from '../models.js';
import { BlenderSession } from './pipelines.js';
import type { AssetRequest } from './prompts.js';
import { closeRenderer, renderGlb } from './render.js';
import { dataUrl } from './review.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const WORKER = join(repoRoot, 'apps/worker3d');
const cli = parseCli(process.argv.slice(2), {
  values: ['cases', 'out', 'agent', 'rounds', 'only'],
  usage: 'npm run bench3d:repair -- [--cases file] [--out dir] [--agent model-id] [--rounds n] [--only asset,asset]',
});
/**
 * What to repair. Either `glb` + `work` (the model and its segmentation work folder from bench3d:segment
 * and bench3d:name-regions: the input keeps each segmentation region as its own piece), or `from` (a
 * library folder holding the asset as it is).
 */
type Case = { asset: string; objectId: string; lesson: string; needs: string; glb?: string; work?: string; from?: string };
const cases = (JSON.parse(await readFile(resolve(repoRoot, cli.flags.cases ?? 'bench/prompts/repair-pilot.json'), 'utf8')) as Case[])
  .filter((c) => !cli.flags.only || cli.flags.only.split(',').includes(c.asset));
const outDir = resolve(repoRoot, cli.flags.out ?? 'bench/results/_repair');
const rounds = Number(cli.flags.rounds ?? 3);
const agent = await loadModel(cli.flags.agent ?? 'muse-spark-1.3-contributor');
const critic = await loadModel('muse-ember-1.0-max');
const requests = new Map((JSON.parse(await readFile(join(repoRoot, 'bench/prompts/objects-12.json'), 'utf8')) as AssetRequest[]).map((o) => [o.id, o]));
const kit = await readFile(join(WORKER, 'repair_kit.py'), 'utf8');
const COLOUR_NAMES = ['red', 'green', 'blue', 'yellow', 'orange', 'purple', 'cyan', 'magenta', 'lime', 'pink'];
const MAX_TURNS = 24;
const TURN_TIMEOUT_MS = 6 * 60_000;

const SYSTEM = `You repair a 3D model for a mixed-reality lesson, in a headless Blender, with your tools. The scene already holds the model, made by an image-to-3D generator and cut into pieces by a segmentation model. There is one top-level object per part (an empty named after the part); its children are mesh pieces, each one region the segmentation cut. Units are metres, Z is up, and the model's front faces -Y.

What a good repair does:
1. Every named part really is that part. Move pieces between parts, or split and rename, where the names are wrong.
2. Parts the lesson needs exist. Build a missing part from primitives, matched in size, position and colour to the model, so it looks like it belongs.
3. The structure is right: parts sit where they belong and fit together as in the real object (gears in one plane with their teeth meshing, a piston inside its cylinder, a handle on its axle).
4. Keep the generated look: don't remove textures or rebuild what is already right. Keep the model's size, position and orientation.
5. One top-level object per part, named in lower case with underscores (e.g. piston, drive_gear). No cameras or lights.

Helpers are already defined in the Python session. Call them inside execute_blender_code; they print what they did:
- parts(): every part and its pieces, with faces, size, centre and extent.
- split_loose(piece): split a piece into its physically separate pieces. Use this, not bpy.ops.mesh.separate: imported meshes are split along texture seams.
- split_plane(piece, axis, value): cut a piece in two at a world plane, e.g. split_plane('drive_gear_0', 'z', 0.03) takes a base plate off what stands on it. No new geometry.
- assign(piece, part): move a piece to a part (created if missing).
- rotate(piece, axis, degrees, about=None) and move(piece, dx, dy, dz): turn a piece about a world axis through its own centre, or shift it.
- join([pieces], new_name) and rename_part(old, new).
Use bpy directly for anything else, e.g. bpy.ops.mesh.primitive_cylinder_add for a missing part, then assign() it to its part.

The look tool shows you the model as it is now: as made, and with each part in its own colour. Use it to see which piece is what and to check your changes, a few times per task (each look is two pictures).

Most fixes are a few helper calls: work out which piece is what from the measurements and a look, split a piece that holds several parts, assign pieces to the right parts. A script that fails leaves the scene as it was before that script. When you are done, reply with a one-line summary and no tool call.`;

const CRITIC = `You review a 3D model for a mixed-reality lesson. You see four views of it as made (front, side, back, above), then the same views with each named part in its own colour, the legend, and what the lesson needs. Judge only what you see. Reply with only a JSON object:
{"score": <1-5: how well the model serves this lesson: realistic, every needed part present, correctly named and in the right place>, "problems": ["<concrete problem a 3D artist could fix, e.g. 'the driven gear is missing', 'the part named piston is the cylinder head'>"]}`;

function python(script: string, args: string[]): Promise<Record<string, unknown>> {
  return new Promise((done) => {
    // Trusted code: reads model files and writes library files.
    const child = spawn(join(WORKER, '.venv/bin/python3'), [join(WORKER, 'library', script), ...args], { cwd: join(WORKER, 'library'), stdio: ['ignore', 'pipe', 'pipe'] });
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

type Views = { parts: string[]; legend: string; asMade: Buffer; byPart: Buffer };

/** Write `glb` as a scratch library asset and render it as made and with each part in its own colour. */
async function views(c: Case, like: string, glb: string, jobDir: string, tag: string): Promise<Views> {
  const scratch = join(jobDir, 'lib');
  const preview = join(jobDir, `${tag}-parts.glb`);
  const written = await python('ingest_glb.py', [glb, '--like', like, '--id', `${c.asset}-${tag}`, '--note', 'scratch', '--out', scratch, '--preview', preview]);
  if (!written.ok) throw new Error(`ingest: ${written.error}`);
  const asMade = await renderGlb(await readFile(join(scratch, 'assets', `${c.asset}-${tag}.glb`)));
  const byPart = await renderGlb(await readFile(preview));
  if (!('grid' in asMade) || !('grid' in byPart)) throw new Error('render failed');
  await writeFile(join(jobDir, `${tag}.jpg`), asMade.grid);
  await writeFile(join(jobDir, `${tag}-parts.jpg`), byPart.grid);
  const parts = written.parts as string[];
  return { parts, legend: parts.map((p, i) => `${COLOUR_NAMES[i % COLOUR_NAMES.length]} = ${p}`).join(', '), asMade: asMade.grid, byPart: byPart.grid };
}

type Review = Views & { score: number; problems: string[] };

/** The critic's review of one round's model, from the same pictures the agent's look tool shows. */
async function review(c: Case, like: string, glb: string, jobDir: string, round: number): Promise<Review> {
  const seen = await views(c, like, glb, jobDir, `round-${round}`);
  const request = requests.get(c.objectId);
  const reply = await complete([{ role: 'system', content: CRITIC }, {
    role: 'user', content: [
      { type: 'text', text: `Lesson: ${c.lesson}\nThe model: ${request?.prompt ?? c.objectId}. Parts it should have: ${request?.parts.join(', ') ?? '-'}.\nWhat the lesson needs: ${c.needs}` },
      { type: 'image_url', image_url: { url: dataUrl(seen.asMade) } },
      { type: 'text', text: `By part. Legend: ${seen.legend}.` },
      { type: 'image_url', image_url: { url: dataUrl(seen.byPart) } },
    ] as ContentPart[],
  }], critic);
  const start = reply.text.indexOf('{');
  let verdict: { score?: number; problems?: string[] } = {};
  try {
    verdict = JSON.parse(reply.text.slice(start, reply.text.lastIndexOf('}') + 1));
  } catch { /* scored 0 below */ }
  return { ...seen, score: typeof verdict.score === 'number' ? verdict.score : 0, problems: (verdict.problems ?? []).map(String).slice(0, 8) };
}

/** The model to repair as <job>/input.glb, and the catalogue entry its title, credit and licence come from. */
async function prepareInput(c: Case, jobDir: string): Promise<string> {
  if (c.glb && c.work) {
    const lib = join(jobDir, 'input-lib');
    const made = await python('retrieved.py', ['ingest', resolve(repoRoot, c.glb), resolve(repoRoot, c.work), '--out', lib, '--refine', '--split-regions']);
    if (!made.ok || made.id !== c.asset) throw new Error(`input: ${made.error ?? `built ${made.id}, expected ${c.asset}`}`);
    await copyFile(join(lib, 'assets', `${c.asset}.glb`), join(jobDir, 'input.glb'));
    return join(lib, 'catalog', `${c.asset}.json`);
  }
  if (!c.from) throw new Error('a case needs glb + work, or from');
  await copyFile(resolve(repoRoot, c.from, 'assets', `${c.asset}.glb`), join(jobDir, 'input.glb'));
  return resolve(repoRoot, c.from, 'catalog', `${c.asset}.json`);
}

/** Run harness code in the session's Blender and return what it printed. */
async function blender(session: BlenderSession, code: string, what: string): Promise<string> {
  const reply = JSON.parse(await session.exec(code)) as { ok: boolean; output?: string; error?: string };
  if (!reply.ok) throw new Error(`${what}: ${reply.error}`);
  return reply.output ?? '';
}

await mkdir(outDir, { recursive: true });
for (const c of cases) {
  try {
    const started = performance.now();
    const jobDir = join(outDir, 'jobs', c.asset);
    await mkdir(jobDir, { recursive: true });
    const like = await prepareInput(c, jobDir);
    const history: { round: number; score: number; problems: string[]; parts: string[]; glb: string }[] = [];
    const before = await review(c, like, join(jobDir, 'input.glb'), jobDir, 0);
    history.push({ round: 0, score: before.score, problems: before.problems, parts: before.parts, glb: join(jobDir, 'input.glb') });
    console.error(`${c.asset}: round 0 (as generated) critic ${before.score}: ${before.problems.join('; ').slice(0, 200)}`);

    // One cache key per job: every turn repeats the system prompt and the conversation so far.
    const cached = { ...agent, extraBody: { ...agent.extraBody, prompt_cache_key: `repair-${c.asset}` } };
    let looks = 0;
    const session = await BlenderSession.open(cached, jobDir, 'local', {
      system: SYSTEM, maxTurns: MAX_TURNS, turnTimeoutMs: TURN_TIMEOUT_MS,
      look: {
        description: 'See the model as it is now: four views as made (front, side, back, above), and the same views with each part in its own flat colour, with the legend.',
        render: async (glb) => {
          const path = join(jobDir, `look-${++looks}.glb`);
          await writeFile(path, glb);
          const seen = await views(c, like, path, jobDir, `look-${looks}`);
          return { text: `First picture: the model as made. Second picture: by part. Legend: ${seen.legend}.`, images: [seen.asMade, seen.byPart] };
        },
      },
    });
    try {
      await blender(session, "import bpy\nbpy.ops.import_scene.gltf(filepath='input.glb')", 'import');
      await blender(session, kit, 'helpers');
      let last = before;
      for (let round = 1; round <= rounds; round++) {
        const table = await blender(session, 'parts()', 'parts');
        const brief = `Lesson: ${c.lesson}\nWhat the lesson needs from the model: ${c.needs}\n\nThe model now (from parts()):\n${table}\nA reviewer saw the attached picture (the model as made) and found these problems:\n${last.problems.map((p) => `- ${p}`).join('\n') || '- none listed'}\nFix them in the scene with your tools.`;
        let reviewed: Review;
        try {
          const step = round === 1 ? await session.start(brief, dataUrl(last.asMade)) : await session.revise(brief, dataUrl(last.asMade));
          if (!step.ok) throw new Error(`export failed: ${step.error}`);
          const glbPath = join(jobDir, `round-${round}.glb`);
          await writeFile(glbPath, step.glb);
          reviewed = await review(c, like, glbPath, jobDir, round);
          history.push({ round, score: reviewed.score, problems: reviewed.problems, parts: reviewed.parts, glb: glbPath });
        } catch (err) {
          // The best round so far still counts; the next model still gets its turn.
          console.error(`${c.asset}: round ${round} failed: ${(err as Error).message.slice(0, 200)}`);
          break;
        }
        last = reviewed;
        console.error(`${c.asset}: round ${round} critic ${last.score}: parts ${last.parts.join(', ')}`);
        if (last.score >= 5) break;
      }
    } finally {
      await session.close();
    }
    const best = history.reduce((a, b) => (b.score > a.score ? b : a));
    const { promptTokens, cachedTokens, completionTokens } = session.usage;
    const cost = agent.priceIn != null && agent.priceOut != null
      ? ((promptTokens - cachedTokens) * agent.priceIn + cachedTokens * (agent.priceCached ?? agent.priceIn) + completionTokens * agent.priceOut) / 1e6 : null;
    await appendFile(join(outDir, 'repair.jsonl'), JSON.stringify({
      asset: c.asset, agent: agent.id, critic: critic.id, best: best.round, history: history.map(({ glb: _g, ...h }) => h),
      usage: session.usage, looks, agentUSD: cost && Math.round(cost * 1000) / 1000, ms: Math.round(performance.now() - started),
    }) + '\n');
    await copyFile(best.glb, join(jobDir, 'best.glb'));
    console.error(`${c.asset}: best round ${best.round} (critic ${best.score}), ${session.usage.calls} turns, ${session.usage.toolCalls} tool calls, ${looks} looks, ${Math.round((100 * cachedTokens) / Math.max(1, promptTokens))}% of input cached, $${cost?.toFixed(3)}, ${((performance.now() - started) / 60000).toFixed(1)} min`);
  } catch (err) {
    // One model's failure (import, render, network) doesn't stop the others.
    console.error(`${c.asset}: failed: ${(err as Error).message.slice(0, 300)}`);
  }
}
await closeRenderer();
