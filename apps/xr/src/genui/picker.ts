import {
  createSystem,
  Group,
  PanelDocument,
  PanelUI,
  PokeInteractable,
  RayInteractable,
  Vector3,
  VisibilityState,
  type Entity,
  type UIKitDocument,
  type World,
} from '@iwsdk/core';
import { EXAMPLE_LESSONS } from './lessons';
import { cancelListening, isListening, microphoneState, startListening, stopAndTranscribe, voiceAvailable } from './voice';
import { TutorUnavailable, VoiceTutor } from './voice-agent';
import type { LessonKind, LessonStatus, LiveOutcome } from './overlay';
import { EXAMPLE_GAMES, createGame, fetchGame, gameProgress, listGames, loadExampleGame, onSection, setSection, type GameSummary, type Section } from './games';
import { courseProgress, createCourse, fetchCourse, fetchCourseLesson, listCourses, polishCourseLesson, type CourseSummary } from './courses';
import { capture, floorHeight, lessonPosition, roomFrame, zoomGame } from './host';
import { makeCardGrabbable, type CardGrab } from './grab';
import { boxAround, worldYaw } from './handle';

/**
 * In-headset lesson picker. The desktop prompt box is a DOM overlay, which an immersive session doesn't
 * show, so in XR this panel is how a learner starts a lesson with hands only (point and pinch, or touch).
 * With no lesson it stands front and centre; once a lesson is ready it docks to the learner's left, out of
 * the lesson's way but a glance away, to pick another. It also shows build progress and, when a lesson
 * breaks after the automatic repair, a "Fix it" button.
 *
 * Below the cards is the course shelf: a spoken subject becomes a saved course, planned at once and written
 * in the background (courses.ts). A course row opens its list of lessons; a ready lesson opens with a pinch.
 *
 * A switch at the top changes the section (shared with the start page, games.ts): Learn is the above; Play
 * has example games that open at once, a spoken request that becomes a game, and the shelf of saved games.
 * While a game is on the desk the picker folds into a small bar: the game's name, - and + to resize it, Menu.
 */

type PickerHandlers = {
  start: (prompt: string) => void;
  fix: () => void;
  /** Write a fresh version of the current lesson live. */
  fresh: () => void;
  /** A request the learner spoke (written live). */
  ask: (prompt: string) => void;
  /** Open a lesson or game that is already written (from a saved course, a saved or example game). */
  open: (code: string, prompt: string, kind?: LessonKind) => void;
  /** Watch a lesson or game being written: its scene builds up on the desk, then it opens (overlay.ts watchLive). */
  watch: (key: string, prompt: string, kind: LessonKind, outcome: () => Promise<LiveOutcome>) => void;
  onStatus: (listener: (status: LessonStatus) => void) => () => void;
};

const CENTRE = { width: 0.56, distance: 0.7, belowEyes: 0.2, yaw: 0 };
// To the left, outside the 35 degrees either side of straight ahead where the host lays out lesson panels.
const DOCKED = { width: 0.36, distance: 0.5, belowEyes: 0.3, yaw: (60 * Math.PI) / 180 };
// Frames to wait after entering XR before placing: the first frames can still have the pre-session camera pose.
const SETTLE_FRAMES = 20;
// The picker's lowest edge stays this far above the floor (its half height is a guess until it has laid out).
const PICKER_FLOOR_CLEARANCE_M = 0.05;
const PICKER_FALLBACK_HALF_HEIGHT_M = 0.3;
const SHELF_ROWS = 3;
// The "See all" list: every saved course, newest first, this many to a page (Newer / Older turn the pages).
const ALL_ROWS = 6;
const COURSE_STEPS = 5;
// While a game is on the desk the picker folds into a small bar (the game's name and Menu), this wide.
const MINI_WIDTH_M = 0.34;
// A spoken game request waits this long for the confirming pinch before it is dropped.
const CONFIRM_MS = 20000;
// Saved games on the Play shelf, newest first, this many to a page.
const GAME_ROWS = 5;
// The Learn / Play switch: the chosen tab is white with dark words (the start page's tabs).
const TAB_TONES = {
  on: { background: 'rgba(255, 255, 255, 0.9)', text: '#272727' },
  off: { background: 'rgba(255, 255, 255, 0)', text: 'rgba(255, 255, 255, 0.7)' },
} as const;
// How often the shelf asks the server while a course is being planned or written.
const COURSE_POLL_MS = 4000;
// A lesson's textures and panels are in by now; its pictures then go to the agent for one revision.
const REVIEW_AFTER_MS = 7000;
const STEP_STATES = { pending: 'Pinch to write it', generating: 'Writing: pinch to watch', ready: 'Ready: pinch to open', failed: 'Failed: pinch to retry' } as const;
// Lesson number badges, by state (Reality Labs Design System, dark mode).
const STEP_BADGES = {
  pending: { background: 'rgba(255, 255, 255, 0.15)', number: 'rgba(255, 255, 255, 0.9)' },
  generating: { background: '#fc9435', number: '#272727' },
  ready: { background: 'rgba(255, 255, 255, 0.9)', number: '#272727' },
  failed: { background: '#f7818c', number: '#272727' },
} as const;
// The voice row's microphone circle: ready, listening, working (understanding, planning), missed (try again),
// unavailable.
const VOICE_TONES = { ready: '#272727', listening: '#e5343e', working: '#31a8f3', speaking: '#0f7a2a', missed: '#fc9435', off: '#8a8a8a' } as const;
type VoiceTone = keyof typeof VOICE_TONES;

// Status colours from the Reality Labs Design System: none, poor (working), good, bad.
const PHASES: Record<LessonStatus['phase'], { dot: string; background: string }> = {
  idle: { dot: '#8a8a8a', background: 'rgba(0, 0, 0, 0.14)' },
  building: { dot: '#fc9435', background: 'rgba(252, 148, 53, 0.14)' },
  fixing: { dot: '#fc9435', background: 'rgba(252, 148, 53, 0.14)' },
  ready: { dot: '#2ad116', background: 'rgba(42, 209, 22, 0.12)' },
  failed: { dot: '#f7818c', background: 'rgba(247, 129, 140, 0.16)' },
  broken: { dot: '#f7818c', background: 'rgba(247, 129, 140, 0.16)' },
};

let handlers: PickerHandlers | null = null;
let picker: LessonPickerSystem | null = null;
let hiddenByHost = false;

export function initLessonPicker(world: World, h: PickerHandlers) {
  handlers = h;
  world.registerSystem(LessonPickerSystem);
}

/** Hide the picker regardless of XR state (the benchmark hides all chrome before its screenshots). */
export function setPickerHidden(hidden: boolean) {
  hiddenByHost = hidden;
  picker?.refreshVisibility();
}

/** Starting over: the picker docks beside the next lesson again, even if the learner had moved it. */
export function redockPicker() {
  picker?.redock();
}

/** For tests: where the picker is and what it shows. */
export function inspectPicker() {
  if (!picker) return null;
  return picker.inspect();
}

/** For tests: what a learner does on the course shelf by voice and pinch. */
export const pickerCourses = {
  request: (subject: string) => picker?.requestCourse(subject),
  show: (id: string | null) => picker?.showCourse(id),
  all: (on: boolean) => picker?.showAll(on),
  step: (index: number) => picker?.openStep(index),
  refresh: () => picker?.refreshCourses(),
  /** Play: switch section, open an example game or a saved game's row, ask for a game. */
  section: (section: Section) => setSection(section),
  exampleGame: (index: number) => picker?.openExampleGame(index),
  game: (index: number) => picker?.openGameRow(index),
  requestGame: (request: string) => picker?.requestGame(request),
  page: (list: 'all' | 'games', step: 1 | -1) => picker?.turnPage(list, step),
};

class LessonPickerSystem extends createSystem({
  documents: { required: [PanelUI, PanelDocument] },
}) {
  private holder!: Group;
  private entity!: Entity;
  private document: UIKitDocument | null = null;
  private status: LessonStatus = { phase: 'idle', prompt: null, kind: 'lesson', message: '', since: 0 };
  private section: Section = 'learn';
  /** A game is on the desk and the learner hasn't opened the menu: only the small bar shows. */
  private folded = false;
  private games: GameSummary[] = [];
  private inXR = false;
  private interactive = true;
  private docked = false;
  /** Held by its frame, like a lesson's cards: one hand moves it, two hands resize it. */
  private card!: CardGrab;
  private frames = 0;
  private readonly eye = new Vector3();
  /** The learner dragged the picker somewhere: it stays there for the rest of the session. */
  private moved = false;
  private placeIn = -1;
  private ticker = 0;
  private courses: CourseSummary[] = [];
  /** The course whose lessons are listed (null: the home view, or the list of all courses). */
  private shown: string | null = null;
  /** The list of every saved course is showing, and which page of it. */
  private listingAll = false;
  private allPage = 0;
  /** Which page of the saved games the Play shelf shows. */
  private gamePage = 0;
  private coursePoll = 0;
  /** Titles of course lessons opened here, by their request, for the status line. */
  private readonly titles = new Map<string, string>();
  private readonly head = new Vector3();
  private readonly forward = new Vector3();
  private readonly lesson = new Vector3();

  init(): void {
    picker = this;
    this.holder = new Group();
    this.holder.name = 'Lesson Picker';
    this.holder.visible = false;
    this.entity = this.world.createTransformEntity(this.holder, { parent: roomFrame().entity });
    this.entity.addComponent(PanelUI, { config: `${import.meta.env.BASE_URL}ui/lesson-picker.uikitml` });
    this.entity.addComponent(RayInteractable, {});
    this.entity.addComponent(PokeInteractable, {});
    this.card = makeCardGrabbable(this.holder, this.entity, () => (this.moved = true));

    this.queries.documents.subscribe('qualify', (entity) => {
      if (entity !== this.entity) return;
      this.document = entity.getValue(PanelDocument, 'document') as UIKitDocument;
      this.wire();
      this.applySize();
      this.render();
    });
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((visibility) => {
        this.inXR = visibility !== VisibilityState.NonImmersive;
        if (this.inXR) this.placeIn = SETTLE_FRAMES;
        if (this.inXR) this.moved = false;
        if (this.inXR) void this.refreshCourses();
        this.refreshVisibility();
      }),
      handlers!.onStatus((status) => this.onStatus(status)),
      () => clearInterval(this.ticker),
      () => clearTimeout(this.coursePoll),
      () => clearTimeout(this.heardTimer),
      () => cancelListening(),
      () => this.tutor.stop(),
      () => this.card.dispose(),
      onSection((section) => {
        this.section = section;
        this.applySize();
        this.renderCourses();
        this.render();
      }),
      () => (picker = null),
    );
    // While a lesson is being written, count the seconds (once a second, not every frame).
    this.ticker = window.setInterval(() => {
      if (this.status.phase === 'building' || this.status.phase === 'fixing') this.render();
    }, 1000);
  }

  update(): void {
    if (this.placeIn > 0 && --this.placeIn === 0) this.place();
    // Its content changes size (courses, lists, docking): the frame follows, a few times a second.
    if (++this.frames % 20 === 0) this.card.refit();
    this.world.camera.getWorldPosition(this.eye);
    this.card.tick(this.eye, floorHeight(this.eye));
  }

  refreshVisibility() {
    const show = this.inXR && !hiddenByHost;
    this.holder.visible = show;
    this.card.setEnabled(show);
    // A hidden panel must not catch a hand ray meant for something else.
    if (show !== this.interactive) {
      this.interactive = show;
      if (show) {
        this.entity.addComponent(RayInteractable, {});
        this.entity.addComponent(PokeInteractable, {});
      } else {
        this.entity.removeComponent(RayInteractable);
        this.entity.removeComponent(PokeInteractable);
      }
    }
  }

  inspect() {
    this.holder.updateWorldMatrix(true, false);
    const at = this.holder.getWorldPosition(new Vector3());
    return {
      visible: this.holder.visible,
      docked: this.docked,
      loaded: this.document !== null,
      phase: this.status.phase,
      position: [at.x, at.y, at.z].map((v) => Math.round(v * 1000) / 1000),
      section: this.section,
      folded: this.folded,
      allPage: this.allPage,
      gamePage: this.gamePage,
      cards: (this.section === 'play' ? EXAMPLE_GAMES : EXAMPLE_LESSONS).map((card, i) => ({ id: `${this.section === 'play' ? 'game' : 'lesson'}-${i}`, title: card.title })),
      games: this.games.map((g) => ({ id: g.id, title: g.title, status: g.status })),
      shown: this.shown,
      courses: this.courses.map((c) => ({ id: c.id, title: c.title, status: c.status, progress: courseProgress(c), lessons: c.lessons.map((l) => l.status) })),
    };
  }

  private onStatus(status: LessonStatus) {
    // Each game that opens folds the picker away; a lesson, or nothing on the desk, unfolds it.
    const wasFolded = this.folded;
    if (status.kind === 'game' && status.phase === 'ready' && status.since !== this.status.since) this.folded = true;
    else if (status.kind !== 'game' || status.phase === 'idle') this.folded = false;
    this.status = status;
    if (this.folded !== wasFolded) {
      this.applySize();
      this.renderCourses();
    }
    // Dock beside a lesson once it is in (each new lesson, in case it stands somewhere else); come back to
    // the centre when there is none.
    const dock = status.phase === 'ready' || (this.docked && (status.phase === 'building' || status.phase === 'fixing' || status.phase === 'broken'));
    if (dock !== this.docked || status.phase === 'ready') {
      this.docked = dock;
      this.applySize();
      if (this.inXR) this.place();
    }
    this.render();
  }

  private wire() {
    const document = this.document!;
    EXAMPLE_LESSONS.forEach((lesson, i) => {
      document.getElementById(`lesson-${i}-title`)?.setProperties({ text: lesson.title });
      document.getElementById(`lesson-${i}-sub`)?.setProperties({ text: lesson.sub });
      document.getElementById(`lesson-${i}`)?.addEventListener('click', () => handlers?.start(lesson.prompt));
    });
    document.getElementById('fix')?.addEventListener('click', () => handlers?.fix());
    document.getElementById('fresh')?.addEventListener('click', () => handlers?.fresh());
    document.getElementById('voice')?.addEventListener('click', () => void this.toggleVoice());
    if (!voiceAvailable()) this.setVoice('Voice input is not available in this browser.', 'off');
    for (let i = 0; i < SHELF_ROWS; i++) document.getElementById(`course-${i}`)?.addEventListener('click', () => this.showCourse(this.courses[i]?.id ?? null));
    for (let i = 0; i < ALL_ROWS; i++) document.getElementById(`all-${i}`)?.addEventListener('click', () => this.showCourse(this.courses[this.allPage * ALL_ROWS + i]?.id ?? null));
    document.getElementById('all-prev')?.addEventListener('click', () => this.turnPage('all', -1));
    document.getElementById('all-next')?.addEventListener('click', () => this.turnPage('all', 1));
    document.getElementById('games-prev')?.addEventListener('click', () => this.turnPage('games', -1));
    document.getElementById('games-next')?.addEventListener('click', () => this.turnPage('games', 1));
    document.getElementById('see-all')?.addEventListener('click', () => this.showAll(true));
    document.getElementById('all-back')?.addEventListener('click', () => this.showAll(false));
    for (let i = 0; i < COURSE_STEPS; i++) document.getElementById(`step-${i}`)?.addEventListener('click', () => void this.openStep(i));
    document.getElementById('back')?.addEventListener('click', () => this.showCourse(null));
    document.getElementById('mini-open')?.addEventListener('click', () => this.setFolded(false));
    document.getElementById('mini-smaller')?.addEventListener('click', () => zoomGame(-1));
    document.getElementById('mini-bigger')?.addEventListener('click', () => zoomGame(1));
    document.getElementById('tab-learn')?.addEventListener('click', () => setSection('learn'));
    document.getElementById('tab-play')?.addEventListener('click', () => setSection('play'));
    EXAMPLE_GAMES.forEach((game, i) => {
      document.getElementById(`game-${i}-title`)?.setProperties({ text: game.title });
      document.getElementById(`game-${i}-sub`)?.setProperties({ text: game.sub });
      document.getElementById(`game-${i}`)?.addEventListener('click', () => void this.openExampleGame(i));
    });
    for (let i = 0; i < GAME_ROWS; i++) document.getElementById(`game-row-${i}`)?.addEventListener('click', () => void this.openGameRow(this.gamePage * GAME_ROWS + i));
    document.getElementById('game-voice')?.addEventListener('click', () => void this.toggleGameVoice());
    if (!voiceAvailable()) this.setGameVoice('Voice input is not available in this browser.', 'off');
    void this.refreshCourses();
  }

  /** Fold the picker into its small bar while a game is on the desk, or open it again (Menu). */
  setFolded(folded: boolean) {
    this.folded = folded;
    this.applySize();
    this.renderCourses();
    this.render();
  }

  /** Play: an example game, ready-made, so it opens at once. */
  async openExampleGame(index: number) {
    const example = EXAMPLE_GAMES[index];
    if (!example) return;
    try {
      const game = await loadExampleGame(example.saved);
      this.titles.set(game.request, example.title);
      handlers?.open(game.code, game.request, 'game');
    } catch (err) {
      this.setGameVoice(`That game did not load: ${ascii((err as Error).message)}`, 'off');
    }
  }

  /** Play: a saved game's row opens it when it is written; a failed one is written again. */
  async openGameRow(index: number) {
    const row = this.games[index];
    if (!row) return;
    if (row.status === 'writing') {
      this.watchGame(row);
      return;
    }
    try {
      const game = await fetchGame(row.id);
      if (game.status === 'ready' && game.code) {
        this.titles.set(game.request, game.title);
        handlers?.open(game.code, game.request, 'game');
      }
    } catch {
      // The shelf below shows what the server says next.
    }
    await this.refreshCourses();
  }

  /** Play: a game being written. Its board builds up on the desk, then it opens to play. */
  private watchGame(row: GameSummary) {
    this.titles.set(row.request, row.title);
    handlers?.watch(`game-${row.id}`, row.request, 'game', async () => {
      const now = (await listGames()).find((g) => g.id === row.id);
      if (!now) return { failed: 'the game is gone' };
      if (now.status === 'failed') return { failed: now.error ?? 'the game could not be written' };
      if (now.status !== 'ready') return null;
      const game = await fetchGame(row.id);
      if (game.code) this.titles.set(game.request, game.title);
      return game.code ? { code: game.code } : null;
    });
  }

  /** Play: a spoken (or typed) request becomes a saved game, written in the background. */
  async requestGame(request: string) {
    try {
      const game = await createGame(request);
      this.games = [game, ...this.games.filter((g) => g.id !== game.id)];
      // With nothing on the desk, the new game builds up there while it is written.
      if (this.status.phase === 'idle') this.watchGame(game);
      this.setGameVoice(`Writing "${ascii(request)}": it appears below in about two minutes.`, 'working');
      this.renderCourses();
      this.pollCourses();
    } catch (err) {
      this.setGameVoice(`That didn't work: ${ascii((err as Error).message)}`, 'off');
    }
  }

  /** A spoken (or typed) subject becomes a saved course: planned now, written in the background. */
  async requestCourse(subject: string) {
    try {
      const course = await createCourse(subject);
      this.courses = [course, ...this.courses.filter((c) => c.id !== course.id)];
      this.showCourse(course.id);
      this.pollCourses();
    } catch (err) {
      this.setVoice(`That didn't work: ${ascii((err as Error).message)}`, 'off');
    }
  }

  showCourse(id: string | null) {
    this.shown = id && this.courses.some((c) => c.id === id) ? id : null;
    // Back from a course returns to where it was opened from (the home view or the list of all courses).
    this.applySize();
    this.renderCourses();
  }

  /** Newer (-1) or older (+1) page of the course list or the games shelf. */
  turnPage(list: 'all' | 'games', step: 1 | -1) {
    const pages = (count: number, size: number) => Math.max(1, Math.ceil(count / size));
    if (list === 'all') this.allPage = Math.min(pages(this.courses.length, ALL_ROWS) - 1, Math.max(0, this.allPage + step));
    else this.gamePage = Math.min(pages(this.games.length, GAME_ROWS) - 1, Math.max(0, this.gamePage + step));
    this.renderCourses();
  }

  showAll(on: boolean) {
    this.listingAll = on;
    if (on) this.allPage = 0;
    this.shown = null;
    this.applySize();
    this.renderCourses();
  }

  /** A lesson row: open it if it is written; otherwise the server starts writing it. */
  async openStep(index: number) {
    const course = this.courses.find((c) => c.id === this.shown);
    if (!course?.lessons[index]) return;
    try {
      const lesson = await fetchCourseLesson(course.id, index);
      if (lesson.status === 'ready' && lesson.code) {
        this.titles.set(lesson.prompt, lesson.title);
        handlers?.open(lesson.code, lesson.prompt);
        if (!lesson.polish) this.reviewLater(course.id, index, lesson.prompt);
      } else if (lesson.status === 'generating' || lesson.status === 'pending') {
        // Asking for it started it (or it was already being written): watch it build up on the desk.
        this.titles.set(lesson.prompt, lesson.title);
        const courseId = course.id;
        handlers?.watch(`course-${courseId}-${index}`, lesson.prompt, 'lesson', async () => {
          const now = (await fetchCourse(courseId)).lessons[index];
          if (!now) return { failed: 'the lesson is gone' };
          if (now.status === 'failed') return { failed: now.error ?? 'the lesson could not be written' };
          if (now.status !== 'ready') return null;
          const written = await fetchCourseLesson(courseId, index);
          return written.code ? { code: written.code } : null;
        });
      }
    } catch {
      // The shelf below shows what the server says next.
    }
    await this.refreshCourses();
  }

  /**
   * Look-and-fix: once a newly written lesson has settled on the desk, send pictures of it to the server, where
   * the agent revises it from what it sees. Skipped if the learner has moved on or the lesson broke.
   */
  private reviewLater(courseId: string, index: number, prompt: string) {
    window.setTimeout(() => {
      if (this.status.phase !== 'ready' || this.status.prompt !== prompt) return;
      const size = { width: 1024, height: 768, quality: 0.8 };
      const pictures = [
        capture({ ...size, zoom: 1.2 }),
        capture({ ...size, subject: 'all', azimuth: 8, elevation: 10 }),
        capture({ ...size, zoom: 1.2, azimuth: 205, elevation: 18 }),
      ].filter((p): p is string => Boolean(p));
      if (pictures.length) void polishCourseLesson(courseId, index, pictures).catch(() => {});
    }, REVIEW_AFTER_MS);
  }

  async refreshCourses() {
    try {
      [this.courses, this.games] = await Promise.all([listCourses(), listGames()]);
    } catch {
      return; // the server may be restarting; the next poll or visit tries again
    }
    if (this.shown && !this.courses.some((c) => c.id === this.shown)) this.shown = null;
    this.renderCourses();
    this.pollCourses();
  }

  /** Keep asking while something is being planned or written. */
  private pollCourses() {
    clearTimeout(this.coursePoll);
    const active = this.courses.some((c) => c.status === 'planning' || c.model?.status === 'building' || c.lessons.some((l) => l.status === 'generating'))
      || this.games.some((g) => g.status === 'writing');
    if (active) this.coursePoll = window.setTimeout(() => void this.refreshCourses(), COURSE_POLL_MS);
  }

  /** A list's Newer / Older row: shown only when there is more than one page, each button only when it goes somewhere. */
  private renderPager(prefix: 'all' | 'games', page: number, size: number, count: number, noun: string) {
    const document = this.document;
    if (!document) return;
    const pages = Math.max(1, Math.ceil(count / size));
    document.getElementById(`${prefix}-pager`)?.setProperties({ display: pages > 1 ? 'flex' : 'none' });
    document.getElementById(`${prefix}-prev`)?.setProperties({ display: page > 0 ? 'flex' : 'none' });
    document.getElementById(`${prefix}-next`)?.setProperties({ display: page < pages - 1 ? 'flex' : 'none' });
    document.getElementById(`${prefix}-page`)?.setProperties({ text: `${page * size + 1}-${Math.min(count, (page + 1) * size)} of ${count} ${noun}` });
  }

  private renderCourses() {
    const document = this.document;
    if (!document) return;
    const play = this.section === 'play';
    const folded = this.folded;
    document.getElementById('mini')?.setProperties({ display: folded ? 'flex' : 'none' });
    for (const id of ['top', 'tabs', 'status']) document.getElementById(id)?.setProperties({ display: folded ? 'none' : 'flex' });
    for (const [id, on] of [['tab-learn', !play], ['tab-play', play]] as const) {
      const tone = on ? TAB_TONES.on : TAB_TONES.off;
      document.getElementById(id)?.setProperties({ backgroundColor: tone.background });
      document.getElementById(`${id}-icon`)?.setProperties({ color: tone.text });
      document.getElementById(`${id}-label`)?.setProperties({ color: tone.text });
    }
    document.getElementById('play')?.setProperties({ display: play && !folded ? 'flex' : 'none' });
    document.getElementById('games-label')?.setProperties({ display: play && this.games.length ? 'flex' : 'none' });
    document.getElementById('games-note')?.setProperties({ text: `${this.games.length} saved, newest first` });
    this.gamePage = Math.min(this.gamePage, Math.max(0, Math.ceil(this.games.length / GAME_ROWS) - 1));
    this.renderPager('games', this.gamePage, GAME_ROWS, this.games.length, 'games');
    for (let i = 0; i < GAME_ROWS; i++) {
      const game = this.games[this.gamePage * GAME_ROWS + i];
      document.getElementById(`game-row-${i}`)?.setProperties({ display: game ? 'flex' : 'none' });
      if (!game) continue;
      document.getElementById(`game-row-${i}-title`)?.setProperties({ text: ascii(game.title) });
      document.getElementById(`game-row-${i}-state`)?.setProperties({ text: game.status === 'ready' ? 'Ready: pinch to play' : game.status === 'failed' ? 'Failed: pinch to retry' : gameProgress(game) });
    }
    const course = play || folded ? undefined : this.courses.find((c) => c.id === this.shown);
    const listing = !play && !folded && !course && this.listingAll;
    document.getElementById('home')?.setProperties({ display: play || folded || course || listing ? 'none' : 'flex' });
    document.getElementById('all')?.setProperties({ display: listing ? 'flex' : 'none' });
    document.getElementById('course')?.setProperties({ display: course ? 'flex' : 'none' });
    document.getElementById('shelf-label')?.setProperties({ display: this.courses.length ? 'flex' : 'none' });
    document.getElementById('see-all')?.setProperties({ display: this.courses.length > SHELF_ROWS ? 'flex' : 'none' });
    document.getElementById('see-all-label')?.setProperties({ text: `See all ${this.courses.length}` });
    document.getElementById('all-note')?.setProperties({ text: `${this.courses.length} saved courses, newest first` });
    this.allPage = Math.min(this.allPage, Math.max(0, Math.ceil(this.courses.length / ALL_ROWS) - 1));
    this.renderPager('all', this.allPage, ALL_ROWS, this.courses.length, 'courses');
    const fillRow = (prefix: string, i: number, index = i) => {
      const row = this.courses[index];
      document.getElementById(`${prefix}-${i}`)?.setProperties({ display: row ? 'flex' : 'none' });
      if (!row) return;
      document.getElementById(`${prefix}-${i}-title`)?.setProperties({ text: ascii(row.title) });
      document.getElementById(`${prefix}-${i}-state`)?.setProperties({ text: courseProgress(row) });
      const ready = row.lessons.filter((l) => l.status === 'ready').length;
      document.getElementById(`${prefix}-${i}-fill`)?.setProperties({ width: `${row.lessons.length ? Math.round((100 * ready) / row.lessons.length) : 0}%` });
    };
    for (let i = 0; i < SHELF_ROWS; i++) fillRow('course', i);
    if (listing) for (let i = 0; i < ALL_ROWS; i++) fillRow('all', i, this.allPage * ALL_ROWS + i);
    if (!course) return;
    const modelling = course.model?.status === 'building';
    document.getElementById('course-sub')?.setProperties({
      text: ascii(course.status === 'failed' ? `Could not be planned: ${course.error ?? ''}`
        : modelling ? `Building its 3D model: ${course.model?.stage ?? 'starting'}`
        : course.subtitle || 'Pinch a lesson to open it.'),
    });
    for (let i = 0; i < COURSE_STEPS; i++) {
      const lesson = course.lessons[i];
      document.getElementById(`step-${i}`)?.setProperties({ display: lesson ? 'flex' : 'none' });
      if (!lesson) continue;
      document.getElementById(`step-${i}-badge`)?.setProperties({ backgroundColor: STEP_BADGES[lesson.status].background });
      document.getElementById(`step-${i}-num`)?.setProperties({ color: STEP_BADGES[lesson.status].number });
      document.getElementById(`step-${i}-title`)?.setProperties({ text: ascii(lesson.title) });
      document.getElementById(`step-${i}-state`)?.setProperties({
        text: modelling && lesson.status === 'pending' ? 'Waits for the 3D model'
          : lesson.status === 'generating' && lesson.live ? ascii(`${lesson.live.line}: pinch to watch`)
          : STEP_STATES[lesson.status],
      });
    }
  }

  /**
   * The voice tutor (voice-agent.ts): a spoken conversation that can plan courses and open lessons. Pinch to
   * start, pinch again to end. Where the tutor is unavailable, voice falls back to a one-shot request: pinch,
   * say a subject, pinch, and it becomes a course.
   */
  private readonly tutor = new VoiceTutor(
    {
      createCourse: async (subject) => {
        const course = await createCourse(subject);
        this.courses = [course, ...this.courses.filter((c) => c.id !== course.id)];
        this.showCourse(course.id);
        this.pollCourses();
        return { ok: true, title: course.title, note: 'Planned. The lessons are being written now, the first in a few minutes; a course about one object first builds its 3D model (about 20 minutes).' };
      },
      listCourses: async () => {
        await this.refreshCourses();
        return { courses: this.courses.map((c) => ({ title: c.title, lessons: c.lessons.map((l, i) => `${i + 1}. ${l.title} (${l.status})`) })) };
      },
      openLesson: async (name, number) => {
        await this.refreshCourses();
        const course = findCourse(this.courses, name);
        if (!course) return { ok: false, error: `No course matches "${name}".`, courses: this.courses.map((c) => c.title) };
        const lesson = course.lessons[number - 1];
        if (!lesson) return { ok: false, error: `"${course.title}" has ${course.lessons.length} lessons.` };
        this.showCourse(course.id);
        await this.openStep(number - 1);
        return { ok: true, course: course.title, lesson: lesson.title, state: lesson.status === 'ready' ? 'opened on the desk' : 'being written; it takes a few minutes' };
      },
      currentLesson: () => {
        const prompt = this.status.prompt;
        if (!prompt || this.status.phase === 'idle') return { open: false };
        const title = EXAMPLE_LESSONS.find((l) => l.prompt === prompt)?.title ?? this.titles.get(prompt) ?? null;
        return { open: true, title, request: prompt.split('\n(This is lesson')[0], state: this.status.phase };
      },
    },
    {
      onText: (role, text) => {
        this.tutorHeard = true;
        this.setVoice(`${role === 'user' ? 'You' : 'Tutor'}: ${ascii(text)}`, role === 'user' ? 'listening' : 'speaking');
      },
      onState: (state, detail) => {
        if (state === 'connecting') this.setVoice('Connecting to the tutor...', 'working');
        else if (state === 'thinking') this.setVoice('Thinking...', 'working');
        else if (state === 'stopped') this.setVoice(detail ? ascii(detail) : 'Pinch, then ask for a course or about a lesson', detail ? 'off' : 'ready');
        else if (state === 'listening' && !this.tutorHeard) this.setVoice('Listening: ask anything. Pinch here to stop.', 'listening');
        if (state === 'stopped') this.tutorHeard = false;
      },
    },
  );
  private tutorHeard = false;
  private tutorOff = false;

  /** What the tutor knows at the start: the saved courses and the lesson on the desk. */
  private async tutorContext(): Promise<string> {
    await this.refreshCourses();
    const courses = this.courses.slice(0, 8).map((c) => `- ${c.title}: ${c.lessons.map((l, i) => `${i + 1}. ${l.title} (${l.status})`).join('; ')}`);
    const open = this.status.prompt && this.status.phase !== 'idle' ? (EXAMPLE_LESSONS.find((l) => l.prompt === this.status.prompt)?.title ?? this.titles.get(this.status.prompt) ?? 'a lesson') : null;
    return `Saved courses:\n${courses.join('\n') || '(none yet)'}\nOn the desk now: ${open ?? 'nothing'}.`;
  }

  /** Pinch to talk to the tutor, again to stop. */
  private async toggleVoice() {
    if (!voiceAvailable() || this.voiceBusy) return;
    if (this.tutor.active) {
      this.tutor.stop();
      return;
    }
    if (!isListening()) {
      // The browser can't ask for the microphone inside XR: it has to be allowed on the start page first.
      const allowed = await microphoneState();
      if (allowed === 'prompt' || allowed === 'denied') {
        this.setVoice('Allow the microphone first: leave XR and tap "Allow microphone" on the start page.', 'off');
        return;
      }
      if (!this.tutorOff) {
        // Busy while the tutor connects, so a second pinch can't start a second session.
        this.voiceBusy = true;
        try {
          await this.tutor.start(await this.tutorContext());
          return;
        } catch (err) {
          this.tutor.stop();
          // No tutor on this server: one-shot voice requests from now on. Anything else (the network, a busy
          // server): a one-shot request this time, and the tutor again on the next pinch.
          if (err instanceof TutorUnavailable && err.permanent) this.tutorOff = true;
        } finally {
          this.voiceBusy = false;
        }
      }
      try {
        await startListening(() => void this.toggleVoice());
        this.setVoice("Listening... pinch here when you're done", 'listening');
      } catch {
        this.setVoice('The microphone did not start: leave XR and tap "Allow microphone" on the start page.', 'off');
      }
      return;
    }
    this.voiceBusy = true;
    this.setVoice('Understanding...', 'working');
    try {
      const text = await stopAndTranscribe();
      if (!text) {
        this.setVoice("I didn't catch that. Pinch here and try again.", 'missed');
      } else {
        this.setVoice(`Planning a course on: "${ascii(text)}"`, 'working');
        await this.requestCourse(text);
      }
    } catch (err) {
      this.setVoice(`Voice failed: ${ascii((err as Error).message)}`, 'off');
    } finally {
      this.voiceBusy = false;
    }
  }

  private voiceBusy = false;

  /** A spoken game request waiting for its confirming pinch (speech meant for someone else is not a game). */
  private heardGame: string | null = null;
  private heardTimer = 0;

  /**
   * Play: pinch, say a game, pinch again; the words show on the row and a third pinch makes the game (no tutor
   * in this section). Unconfirmed words are dropped after CONFIRM_MS.
   */
  private async toggleGameVoice() {
    if (!voiceAvailable() || this.voiceBusy) return;
    if (this.heardGame) {
      const request = this.heardGame;
      this.heardGame = null;
      clearTimeout(this.heardTimer);
      await this.requestGame(request);
      return;
    }
    if (!isListening()) {
      const allowed = await microphoneState();
      if (allowed === 'prompt' || allowed === 'denied') {
        this.setGameVoice('Allow the microphone first: leave XR and tap "Allow microphone" on the start page.', 'off');
        return;
      }
      try {
        await startListening(() => void this.toggleGameVoice());
        this.setGameVoice("Listening... pinch here when you're done", 'listening');
      } catch {
        this.setGameVoice('The microphone did not start: leave XR and tap "Allow microphone" on the start page.', 'off');
      }
      return;
    }
    this.voiceBusy = true;
    this.setGameVoice('Understanding...', 'working');
    try {
      const text = await stopAndTranscribe();
      if (!text) {
        this.setGameVoice("I didn't catch that. Pinch here and try again.", 'missed');
      } else {
        this.heardGame = text;
        this.setGameVoice(`Make "${ascii(text)}"? Pinch to make it.`, 'speaking');
        clearTimeout(this.heardTimer);
        this.heardTimer = window.setTimeout(() => {
          this.heardGame = null;
          this.setGameVoice('Pinch, say a game, then pinch again', 'ready');
        }, CONFIRM_MS);
      }
    } catch (err) {
      this.setGameVoice(`Voice failed: ${ascii((err as Error).message)}`, 'off');
    } finally {
      this.voiceBusy = false;
    }
  }

  private setGameVoice(text: string, tone: VoiceTone) {
    this.document?.getElementById('game-voice-label')?.setProperties({ text });
    this.document?.getElementById('game-voice-circle')?.setProperties({ backgroundColor: VOICE_TONES[tone] });
  }

  private setVoice(text: string, tone: VoiceTone) {
    this.document?.getElementById('voice-label')?.setProperties({ text });
    this.document?.getElementById('voice-circle')?.setProperties({ backgroundColor: VOICE_TONES[tone] });
  }

  private applySize() {
    const width = this.folded ? MINI_WIDTH_M : this.docked ? DOCKED.width : CENTRE.width;
    // Height is generous so the width is what sets the scale (as the host does for lesson panels).
    this.document?.setTargetDimensions(width, width * 4);
    const play = this.section === 'play';
    const course = play ? undefined : this.courses.find((c) => c.id === this.shown);
    const listing = !play && !course && this.listingAll;
    this.document?.getElementById('hint')?.setProperties({ display: this.docked || course || listing ? 'none' : 'flex' });
    this.document?.getElementById('heading')?.setProperties({
      text: play ? (this.docked ? 'Pick another game' : 'What do you want to play?')
        : course ? ascii(course.title) : listing ? 'My courses' : this.docked ? 'Pick another lesson' : 'What do you want to learn?',
    });
    this.document?.getElementById('eyebrow')?.setProperties({ text: play ? 'GAMES ON YOUR DESK' : course ? 'COURSE' : 'LESSONS ON YOUR DESK' });
  }

  /**
   * Stand the picker in front of where the learner is looking or, docked, to the left of the lesson (not of
   * their gaze: they are often looking at the picker itself when the next lesson arrives), facing them.
   */
  redock() {
    this.moved = false;
    this.placeIn = SETTLE_FRAMES;
  }

  private place() {
    if (this.moved) return;
    const spot = this.docked ? DOCKED : CENTRE;
    const camera = this.world.camera;
    camera.getWorldPosition(this.head);
    if (this.docked && lessonPosition(this.lesson)) this.forward.subVectors(this.lesson, this.head);
    else camera.getWorldDirection(this.forward);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, -1);
    this.forward.normalize().applyAxisAngle(Object3DUp, spot.yaw);
    // Worked out in the world, then put in the room's frame (anchored to the room, so it can differ).
    const at = this.head.clone().addScaledVector(this.forward, spot.distance);
    // Below the eyes, but never into the floor: a learner lying down or sitting on the floor has little room.
    const box = boxAround(this.holder);
    const below = box.isEmpty() ? PICKER_FALLBACK_HALF_HEIGHT_M : this.holder.getWorldPosition(new Vector3()).y - box.min.y;
    at.y = Math.max(this.head.y - spot.belowEyes, floorHeight(this.head) + PICKER_FLOOR_CLEARANCE_M + below);
    const frame = this.holder.parent;
    frame?.updateWorldMatrix(true, false);
    this.holder.position.copy(frame ? frame.worldToLocal(at.clone()) : at);
    // Panels face +Z: yaw toward the head.
    this.holder.rotation.set(0, Math.atan2(this.head.x - at.x, this.head.z - at.z) - worldYaw(frame), 0);
  }

  private render() {
    const document = this.document;
    if (!document) return;
    const { phase, prompt, message, since, kind } = this.status;
    const seconds = Math.max(0, Math.round((performance.now() - since) / 1000));
    const thing = kind === 'game' ? 'game' : 'lesson';
    const fallback = `your ${thing}`;
    const title = EXAMPLE_LESSONS.find((lesson) => lesson.prompt === prompt)?.title ?? (prompt && this.titles.get(prompt)) ?? fallback;
    document.getElementById('mini-title')?.setProperties({ text: ascii(title === fallback ? 'Game on' : title) });
    const text = {
      idle: this.section === 'play' ? 'Pick a game to start.' : 'Pick a lesson to start.',
      building: `Writing ${title === fallback ? title : `the ${title} ${thing}`}${message ? ` (${ascii(message)})` : ''}... ${seconds} s`,
      fixing: `Fixing a problem in the ${thing}... ${seconds} s`,
      ready: `${title === fallback ? `Your ${thing}` : title} is ready.`,
      failed: `That didn't work: ${ascii(message)}`,
      broken: `Something in the ${thing} broke.`,
    }[phase];
    document.getElementById('status-text')?.setProperties({ text });
    document.getElementById('status-dot')?.setProperties({ backgroundColor: PHASES[phase].dot });
    document.getElementById('status')?.setProperties({ backgroundColor: PHASES[phase].background });
    document.getElementById('fix')?.setProperties({ display: phase === 'broken' ? 'flex' : 'none' });
    document.getElementById('fresh')?.setProperties({ display: phase === 'ready' ? 'flex' : 'none' });
    // The chosen card stays marked while it is being written and once it is showing.
    EXAMPLE_LESSONS.forEach((lesson, i) => {
      const chosen = lesson.prompt === prompt && phase !== 'idle' && phase !== 'failed';
      document.getElementById(`lesson-${i}`)?.setProperties({ borderColor: chosen ? PHASES[phase].dot : 'rgba(255, 255, 255, 0)' });
    });
  }
}

const Object3DUp = new Vector3(0, 1, 0);

/** The panel font has plain ASCII only; keep server messages short and printable. */
/** A course whose title best matches what the learner said (shared words), or none. */
function findCourse(courses: CourseSummary[], name: string): CourseSummary | undefined {
  const words = (text: string) => new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !['how', 'the', 'and', 'works', 'work'].includes(w)));
  const wanted = words(name);
  let best: CourseSummary | undefined;
  let score = 0;
  for (const course of courses) {
    const shared = [...words(course.title)].filter((w) => wanted.has(w)).length;
    if (shared > score) [best, score] = [course, shared];
  }
  return best;
}

const TYPOGRAPHY: Record<string, string> = { '\u2014': ' - ', '\u2013': '-', '\u2018': "'", '\u2019': "'", '\u201c': '"', '\u201d': '"', '\u2026': '...' };

function ascii(text: string) {
  const plain = text.replace(/[\u2013\u2014\u2018\u2019\u201c\u201d\u2026]/g, (ch) => TYPOGRAPHY[ch]).replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim();
  return plain.length > 90 ? `${plain.slice(0, 87)}...` : plain || 'unknown error';
}
