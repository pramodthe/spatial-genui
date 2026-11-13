// Guards for the public deployment (SPEC.md Phase 6): a per-visitor rate limit, a global daily spending
// cap, and a content screen for the competition's rules (no identifiable real people, no brands or logos,
// content fit for a public forum). Benchmarks call generate() directly and never pass through here.
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import { complete, type LlmTarget } from './llm.js';
import { loadModel, type ModelEntry } from './models.js';

const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_10_MIN || 6);
const DAILY_BUDGET_USD = Number(process.env.DAILY_BUDGET_USD || 15);
const RATE_WINDOW_MS = 10 * 60_000;

export type Refusal = { status: number; reason: 'rate' | 'budget' | 'content'; error: string };

// --- Rate limit: generations per visitor in a sliding 10-minute window -----------------------------
const recent = new Map<string, number[]>();

export function visitorOf(req: { headers: Record<string, string | string[] | undefined>; socket: { remoteAddress?: string } }): string {
  // Behind a proxy (the hosting platform) the visitor is the first forwarded address.
  const forwarded = req.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'unknown';
}

function checkRate(visitor: string): Refusal | null {
  const now = Date.now();
  const times = (recent.get(visitor) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.set(visitor, times);
  if (times.length < RATE_LIMIT) return null;
  const minutes = Math.ceil((RATE_WINDOW_MS - (now - times[0])) / 60_000);
  return { status: 429, reason: 'rate', error: `That's a lot of lessons in a short time. Try again in ${minutes} min, or pick a ready-made lesson.` };
}

// --- Daily spending cap (estimated from tokens and catalogue prices) ----------------------------------
const spendFile = () => join(config.runsDir, `spend-${new Date().toISOString().slice(0, 10)}.json`);
let spend = { day: '', usd: 0, runs: 0 };

function today() {
  const day = new Date().toISOString().slice(0, 10);
  if (spend.day !== day) {
    // A restart keeps the day's total.
    const file = spendFile();
    spend = existsSync(file) ? { day, ...JSON.parse(readFileSync(file, 'utf8')) } : { day, usd: 0, runs: 0 };
  }
  return spend;
}

function checkBudget(): Refusal | null {
  if (today().usd < DAILY_BUDGET_USD) return null;
  return { status: 503, reason: 'budget', error: "Live lessons are paused for today. The ready-made lessons still work." };
}

const prices = new Map<string, ModelEntry | null>();
async function priceOf(modelId: string): Promise<ModelEntry | null> {
  if (!prices.has(modelId)) prices.set(modelId, await loadModel(modelId).catch(() => null));
  return prices.get(modelId) ?? null;
}

/** Add a finished run's estimated cost to the day's total (calls priced at their model's rates). */
export async function recordSpend(calls: { model: string; promptTokens: number; completionTokens: number }[]) {
  let usd = 0;
  for (const call of calls) {
    const entry = await priceOf(call.model);
    // Unknown price: assume Sonnet-class rates rather than free.
    const priceIn = entry?.priceIn ?? 3;
    const priceOut = entry?.priceOut ?? 15;
    usd += (call.promptTokens * priceIn + call.completionTokens * priceOut) / 1e6;
  }
  const s = today();
  s.usd += usd;
  s.runs++;
  await mkdir(config.runsDir, { recursive: true });
  await writeFile(spendFile(), JSON.stringify({ usd: Math.round(s.usd * 1e4) / 1e4, runs: s.runs }));
}

export function spendToday() {
  const s = today();
  return { usd: Math.round(s.usd * 100) / 100, runs: s.runs, budgetUsd: DAILY_BUDGET_USD };
}

// --- Content screen ----------------------------------------------------------------------------------
const SCREEN_PROMPT = `You screen requests for an educational mixed-reality app that builds interactive 3D lessons
and small interactive tools. Allow almost everything a teacher, student or curious adult would ask for:
science, history, maths, geography, art, how things work, games and everyday tools.
Refuse a request only when building it would need:
- an identifiable real person (their likeness, a named celebrity, politician or private individual);
- a brand, logo, trademark, branded product or commercial artwork (generic objects are fine: "a smartphone", not a named brand's phone);
- sexual content, graphic violence or gore, hate, harassment, self-harm, weapons instructions or illegal acts;
- anything not suitable for a 13+ audience.
Historical figures as topics (e.g. "Newton's laws") are fine; only a portrait or likeness is not.
Reply with only JSON: {"allowed": true} or {"allowed": false, "reason": "<one short, friendly sentence for the user>"}`;

let screener: Promise<LlmTarget | null> | null = null;
const screened = new Map<string, Refusal | null>();

async function checkContent(prompt: string): Promise<{ refusal: Refusal | null; usage?: { model: string; promptTokens: number; completionTokens: number } }> {
  if (process.env.MODERATION === 'off') return { refusal: null };
  const key = prompt.trim().toLowerCase();
  if (screened.has(key)) return { refusal: screened.get(key)! };
  screener ??= loadModel(process.env.MODERATION_MODEL || 'claude-haiku-5-5').catch((err) => {
    console.warn(`Content screen unavailable (${(err as Error).message}); requests are not screened.`);
    return null;
  });
  const target = await screener;
  if (!target) return { refusal: null };
  try {
    const reply = await complete([{ role: 'system', content: SCREEN_PROMPT }, { role: 'user', content: prompt }], target);
    const json = reply.text.match(/\{[\s\S]*\}/)?.[0];
    const verdict = json ? (JSON.parse(json) as { allowed?: boolean; reason?: string }) : { allowed: true };
    const refusal: Refusal | null = verdict.allowed === false
      ? { status: 422, reason: 'content', error: verdict.reason || "That isn't something this app can build. Try a science or how-it-works topic." }
      : null;
    screened.set(key, refusal);
    return { refusal, usage: { model: target.id, promptTokens: reply.promptTokens, completionTokens: reply.completionTokens } };
  } catch (err) {
    // A failed screen shouldn't block learning; it is logged and the request goes ahead.
    console.warn(`Content screen failed: ${(err as Error).message}`);
    return { refusal: null };
  }
}

/** Every guard, cheapest first. Null means go ahead (and the request counts toward the visitor's limit). */
export async function admit(visitor: string, prompt: string): Promise<Refusal | null> {
  const rate = checkRate(visitor);
  if (rate) return rate;
  const budget = checkBudget();
  if (budget) return budget;
  const { refusal, usage } = await checkContent(prompt);
  if (usage) await recordSpend([usage]);
  if (refusal) return refusal;
  recent.get(visitor)!.push(Date.now());
  return null;
}
