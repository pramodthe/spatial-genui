import { aimPoint, capture, inspectMounted, debugRay, debugRoot, mountGenerated, unmountGenerated, type MountReport } from './host.js';
import { EXAMPLE_LESSONS, type SavedLesson } from './lessons.js';
import { inspectPicker, pickerCourses, setPickerHidden } from './picker.js';

/**
 * Desktop/emulator prompt box, and the lesson state both it and the in-headset picker (picker.ts) drive.
 * DOM overlays are not visible inside an immersive session; the picker follows the lesson through
 * onLessonStatus.
 */

/** Where the current lesson is, for the in-headset picker. */
export type LessonStatus = {
  phase: 'idle' | 'building' | 'fixing' | 'ready' | 'failed' | 'broken';
  prompt: string | null;
  message: string;
  /** performance.now() when this phase began. */
  since: number;
};

// Parallel generation (SPEC.md Phase 5): /?parallel=1 streams a lesson in part by part (/api/generate-stream).
const PARALLEL = new URLSearchParams(location.search).has('parallel');

// A runtime error this soon after mounting comes from loading the lesson (a panel element it never
// created, a broken first frame), not from the learner using it: repair once without asking.
const AUTO_REPAIR_WINDOW_MS = 8000;

type GenerateResponse = {
  ok: boolean;
  code?: string;
  error?: string;
  attempts?: { stage: string; ms: number }[];
  totalMs?: number;
  model?: string;
  stats?: Record<string, unknown>;
  /** Models being fetched or generated in the background for this lesson (the server's on-demand path). */
  pendingAssets?: { jobId: string; name: string }[];
};

type AssetJob = { id: string; name: string; status: 'queued' | 'running' | 'done' | 'failed'; events: { message: string }[]; assetId?: string; error?: string };

type GenUIState = {
  prompt: string | null;
  code: string | null;
  lastResponse: GenerateResponse | null;
  lastMount: MountReport | null;
  runtimeErrors: string[];
  busy: boolean;
  /** Background model jobs for the current lesson, as last polled. */
  assetJobs: AssetJob[];
  /** performance.now() when the current lesson mounted. */
  mountedAt: number;
  /** The current lesson has had its one automatic repair. */
  autoRepaired: boolean;
};

const state: GenUIState = {
  prompt: null,
  code: null,
  lastResponse: null,
  lastMount: null,
  runtimeErrors: [],
  busy: false,
  assetJobs: [],
  mountedAt: 0,
  autoRepaired: false,
};

let lessonStatus: LessonStatus = { phase: 'idle', prompt: null, message: '', since: performance.now() };
const statusListeners = new Set<(status: LessonStatus) => void>();

/** The current lesson's request (for "Make a new one"). */
export function lessonPrompt(): string | null {
  return state.prompt;
}

/** Follow the lesson's phase; the listener gets the current one at once. Returns an unsubscribe. */
export function onLessonStatus(listener: (status: LessonStatus) => void): () => void {
  statusListeners.add(listener);
  listener(lessonStatus);
  return () => statusListeners.delete(listener);
}

function setPhase(phase: LessonStatus['phase'], message = '', keepSince = false) {
  const since = keepSince && lessonStatus.phase === phase ? lessonStatus.since : performance.now();
  lessonStatus = { phase, prompt: state.prompt, message, since };
  for (const listener of statusListeners) listener(lessonStatus);
}

let statusEl: HTMLDivElement;
let assetsEl: HTMLDivElement;
let codeEl: HTMLPreElement;
let repairButton: HTMLButtonElement;
let rebuildButton: HTMLButtonElement;
let assetWatch = 0;

export function createOverlay() {
  const root = document.createElement('div');
  root.style.cssText =
    // Above IWER's emulated-XR layer (z-index 999) and clear of its corner Pose/Pinch panels.
    'position:fixed;left:12px;bottom:96px;width:min(440px,calc(100vw - 24px));z-index:10000;' +
    'font:14px/1.4 system-ui,sans-serif;color:#eef0f3;background:rgba(20,22,27,.92);' +
    'border:1px solid #3a3d44;border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:8px;';
  root.innerHTML = `
    <div style="font-weight:700">Generative UI</div>
    <textarea rows="2" placeholder="e.g. Teach me the solar system with a short quiz"
      style="resize:vertical;font:inherit;color:inherit;background:#0f1114;border:1px solid #3a3d44;border-radius:8px;padding:8px"></textarea>
    <div data-role="examples" style="display:flex;gap:6px;flex-wrap:wrap">
      ${EXAMPLE_LESSONS.map((lesson) => `<button data-prompt="${lesson.prompt}">${lesson.title}</button>`).join('')}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button data-action="generate">Generate</button>
      <button data-action="repair" hidden>Repair runtime error</button>
      <button data-action="rebuild" hidden>Rebuild with the accurate model</button>
      <button data-action="clear">Clear</button>
      <button data-action="code">Show code</button>
    </div>
    <div data-role="status" style="white-space:pre-wrap;color:#b8bec8"></div>
    <div data-role="assets" style="white-space:pre-wrap;color:#9fd3a8"></div>
    <pre data-role="code" hidden style="max-height:40vh;overflow:auto;margin:0;font:12px/1.4 ui-monospace,monospace;background:#0f1114;padding:8px;border-radius:8px"></pre>`;
  for (const button of root.querySelectorAll('button')) {
    button.style.cssText =
      'font:inherit;color:#fff;background:#2f6fdb;border:0;border-radius:8px;padding:6px 12px;cursor:pointer';
  }
  // Example lessons (one tap, for trying the app in a headset without typing): quieter than the actions.
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-prompt]')) button.style.background = '#3a3d44';
  document.body.appendChild(root);

  const input = root.querySelector('textarea')!;
  statusEl = root.querySelector('[data-role="status"]')!;
  assetsEl = root.querySelector('[data-role="assets"]')!;
  rebuildButton = root.querySelector('[data-action="rebuild"]')!;
  codeEl = root.querySelector('[data-role="code"]')!;
  repairButton = root.querySelector('[data-action="repair"]')!;

  root.addEventListener('click', (event) => {
    const example = (event.target as HTMLElement).dataset.prompt;
    if (example) {
      input.value = example;
      void startLesson(example);
    }
    const action = (event.target as HTMLElement).dataset.action;
    if (action === 'generate') void generate(input.value);
    if (action === 'repair') void repair();
    if (action === 'rebuild') void rebuild();
    if (action === 'clear') clear();
    if (action === 'code') codeEl.hidden = !codeEl.hidden;
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void generate(input.value);
    }
  });

  // A lesson can be started from the address: /?prompt=Teach%20me%20... (e.g. when launching the page on a headset).
  const linked = new URLSearchParams(location.search).get('prompt');
  if (linked) {
    input.value = linked;
    void generate(linked);
  }

  // Scriptable entry point for automated tests (CLI/Playwright) and the benchmark harness.
  (window as unknown as { genui: unknown }).genui = {
    generate,
    generateParallel: (prompt: string) => generateStream(prompt),
    startLesson,
    openWritten,
    repair,
    rebuild,
    mount,
    clear,
    state,
    inspect: inspectMounted,
    inspectPicker,
    courses: pickerCourses,
    debugRay,
    debugRoot,
    capture,
    aimPoint,
    // Hides all chrome, the in-headset picker too (the benchmark's screenshots show the lesson only).
    setOverlayHidden: (hidden: boolean) => {
      root.style.display = hidden ? 'none' : 'flex';
      setPickerHidden(hidden);
    },
  };
}

export function reportRuntimeError(message: string) {
  state.runtimeErrors.push(message);
  console.error('[GenUI]', message);
  setStatus(`Runtime error: ${message}`);
  // While a lesson streams in, its partial versions are replaced as parts arrive: only the final one counts.
  if (!state.code || streaming) return;
  repairButton.hidden = false;
  // In a headset nobody can reach the repair button: a lesson that breaks while loading is repaired
  // once on its own. A later break (from using it) waits for the learner to ask ("Fix it").
  const loading = state.lastMount?.ok === false || performance.now() - state.mountedAt < AUTO_REPAIR_WINDOW_MS;
  if (loading && !state.autoRepaired) {
    state.autoRepaired = true;
    repairPending = true;
    setPhase('fixing', message);
    setTimeout(() => void repair(), 50); // after the generate() that mounted it has finished, and the errors that came with it
  } else if (!repairPending) {
    setPhase('broken', message);
  }
}

/** An automatic repair is scheduled but hasn't started: later errors from the same load join it. */
let repairPending = false;

export async function generate(prompt: string, extra: { previousCode?: string; clientError?: string } = {}) {
  prompt = prompt.trim();
  if (!prompt || state.busy) return state;
  if (PARALLEL && !extra.previousCode) return generateStream(prompt);
  state.busy = true;
  repairPending = false;
  if (!extra.previousCode) state.autoRepaired = false; // a new lesson gets its own automatic repair
  state.prompt = prompt;
  repairButton.hidden = true;
  stopWatchingAssets();
  setStatus('Generating…');
  setPhase(extra.previousCode ? 'fixing' : 'building');
  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, ...extra }),
    });
    const data = (await res.json()) as GenerateResponse;
    state.lastResponse = data;
    if (!res.ok || !data.ok || !data.code) {
      setStatus(`Generation failed: ${data.error ?? res.statusText}`);
      setPhase('failed', data.error ?? res.statusText);
      return state;
    }
    await mount(data.code);
    const stages = data.attempts?.map((a) => a.stage).join(' → ');
    if (state.lastMount?.ok) {
      setStatus(
        `Done in ${((data.totalMs ?? 0) / 1000).toFixed(1)} s with ${data.model} (attempts: ${stages}).` +
          (state.lastMount.warnings.length ? `\n${state.lastMount.warnings.join('\n')}` : '') +
          // Library models are CC BY: their full credit is shown wherever the lesson runs.
          (state.lastMount.credits.length ? `\n${state.lastMount.credits.join('\n')}` : ''),
      );
    }
    if (data.pendingAssets?.length) watchAssets(data.pendingAssets);
  } catch (err) {
    setStatus(`Request failed: ${(err as Error).message}`);
    setPhase('failed', (err as Error).message);
  } finally {
    state.busy = false;
  }
  return state;
}

/** True while a parallel lesson streams in (its partial mounts don't dock the picker or trigger repairs). */
let streaming = false;

/**
 * Parallel generation: placeholders as soon as the plan exists, then each part as it is ready. Every event
 * carries the whole lesson so far, so each one is a plain remount.
 */
async function generateStream(prompt: string) {
  prompt = prompt.trim();
  if (!prompt || state.busy) return state;
  state.busy = true;
  streaming = true;
  repairPending = false;
  state.autoRepaired = false;
  state.prompt = prompt;
  repairButton.hidden = true;
  stopWatchingAssets();
  setStatus('Planning…');
  setPhase('building', 'planning');
  try {
    const res = await fetch('/api/generate-stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    if (!res.ok || !res.body) throw new Error(res.statusText || `HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      for (let nl = buffered.indexOf('\n'); nl >= 0; nl = buffered.indexOf('\n')) {
        const line = buffered.slice(0, nl).trim();
        buffered = buffered.slice(nl + 1);
        if (line) await onStreamEvent(JSON.parse(line));
      }
    }
  } catch (err) {
    setStatus(`Request failed: ${(err as Error).message}`);
    setPhase('failed', (err as Error).message);
  } finally {
    streaming = false;
    state.busy = false;
  }
  return state;
}

type StreamEvent =
  | { type: 'PLAN_READY'; ms: number; code: string; plan: { parts: { id: string }[] } }
  | { type: 'COMPONENT_READY'; ms: number; code: string; ready: number; total: number; partId: string }
  | { type: 'COMPONENT_FAILED'; ms: number; partId: string; error: string }
  | { type: 'RESULT'; result: GenerateResponse & { timings?: { planMs: number; firstPartMs: number | null; totalMs: number } } }
  | { type: string };

async function onStreamEvent(event: StreamEvent) {
  if (event.type === 'PLAN_READY' && 'plan' in event) {
    await mountPartial(event.code);
    setPhase('building', `0 of ${event.plan.parts.length} parts`, true);
    setStatus(`Plan ready in ${(event.ms / 1000).toFixed(1)} s: ${event.plan.parts.map((p) => p.id).join(', ')}`);
  } else if (event.type === 'COMPONENT_READY' && 'ready' in event) {
    await mountPartial(event.code);
    setPhase('building', `${event.ready} of ${event.total} parts`, true);
    setStatus(`${event.partId} ready at ${(event.ms / 1000).toFixed(1)} s (${event.ready} of ${event.total})`);
  } else if (event.type === 'COMPONENT_FAILED' && 'error' in event) {
    setStatus(`${event.partId} failed: ${event.error}`);
  } else if (event.type === 'RESULT' && 'result' in event) {
    const result = event.result;
    state.lastResponse = result;
    if (!result.ok || !result.code) {
      setStatus(`Generation failed: ${result.error ?? 'unknown error'}`);
      setPhase('failed', result.error ?? 'unknown error');
      return;
    }
    streaming = false; // the finished lesson is a normal lesson (picker docks, repairs apply)
    await mount(result.code);
    const t = result.timings;
    if (state.lastMount?.ok && t) {
      setStatus(`Done in ${(t.totalMs / 1000).toFixed(1)} s (plan ${(t.planMs / 1000).toFixed(1)} s, first part ${((t.firstPartMs ?? 0) / 1000).toFixed(1)} s) with ${result.model}.`);
    }
  }
}

/** Mount a lesson that is still streaming in: no picker docking, no repair. */
async function mountPartial(code: string) {
  state.code = code;
  state.runtimeErrors = [];
  codeEl.textContent = code;
  state.lastMount = await mountGenerated(code);
}

/**
 * A picker card: the example's ready-made lesson if there is one (instant, no model call), otherwise a live
 * generation. Other requests always generate live.
 */
export async function startLesson(prompt: string) {
  const example = EXAMPLE_LESSONS.find((lesson) => lesson.prompt === prompt);
  if (!example?.saved || state.busy) return generate(prompt);
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}lessons/${example.saved}.json`);
    if (!res.ok) return generate(prompt);
    const saved = (await res.json()) as SavedLesson;
    state.prompt = prompt;
    state.autoRepaired = false;
    repairPending = false;
    stopWatchingAssets();
    await mount(saved.code);
    if (state.lastMount?.ok) {
      setStatus(`Ready-made lesson (written by ${saved.model}, ${saved.generatedAt.slice(0, 10)}).` +
        (state.lastMount.credits.length ? `\n${state.lastMount.credits.join('\n')}` : ''));
    }
    return state;
  } catch {
    return generate(prompt);
  }
}

/** Open a lesson that is already written (a saved course's lesson): no model call. */
export async function openWritten(code: string, prompt: string) {
  if (state.busy) return state;
  state.prompt = prompt;
  state.autoRepaired = false;
  repairPending = false;
  stopWatchingAssets();
  await mount(code);
  if (state.lastMount?.ok) setStatus('Lesson from a saved course.');
  return state;
}

async function mount(code: string) {
  state.code = code;
  state.runtimeErrors = [];
  codeEl.textContent = code;
  state.mountedAt = performance.now();
  state.lastMount = await mountGenerated(code);
  if (!state.lastMount.ok) reportRuntimeError(state.lastMount.error);
  // Any lesson in the scene docks the picker, however it was mounted (generate, tests, saved lessons).
  else setPhase('ready');
  return state.lastMount;
}

/**
 * On-demand assets: the lesson was built from shapes because the library had no model of its subject;
 * the server is fetching or generating one. Show its progress and, when it is in the library, offer
 * to build the lesson again around it (never automatically: the learner may be mid-lesson).
 */
function watchAssets(pending: { jobId: string; name: string }[]) {
  const watch = ++assetWatch;
  const poll = async () => {
    if (watch !== assetWatch) return;
    try {
      state.assetJobs = await Promise.all(pending.map(async (p) => (await fetch(`/api/assets/jobs/${p.jobId}`)).json() as Promise<AssetJob>));
    } catch {
      setTimeout(poll, 5000); // the server may be restarting
      return;
    }
    if (watch !== assetWatch) return;
    assetsEl.textContent = state.assetJobs.map((job) =>
      job.status === 'done' ? `An accurate model of ${job.name} is ready.`
        : job.status === 'failed' ? `No accurate model of ${job.name}: ${job.error}`
          : `Getting an accurate model of ${job.name}: ${job.events[job.events.length - 1]?.message ?? 'queued'}...`).join('\n');
    const running = state.assetJobs.some((job) => job.status === 'queued' || job.status === 'running');
    rebuildButton.hidden = running || !state.assetJobs.some((job) => job.status === 'done');
    if (running) setTimeout(poll, 3000);
  };
  void poll();
}

function stopWatchingAssets() {
  assetWatch++;
  state.assetJobs = [];
  assetsEl.textContent = '';
  rebuildButton.hidden = true;
}

/** Build the current lesson again, now that the model it lacked is in the library. */
async function rebuild() {
  return state.prompt ? generate(state.prompt) : state;
}

export async function repair() {
  if (!state.prompt || !state.code || state.runtimeErrors.length === 0) return state;
  return generate(state.prompt, { previousCode: state.code, clientError: state.runtimeErrors.join('\n') });
}

function clear() {
  unmountGenerated();
  state.code = null;
  state.runtimeErrors = [];
  repairButton.hidden = true;
  stopWatchingAssets();
  setStatus('');
  setPhase('idle');
}

function setStatus(text: string) {
  statusEl.textContent = text;
}
