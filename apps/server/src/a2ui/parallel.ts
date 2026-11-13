// RQ4 / SPEC.md Phase 5: parallel generation. A planner splits the lesson into parts (each with its place,
// the ids other parts may refer to, and the shared data paths); one builder per part writes that part's
// A2UI components, all at the same time; each part streams to the client the moment it passes its checks
// (A2UI's createSurface + updateComponents), over placeholders shown as soon as the plan exists.
// Compared with one-shot version C (same catalog, renderer, checks and builder model).
import { complete, type ChatMessage, type LlmTarget } from '../llm.js';
import { checkSurface, compileSurface, extractJson, SPATIAL_CATALOG_ID, type A2UIComponent, type Surface } from './catalog.js';
import { CATALOG_DOCS, FRAMING, SPACE_AND_QUALITY, jsonRepairMessage } from './prompts.js';

export type PlanPart = {
  id: string;
  kind: 'object' | 'panel' | 'quiz' | 'tour';
  brief: string;
  position: [number, number, number];
  width?: number;
  /** Ids inside this part that other parts may refer to (highlight targets, orbit targets). */
  exports?: string[];
};
export type Plan = { title: string; dataModel: Record<string, unknown>; parts: PlanPart[] };

/** AG-UI-style run events (SPEC.md Phase 5). `code` is the lesson so far, ready to mount. */
export type RunEvent =
  | { type: 'RUN_STARTED'; ms: number }
  | { type: 'PLAN_READY'; ms: number; plan: Plan; code: string }
  | { type: 'COMPONENT_STARTED'; ms: number; partId: string }
  | { type: 'COMPONENT_READY'; ms: number; partId: string; code: string; ready: number; total: number }
  | { type: 'COMPONENT_FAILED'; ms: number; partId: string; error: string }
  | { type: 'RUN_FINISHED'; ms: number; ok: boolean; error?: string };

export type CallRecord = { role: string; ms: number; promptTokens: number; completionTokens: number; finishReason: string | null; ok: boolean; error?: string };

export type ParallelResult = {
  ok: boolean;
  code?: string;
  /** The merged surface (what the parts built), as JSON. */
  source?: string;
  error?: string;
  calls: CallRecord[];
  timings: { planMs: number; firstPartMs: number | null; partMs: Record<string, number>; totalMs: number };
  failedParts: string[];
  plan?: Plan;
};

const KINDS = new Set(['object', 'panel', 'quiz', 'tour']);
const ID = /^[A-Za-z_][A-Za-z0-9_]*$/;

const PLANNER_PROMPT = `You plan a mixed-reality lesson so that several builders can make its parts at the same time.
A seated user asked for something; the lesson sits on their desk (origin about 0.5 m in front of them,
+Y up, +Z toward the user, everything within 0.8 m wide x 0.5 m tall x 0.5 m deep, above y = 0).

Reply with exactly one \`\`\`json code block, and nothing else:
{"title": "...", "dataModel": {"info": "..."}, "parts": [
  {"id": "...", "kind": "object|panel|quiz|tour", "brief": "...", "position": [x, y, z], "width": 0.3,
   "exports": ["..."]}]}

- 2-6 parts. Builders work at the same time, so the lesson is ready when its biggest part is: when there
  are many 3D objects (more than about 4), split them across up to 3 object parts by region or group
  (e.g. organelles on the left half and on the right half), each with its own position.
- kind "object": the 3D things to grab or press (one part can hold several objects). "panel":
  an info panel (title, text bound to the data model, buttons). "quiz": one multiple-choice card. "tour":
  one step-by-step panel that walks through the objects and makes them glow.
- id: letters, digits and underscores. brief: 1-4 sentences on what to build, the facts to use (be
  accurate) and the interactions, so the builder needs nothing else.
- Place parts so nothing overlaps: objects near x = 0, y 0.05-0.3; panels and quizzes beside them at about
  x = +0.34 or -0.34, y = 0.16, width 0.26-0.34 (one panel per side).
- exports: ids inside a part that OTHER parts refer to (e.g. the object part exports heart_left_ventricle
  so the tour can highlight it, or a planet so an info button can highlight it). Each export id starts
  with its part's id and an underscore. List every one other parts need; nothing else can be referred to.
- dataModel: shared values parts read and write (bound text such as "info"). Give each a starting value.`;

const BUILDER_SYSTEM = `${FRAMING}

You build ONE part of a lesson that a planner split into parts; other builders make the other parts at
the same time, from the same plan. Your part becomes part of one A2UI v1.0 surface
(catalog ${SPATIAL_CATALOG_ID}).

# Output format
Reply with exactly one \`\`\`json code block, and nothing else:
{"top": ["ids of your components that go directly into the Scene"], "components": [...]}
- Every id you create starts with your part's id followed by an underscore (or is exactly your part's id).
- Create every id listed in your part's exports. You may refer to your own ids, to other parts' exports,
  and to the shared data model paths; nothing else exists for you.
- top: your 3D objects that need grab or action, your motions (Orbit, Spin), and your panels (Panel,
  QuizCard, StepTour). Don't include the Scene: the planner's Scene lists everyone's top components.
- Use your part's position: objects around it, a panel exactly at it with the planned width.

${CATALOG_DOCS}

${SPACE_AND_QUALITY}`;

/** Plan, build the parts in parallel, and merge. `onEvent` gets the stream (for the client). */
export async function generateParallel(
  prompt: string,
  options: { builder: LlmTarget; planner?: LlmTarget; onEvent?: (event: RunEvent) => void },
): Promise<ParallelResult> {
  const started = performance.now();
  const now = () => Math.round(performance.now() - started);
  const emit = (event: RunEvent) => options.onEvent?.(event);
  const calls: CallRecord[] = [];
  const result: ParallelResult = { ok: false, calls, timings: { planMs: 0, firstPartMs: null, partMs: {}, totalMs: 0 }, failedParts: [] };
  emit({ type: 'RUN_STARTED', ms: 0 });

  // 1. Plan (one repair if the plan is unusable).
  const planMessages: ChatMessage[] = [{ role: 'system', content: PLANNER_PROMPT }, { role: 'user', content: prompt }];
  let plan: Plan | undefined;
  for (let i = 0; i < 2 && !plan; i++) {
    const reply = await complete(planMessages, options.planner ?? options.builder);
    const problems = checkPlan(extractJson(reply.text));
    calls.push(record('planner', reply, problems.length === 0, problems.join(' ')));
    planMessages.push({ role: 'assistant', content: reply.text });
    if (problems.length === 0) plan = extractJson(reply.text) as Plan;
    else planMessages.push({ role: 'user', content: jsonRepairMessage(problems.join('\n')) });
  }
  result.timings.planMs = now();
  if (!plan) return finish(false, 'The planner did not produce a usable plan.');
  result.plan = plan;
  const ready = new Map<string, { top: string[]; components: A2UIComponent[] }>();
  emit({ type: 'PLAN_READY', ms: now(), plan, code: compileSurface(merge(plan, ready, true)) });

  // 2. Build every part at once; each streams in when it passes its own checks.
  await Promise.all(plan.parts.map(async (part) => {
    emit({ type: 'COMPONENT_STARTED', ms: now(), partId: part.id });
    const built = await buildPart(plan!, part, options.builder, calls);
    if ('error' in built) {
      result.failedParts.push(part.id);
      emit({ type: 'COMPONENT_FAILED', ms: now(), partId: part.id, error: built.error });
      return;
    }
    ready.set(part.id, built);
    result.timings.partMs[part.id] = now();
    result.timings.firstPartMs ??= now();
    emit({ type: 'COMPONENT_READY', ms: now(), partId: part.id, code: compileSurface(merge(plan!, ready, true)), ready: ready.size, total: plan!.parts.length });
  }));

  // 3. The finished lesson: the parts that made it, checked together.
  if (ready.size === 0) return finish(false, 'No part was built.');
  const surface = merge(plan, ready, false);
  const problems = checkSurface(surface);
  if (problems.length) return finish(false, `The merged lesson failed its checks: ${problems.join(' ')}`);
  result.code = compileSurface(surface);
  result.source = JSON.stringify(surface);
  return finish(true);

  function finish(ok: boolean, error?: string): ParallelResult {
    result.ok = ok && result.failedParts.length === 0;
    if (!ok) result.error = error;
    else if (result.failedParts.length) result.error = `Parts that failed (left out): ${result.failedParts.join(', ')}`;
    result.timings.totalMs = now();
    emit({ type: 'RUN_FINISHED', ms: result.timings.totalMs, ok: result.ok, error: result.error });
    return result;
  }
}

async function buildPart(plan: Plan, part: PlanPart, target: LlmTarget, calls: CallRecord[]): Promise<{ top: string[]; components: A2UIComponent[] } | { error: string }> {
  const messages: ChatMessage[] = [
    { role: 'system', content: BUILDER_SYSTEM },
    { role: 'user', content: `The plan:\n${JSON.stringify(plan, null, 1)}\n\nBuild part "${part.id}".` },
  ];
  let lastError = '';
  for (let i = 0; i < 2; i++) {
    const reply = await complete(messages, target);
    messages.push({ role: 'assistant', content: reply.text });
    const parsed = extractJson(reply.text) as { top?: unknown; components?: unknown } | null;
    const problems = parsed ? checkPart(plan, part, parsed) : [reply.finishReason === 'length' ? 'The reply was cut off; write a shorter part.' : 'No valid JSON found (one ```json block).'];
    calls.push(record(`part:${part.id}`, reply, problems.length === 0, problems.join(' ')));
    if (problems.length === 0) return parsed as { top: string[]; components: A2UIComponent[] };
    lastError = problems.join(' ');
    messages.push({ role: 'user', content: jsonRepairMessage(problems.join('\n')) });
  }
  return { error: lastError };
}

/** A part's own problems: its ids, its exports, and everything the renderer checks, with the other
 * parts' exports standing in as placeholders. */
function checkPart(plan: Plan, part: PlanPart, built: { top?: unknown; components?: unknown }): string[] {
  if (!Array.isArray(built.top) || !Array.isArray(built.components)) return ['Reply with {"top": [ids], "components": [...]}.'];
  const problems: string[] = [];
  const components = built.components as A2UIComponent[];
  const own = new Set(components.map((c) => c?.id));
  for (const id of own) if (typeof id !== 'string' || !(id === part.id || id.startsWith(`${part.id}_`))) problems.push(`Id ${JSON.stringify(id)} must start with "${part.id}_".`);
  for (const id of part.exports ?? []) if (!own.has(id)) problems.push(`Create "${id}": it is in your part's exports.`);
  for (const id of built.top as string[]) if (!own.has(id)) problems.push(`top lists "${id}", which you didn't create.`);
  if (problems.length) return problems;
  const others = plan.parts.filter((p) => p.id !== part.id).flatMap((p) => p.exports ?? []);
  const probe: Surface = {
    surfaceId: 'probe',
    catalogId: SPATIAL_CATALOG_ID,
    dataModel: plan.dataModel,
    components: [
      { id: 'root', component: 'Scene', children: [...(built.top as string[]), ...others] },
      ...components,
      ...others.map((id) => ({ id, component: 'Shape', shape: 'sphere', radius: 0.01 })),
    ],
  };
  return checkSurface(probe);
}

function checkPlan(plan: unknown): string[] {
  const p = plan as Plan | null;
  if (!p || typeof p !== 'object' || !Array.isArray(p.parts)) return ['Reply with {"title", "dataModel", "parts": [...]}.'];
  const problems: string[] = [];
  if (p.parts.length < 2 || p.parts.length > 6) problems.push('Plan 2-6 parts.');
  const ids = new Set<string>();
  for (const part of p.parts) {
    if (!part || typeof part.id !== 'string' || !ID.test(part.id) || part.id === 'root') problems.push(`Part id ${JSON.stringify(part?.id)} must be letters, digits and underscores (not "root").`);
    else if (ids.has(part.id)) problems.push(`Two parts are called "${part.id}".`);
    else ids.add(part.id);
    if (!KINDS.has(part?.kind)) problems.push(`Part "${part?.id}": kind must be object, panel, quiz or tour.`);
    if (typeof part?.brief !== 'string' || part.brief.length < 10) problems.push(`Part "${part?.id}" needs a brief.`);
    if (!Array.isArray(part?.position) || part.position.length !== 3 || !part.position.every((n) => typeof n === 'number')) problems.push(`Part "${part?.id}": position must be [x, y, z].`);
    for (const e of part?.exports ?? []) if (typeof e !== 'string' || !e.startsWith(`${part.id}_`) || !ID.test(e)) problems.push(`Export ${JSON.stringify(e)} must start with "${part?.id}_" (letters, digits, underscores).`);
  }
  if (p.dataModel !== undefined && (typeof p.dataModel !== 'object' || Array.isArray(p.dataModel))) problems.push('dataModel must be an object.');
  return problems;
}

/** The surface so far: the parts that are ready, and (while building) a faint box where each pending part will go. */
function merge(plan: Plan, ready: Map<string, { top: string[]; components: A2UIComponent[] }>, placeholders: boolean): Surface {
  const children: string[] = [];
  const components: A2UIComponent[] = [];
  for (const part of plan.parts) {
    const built = ready.get(part.id);
    if (built) {
      children.push(...built.top);
      components.push(...built.components);
    } else if (placeholders) {
      const panel = part.kind !== 'object';
      const width = Math.min(Math.max(part.width ?? 0.3, 0.2), 0.6);
      children.push(`${part.id}__placeholder`);
      components.push({ id: `${part.id}__placeholder`, component: 'Shape', shape: 'box', size: panel ? [width, 0.2, 0.01] : [0.14, 0.14, 0.14],
        color: '#8ab4f8', opacity: 0.18, position: part.position });
    }
  }
  return { surfaceId: 'lesson', catalogId: SPATIAL_CATALOG_ID, dataModel: plan.dataModel ?? {}, components: [{ id: 'root', component: 'Scene', children }, ...components] };
}

function record(role: string, reply: { ms: number; promptTokens: number; completionTokens: number; finishReason: string | null }, ok: boolean, error?: string): CallRecord {
  return { role, ms: reply.ms, promptTokens: reply.promptTokens, completionTokens: reply.completionTokens, finishReason: reply.finishReason, ok, error: ok ? undefined : error };
}
