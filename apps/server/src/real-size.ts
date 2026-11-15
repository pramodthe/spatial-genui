// The size agent: how big a lesson's subject is in the real world, for the headset's "Real size" view. Lessons are
// built at desk scale (a house and a bacterium both about 0.4 m), so the headset can't know the true size from the
// model; this asks the app's model once per subject and keeps the answer.
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { recordSpend } from './guard.js';
import { complete, type LlmTarget } from './llm.js';
import { loadModel } from './models.js';

export type RealSize = {
  /** The one thing the lesson shows, in a few words ("a two-storey house"). */
  subject: string;
  /** Its largest real dimension in metres, or null when it has no single size (a process, a whole system). */
  sizeM: number | null;
  /** Which dimension that is: height, length, width or diameter. */
  dimension: string;
};

const CACHE_FILE = fileURLToPath(new URL('../../../data/real-sizes.json', import.meta.url));
const PROMPT = `A mixed-reality learning app shows a 3D model of a lesson's subject on the learner's desk, and can also
show it at its true size. Given the lesson's request or title, name the one physical thing the lesson is about and
give its typical largest real-world dimension in metres (a two-storey house about 8, an adult human heart about 0.12,
an E. coli bacterium about 0.000002, a guitar about 1). For a process that happens to one kind of thing, give that
thing ("how bacteria divide": a bacterium; "how a jet engine works": a jet engine). Give null only when there is no
single thing to show at its true size: a cycle or system spread over a landscape or space (the water cycle, the solar
system as a whole) or nothing physical.
Reply with JSON only: {"subject": "...", "sizeM": number or null, "dimension": "height" | "length" | "width" | "diameter"}`;

const cache = new Map<string, RealSize>();
try {
  if (existsSync(CACHE_FILE)) for (const [key, value] of Object.entries(JSON.parse(readFileSync(CACHE_FILE, 'utf8')))) cache.set(key, value as RealSize);
} catch {
  // A damaged cache is rebuilt as subjects are asked again.
}

let sizer: Promise<LlmTarget | null> | null = null;

/** The real size of the subject of `request` (a lesson's prompt or title), from the cache or the size agent. */
export async function realSizeOf(request: string): Promise<RealSize> {
  const key = request.trim().toLowerCase();
  const known = cache.get(key);
  if (known) return known;
  sizer ??= loadModel(process.env.SIZE_MODEL || config.model).catch((err) => {
    console.warn(`Size agent unavailable (${(err as Error).message}); real-size views are off.`);
    return null;
  });
  const target = await sizer;
  if (!target) return { subject: request, sizeM: null, dimension: 'length' };
  const reply = await complete([{ role: 'system', content: PROMPT }, { role: 'user', content: request }], target);
  await recordSpend([{ model: target.id, promptTokens: reply.promptTokens, completionTokens: reply.completionTokens }]);
  const parsed = JSON.parse(reply.text.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as Partial<RealSize>;
  const sizeM = typeof parsed.sizeM === 'number' && Number.isFinite(parsed.sizeM) && parsed.sizeM > 0 ? parsed.sizeM : null;
  const answer: RealSize = { subject: String(parsed.subject || request).slice(0, 120), sizeM, dimension: String(parsed.dimension || 'length') };
  cache.set(key, answer);
  await mkdir(dirname(CACHE_FILE), { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(Object.fromEntries(cache), null, 1));
  return answer;
}
