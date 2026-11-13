// Repair stage (v2 architecture, after part segmentation): a strong model fixes a generated library
// model in a sandboxed, headless Blender (the Phase 3 Blender MCP server). TRELLIS.2 gives realistic
// shape and texture but wrong or missing parts; the agent corrects part boundaries and names, builds
// missing parts from primitives and fixes the structure (e.g. gears that don't mesh), keeping the
// generated look. (Motion is out of scope for now: models first.) A Muse Ember critic reviews each
// round from renders; the best round wins, and the model as it came in counts as round 0, so a repair
// never makes it worse by the critic's measure.
// Usage: npm run bench3d:repair -- [--cases bench/prompts/repair-pilot.json] [--out bench/results/_repair]
//          [--agent muse-spark-1.3-contributor] [--rounds 3] [--only asset,asset]
// The default agent runs in Meta's contributor mode: discounted, and Meta may use the prompts, renders and
// replies to train future models. Meta's prompt cache is automatic; each job keeps one cache key.
import { copyFile, mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
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
type Case = { asset: string; from: string; objectId: string; lesson: string; needs: string };
const cases = (JSON.parse(await readFile(resolve(repoRoot, cli.flags.cases ?? 'bench/prompts/repair-pilot.json'), 'utf8')) as Case[])
  .filter((c) => !cli.flags.only || cli.flags.only.split(',').includes(c.asset));
const outDir = resolve(repoRoot, cli.flags.out ?? 'bench/results/_repair');
const rounds = Number(cli.flags.rounds ?? 3);
const agent = await loadModel(cli.flags.agent ?? 'muse-spark-1.3-contributor');
const critic = await loadModel('muse-ember-1.0-max');
const requests = new Map((JSON.parse(await readFile(join(repoRoot, 'bench/prompts/objects-12.json'), 'utf8')) as AssetRequest[]).map((o) => [o.id, o]));
const COLOUR_NAMES = ['red', 'green', 'blue', 'yellow', 'orange', 'purple', 'cyan', 'magenta', 'lime', 'pink'];

const SYSTEM = `You repair a 3D model for a mixed-reality lesson, in a headless Blender, with your tools. The scene already holds the model, made by an image-to-3D generator and split into named parts: one top-level object (an empty with mesh pieces as children) per part, named after the part. Units are metres, Z is up, and the model's front faces -Y.

What a good repair does:
1. Every named part really is that part. Move faces between parts, or split and rename parts, where the names are wrong.
2. Parts the lesson needs exist. Build a missing part from primitives, matched in size, position and colour to the model, so it looks like it belongs.
3. The structure is right: parts sit where they belong and fit together as in the real object (gears in one plane with their teeth meshing, a piston inside its cylinder, a handle on its axle).
4. Keep the generated look: don't remove textures or rebuild what is already right. Keep the model's size, position and orientation.
5. Keep one top-level object per part, named with the part's name in lower case words (e.g. "piston", "drive gear"). No cameras or lights.

Work in small steps: inspect with get_scene_info and short scripts (print bounding boxes, vertex counts, origins) before you change things; a script that fails leaves the scene as it was before that script. When you are done, reply with a one-line summary and no tool call.`;

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

type Review = { score: number; problems: string[]; parts: string[]; moving: { name: string; type: string }[]; grid: Buffer };

/** Write `glb` as a scratch library asset, render it as made and by part, and have the critic review it. */
async function review(c: Case, like: string, glb: string, jobDir: string, round: number): Promise<Review> {
  const scratch = join(jobDir, 'lib');
  const preview = join(jobDir, `round-${round}-parts.glb`);
  const written = await python('ingest_glb.py', [glb, '--like', like, '--id', `${c.asset}-r${round}`, '--note', 'scratch', '--out', scratch, '--preview', preview]);
  if (!written.ok) throw new Error(`ingest: ${written.error}`);
  const asMade = await renderGlb(await readFile(join(scratch, 'assets', `${c.asset}-r${round}.glb`)));
  const byPart = await renderGlb(await readFile(preview));
  if (!('grid' in asMade) || !('grid' in byPart)) throw new Error('render failed');
  await writeFile(join(jobDir, `round-${round}.jpg`), asMade.grid);
  await writeFile(join(jobDir, `round-${round}-parts.jpg`), byPart.grid);
  const parts = written.parts as string[];
  const moving = written.moving as { name: string; type: string }[];
  const request = requests.get(c.objectId);
  const reply = await complete([{ role: 'system', content: CRITIC }, {
    role: 'user', content: [
      { type: 'text', text: `Lesson: ${c.lesson}\nThe model: ${request?.prompt ?? c.objectId}. Parts it should have: ${request?.parts.join(', ') ?? '-'}.\nWhat the lesson needs: ${c.needs}` },
      { type: 'image_url', image_url: { url: dataUrl(asMade.grid) } },
      { type: 'text', text: `By part. Legend: ${parts.map((p, i) => `${COLOUR_NAMES[i % COLOUR_NAMES.length]} = ${p}`).join(', ')}.` },
      { type: 'image_url', image_url: { url: dataUrl(byPart.grid) } },
    ] as ContentPart[],
  }], critic);
  const start = reply.text.indexOf('{');
  let verdict: { score?: number; problems?: string[] } = {};
  try {
    verdict = JSON.parse(reply.text.slice(start, reply.text.lastIndexOf('}') + 1));
  } catch { /* scored 0 below */ }
  return { score: typeof verdict.score === 'number' ? verdict.score : 0, problems: (verdict.problems ?? []).map(String).slice(0, 8), parts, moving, grid: asMade.grid };
}

await mkdir(outDir, { recursive: true });
for (const c of cases) {
  try {
    const started = performance.now();
    const jobDir = join(outDir, 'jobs', c.asset);
    await mkdir(jobDir, { recursive: true });
    const like = resolve(repoRoot, c.from, 'catalog', `${c.asset}.json`);
    await copyFile(resolve(repoRoot, c.from, 'assets', `${c.asset}.glb`), join(jobDir, 'input.glb'));
    const history: { round: number; score: number; problems: string[]; parts: string[]; moving: unknown[]; glb: string }[] = [];
    const before = await review(c, like, join(jobDir, 'input.glb'), jobDir, 0);
    history.push({ round: 0, score: before.score, problems: before.problems, parts: before.parts, moving: before.moving, glb: join(jobDir, 'input.glb') });
    console.error(`${c.asset}: round 0 (as generated) critic ${before.score}: ${before.problems.join('; ').slice(0, 200)}`);

    // One cache key per job: every turn repeats the system prompt and the conversation so far.
    const cached = { ...agent, extraBody: { ...agent.extraBody, prompt_cache_key: `repair-${c.asset}` } };
    const session = await BlenderSession.open(cached, jobDir, 'local', SYSTEM, 30); // repairs inspect more than builds
    try {
      const imported = await session.exec("import bpy\nbpy.ops.import_scene.gltf(filepath='input.glb')\nprint(len(bpy.data.objects))");
      if (!imported.includes('"ok": true') && !imported.includes('"ok":true')) throw new Error(`import failed: ${imported.slice(0, 300)}`);
      let last = before;
      for (let round = 1; round <= rounds; round++) {
        const brief = `Lesson: ${c.lesson}\nWhat the lesson needs from the model: ${c.needs}\nParts now: ${last.parts.join(', ')}.\nA reviewer found these problems:\n${last.problems.map((p) => `- ${p}`).join('\n') || '- none listed'}\nFix them in the scene with your tools.`;
        let reviewed: Review;
        try {
          const step = round === 1 ? await session.start(brief, dataUrl(last.grid)) : await session.revise(brief, dataUrl(last.grid));
          if (!step.ok) throw new Error(`export failed: ${step.error}`);
          const glbPath = join(jobDir, `round-${round}.glb`);
          await writeFile(glbPath, step.glb);
          reviewed = await review(c, like, glbPath, jobDir, round);
          history.push({ round, score: reviewed.score, problems: reviewed.problems, parts: reviewed.parts, moving: reviewed.moving, glb: glbPath });
        } catch (err) {
          // The best round so far still counts; the next model still gets its turn.
          console.error(`${c.asset}: round ${round} failed: ${(err as Error).message.slice(0, 200)}`);
          break;
        }
        last = reviewed;
        console.error(`${c.asset}: round ${round} critic ${last.score}: parts ${last.parts.join(', ')}; moving ${last.moving.map((m) => m.name).join(', ') || '-'}`);
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
      usage: session.usage, agentUSD: cost && Math.round(cost * 1000) / 1000, ms: Math.round(performance.now() - started),
    }) + '\n');
    await copyFile(best.glb, join(jobDir, 'best.glb'));
    console.error(`${c.asset}: best round ${best.round} (critic ${best.score}), ${session.usage.toolCalls} tool calls, ${Math.round((100 * cachedTokens) / Math.max(1, promptTokens))}% of input cached, $${cost?.toFixed(3)}, ${((performance.now() - started) / 60000).toFixed(1)} min`);
  } catch (err) {
    // One model's failure (import, render, network) doesn't stop the others.
    console.error(`${c.asset}: failed: ${(err as Error).message.slice(0, 300)}`);
  }
}
await closeRenderer();
