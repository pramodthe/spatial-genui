import { VisibilityState, type World } from '@iwsdk/core';
import { APP_NAME, CARD_COLORS, COLORS, MASCOT_NAME } from './brand';
import { isFolder, myCards, readyCards, type Card } from './cards';
import { fetchCourseLesson, listCourses, type CourseSummary } from './courses';
import { EXAMPLE_GAMES, createGame, fetchGame, fixGame, listGames, loadExampleGame, openGamePage, type GameSummary } from './games';
import { EXAMPLE_LESSONS } from './lessons';
import { createMuseCanvas } from './muse-canvas';
import { onChromeHidden, onLessonStatus, openWritten, startLesson, type LessonStatus } from './overlay';
import { askForMicrophone, microphoneState, type MicrophoneState } from './voice';

/**
 * The 2D start page: what the headset browser (and a desktop) shows outside XR, made for players about 9 to 12.
 * One shelf of cards, since everything here is a game you learn from: the ready-made ones first, then the player's
 * own games (a card appears the moment one is asked for and shows it being made until it is ready), each with a
 * picture of the game itself. Above them Muse, the mascot (in 3D, muse-canvas.ts), asks what you wonder about. The microphone is asked for here because the
 * headset cannot ask inside XR. A game previews on this screen with a bar on top. The developer prompt box sits
 * folded at the bottom. Hidden while an XR session runs.
 */

// Lilita One for headlines and card names (chunky, game-like); Atkinson Hyperlegible Next for reading, made for legibility.
const FONTS = 'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Next:wght@400;700&family=Lilita+One&display=swap';

const STYLE = `
#start-page, #start-bar {
  --sky: ${COLORS.sky}; --ink: ${COLORS.ink}; --paper: ${COLORS.paper}; --sun: ${COLORS.sun}; --green: ${COLORS.green}; --pink: ${COLORS.pink};
  --display: 'Lilita One', 'Arial Rounded MT Bold', system-ui, sans-serif;
  --text: 'Atkinson Hyperlegible Next', 'Atkinson Hyperlegible', system-ui, -apple-system, 'Segoe UI', sans-serif;
}
#start-page { position: fixed; inset: 0; z-index: 10000; overflow: auto; color: var(--ink);
  background: var(--sky) radial-gradient(rgba(255, 255, 255, 0.6) 3px, transparent 3.5px) 0 0 / 44px 44px local;
  font-family: var(--text); font-size: 18px; line-height: 1.45; -webkit-font-smoothing: antialiased; }
#start-page *, #start-bar * { box-sizing: border-box; }
#start-page :focus-visible, #start-bar :focus-visible { outline: 4px solid var(--ink); outline-offset: 4px; }
.sp-wrap { max-width: 1160px; margin: 0 auto; padding: 22px 24px 56px; }
.sp-top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
.sp-logo { display: block; height: 78px; width: auto; }
.sp-top-actions { display: flex; flex-wrap: wrap; gap: 12px; }

/* Buttons: toys you press. A hard shadow under each, which they sink into. */
.sp-btn { appearance: none; border: 4px solid var(--ink); border-radius: 18px; min-height: 54px; padding: 10px 22px;
  display: inline-flex; align-items: center; gap: 10px; background: var(--paper); color: var(--ink);
  font-family: var(--display); font-size: 22px; line-height: 1; letter-spacing: 0.2px; cursor: pointer;
  box-shadow: 0 6px 0 var(--ink); transition: transform 0.08s, box-shadow 0.08s; }
.sp-btn svg { width: 24px; height: 24px; flex-shrink: 0; }
.sp-btn:not(:disabled):active { transform: translateY(6px); box-shadow: 0 0 0 var(--ink); }
.sp-btn:disabled { cursor: default; background: #e9e7f5; color: rgba(18, 6, 59, 0.6); }
.sp-primary { background: var(--sun); }
.sp-big { min-height: 66px; padding: 14px 30px; font-size: 27px; border-radius: 22px; }

/* Muse asks; the player answers in the speech bubble. */
.sp-hero { display: flex; align-items: flex-end; gap: 28px; padding: 26px 0 0; }
.sp-muse { flex: 0 0 190px; margin-bottom: -4px; }
.muse-3d { display: block; width: 100%; aspect-ratio: 1; padding: 0; border: 0; background: none; cursor: pointer; }
.muse-3d canvas { display: block; width: 100%; height: 100%; }
.sp-say { flex: 1; min-width: 0; }
.sp-h1 { margin: 0 0 20px; font-family: var(--display); font-weight: 400; font-size: clamp(38px, 5.4vw, 70px); line-height: 1.02; letter-spacing: 0.3px; color: var(--ink); text-wrap: balance; }
.sp-ask { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 28px 14px; max-width: 840px; }
.sp-bubble { position: relative; flex: 1 1 360px; display: flex; border: 4px solid var(--ink); border-radius: 28px; background: var(--paper); box-shadow: 0 6px 0 var(--ink); }
.sp-bubble::before { content: ''; position: absolute; left: -15px; bottom: 16px; width: 26px; height: 26px; background: var(--paper);
  border-left: 4px solid var(--ink); border-bottom: 4px solid var(--ink); transform: skewY(-24deg) rotate(45deg); }
.sp-input { position: relative; z-index: 1; flex: 1; min-width: 0; min-height: 64px; padding: 0 24px; border: 0; border-radius: 28px; outline: none;
  background: transparent; color: var(--ink); font-family: var(--text); font-size: 21px; font-weight: 700; }
.sp-input::placeholder { color: rgba(18, 6, 59, 0.5); font-weight: 400; }
.sp-bubble:focus-within { box-shadow: 0 6px 0 var(--ink), 0 0 0 4px var(--paper), 0 0 0 8px var(--ink); }
.sp-message { min-height: 26px; margin: 16px 0 0; font-size: 18px; }
@media (max-width: 720px) { .sp-hero { flex-direction: column; align-items: flex-start; gap: 6px; } .sp-muse { flex-basis: auto; width: 120px; }
  .sp-bubble::before { display: none; } }

/* Each shelf's name on a dark tag, the same as in the headset, where it floats over the room. */
.sp-h2 { display: inline-block; margin: 44px 0 22px; padding: 8px 22px 10px; border-radius: 999px; background: var(--ink);
  font-family: var(--display); font-weight: 400; font-size: 30px; line-height: 1.1; color: var(--sun); }
/* Cards: every game, the player's own and the ready-made ones. A picture of the game, a thick outline, a slight tilt. */
.sp-cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 30px 22px; }
@media (max-width: 920px) { .sp-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.sp-card { --tilt: -1.6deg; --card: var(--green); appearance: none; border: 4px solid var(--ink); padding: 8px 8px 14px; border-radius: 26px; background: var(--paper); color: var(--ink);
  display: flex; flex-direction: column; gap: 4px; text-align: left; font: inherit; cursor: pointer;
  transform: rotate(var(--tilt)); box-shadow: 0 9px 0 var(--ink); transition: transform 0.15s, box-shadow 0.15s; }
.sp-card:nth-child(4n + 2) { --tilt: 1.4deg; }
.sp-card:nth-child(4n + 3) { --tilt: -0.8deg; }
.sp-card:nth-child(4n + 4) { --tilt: 1.9deg; }
.sp-card:not(:disabled):hover, .sp-card:focus-visible { transform: rotate(0deg) translateY(-7px); box-shadow: 0 16px 0 var(--ink); }
.sp-card:not(:disabled):active { transform: rotate(0deg) translateY(5px); box-shadow: 0 2px 0 var(--ink); }
.sp-card:disabled { cursor: default; }
.sp-pic { position: relative; display: flex; align-items: center; justify-content: center; width: 100%; aspect-ratio: 4 / 3; overflow: hidden;
  border: 3px solid var(--ink); border-radius: 16px; background: var(--card); }
.sp-pic img { display: block; width: 100%; height: 100%; object-fit: cover; }
/* No picture yet: the game's first letter (or a level's number), like a toy block. */
.sp-mark { font-family: var(--display); font-size: 92px; line-height: 1; color: var(--paper); -webkit-text-stroke: 4px var(--ink); paint-order: stroke fill; }
/* Being made: grid paper that fills with the card's colour from the bottom as the game is made (--fill, 0 to 1),
   under a rolling wave with an ink edge. Full, it is the finished card: a colour block with the game's letter. */
.sp-card[data-state="making"] .sp-pic { background: var(--paper) radial-gradient(rgba(18, 6, 59, 0.16) 2px, transparent 2.5px) 0 0 / 20px 20px; }
.sp-fill { position: absolute; left: 0; right: 0; bottom: 0; height: calc(var(--fill, 0) * 100%); background: var(--card); transition: height 1.2s ease; }
/* The wave: one period is 56px, so sliding the masks by 56px loops with no seam. Its body is the card's colour, its edge ink. */
.sp-fill::before, .sp-fill::after { content: ''; position: absolute; left: 0; right: 0; bottom: calc(100% - 1px); height: 14px;
  -webkit-mask: var(--wave) 0 0 / 56px 14px repeat-x; mask: var(--wave) 0 0 / 56px 14px repeat-x; animation: sp-wave 2.6s linear infinite; animation-delay: inherit; }
.sp-fill::before { --wave: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='14'%3E%3Cpath d='M0 7Q14 1 28 7T56 7V14H0Z'/%3E%3C/svg%3E"); background: var(--card); }
.sp-fill::after { --wave: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='14'%3E%3Cpath d='M0 7Q14 1 28 7T56 7' fill='none' stroke='black' stroke-width='3.5'/%3E%3C/svg%3E"); background: var(--ink); }
@keyframes sp-wave { to { -webkit-mask-position: 56px 0; mask-position: 56px 0; } }
/* Its letter sits a little low, clear of the tag. */
.sp-card[data-state="making"] .sp-mark { position: relative; top: 12px; }
.sp-card[data-state="failed"] .sp-pic { background: #e9e7f5; }
.sp-chip { position: absolute; left: 10px; top: 10px; padding: 4px 12px; border: 3px solid var(--ink); border-radius: 999px; background: var(--sun);
  font-family: var(--display); font-size: 17px; line-height: 1.2; color: var(--ink); }
.sp-card-title { margin: 10px 6px 0; font-family: var(--display); font-size: 25px; line-height: 1.05; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.sp-card-sub { margin: 0 6px; font-size: 16px; line-height: 1.3; }
@keyframes sp-slap { from { opacity: 0; transform: rotate(calc(var(--tilt) + 9deg)) scale(1.18); } to { opacity: 1; transform: rotate(var(--tilt)) scale(1); } }
.sp-cards.sp-arrive .sp-card { animation: sp-slap 0.32s cubic-bezier(0.2, 1.4, 0.4, 1) both; }
.sp-cards.sp-arrive .sp-card:nth-child(2) { animation-delay: 0.06s; }
.sp-cards.sp-arrive .sp-card:nth-child(3) { animation-delay: 0.12s; }
.sp-cards.sp-arrive .sp-card:nth-child(4) { animation-delay: 0.18s; }
@media (prefers-reduced-motion: reduce) { .sp-cards.sp-arrive .sp-card, .sp-fill::before, .sp-fill::after { animation: none; } .sp-card, .sp-btn, .sp-fill { transition: none; } }
/* A course is a folder: a pile of cards. Two paper sheets peek out behind a face in the course's colour, which has no
   picture, only what to do with it, in the letters the cards' marks use; pointed at, the words lift and the pile fans. */
.sp-folder { position: relative; padding: 0; border: 0; background: transparent; box-shadow: none; }
.sp-folder:not(:disabled):hover, .sp-folder:focus-visible, .sp-folder:not(:disabled):active { box-shadow: none; }
.sp-face { position: relative; display: flex; flex-direction: column; gap: 4px; height: 100%; padding: 8px 8px 14px; border: 4px solid var(--ink);
  border-radius: 26px; background: var(--card); box-shadow: 0 9px 0 var(--ink); transition: box-shadow 0.15s; }
.sp-folder:not(:disabled):hover .sp-face, .sp-folder:focus-visible .sp-face { box-shadow: 0 16px 0 var(--ink); }
.sp-folder:not(:disabled):active .sp-face { box-shadow: 0 2px 0 var(--ink); }
.sp-sheet { position: absolute; inset: 0; border: 4px solid var(--ink); border-radius: 26px; background: var(--paper); box-shadow: 0 9px 0 var(--ink);
  transition: transform 0.2s cubic-bezier(0.2, 1.4, 0.4, 1); }
.sp-sheet:nth-child(1) { transform: rotate(5deg) translate(9px, -7px); }
.sp-sheet:nth-child(2) { transform: rotate(-3.5deg) translate(-7px, -11px); }
.sp-folder:not(:disabled):hover .sp-sheet:nth-child(1), .sp-folder:focus-visible .sp-sheet:nth-child(1) { transform: rotate(9deg) translate(16px, -9px); }
.sp-folder:not(:disabled):hover .sp-sheet:nth-child(2), .sp-folder:focus-visible .sp-sheet:nth-child(2) { transform: rotate(-7deg) translate(-14px, -13px); }
.sp-peek { position: relative; display: flex; flex-direction: column; justify-content: center; width: 100%; aspect-ratio: 4 / 3; padding: 0 10px;
  font-family: var(--display); font-size: clamp(40px, 4.6vw, 64px); line-height: 0.92; color: var(--paper);
  -webkit-text-stroke: 5px var(--ink); paint-order: stroke fill; transform: rotate(-3deg); transition: transform 0.2s cubic-bezier(0.2, 1.4, 0.4, 1); }
.sp-peek span:last-child { margin-left: 0.6em; }
.sp-folder:not(:disabled):hover .sp-peek, .sp-folder:focus-visible .sp-peek { transform: rotate(-6deg) translateY(-6px) scale(1.06); }
.sp-folder .sp-chip { top: 14px; left: 14px; }
.sp-folder[data-state="making"] .sp-peek { padding-top: 26px; }
.sp-folder .sp-card-title, .sp-folder .sp-card-sub { color: var(--ink); }
/* Inside a folder the shelf's heading is the course's name, after the way back out. */
.sp-shelf-head { display: flex; flex-wrap: wrap; align-items: center; gap: 14px 18px; margin: 44px 0 22px; }
.sp-shelf-head .sp-h2 { margin: 0; }
.sp-back { min-height: 50px; padding: 8px 20px 8px 14px; font-size: 21px; }
.sp-back::before { content: ''; width: 12px; height: 12px; margin-right: 2px; border-left: 4px solid var(--ink); border-bottom: 4px solid var(--ink); transform: rotate(45deg); }
.sp-back[hidden] { display: none; }
@media (prefers-reduced-motion: reduce) { .sp-sheet, .sp-peek { transition: none; } }
.sp-empty { padding: 20px 22px; border: 4px dashed rgba(18, 6, 59, 0.5); border-radius: 22px; background: rgba(255, 255, 255, 0.55); font-size: 18px; max-width: 760px; }

.sp-dev { margin-top: 56px; color: rgba(18, 6, 59, 0.75); }
.sp-dev summary { cursor: pointer; font-size: 14px; }
.sp-dev[open] summary { margin-bottom: 12px; }

/* While a game previews on this screen: a bar at the top. */
#start-bar { position: fixed; top: 14px; left: 14px; z-index: 10000; display: none; align-items: center; gap: 10px; padding: 8px 8px 12px; max-width: calc(100vw - 28px);
  border: 4px solid var(--ink); border-radius: 24px; background: var(--paper); color: var(--ink); font-family: var(--text); box-shadow: 0 6px 0 var(--ink); }
#start-bar .sp-btn { min-height: 46px; font-size: 19px; }
#start-bar .sp-bar-text { padding: 0 6px; font-size: 17px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

// Icon shapes (24 x 24, stroked) after Lucide (ISC licence), the icon set the headset UI uses.
const ICONS = {
  goggles: '<path d="M2 10a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3h-3l-2-3h-4l-2 3H5a3 3 0 0 1-3-3z"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 18v4"/>',
  back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
} as const;

const icon = (paths: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const WAIT = 'Muse turns it into a game in about 15 minutes. Play one of these while you wait.';
const MIC_TEXT: Record<MicrophoneState, string> = {
  granted: 'Microphone on',
  prompt: 'Turn on my microphone',
  denied: "Microphone blocked: turn it on in this site's settings",
  unknown: 'Turn on my microphone',
};
const PHASE_TEXT: Record<LessonStatus['phase'], string> = {
  idle: 'Nothing open',
  building: 'Making it...',
  fixing: 'Fixing a problem...',
  ready: 'Ready',
  failed: "That didn't work",
  broken: 'Something broke',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A card: a picture of the game (or, with none yet, its mark on a colour), its name and one line on it. */
function card(item: Card, index: number, open: (item: Card) => void): HTMLButtonElement {
  const node = el('button', 'sp-card');
  node.dataset.state = item.state;
  node.style.setProperty('--card', CARD_COLORS[index % CARD_COLORS.length]);
  const pic = el('span', 'sp-pic');
  const mark = () => pic.replaceChildren(el('span', 'sp-mark', item.mark));
  if (isFolder(item)) {
    // A folder has no picture: it says what to do with it. A level being made keeps its tag.
    const peek = el('span', 'sp-peek');
    peek.append(el('span', '', 'Peek'), el('span', '', 'inside'));
    node.classList.add('sp-folder');
    const face = el('span', 'sp-face');
    face.append(peek, el('span', 'sp-card-title', item.title), el('span', 'sp-card-sub', item.sub));
    // The tag sits on the face, not in the big lettering, so it keeps its own plain type.
    if (item.state === 'making') face.append(el('span', 'sp-chip', item.making?.left ?? 'Being made'));
    node.append(el('span', 'sp-sheet'), el('span', 'sp-sheet'), face);
    node.addEventListener('click', () => open(item));
    return node;
  }
  if (item.state === 'making') {
    // The cards are drawn again on every refresh: start the wave where the last one was, so it never jumps.
    const fill = el('span', 'sp-fill');
    fill.style.animationDelay = `${-(performance.now() % 2600)}ms`;
    node.style.setProperty('--fill', String(item.making?.fill ?? 0.04));
    pic.append(fill, el('span', 'sp-mark', item.mark), el('span', 'sp-chip', item.making?.left ?? 'Being made'));
  } else if (item.picture) {
    const img = el('img');
    img.alt = '';
    img.loading = 'lazy';
    img.addEventListener('error', mark, { once: true });
    img.src = item.picture;
    pic.appendChild(img);
  } else mark();
  node.append(pic, el('span', 'sp-card-title', item.title), el('span', 'sp-card-sub', item.sub));
  node.disabled = item.state === 'making';
  node.addEventListener('click', () => open(item));
  return node;
}

export function createStartPage(world: World, developerTools: HTMLElement) {
  document.title = APP_NAME;
  for (const [rel, href] of [['preconnect', 'https://fonts.gstatic.com'], ['stylesheet', FONTS]]) {
    const link = el('link');
    link.rel = rel;
    link.href = href;
    if (rel === 'preconnect') link.crossOrigin = '';
    document.head.appendChild(link);
  }
  const style = el('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const page = el('div');
  page.id = 'start-page';
  page.innerHTML = `
    <div class="sp-wrap">
      <div class="sp-top">
        <img class="sp-logo" src="${import.meta.env.BASE_URL}logo.png" alt="${APP_NAME}" />
        <div class="sp-top-actions">
          <button class="sp-btn" data-id="mic">${icon(ICONS.mic)}<span data-id="mic-text">Turn on my microphone</span></button>
          <button class="sp-btn sp-primary" data-id="enter">${icon(ICONS.goggles)}<span>Play in my room</span></button>
        </div>
      </div>
      <section class="sp-hero">
        <div class="sp-muse" data-id="muse"></div>
        <div class="sp-say">
          <h1 class="sp-h1" data-id="ask-title">What do you wonder about?</h1>
          <form class="sp-ask" data-id="ask-form">
            <div class="sp-bubble"><input class="sp-input" data-id="ask-input" maxlength="200" aria-label="What do you wonder about?" placeholder="Why do boats float?" /></div>
            <button class="sp-btn sp-primary sp-big" data-id="ask-submit" type="submit">Make a game</button>
            <button class="sp-btn" data-id="ask-cancel" type="button" hidden>Make a new game instead</button>
          </form>
          <p class="sp-message" data-id="ask-message">${WAIT}</p>
        </div>
      </section>
      <p class="sp-message" data-id="hero-message"></p>
      <h2 class="sp-h2">Ready to play</h2>
      <div class="sp-cards sp-arrive" data-id="ready"></div>
      <div class="sp-shelf-head">
        <button class="sp-btn sp-back" data-id="mine-back" type="button" hidden>Back to your games</button>
        <h2 class="sp-h2" data-id="mine-title">Your games</h2>
      </div>
      <div data-id="mine"></div>
      <details class="sp-dev"><summary>Developer tools</summary></details>
    </div>`;
  document.body.appendChild(page);
  const find = <T extends HTMLElement = HTMLElement>(id: string) => page.querySelector<T>(`[data-id="${id}"]`)!;
  page.querySelector('.sp-dev')!.appendChild(developerTools);
  const muse = createMuseCanvas();
  find('muse').appendChild(muse.element);

  // While a game is previewed on this screen, the page folds into a bar at the top.
  const bar = el('div');
  bar.id = 'start-bar';
  bar.innerHTML = `<button class="sp-btn" data-id="back">${icon(ICONS.back)}<span>Back</span></button>
    <span class="sp-bar-text" data-id="bar-text"></span>
    <button class="sp-btn sp-primary" data-id="bar-enter">${icon(ICONS.goggles)}<span>Play it in my room</span></button>`;
  document.body.appendChild(bar);

  let previewing = false;
  let immersive = false;
  let hiddenByHost = false;
  let courses: CourseSummary[] = [];
  let games: GameSummary[] = [];
  // The course folder open under Your games (its levels are listed), or null for all of the player's cards.
  let folder: string | null = null;
  // What was being made at the last look, so Muse can cheer when one of them is ready.
  let making = new Set<string>();
  let poll = 0;
  // Declared before anything can call refresh(): the visibility subscription below runs at once.
  let refreshing = false;

  const show = () => {
    const visible = !immersive && !hiddenByHost;
    page.style.display = visible && !previewing ? 'block' : 'none';
    bar.style.display = visible && previewing ? 'flex' : 'none';
  };
  world.visibilityState.subscribe((state) => {
    immersive = state !== VisibilityState.NonImmersive;
    show();
    // Back from XR: games may have been made meanwhile.
    if (!immersive) void refresh();
  });
  onChromeHidden((hidden) => {
    hiddenByHost = hidden;
    show();
    if (!hidden) void refresh();
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
      // The room opens on the game previewed here, if there is one; otherwise on the dashboard (picker.ts), where
      // the player picks one.
      await world.launchXR();
    } catch (err) {
      find('hero-message').textContent = `Mixed reality didn't start: ${(err as Error).message}`;
    }
  };
  const xrPossible = world.xrEnabled && 'xr' in navigator;
  for (const id of ['enter', 'bar-enter']) {
    const button = (id === 'enter' ? page : bar).querySelector<HTMLButtonElement>(`[data-id="${id}"]`)!;
    button.disabled = !xrPossible;
    button.addEventListener('click', () => void enter());
  }
  if (!xrPossible) find('hero-message').textContent = 'Playing in your room needs a headset, in its browser. Here you can look at the games.';

  // The microphone, asked for here because the headset cannot ask inside XR.
  const micButton = find<HTMLButtonElement>('mic');
  const showMic = (state: MicrophoneState) => {
    find('mic-text').textContent = MIC_TEXT[state];
    micButton.disabled = state === 'granted' || state === 'denied';
  };
  void microphoneState().then(showMic);
  micButton.addEventListener('click', async () => showMic(await askForMicrophone()));

  // A game page's "Tell Muse what to fix" opens the Lab with ?fix=<id>: the box then asks what to fix in that game.
  // Offered once, when the player's games have loaded.
  let askedToFix = new URLSearchParams(window.location.search).get('fix');
  let fixing: { id: string; title: string } | null = null;
  // The game whose fix was asked for here: when it is ready again, say how the fix went.
  let fixAsked: string | null = null;
  const fixMode = (game: { id: string; title: string } | null) => {
    fixing = game;
    const input = find<HTMLInputElement>('ask-input');
    find('ask-title').textContent = game ? `What should ${MASCOT_NAME} fix in ${game.title}?` : 'What do you wonder about?';
    input.placeholder = game ? 'The stand is upside down' : 'Why do boats float?';
    input.setAttribute('aria-label', find('ask-title').textContent ?? '');
    find('ask-submit').textContent = game ? 'Fix it' : 'Make a game';
    find('ask-cancel').hidden = !game;
    find('ask-message').textContent = game ? 'Say what looks or works wrong, in one sentence. The game stays as it is until the fix works.' : WAIT;
    if (!game && window.location.search) window.history.replaceState(null, '', window.location.pathname);
    if (game) input.focus();
  };
  find('ask-cancel').addEventListener('click', () => fixMode(null));

  // Ask for a game by typing (in the headset, by voice too), or for a fix to one. Its card shows it being made.
  find<HTMLFormElement>('ask-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = find<HTMLInputElement>('ask-input');
    const idea = input.value.trim();
    if (!idea) return;
    const fix = fixing;
    find('ask-message').textContent = fix ? `Asking ${MASCOT_NAME} to fix ${fix.title}...` : `Asking ${MASCOT_NAME} for "${idea}"...`;
    try {
      if (fix) await fixGame(fix.id, idea);
      else await createGame(idea);
      input.value = '';
      if (fix) {
        fixMode(null);
        fixAsked = fix.id;
        find('ask-message').textContent = `${MASCOT_NAME} is fixing ${fix.title}. Its card shows it being fixed; it takes a few minutes.`;
      } else {
        find('ask-message').textContent = `${MASCOT_NAME} is making your game. Its card is under Your games, below; it takes about 15 minutes.`;
      }
      await refresh();
    } catch (err) {
      find('ask-message').textContent = `That didn't work: ${(err as Error).message}`;
    }
  });

  /** Open what a card names: a ready game or level previews here; one not made yet (or failed) starts being made. */
  const open = (item: Card) => {
    const source = item.source;
    if (source.kind === 'game') void openGame(source.id);
    else if (source.kind === 'level') void openLesson(source.courseId, source.index);
    else if (source.kind === 'course') {
      folder = source.id;
      renderMine(true);
    } else if (source.kind === 'example-lesson') {
      preview(true);
      void startLesson(EXAMPLE_LESSONS[source.index].prompt);
    } else if (source.kind === 'example-game') {
      void (async () => {
        try {
          const game = await loadExampleGame(EXAMPLE_GAMES[source.index].saved);
          preview(true);
          await openWritten(game.code, game.request, 'game');
        } catch (err) {
          find('ask-message').textContent = `That game didn't load: ${(err as Error).message}`;
        }
      })();
    }
  };
  // The ready-made games and lessons. They open at once.
  find('ready').append(...readyCards(import.meta.env.BASE_URL).map((item, index) => card(item, index, open)));

  // The player's games: kept fresh while the page or its bar is on screen (in XR the dashboard polls instead).
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    clearTimeout(poll);
    let wait = 20000;
    try {
      [courses, games] = await Promise.all([listCourses(), listGames()]);
      if (renderMine()) wait = 4000;
      if (askedToFix) {
        const game = games.find((g) => g.id === askedToFix);
        askedToFix = null;
        if (game?.builder === 'pi' && game.status === 'ready') fixMode({ id: game.id, title: game.title });
      }
      const fixed = fixAsked ? games.find((g) => g.id === fixAsked) : undefined;
      if (fixed && fixed.status === 'ready') {
        fixAsked = null;
        find('ask-message').textContent = fixed.note ?? `${MASCOT_NAME} fixed ${fixed.title}. Tap its card to play it.`;
      }
    } catch {
      wait = 8000; // the server may be restarting
    } finally {
      refreshing = false;
      if (!immersive && !hiddenByHost) poll = window.setTimeout(() => void refresh(), wait);
    }
  }

  /** Draws the player's cards; true while one is being made. Muse thinks while one is, and cheers when it is ready. */
  function renderMine(deal = false): boolean {
    if (folder && !courses.some((course) => course.id === folder)) folder = null;
    const cards = myCards(games, courses, 'Tap', folder);
    // Inside a folder: the course's name as the heading, after the way back out.
    find('mine-title').textContent = courses.find((course) => course.id === folder)?.title ?? 'Your games';
    find('mine-back').hidden = folder === null;
    const box = find('mine');
    if (cards.length === 0) box.replaceChildren(el('div', 'sp-empty', 'The games you ask for show up here. Ask for one at the top.'));
    else {
      const grid = el('div', deal ? 'sp-cards sp-arrive' : 'sp-cards');
      grid.append(...cards.map((item, index) => card(item, index, open)));
      box.replaceChildren(grid);
    }
    const now = new Set(cards.filter((c) => c.state === 'making').map((c) => c.key));
    const finished = cards.some((c) => c.state === 'ready' && making.has(c.key));
    making = now;
    muse.setMood(finished ? 'cheer' : now.size > 0 ? 'thinking' : 'idle');
    if (finished && now.size > 0) window.setTimeout(() => muse.setMood('thinking'), 1800);
    return now.size > 0;
  }

  /** A ready game opens here; a failed one is made again. */
  async function openGame(id: string) {
    try {
      const game = await fetchGame(id);
      if (game.status === 'ready' && game.url) {
        openGamePage(game.url);
        return;
      }
      if (game.status === 'ready' && game.code) {
        preview(true);
        await openWritten(game.code, game.request, 'game');
      }
    } catch {
      // The cards show what the server says next.
    }
    await refresh();
  }

  /** A ready level opens here; one not made yet (or failed) starts being made. */
  async function openLesson(courseId: string, index: number) {
    try {
      const lesson = await fetchCourseLesson(courseId, index);
      if (lesson.status === 'ready' && lesson.code) {
        preview(true);
        await openWritten(lesson.code, lesson.prompt);
      }
    } catch {
      // The cards show what the server says next.
    }
    await refresh();
  }

  bar.querySelector('[data-id="back"]')!.addEventListener('click', () => preview(false));
  find('mine-back').addEventListener('click', () => {
    folder = null;
    renderMine(true);
    find('mine-title').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  show();
  void refresh();
}
