import { VisibilityState, type World } from '@iwsdk/core';
import { courseProgress, createCourse, fetchCourseLesson, listCourses, type CourseSummary } from './courses';
import { EXAMPLE_LESSONS } from './lessons';
import { onChromeHidden, onLessonStatus, openWritten, startLesson, type LessonStatus } from './overlay';
import { askForMicrophone, microphoneState, type MicrophoneState } from './voice';

/**
 * The 2D start page: what the headset browser (and a desktop) shows outside XR. Styled after the Meta
 * Horizon OS UI Set like the in-headset picker: enter mixed reality, allow the microphone (Quest Browser
 * cannot ask for it inside XR), ask for a course by typing, see the saved courses, and preview a lesson on
 * this screen. The developer prompt box sits folded at the bottom. Hidden while an XR session runs.
 */

const STYLE = `
#start-page { position: fixed; inset: 0; z-index: 10000; overflow: auto; background: linear-gradient(180deg, #1d1d1d 0%, #101010 100%);
  color: rgba(255, 255, 255, 0.9); font-family: Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
#start-page *, #start-bar * { box-sizing: border-box; }
.sp-wrap { max-width: 1000px; margin: 0 auto; padding: 32px 20px 48px; display: flex; flex-direction: column; gap: 20px; }
.sp-panel { background: linear-gradient(180deg, #414141 0%, #272727 100%); border-radius: 24px; padding: 28px;
  box-shadow: inset 1px 1px 1px rgba(255, 255, 255, 0.1), inset -1px -1px 1px rgba(0, 0, 0, 0.1), 0 24px 60px rgba(0, 0, 0, 0.35); }
.sp-eyebrow { font-size: 12px; line-height: 16px; font-weight: 500; letter-spacing: 0.4px; color: rgba(255, 255, 255, 0.7); }
.sp-h1 { margin: 6px 0 8px; font-size: 34px; line-height: 40px; font-weight: 700; letter-spacing: -0.5px; }
.sp-lead { margin: 0; max-width: 600px; font-size: 16px; line-height: 24px; color: rgba(255, 255, 255, 0.7); }
.sp-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 22px; }
.sp-btn { appearance: none; border: 0; border-radius: 1000px; min-height: 48px; padding: 12px 20px; display: inline-flex; align-items: center; gap: 8px;
  font: 600 14px/20px inherit; font-family: inherit; cursor: pointer; transition: background-color 0.12s; }
.sp-btn svg { width: 20px; height: 20px; flex-shrink: 0; }
.sp-btn:disabled { opacity: 0.4; cursor: default; }
.sp-primary { background: rgba(255, 255, 255, 0.9); color: #272727; }
.sp-primary:not(:disabled):hover { background: #d9d9d9; }
.sp-primary:not(:disabled):active { background: #c0c0c0; }
.sp-secondary { background: rgba(255, 255, 255, 0.1); color: rgba(255, 255, 255, 0.9); }
.sp-secondary:not(:disabled):hover { background: rgba(255, 255, 255, 0.16); }
.sp-secondary:not(:disabled):active { background: rgba(255, 255, 255, 0.22); }
.sp-tertiary { background: transparent; color: rgba(255, 255, 255, 0.9); min-height: 40px; padding: 8px 14px; }
.sp-tertiary:hover { background: rgba(255, 255, 255, 0.1); }
.sp-chip { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 1000px; background: rgba(0, 0, 0, 0.2);
  font-size: 12px; line-height: 16px; font-weight: 500; color: rgba(255, 255, 255, 0.7); }
.sp-dot { width: 8px; height: 8px; border-radius: 4px; background: #8a8a8a; flex-shrink: 0; }
.sp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }
@media (max-width: 780px) { .sp-grid { grid-template-columns: 1fr; } .sp-h1 { font-size: 28px; line-height: 34px; } }
.sp-col { display: flex; flex-direction: column; gap: 20px; }
.sp-title { margin: 0 0 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px;
  font-size: 20px; line-height: 24px; font-weight: 700; letter-spacing: -0.5px; }
.sp-note { font-size: 12px; line-height: 16px; font-weight: 500; color: rgba(255, 255, 255, 0.7); letter-spacing: 0; }
.sp-ask { display: flex; gap: 8px; }
.sp-input { flex: 1; min-width: 0; min-height: 48px; padding: 0 16px; border: 0; border-radius: 12px; outline: none; background: rgba(0, 0, 0, 0.25);
  color: rgba(255, 255, 255, 0.9); font: 500 14px/20px inherit; font-family: inherit; box-shadow: inset 0 1px 1px rgba(0, 0, 0, 0.2); }
.sp-input::placeholder { color: rgba(255, 255, 255, 0.45); }
.sp-input:focus { background: rgba(0, 0, 0, 0.35); box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.5); }
.sp-message { min-height: 16px; margin-top: 10px; font-size: 12px; line-height: 16px; font-weight: 500; color: rgba(255, 255, 255, 0.7); }
.sp-list { display: flex; flex-direction: column; gap: 2px; padding: 4px; border-radius: 16px; background: rgba(0, 0, 0, 0.14); }
.sp-cell { appearance: none; width: 100%; border: 0; display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 12px;
  background: transparent; color: inherit; text-align: left; font: inherit; cursor: pointer; }
.sp-cell:hover { background: rgba(255, 255, 255, 0.08); }
.sp-cell:disabled { cursor: default; }
.sp-cell:disabled:hover { background: transparent; }
.sp-cell svg { width: 20px; height: 20px; flex-shrink: 0; color: rgba(255, 255, 255, 0.7); }
.sp-cell-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.sp-text1 { font-size: 14px; line-height: 20px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sp-text2 { font-size: 12px; line-height: 16px; font-weight: 500; color: rgba(255, 255, 255, 0.7); }
.sp-track { height: 4px; margin-top: 6px; border-radius: 2px; overflow: hidden; background: rgba(255, 255, 255, 0.15); }
.sp-fill { height: 100%; background: rgba(255, 255, 255, 0.9); }
.sp-badge { width: 28px; height: 28px; border-radius: 14px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; }
.sp-lessons { display: flex; flex-direction: column; gap: 2px; padding: 2px 0 8px 32px; }
.sp-empty { padding: 14px 12px; font-size: 14px; line-height: 20px; color: rgba(255, 255, 255, 0.7); }
.sp-tiles { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
.sp-tile { appearance: none; border: 0; padding: 16px; border-radius: 16px; display: flex; flex-direction: column; gap: 6px; text-align: left;
  background: rgba(255, 255, 255, 0.08); color: inherit; font: inherit; cursor: pointer; }
.sp-tile:hover { background: rgba(255, 255, 255, 0.16); }
.sp-tile svg { width: 24px; height: 24px; color: rgba(255, 255, 255, 0.9); }
.sp-tile-title { font-size: 16px; line-height: 20px; font-weight: 700; }
.sp-tile-sub { font-size: 12px; line-height: 16px; font-weight: 500; color: rgba(255, 255, 255, 0.7); }
.sp-dev summary { cursor: pointer; font-size: 12px; line-height: 16px; font-weight: 500; color: rgba(255, 255, 255, 0.55); }
.sp-dev[open] summary { margin-bottom: 12px; }
#start-bar { position: fixed; top: 16px; left: 16px; z-index: 10000; display: none; align-items: center; gap: 8px; padding: 6px; max-width: calc(100vw - 32px);
  border-radius: 1000px; background: linear-gradient(180deg, #414141 0%, #272727 100%); color: rgba(255, 255, 255, 0.9);
  font-family: Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35); }
#start-bar .sp-bar-text { padding: 0 8px; font-size: 14px; line-height: 20px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

// Icon shapes (24 x 24, stroked) after Lucide (ISC licence), the icon set the headset UI uses.
const ICONS = {
  goggles: '<path d="M2 10a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3h-3l-2-3h-4l-2 3H5a3 3 0 0 1-3-3z"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 18v4"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  heart: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/>',
  microscope: '<path d="M6 18h8"/><path d="M3 22h18"/><path d="M14 22a7 7 0 1 0 0-14h-1"/><path d="M9 14h2"/><path d="M9 12a2 2 0 0 1-2-2V6h6v4a2 2 0 0 1-2 2Z"/><path d="M12 6V3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  flower: '<circle cx="12" cy="12" r="3"/><path d="M12 9a3 3 0 1 1 3-3M15 12a3 3 0 1 1 3 3M12 15a3 3 0 1 1-3 3M9 12a3 3 0 1 1-3-3"/>',
  book: '<path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z"/>',
} as const;
const TILE_ICONS = [ICONS.heart, ICONS.microscope, ICONS.cog, ICONS.flower];

const icon = (paths: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

// The same state colours as the picker's lesson badges.
const BADGES = {
  pending: ['rgba(255, 255, 255, 0.15)', 'rgba(255, 255, 255, 0.9)'],
  generating: ['#fc9435', '#272727'],
  ready: ['rgba(255, 255, 255, 0.9)', '#272727'],
  failed: ['#f7818c', '#272727'],
} as const;
const LESSON_STATES = { pending: 'Not written yet: tap to write it', generating: 'Writing...', ready: 'Ready: tap to preview here', failed: 'Failed: tap to try again' } as const;
const MIC_TEXT: Record<MicrophoneState, string> = {
  granted: 'Microphone allowed',
  prompt: 'Allow microphone',
  denied: 'Microphone blocked: allow it in this site\'s settings',
  unknown: 'Allow microphone',
};
const PHASE_TEXT: Record<LessonStatus['phase'], string> = {
  idle: 'No lesson open',
  building: 'Writing the lesson...',
  fixing: 'Fixing a problem in the lesson...',
  ready: 'Lesson ready',
  failed: 'That did not work',
  broken: 'Something in the lesson broke',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createStartPage(world: World, developerTools: HTMLElement) {
  const style = el('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const page = el('div');
  page.id = 'start-page';
  page.innerHTML = `
    <div class="sp-wrap">
      <section class="sp-panel">
        <div class="sp-eyebrow">SPATIAL GENERATIVE UI</div>
        <h1 class="sp-h1">Lessons on your desk</h1>
        <p class="sp-lead">Ask for any subject. An AI agent builds a hands-on course in 3D that you pick up, turn and take apart in your own room.</p>
        <div class="sp-actions">
          <button class="sp-btn sp-primary" data-id="enter">${icon(ICONS.goggles)}<span>Enter mixed reality</span></button>
          <button class="sp-btn sp-secondary" data-id="mic">${icon(ICONS.mic)}<span data-id="mic-text">Allow microphone</span></button>
        </div>
        <div class="sp-message" data-id="hero-message"></div>
      </section>
      <div class="sp-grid">
        <div class="sp-col">
          <section class="sp-panel">
            <h2 class="sp-title">Ask for a course</h2>
            <form class="sp-ask" data-id="ask">
              <input class="sp-input" data-id="ask-input" maxlength="200" placeholder="e.g. How a jet engine works" />
              <button class="sp-btn sp-primary" type="submit">Plan it</button>
            </form>
            <div class="sp-message" data-id="ask-message">In the headset you can also ask by voice.</div>
          </section>
          <section class="sp-panel">
            <h2 class="sp-title">Start a lesson <span class="sp-note">Opens at once</span></h2>
            <div class="sp-tiles" data-id="tiles"></div>
          </section>
        </div>
        <section class="sp-panel">
          <h2 class="sp-title">My courses <span class="sp-note">Saved for you</span></h2>
          <div class="sp-list" data-id="courses"><div class="sp-empty">Loading...</div></div>
        </section>
      </div>
      <details class="sp-dev"><summary>Developer tools</summary></details>
    </div>`;
  document.body.appendChild(page);
  const find = <T extends HTMLElement = HTMLElement>(id: string) => page.querySelector<T>(`[data-id="${id}"]`)!;
  page.querySelector('.sp-dev')!.appendChild(developerTools);

  // While a lesson is previewed on this screen, the page folds into a bar at the top.
  const bar = el('div');
  bar.id = 'start-bar';
  bar.innerHTML = `<button class="sp-btn sp-secondary" data-id="back">${icon(ICONS.back)}<span>Start page</span></button>
    <span class="sp-bar-text" data-id="bar-text"></span>
    <button class="sp-btn sp-primary" data-id="bar-enter">${icon(ICONS.goggles)}<span>Enter mixed reality</span></button>`;
  document.body.appendChild(bar);

  let previewing = false;
  let immersive = false;
  let hiddenByHost = false;
  let courses: CourseSummary[] = [];
  const expanded = new Set<string>();
  let poll = 0;

  const show = () => {
    const visible = !immersive && !hiddenByHost;
    page.style.display = visible && !previewing ? 'block' : 'none';
    bar.style.display = visible && previewing ? 'flex' : 'none';
  };
  world.visibilityState.subscribe((state) => {
    immersive = state !== VisibilityState.NonImmersive;
    show();
  });
  onChromeHidden((hidden) => {
    hiddenByHost = hidden;
    show();
  });
  const preview = (on: boolean) => {
    previewing = on;
    show();
    if (!on) void refresh();
  };
  onLessonStatus((status) => {
    bar.querySelector<HTMLElement>('[data-id="bar-text"]')!.textContent = PHASE_TEXT[status.phase];
  });

  // Mixed reality.
  const enter = async () => {
    try {
      await world.launchXR();
    } catch (err) {
      find('hero-message').textContent = `Could not start mixed reality: ${(err as Error).message}`;
    }
  };
  const xrPossible = world.xrEnabled && 'xr' in navigator;
  for (const id of ['enter', 'bar-enter']) {
    const button = (id === 'enter' ? page : bar).querySelector<HTMLButtonElement>(`[data-id="${id}"]`)!;
    button.disabled = !xrPossible;
    button.addEventListener('click', () => void enter());
  }
  if (!xrPossible) find('hero-message').textContent = 'Mixed reality needs a headset browser, such as the Meta Quest browser.';

  // The microphone, asked for here because the headset cannot ask inside XR.
  const micButton = find<HTMLButtonElement>('mic');
  const showMic = (state: MicrophoneState) => {
    find('mic-text').textContent = MIC_TEXT[state];
    micButton.disabled = state === 'granted' || state === 'denied';
  };
  void microphoneState().then(showMic);
  micButton.addEventListener('click', async () => showMic(await askForMicrophone()));

  // Ask for a course by typing.
  find<HTMLFormElement>('ask').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = find<HTMLInputElement>('ask-input');
    const subject = input.value.trim();
    if (!subject) return;
    find('ask-message').textContent = `Planning a course on "${subject}"...`;
    try {
      const course = await createCourse(subject);
      input.value = '';
      expanded.add(course.id);
      find('ask-message').textContent = 'Planned. Its lessons are being written; they appear under My courses.';
      await refresh();
    } catch (err) {
      find('ask-message').textContent = `That did not work: ${(err as Error).message}`;
    }
  });

  // Example lessons.
  EXAMPLE_LESSONS.forEach((lesson, i) => {
    const tile = el('button', 'sp-tile');
    tile.innerHTML = icon(TILE_ICONS[i] ?? ICONS.book);
    tile.append(el('span', 'sp-tile-title', lesson.title), el('span', 'sp-tile-sub', lesson.sub));
    tile.addEventListener('click', () => {
      preview(true);
      void startLesson(lesson.prompt);
    });
    find('tiles').appendChild(tile);
  });

  // Saved courses.
  async function refresh() {
    try {
      courses = await listCourses();
    } catch {
      return;
    }
    renderCourses();
    clearTimeout(poll);
    const active = courses.some((c) => c.status === 'planning' || c.model?.status === 'building' || c.lessons.some((l) => l.status === 'generating'));
    if (page.style.display !== 'none') poll = window.setTimeout(() => void refresh(), active ? 4000 : 20000);
  }

  function renderCourses() {
    const list = find('courses');
    list.replaceChildren();
    if (courses.length === 0) {
      list.appendChild(el('div', 'sp-empty', 'No courses yet. Ask for one above.'));
      return;
    }
    for (const course of courses) {
      const row = el('button', 'sp-cell');
      row.innerHTML = icon(ICONS.book);
      const text = el('div', 'sp-cell-text');
      const ready = course.lessons.filter((l) => l.status === 'ready').length;
      const track = el('div', 'sp-track');
      const fill = el('div', 'sp-fill');
      fill.style.width = `${course.lessons.length ? Math.round((100 * ready) / course.lessons.length) : 0}%`;
      track.appendChild(fill);
      text.append(el('span', 'sp-text1', course.title), el('span', 'sp-text2', courseProgress(course)), track);
      row.appendChild(text);
      row.insertAdjacentHTML('beforeend', icon(expanded.has(course.id) ? ICONS.down : ICONS.chevron));
      row.addEventListener('click', () => {
        if (expanded.has(course.id)) expanded.delete(course.id);
        else expanded.add(course.id);
        renderCourses();
      });
      list.appendChild(row);
      if (!expanded.has(course.id)) continue;
      const lessons = el('div', 'sp-lessons');
      course.lessons.forEach((lesson, index) => {
        const cell = el('button', 'sp-cell');
        const badge = el('span', 'sp-badge', String(index + 1));
        [badge.style.background, badge.style.color] = BADGES[lesson.status];
        const words = el('div', 'sp-cell-text');
        words.append(el('span', 'sp-text1', lesson.title), el('span', 'sp-text2', LESSON_STATES[lesson.status]));
        cell.append(badge, words);
        cell.disabled = lesson.status === 'generating';
        cell.addEventListener('click', () => void openLesson(course.id, index));
        lessons.appendChild(cell);
      });
      list.appendChild(lessons);
    }
  }

  async function openLesson(courseId: string, index: number) {
    try {
      const lesson = await fetchCourseLesson(courseId, index);
      if (lesson.status === 'ready' && lesson.code) {
        preview(true);
        await openWritten(lesson.code, lesson.prompt);
      }
    } catch {
      // The list shows what the server says next.
    }
    await refresh();
  }

  bar.querySelector('[data-id="back"]')!.addEventListener('click', () => preview(false));
  show();
  void refresh();
}
