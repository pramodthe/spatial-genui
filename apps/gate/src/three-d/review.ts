import { complete, type LlmTarget } from '../llm.js';
import { CRITIC_SYSTEM, JUDGE_SYSTEM, criticText, judgeText, referenceImagePrompt, type AssetRequest } from './prompts.js';
import type { RenderStats } from './render.js';

export const dataUrl = (jpeg: Buffer) => `data:image/jpeg;base64,${jpeg.toString('base64')}`;

/** First JSON object in a model reply (models sometimes wrap it in prose or a code fence). */
function parseJson<T>(text: string): T | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

export type Critique = { score: number; problems: string[]; ms: number; promptTokens: number; completionTokens: number };

/** M2: a vision model reviews the four-view render and lists what to fix. */
export async function critique(target: LlmTarget, req: AssetRequest, grid: Buffer, stats: RenderStats, missing: string[]): Promise<Critique> {
  const reply = await complete([
    { role: 'system', content: CRITIC_SYSTEM },
    { role: 'user', content: [{ type: 'text', text: criticText(req, stats, missing) }, { type: 'image_url', image_url: { url: dataUrl(grid) } }] },
  ], target);
  const parsed = parseJson<{ score?: number; problems?: string[] }>(reply.text);
  return {
    score: typeof parsed?.score === 'number' ? parsed.score : 0,
    problems: Array.isArray(parsed?.problems) ? parsed.problems.slice(0, 6).map(String) : ['The review could not be parsed; check the model against the request.'],
    ms: reply.ms, promptTokens: reply.promptTokens, completionTokens: reply.completionTokens,
  };
}

export type Verdict = {
  recognizable: number; accuracy: number; craft: number; overall: number;
  partsVisible: string[]; comment: string; ms: number; promptTokens: number; completionTokens: number;
};

/** Independent judge (not part of any pipeline): scores the four-view render. */
export async function judge(target: LlmTarget, req: AssetRequest, grid: Buffer): Promise<Verdict> {
  const reply = await complete([
    { role: 'system', content: JUDGE_SYSTEM },
    { role: 'user', content: [{ type: 'text', text: judgeText(req) }, { type: 'image_url', image_url: { url: dataUrl(grid) } }] },
  ], target);
  const v = parseJson<Partial<Verdict>>(reply.text);
  const score = (x: unknown) => (typeof x === 'number' && x >= 1 && x <= 5 ? x : NaN);
  if (!v || !Number.isFinite(score(v.overall))) throw new Error(`Unparseable verdict: ${reply.text.slice(0, 200)}`);
  return {
    recognizable: score(v.recognizable), accuracy: score(v.accuracy), craft: score(v.craft), overall: score(v.overall),
    partsVisible: Array.isArray(v.partsVisible) ? v.partsVisible.map(String) : [], comment: String(v.comment ?? ''),
    ms: reply.ms, promptTokens: reply.promptTokens, completionTokens: reply.completionTokens,
  };
}

/** One picture from Muse Image (Meta API) for a prompt. */
export async function museImage(prompt: string): Promise<{ jpeg: Buffer; ms: number }> {
  const base = process.env.META_API_BASE || 'https://api.meta.ai/v1';
  const key = process.env.META_API_KEY;
  if (!key) throw new Error('Set META_API_KEY in .env for reference images.');
  const started = performance.now();
  const res = await fetch(`${base.replace(/\/$/, '')}/images/generations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'muse-image-1.0', prompt, n: 1, size: '1024x1024', output_format: 'jpeg' }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`Muse Image ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { data: { b64_json: string }[] };
  return { jpeg: Buffer.from(body.data[0].b64_json, 'base64'), ms: Math.round(performance.now() - started) };
}

/** M1: a reference picture from Muse Image, shared by all pipelines for the same object (fixed style, unchecked). */
export function referenceImage(req: AssetRequest): Promise<{ jpeg: Buffer; ms: number }> {
  return museImage(referenceImagePrompt(req));
}
