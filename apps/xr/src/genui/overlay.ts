import { aimPoint, capture, dropLessonRealSize, inspectFrame, zoomGame, forgetLessonSpot, inspectMounted, debugHands, debugRay, debugRoot, lessonDeclaresRealSize, mountGenerated, setLessonRealSize, setLessonView, unmountGenerated, type MountReport, type PlayMode } from './host.js';
import { inspectPill, pressPill, setPillHidden } from './hud.js';
import { EXAMPLE_LESSONS, type SavedLesson } from './lessons.js';
import { inspectPicker, pickerCourses, redockPicker, setPickerHidden } from './picker.js';
import { inspectMoveHandles, setMoveHandlesHidden } from './handle.js';

/**
 * The developer prompt box (folded into the start page, start-page.ts), and the lesson state the start
 * page, the box and the in-headset picker (picker.ts) all follow through onLessonStatus. DOM is not visible
 * inside an immersive session.
 */

/** What is on the desk: a lesson (Learn) or a game (Play). */
export type LessonKind = 'lesson' | 'game';

/** Where the current lesson is, for the in-headset picker. */
export type LessonStatus = {
  phase: 'idle' | 'building' | 'fixing' | 'ready' | 'failed' | 'broken';
  prompt: string | null;
  kind: LessonKind;
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
  /** A game has no real-size view and is repaired with the game prompt. */
  kind: LessonKind;
  /** Where it plays: on the desk (mixed reality, toy size) or as a world around the player. Unset: the module's own. */
  mode: PlayMode | null;
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
  kind: 'lesson',
  mode: null,
  code: null,
  lastResponse: null,
  lastMount: null,
  runtimeErrors: [],
  busy: false,
  assetJobs: [],
  mountedAt: 0,
  autoRepaired: false,
};

let lessonStatus: LessonStatus = { phase: 'idle', prompt: null, kind: 'lesson', message: '', since: performance.now() };
const statusListeners = new Set<(status: LessonStatus) => void>();
const chromeListeners = new Set<(hidden: boolean) => void>();

/** Follow genui.setOverlayHidden (the benchmark hides all chrome before its screenshots). */
export function onChromeHidden(listener: (hidden: boolean) => void) {
  chromeListeners.add(listener);
}

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
  lessonStatus = { phase, prompt: state.prompt, kind: state.kind, message, since };
  for (const listener of statusListeners) listener(lessonStatus);
}

let statusEl: HTMLDivElement;
let assetsEl: HTMLDivElement;
let codeEl: HTMLPreElement;
let repairButton: HTMLButtonElement;
let rebuildButton: HTMLButtonElement;
let assetWatch = 0;

/** The developer prompt box: write any lesson live, repair, see the code. Returns it for the start page to hold. */
export function createOverlay(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'sp-panel';
  root.style.cssText = 'display:flex;flex-direction:column;gap:10px;font-size:14px;line-height:20px;';
  root.innerHTML = `
    <div class="sp-title" style="margin:0">Write a lesson live</div>
    <textarea rows="2" placeholder="e.g. Show me how a lever lifts a heavy box" class="sp-input"
      style="resize:vertical;padding:12px 16px;min-height:72px"></textarea>
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
  for (const button of root.querySelectorAll('button')) button.className = 'sp-btn sp-secondary';
  root.querySelector('[data-action="generate"]')!.className = 'sp-btn sp-primary';
  for (const pre of root.querySelectorAll<HTMLElement>('[data-role="status"], [data-role="assets"]')) pre.style.color = 'rgba(255, 255, 255, 0.7)';

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
    watchLive,
    lessonStatus: () => lessonStatus,
    repair,
    rebuild,
    mount,
    clear,
    state,
    inspect: inspectMounted,
    inspectPicker,
    inspectMoveHandles,
    inspectFrame,
    inspectPill,
    pressPill,
    setLessonView,
    setLessonRealSize,
    courses: pickerCourses,
    debugRay,
    debugRoot,
    debugHands,
    zoomGame,
    capture,
    aimPoint,
    // Hides all chrome, the in-headset picker too (the benchmark's screenshots show the lesson only).
    setOverlayHidden: (hidden: boolean) => {
      for (const listener of chromeListeners) listener(hidden);
      setPickerHidden(hidden);
      setMoveHandlesHidden(hidden);
      setPillHidden(hidden);
    },
  };
  return root;
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
  liveWatch++; // a live lesson replaces the one being watched
  streaming = false; // the superseded watch leaves the flag to whoever runs now
  if (PARALLEL && !extra.previousCode) return generateStream(prompt);
  state.busy = true;
  repairPending = false;
  if (!extra.previousCode) state.autoRepaired = false; // a new lesson gets its own automatic repair
  if (!extra.previousCode) {
    // The prompt box writes lessons, on the desk unless they say otherwise; a repair keeps the kind and the mode.
    state.kind = 'lesson';
    state.mode = null;
  }
  state.prompt = prompt;
  repairButton.hidden = true;
  stopWatchingAssets();
  setStatus('Generating…');
  setPhase(extra.previousCode ? 'fixing' : 'building');
  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, kind: state.kind, ...extra }),
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
  state.kind = 'lesson';
  state.mode = null;
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
async function mountPartial(code: string, preview = false) {
  state.code = code;
  state.runtimeErrors = [];
  codeEl.textContent = code;
  sizeTicket++;
  const report = await mountGenerated(code, preview ? { kind: state.kind, preview: true } : {});
  if (!report.ok && report.superseded) return; // a later part replaced it
  state.lastMount = report;
}

/** The live preview being watched; anything else opening (or a second watch) ends it. */
let liveWatch = 0;
const LIVE_POLL_MS = 1000;

type LiveView = { line: string; stage: string; detail: string; parts: string[]; seq: number; meshes: number; done: boolean; ok: boolean; code?: string };
/** Where the shelf has the lesson or game: its code once it is written, or why it failed. */
export type LiveOutcome = { code?: string; failed?: string } | null;

/**
 * Watch a course lesson or a game while the server writes it (GET /api/live/<key>, the server's live.py): the
 * status line follows what the writer is doing, and every gate-checked snapshot of the scene so far is mounted
 * on the desk, its new parts growing in. When the shelf has the code (`outcome`) it opens as usual. Before the
 * writer starts (a lesson waiting for its course's 3D model) there is nothing to show yet, so it waits.
 */
export async function watchLive(key: string, prompt: string, kind: LessonKind, outcome: () => Promise<LiveOutcome>) {
  if (state.busy) return state;
  const watch = ++liveWatch;
  state.prompt = prompt;
  state.kind = kind;
  state.mode = null;
  state.autoRepaired = false;
  repairPending = false;
  stopWatchingAssets();
  streaming = true;
  setStatus('Watching it being written…');
  setPhase('building', 'starting');
  let seq = 0;
  try {
    while (watch === liveWatch) {
      let view: LiveView | null = null;
      try {
        const res = await fetch(`/api/live/${key}?after=${seq}`);
        view = res.ok ? ((await res.json()) as LiveView) : null;
      } catch {
        view = null; // the server may be restarting
      }
      if (watch !== liveWatch) return state;
      if (view) {
        if (view.code && view.seq > seq) {
          seq = view.seq;
          await mountPartial(view.code, true);
          if (watch !== liveWatch) return state;
        }
        setPhase('building', view.line, true);
        setStatus(`${view.line}${view.parts.length ? `\n${view.parts.join(', ')}` : ''}`);
        if (view.done && !view.ok) {
          setStatus(`Writing failed: ${view.detail}`);
          setPhase('failed', view.detail || 'it could not be written');
          return state;
        }
      }
      if (!view || view.done) {
        const shelf = await outcome().catch(() => null);
        if (watch !== liveWatch) return state;
        if (shelf?.code) {
          liveWatch++;
          streaming = false;
          await mountWritten(shelf.code);
          return state;
        }
        if (shelf?.failed) {
          setPhase('failed', shelf.failed);
          return state;
        }
        if (!view) setPhase('building', 'waiting to start', true);
      }
      await new Promise((resolve) => window.setTimeout(resolve, LIVE_POLL_MS));
    }
  } finally {
    if (watch === liveWatch) streaming = false;
  }
  return state;
}

/** The finished lesson or game after a live preview: opened like a saved one (the prompt and kind are set). */
async function mountWritten(code: string) {
  await mount(code);
  if (state.lastMount?.ok) setStatus(state.kind === 'game' ? 'A saved game.' : 'Lesson from a saved course.');
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
    state.kind = 'lesson';
    state.mode = null;
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

/** Open a lesson or game that is already written (a saved course's lesson, a saved game): no model call. */
export async function openWritten(code: string, prompt: string, kind: LessonKind = 'lesson', mode: PlayMode | null = null) {
  if (state.busy) return state;
  state.mode = mode;
  liveWatch++; // opening something else stops watching one being written
  streaming = false; // otherwise the stopped watch would keep repairs off for this lesson
  state.prompt = prompt;
  state.kind = kind;
  state.autoRepaired = false;
  repairPending = false;
  stopWatchingAssets();
  await mount(code);
  if (state.lastMount?.ok) setStatus(kind === 'game' ? 'A saved game.' : 'Lesson from a saved course.');
  return state;
}

async function mount(code: string) {
  state.code = code;
  state.runtimeErrors = [];
  codeEl.textContent = code;
  state.mountedAt = performance.now();
  const sizeFor = ++sizeTicket;
  const report = await mountGenerated(code, { kind: state.kind, ...(state.mode ? { mode: state.mode } : {}) });
  // A later lesson replaced this one while it loaded: that one reports for itself.
  if (!report.ok && report.superseded) return report;
  state.lastMount = report;
  if (!state.lastMount.ok) reportRuntimeError(state.lastMount.error);
  // Any lesson in the scene docks the picker, however it was mounted (generate, tests, saved lessons).
  else {
    // A game is played at desk scale: no real-size view, whatever its code declares.
    if (state.kind === 'game') dropLessonRealSize();
    setPhase('ready');
    if (state.kind === 'lesson' && state.prompt && !lessonDeclaresRealSize()) void lookUpRealSize(state.prompt, sizeFor);
  }
  return state.lastMount;
}

// Which mount a size answer is for: any mount, a streaming part's too, makes earlier answers stale.
let sizeTicket = 0;

/** Ask the size agent how big the lesson's subject really is, for the view pill (answers are cached per subject). */
async function lookUpRealSize(request: string, ticket: number) {
  try {
    // The subject comes first; course lesson prompts run past the 500 characters the server takes.
    const res = await fetch('/api/real-size', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request: request.slice(0, 480) }) });
    if (!res.ok) return;
    const answer = (await res.json()) as { sizeM?: number | null };
    // Only for the lesson still open.
    if (sizeTicket === ticket) setLessonRealSize(answer.sizeM ?? null);
  } catch {
    // No size: the pill stays hidden for this lesson.
  }
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
  forgetLessonSpot(); // the next lesson finds its place afresh
  redockPicker();
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
