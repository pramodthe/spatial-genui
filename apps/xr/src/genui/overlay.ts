import { aimPoint, inspectMounted, debugRay, mountGenerated, unmountGenerated, type MountReport } from './host.js';

/**
 * Desktop/emulator prompt box for Phase 1 testing. In-headset input (topic chips,
 * voice) comes in Phase 4; DOM overlays are not visible inside an immersive session.
 */

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
};

const state: GenUIState = {
  prompt: null,
  code: null,
  lastResponse: null,
  lastMount: null,
  runtimeErrors: [],
  busy: false,
  assetJobs: [],
};

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
      <button data-prompt="Show me how blood flows through the heart, step by step.">Heart</button>
      <button data-prompt="Teach me the parts of a microscope and what each part does.">Microscope</button>
      <button data-prompt="Teach me how two gears change speed and turning force.">Gears</button>
      <button data-prompt="Teach me the parts of a flower and what each part does.">Flower</button>
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
      void generate(example);
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
    repair,
    rebuild,
    mount,
    clear,
    state,
    inspect: inspectMounted,
    debugRay,
    aimPoint,
    setOverlayHidden: (hidden: boolean) => (root.style.display = hidden ? 'none' : 'flex'),
  };
}

export function reportRuntimeError(message: string) {
  state.runtimeErrors.push(message);
  console.error('[GenUI]', message);
  setStatus(`Runtime error: ${message}`);
  if (state.code) repairButton.hidden = false;
}

async function generate(prompt: string, extra: { previousCode?: string; clientError?: string } = {}) {
  prompt = prompt.trim();
  if (!prompt || state.busy) return state;
  state.busy = true;
  state.prompt = prompt;
  repairButton.hidden = true;
  stopWatchingAssets();
  setStatus('Generating…');
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
  } finally {
    state.busy = false;
  }
  return state;
}

async function mount(code: string) {
  state.code = code;
  state.runtimeErrors = [];
  codeEl.textContent = code;
  state.lastMount = await mountGenerated(code);
  if (!state.lastMount.ok) reportRuntimeError(state.lastMount.error);
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

async function repair() {
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
}

function setStatus(text: string) {
  statusEl.textContent = text;
}
