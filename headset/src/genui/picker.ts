import {
  Box3,
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
import { CARD_COLORS, COLORS, MASCOT_NAME } from './brand';
import { myCards, readyCards, type Card } from './cards';
import { createCourse, fetchCourse, fetchCourseLesson, listCourses, polishCourseLesson, type CourseSummary } from './courses';
import { EXAMPLE_GAMES, createGame, fetchGame, listGames, loadExampleGame, type GameSummary } from './games';
import { makeCardGrabbable, type CardGrab } from './grab';
import { boxAround, worldYaw } from './handle';
import { capture, floorHeight, lessonCardsCentre, lessonModelBox, lessonPosition, roomFrame, zoomGame } from './host';
import { EXAMPLE_LESSONS } from './lessons';
import { createMuse3D, type Muse3D, type MuseMood } from './muse3d';
import type { LessonKind, LessonStatus, LiveOutcome } from './overlay';
import { cancelListening, isListening, microphoneState, startListening, stopAndTranscribe, voiceAvailable } from './voice';
import { TutorUnavailable, VoiceTutor } from './voice-agent';

/**
 * The headset dashboard (public/ui/lesson-picker.uikitml). The 2D start page is a DOM overlay, which an immersive
 * session doesn't show, so in mixed reality this panel is the home screen: it floats in front of the player with
 * no background, the room showing through, like a store front, and shows the same cards as the start page
 * (cards.ts) in one list that scrolls down: the ready-made games first, then the player's own (a card appears as
 * soon as one is asked for, and pinching it watches it being made). Point and pinch, or touch; pinch and drag to
 * scroll, or push a controller's thumbstick up or down.
 *
 * Picking a card opens that game and folds the dashboard into a small bar beside it: Home, the game's name, and
 * smaller / bigger. Home closes the game and brings the dashboard back; there is no going from one game to the
 * next without coming home.
 *
 * At the top Muse, the mascot, stands in 3D beside its question (muse3d.ts): it watches the player, bobs while a
 * game is being made and hops when one is ready. Beside it two voice buttons: Make a game (pinch, say it, pinch,
 * pinch to confirm) and Talk to Muse (the voice tutor, voice-agent.ts). Under Muse's question a line shows what is
 * being made or fixed, with Fix it when a game breaks after the automatic repair.
 */

type PickerHandlers = {
  /** Open a ready-made lesson by its request. */
  start: (prompt: string) => void;
  fix: () => void;
  /** Open a game or lesson that is already written. */
  open: (code: string, prompt: string, kind?: LessonKind) => void;
  /** Watch one being written: its scene builds up in the room, then it opens (overlay.ts watchLive). */
  watch: (key: string, prompt: string, kind: LessonKind, outcome: () => Promise<LiveOutcome>) => void;
  /** Close what is open: back to the dashboard. */
  close: () => void;
  onStatus: (listener: (status: LessonStatus) => void) => () => void;
};

// The dashboard: a metre wide, a metre away, its middle a little below the eyes.
const CENTRE = { width: 1.0, distance: 1.0, belowEyes: 0.08, yaw: 0 };
// The small bar while a game is open: to the left, outside the 35 degrees either side of straight ahead where
// the host lays out a lesson's panels.
const DOCKED = { width: 0.34, distance: 0.5, belowEyes: 0.3, yaw: (60 * Math.PI) / 180 };
// The panel's design width (lesson-picker.uikitml), as the dashboard and as the small bar.
const BOARD_PX = 1120;
const BAR_PX = 540;
// Frames to wait after entering XR before placing: the first frames can still have the pre-session camera pose.
const SETTLE_FRAMES = 20;
// The panel's lowest edge stays this far above the floor (its half height is a guess until it has laid out).
const PICKER_FLOOR_CLEARANCE_M = 0.05;
const PICKER_FALLBACK_HALF_HEIGHT_M = 0.3;
// The docked bar stays this far outside the game's model, and no further from the eyes than this.
const PICKER_LESSON_GAP_M = 0.08;
const PICKER_MAX_DISTANCE_M = 1.0;
// Card slots in the panel: all the ready-made ones, and the player's newest.
const SLOTS: Record<Shelf, number> = { ready: 8, mine: 12 };
// A controller's thumbstick scrolls the list this fast at full tilt (design pixels a second), past a small dead zone.
const STICK_PX_PER_S = 1100;
const STICK_DEADZONE = 0.2;
// A spoken game request waits this long for the confirming pinch before it is dropped.
const CONFIRM_MS = 20000;
// How often the shelves ask the server while something is being made.
const POLL_MS = 4000;
// A lesson's textures and panels are in by now; its pictures then go to the agent for one revision.
const REVIEW_AFTER_MS = 7000;
// The voice buttons' circle: ready, listening, working, speaking, missed (try again), unavailable.
const VOICE_TONES = { ready: COLORS.ink, listening: '#e5343e', working: '#0a84ff', speaking: '#0f7a2a', missed: COLORS.orange, off: '#8a8a8a' } as const;
type VoiceTone = keyof typeof VOICE_TONES;
// The status line's dot: nothing, working, good, bad.
const PHASE_DOTS: Record<LessonStatus['phase'], string> = {
  idle: COLORS.green, building: COLORS.orange, fixing: COLORS.orange, ready: COLORS.green, failed: COLORS.pink, broken: COLORS.pink,
};
const FAILED_CARD = '#e9e7f5';
// The height of a card's picture block (lesson-picker.uikitml .card-block): a card being made fills it from the bottom,
// at most to below the block's rounded top corners (the fill's own corners are square on top).
const FILL_PX = 162;
const FILL_MAX_PX = FILL_PX - 18;
// Card pictures drawn in the start page's style (scripts/render-card-art.mjs): a letter or digit, and the wave on
// top of a card's colour, named in CARD_COLORS order. The wave rolls one period every WAVE_MS.
const CARD_ART = 'ui/cards/';
const ART_MARK = /^[A-Z0-9]$/;
const WAVES = ['green', 'pink', 'orange', 'aqua'] as const;
const WAVE_PERIOD_PX = 64;
const WAVE_MS = 2600;
type Shelf = 'mine' | 'ready';

let handlers: PickerHandlers | null = null;
let picker: LessonPickerSystem | null = null;
let hiddenByHost = false;

export function initLessonPicker(world: World, h: PickerHandlers) {
  handlers = h;
  world.registerSystem(LessonPickerSystem);
}

/** Hide the dashboard regardless of XR state (screenshots of a game show the game only). */
export function setPickerHidden(hidden: boolean) {
  hiddenByHost = hidden;
  picker?.refreshVisibility();
}

/** Starting over: the dashboard stands in front of the player again, even if they had moved it. */
export function redockPicker() {
  picker?.redock();
}

/** For tests: where the dashboard is and what it shows. */
export function inspectPicker() {
  if (!picker) return null;
  return picker.inspect();
}

/** For tests: what a player does on the dashboard by pinch and voice. */
export const pickerCourses = {
  refresh: () => picker?.refreshCourses(),
  /** Pick a card: the n-th of the player's own ('mine') or of the ready-made ones ('ready'). */
  open: (shelf: Shelf, index: number) => picker?.openCard(shelf, index),
  requestGame: (request: string) => picker?.requestGame(request),
  /** Scroll the list by design pixels (what a thumbstick does); returns [where it is, how far it goes]. */
  scroll: (px: number) => picker?.scrollBy(px) ?? null,
  home: () => handlers?.close(),
};

class LessonPickerSystem extends createSystem({
  documents: { required: [PanelUI, PanelDocument] },
}) {
  private holder!: Group;
  private entity!: Entity;
  private document: UIKitDocument | null = null;
  private status: LessonStatus = { phase: 'idle', prompt: null, kind: 'lesson', message: '', since: 0 };
  /** A game is open: only the small bar shows, docked beside it. */
  private folded = false;
  private inXR = false;
  private interactive = true;
  /** Held by its frame, like a lesson's cards: one hand moves it, two hands resize it. */
  private frame!: CardGrab;
  private frames = 0;
  private readonly eye = new Vector3();
  /** The player dragged the panel somewhere: it stays there until they come home again. */
  private moved = false;
  private placeIn = -1;
  private ticker = 0;
  private games: GameSummary[] = [];
  private courses: CourseSummary[] = [];
  private readonly cards: Record<Shelf, Card[]> = { mine: [], ready: readyCards(import.meta.env.BASE_URL) };
  /** The cards that were being made at the last look, so Muse can cheer when one is ready. */
  private making = new Set<string>();
  private cheerUntil = 0;
  /** Muse in 3D, standing on the panel's (invisible) picture of it. */
  private muse!: Muse3D;
  private readonly museBox = new Box3();
  private readonly museAt = new Vector3();
  private poll = 0;
  /** What each panel element was last given (a picture, a colour): set again only when it changes. */
  private readonly shown = new Map<string, string | number>();
  /** The cards being made, whose waves roll every frame. */
  private waves: string[] = [];
  /** Names of what was opened here, by request, for the bar and the status line. */
  private readonly titles = new Map<string, string>();
  private readonly head = new Vector3();
  private readonly forward = new Vector3();
  private readonly lesson = new Vector3();
  private readonly lessonCards = new Vector3();
  private readonly lessonBox = new Box3();

  init(): void {
    picker = this;
    this.holder = new Group();
    this.holder.name = 'Lesson Picker';
    this.holder.visible = false;
    this.entity = this.world.createTransformEntity(this.holder, { parent: roomFrame().entity });
    this.entity.addComponent(PanelUI, { config: `${import.meta.env.BASE_URL}ui/lesson-picker.uikitml` });
    this.entity.addComponent(RayInteractable, {});
    this.entity.addComponent(PokeInteractable, {});
    this.frame = makeCardGrabbable(this.holder, this.entity, () => (this.moved = true));
    this.muse = createMuse3D();
    this.muse.object.visible = false;
    this.holder.add(this.muse.object);

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
      () => clearTimeout(this.poll),
      () => clearTimeout(this.heardTimer),
      () => cancelListening(),
      () => this.tutor.stop(),
      () => this.frame.dispose(),
      () => (picker = null),
    );
    // Once a second: the seconds on the status line, Muse's face, and the cards being made.
    this.ticker = window.setInterval(() => {
      if (!this.holder.visible) return;
      this.render();
      if (this.making.size > 0) this.renderCards();
    }, 1000);
  }

  update(delta: number): void {
    clearScrollMarks(this.world.input);
    this.stickScroll(delta);
    if (this.placeIn > 0 && --this.placeIn === 0) this.place();
    // Its content changes size (folding into the bar): the frame follows, a few times a second.
    if (++this.frames % 20 === 0) this.frame.refit();
    this.world.camera.getWorldPosition(this.eye);
    this.frame.tick(this.eye, floorHeight(this.eye));
    this.placeMuse();
    if (this.muse.object.visible) this.muse.update(delta, this.museMood(), this.eye);
    // The waves on cards being made roll: one whole period loops with no seam.
    if (this.waves.length) {
      const left = -(((performance.now() / WAVE_MS) * WAVE_PERIOD_PX) % WAVE_PERIOD_PX);
      for (const id of this.waves) this.put(`${id}-wave`, 'positionLeft', Math.round(left * 2) / 2);
    }
  }

  /** Muse stands on the bottom of its place in the panel, a little in front, as tall as that place. */
  private placeMuse() {
    const spot = this.document?.getElementById('muse') as unknown as import('three').Object3D | undefined;
    const show = Boolean(spot) && this.holder.visible && !this.folded;
    this.muse.object.visible = show;
    if (!show) return;
    this.museBox.setFromObject(spot!);
    if (this.museBox.isEmpty()) {
      this.muse.object.visible = false;
      return;
    }
    const height = this.museBox.max.y - this.museBox.min.y;
    this.museBox.getCenter(this.museAt);
    this.museAt.y = this.museBox.min.y;
    this.holder.worldToLocal(this.museAt);
    this.muse.object.position.copy(this.museAt);
    this.muse.object.position.z += 0.03;
    // Muse is one unit tall.
    this.muse.object.scale.setScalar(height * 0.98);
  }

  private museMood(): MuseMood {
    if (performance.now() < this.cheerUntil) return 'cheer';
    const { phase } = this.status;
    return this.making.size > 0 || phase === 'building' || phase === 'fixing' ? 'thinking' : 'idle';
  }

  /** A controller's thumbstick, pushed up or down, scrolls the list while the dashboard is open. */
  private stickScroll(delta: number) {
    if (!this.holder.visible || this.folded) return;
    let tilt = 0;
    for (const hand of ['left', 'right'] as const) {
      const y = this.world.input.gamepads[hand]?.getAxesValues('xr-standard-thumbstick')?.y ?? 0;
      if (Math.abs(y) > Math.abs(tilt)) tilt = y;
    }
    // Up on the stick is negative: it shows what is above.
    if (Math.abs(tilt) >= STICK_DEADZONE) this.scrollBy(tilt * STICK_PX_PER_S * delta);
  }

  /** Move the list down (or, negative, up) by design pixels, within its ends; where it is then, of how far it goes. */
  scrollBy(px: number): [number, number] | null {
    const list = this.document?.getElementById('list') as unknown as ScrollList | undefined;
    const at = list?.scrollPosition?.value;
    const max = list?.maxScrollPosition?.value?.[1];
    if (!list || !at || max == null) return null;
    const y = Math.min(max, Math.max(0, at[1] + px));
    list.scrollPosition.value = [at[0], y];
    return [y, max];
  }

  refreshVisibility() {
    const show = this.inXR && !hiddenByHost;
    this.holder.visible = show;
    this.frame.setEnabled(show);
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
    const list = (shelf: Shelf) => this.cards[shelf].map((card) => ({ key: card.key, title: card.title, state: card.state, picture: Boolean(card.picture) }));
    return {
      visible: this.holder.visible,
      folded: this.folded,
      loaded: this.document !== null,
      phase: this.status.phase,
      position: [at.x, at.y, at.z].map((v) => Math.round(v * 1000) / 1000),
      mine: list('mine'),
      ready: list('ready'),
    };
  }

  private onStatus(status: LessonStatus) {
    // A game that opens folds the dashboard into its bar; nothing open, or one that failed or broke (so the
    // status line and Fix it can be seen), brings the dashboard back.
    const wasFolded = this.folded;
    if (status.phase === 'ready') this.folded = true;
    else if (status.phase === 'idle' || status.phase === 'failed' || status.phase === 'broken') this.folded = false;
    this.status = status;
    // The bar docks beside each game that opens (it may stand somewhere else than the last one).
    if (this.folded !== wasFolded || status.phase === 'ready') {
      this.applySize();
      if (this.inXR) this.place();
    }
    this.render();
  }

  private wire() {
    const document = this.document!;
    document.getElementById('fix')?.addEventListener('click', () => handlers?.fix());
    document.getElementById('voice')?.addEventListener('click', () => void this.toggleVoice());
    document.getElementById('game-voice')?.addEventListener('click', () => void this.toggleGameVoice());
    if (!voiceAvailable()) {
      this.setVoice('Voice is not available in this browser.', 'off');
      this.setGameVoice('Voice is not available in this browser.', 'off');
    }
    for (const shelf of ['mine', 'ready'] as const) {
      for (let i = 0; i < SLOTS[shelf]; i++) {
        document.getElementById(`${shelf}-${i}`)?.addEventListener('click', () => void this.openCard(shelf, i));
        // A card's picture fills its frame whatever its own shape (the panel format takes this only from code).
        document.getElementById(`${shelf}-${i}-pic`)?.setProperties({ keepAspectRatio: false });
      }
    }
    document.getElementById('mini-home')?.addEventListener('click', () => handlers?.close());
    document.getElementById('mini-smaller')?.addEventListener('click', () => zoomGame(-1));
    document.getElementById('mini-bigger')?.addEventListener('click', () => zoomGame(1));
    // Muse waves when pinched.
    document.getElementById('muse')?.addEventListener('click', () => this.muse.wave());
    this.renderCards();
    void this.refreshCourses();
  }

  /** Pick a card: open what it names. */
  async openCard(shelf: Shelf, index: number) {
    const card = this.cards[shelf][index];
    if (!card) return;
    const source = card.source;
    if (source.kind === 'example-game') await this.openExampleGame(source.index);
    else if (source.kind === 'example-lesson') {
      const lesson = EXAMPLE_LESSONS[source.index];
      this.titles.set(lesson.prompt, lesson.title);
      handlers?.start(lesson.prompt);
    } else if (source.kind === 'game') await this.openGame(source.id);
    else if (source.kind === 'level') await this.openLevel(source.courseId, source.index);
  }

  /** A ready-made game: it opens at once. */
  private async openExampleGame(index: number) {
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

  /** One of the player's games: it opens when it is made, is watched while it is being made, and a failed one is made again. */
  private async openGame(id: string) {
    const row = this.games.find((game) => game.id === id);
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
      // The shelf shows what the server says next.
    }
    await this.refreshCourses();
  }

  /** A game being made: it builds up in the room, then opens to play. */
  private watchGame(row: GameSummary) {
    this.titles.set(row.request, row.title);
    handlers?.watch(`game-${row.id}`, row.request, 'game', async () => {
      const now = (await listGames()).find((g) => g.id === row.id);
      if (!now) return { failed: 'the game is gone' };
      if (now.status === 'failed') return { failed: now.error ?? 'the game could not be made' };
      if (now.status !== 'ready') return null;
      const game = await fetchGame(row.id);
      if (game.code) this.titles.set(game.request, game.title);
      return game.code ? { code: game.code } : null;
    });
  }

  /** A level of a course: it opens if it is made; otherwise asking for it starts it, and it is watched. */
  private async openLevel(courseId: string, index: number) {
    try {
      const lesson = await fetchCourseLesson(courseId, index);
      this.titles.set(lesson.prompt, lesson.title);
      if (lesson.status === 'ready' && lesson.code) {
        handlers?.open(lesson.code, lesson.prompt);
        if (!lesson.polish) this.reviewLater(courseId, index, lesson.prompt);
      } else if (lesson.status === 'generating' || lesson.status === 'pending') {
        handlers?.watch(`course-${courseId}-${index}`, lesson.prompt, 'lesson', async () => {
          const now = (await fetchCourse(courseId)).lessons[index];
          if (!now) return { failed: 'the level is gone' };
          if (now.status === 'failed') return { failed: now.error ?? 'the level could not be made' };
          if (now.status !== 'ready') return null;
          const written = await fetchCourseLesson(courseId, index);
          return written.code ? { code: written.code } : null;
        });
      }
    } catch {
      // The shelf shows what the server says next.
    }
    await this.refreshCourses();
  }

  /** A spoken (or typed) request becomes one of the player's games, made in the background: its card appears at once. */
  async requestGame(request: string) {
    try {
      const game = await createGame(request);
      this.games = [game, ...this.games.filter((g) => g.id !== game.id)];
      this.setGameVoice(`Making "${ascii(request)}". Its card is under Your games, below.`, 'working');
      this.listCards();
      this.pollSoon();
    } catch (err) {
      this.setGameVoice(`That didn't work: ${ascii((err as Error).message)}`, 'off');
    }
  }

  /**
   * Look-and-fix: once a newly made level has settled, send pictures of it to the server, where the agent
   * revises it from what it sees. Skipped if the player has moved on or it broke.
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
    this.listCards();
    this.pollSoon();
  }

  /** The player's cards from what the server has; Muse cheers when one that was being made is ready. */
  private listCards() {
    this.cards.mine = myCards(this.games, this.courses, 'Pinch');
    const making = new Set(this.cards.mine.filter((card) => card.state === 'making').map((card) => card.key));
    if (this.cards.mine.some((card) => card.state === 'ready' && this.making.has(card.key))) this.cheerUntil = performance.now() + 2500;
    this.making = making;
    this.renderCards();
    this.render();
  }

  /** Keep asking while something is being made. */
  private pollSoon() {
    clearTimeout(this.poll);
    if (this.making.size > 0) this.poll = window.setTimeout(() => void this.refreshCourses(), POLL_MS);
  }

  /** Give a panel element a property, only when it has changed (a picture is not loaded twice). */
  private put(id: string, key: string, value: string | number) {
    const slot = `${id}.${key}`;
    if (this.shown.get(slot) === value) return;
    this.shown.set(slot, value);
    this.document?.getElementById(id)?.setProperties({ [key]: value });
  }

  private renderCards() {
    if (!this.document) return;
    const waves: string[] = [];
    for (const shelf of ['mine', 'ready'] as const) {
      const cards = this.cards[shelf];
      for (let index = 0; index < SLOTS[shelf]; index++) {
        const id = `${shelf}-${index}`;
        const card = cards[index];
        this.put(id, 'display', card ? 'flex' : 'none');
        if (!card) continue;
        this.put(`${id}-title`, 'text', clip(card.title, 34));
        this.put(`${id}-sub`, 'text', clip(card.sub, 50));
        const pictured = card.state === 'ready' && Boolean(card.picture);
        this.put(`${id}-pic`, 'display', pictured ? 'flex' : 'none');
        this.put(`${id}-block`, 'display', pictured ? 'none' : 'flex');
        const making = card.state === 'making' ? card.making : undefined;
        this.put(`${id}-chip`, 'display', making ? 'flex' : 'none');
        if (making) this.put(`${id}-chip-label`, 'text', making.left);
        if (pictured) this.put(`${id}-pic`, 'src', card.picture!);
        else {
          const colour = CARD_COLORS[index % CARD_COLORS.length];
          // The letter as a picture in the start page's font, or as text when there is none (a two-digit level).
          const art = ART_MARK.test(card.mark);
          this.put(`${id}-letter`, 'display', art ? 'flex' : 'none');
          this.put(`${id}-mark`, 'display', art ? 'none' : 'flex');
          if (art) this.put(`${id}-letter`, 'src', `${CARD_ART}mark-${card.mark}.png`);
          else this.put(`${id}-mark`, 'text', card.mark);
          // Being made, it sits a little low, clear of the tag.
          this.put(`${id}-${art ? 'letter' : 'mark'}`, 'marginTop', making ? 20 : 0);
          this.put(`${id}-dots`, 'display', making ? 'flex' : 'none');
          // Being made: white, filling with the card's colour from the bottom; full, it is the finished card.
          this.put(`${id}-block`, 'backgroundColor', card.state === 'failed' ? FAILED_CARD : making ? COLORS.paper : colour);
          this.put(`${id}-fill`, 'display', making ? 'flex' : 'none');
          if (making) {
            this.put(`${id}-fill`, 'backgroundColor', colour);
            this.put(`${id}-fill`, 'height', Math.min(FILL_MAX_PX, Math.round(FILL_PX * making.fill)));
            this.put(`${id}-wave`, 'src', `${CARD_ART}wave-${WAVES[index % WAVES.length]}.png`);
            waves.push(id);
          }
        }
      }
    }
    this.waves = waves;
    const none = this.cards.mine.length === 0;
    this.put('mine-cards', 'display', none ? 'none' : 'flex');
    this.put('mine-empty', 'display', none ? 'flex' : 'none');
  }

  /**
   * Talk to Muse: the voice tutor (voice-agent.ts), a spoken conversation that answers questions about the game
   * that is open, can plan a course and can open a level. Pinch to start, pinch again to end.
   */
  private readonly tutor = new VoiceTutor(
    {
      createCourse: async (subject) => {
        const course = await createCourse(subject);
        this.courses = [course, ...this.courses.filter((c) => c.id !== course.id)];
        this.listCards();
        this.pollSoon();
        return { ok: true, title: course.title, note: 'Planned. Its levels are being made now, each as a card under Your games; the first takes about 15 minutes.' };
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
        if (!lesson) return { ok: false, error: `"${course.title}" has ${course.lessons.length} levels.` };
        await this.openLevel(course.id, number - 1);
        return { ok: true, course: course.title, lesson: lesson.title, state: lesson.status === 'ready' ? 'opened in the room' : 'being made; it takes about 15 minutes' };
      },
      currentLesson: () => {
        const prompt = this.status.prompt;
        if (!prompt || this.status.phase === 'idle') return { open: false };
        return { open: true, title: this.titles.get(prompt) ?? null, request: prompt.split('\n(This is lesson')[0], state: this.status.phase };
      },
    },
    {
      onText: (role, text) => {
        this.tutorHeard = true;
        this.setVoice(`${role === 'user' ? 'You' : MASCOT_NAME}: ${ascii(text)}`, role === 'user' ? 'listening' : 'speaking');
      },
      onState: (state, detail) => {
        if (state === 'connecting') this.setVoice(`Calling ${MASCOT_NAME}...`, 'working');
        else if (state === 'thinking') this.setVoice('Thinking...', 'working');
        else if (state === 'stopped') this.setVoice(detail ? ascii(detail) : 'Pinch, then ask anything', detail ? 'off' : 'ready');
        else if (state === 'listening' && !this.tutorHeard) this.setVoice('Listening: ask anything. Pinch here to stop.', 'listening');
        if (state === 'stopped') this.tutorHeard = false;
      },
    },
  );
  private tutorHeard = false;
  private voiceBusy = false;

  /** What the tutor knows at the start: the player's courses and what is open. */
  private async tutorContext(): Promise<string> {
    await this.refreshCourses();
    const courses = this.courses.slice(0, 8).map((c) => `- ${c.title}: ${c.lessons.map((l, i) => `${i + 1}. ${l.title} (${l.status})`).join('; ')}`);
    const open = this.status.prompt && this.status.phase !== 'idle' ? (this.titles.get(this.status.prompt) ?? 'a game') : null;
    return `Saved courses:\n${courses.join('\n') || '(none yet)'}\nOpen now: ${open ?? 'nothing'}.`;
  }

  /** Pinch to talk to Muse, again to stop. */
  private async toggleVoice() {
    if (!voiceAvailable() || this.voiceBusy) return;
    if (this.tutor.active) {
      this.tutor.stop();
      return;
    }
    // The browser can't ask for the microphone inside XR: it has to be turned on on the start page first.
    const allowed = await microphoneState();
    if (allowed === 'prompt' || allowed === 'denied') {
      this.setVoice('Turn on the microphone first: leave the room view and tap "Turn on my microphone".', 'off');
      return;
    }
    // Busy while the tutor connects, so a second pinch can't start a second conversation.
    this.voiceBusy = true;
    try {
      await this.tutor.start(await this.tutorContext());
    } catch (err) {
      this.tutor.stop();
      this.setVoice(err instanceof TutorUnavailable && err.permanent ? `${MASCOT_NAME} can't talk here yet. Use Make a game.` : `${MASCOT_NAME} didn't answer. Pinch to try again.`, 'off');
    } finally {
      this.voiceBusy = false;
    }
  }

  /** A spoken game request waiting for its confirming pinch (speech meant for someone else is not a game). */
  private heardGame: string | null = null;
  private heardTimer = 0;

  /**
   * Make a game: pinch, say it, pinch again; the words show on the button and a third pinch makes the game.
   * Unconfirmed words are dropped after CONFIRM_MS.
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
        this.setGameVoice('Turn on the microphone first: leave the room view and tap "Turn on my microphone".', 'off');
        return;
      }
      try {
        await startListening(() => void this.toggleGameVoice());
        this.setGameVoice("Listening... pinch here when you're done", 'listening');
      } catch {
        this.setGameVoice('The microphone did not start: leave the room view and tap "Turn on my microphone".', 'off');
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
          this.setGameVoice('Pinch, say it, then pinch again', 'ready');
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
    const width = this.folded ? DOCKED.width : CENTRE.width;
    this.document?.getElementById('picker')?.setProperties({ width: this.folded ? BAR_PX : BOARD_PX });
    // Height is generous so the width is what sets the scale (as the host does for lesson panels).
    this.document?.setTargetDimensions(width, width * 4);
  }

  redock() {
    this.moved = false;
    this.placeIn = SETTLE_FRAMES;
  }

  /**
   * Stand the dashboard in front of where the player is looking or, as the small bar, to the left of the game
   * (not of their gaze: they are often looking at the panel itself when the game arrives), facing them.
   */
  private place() {
    if (this.moved) return;
    const docked = this.folded;
    const spot = docked ? DOCKED : CENTRE;
    const camera = this.world.camera;
    camera.getWorldPosition(this.head);
    if (docked && lessonPosition(this.lesson)) this.forward.subVectors(this.lesson, this.head);
    else camera.getWorldDirection(this.forward);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, -1);
    this.forward.normalize();
    // Docked on the side away from the game's panels. A positive yaw turns toward the player's left; a lesson
    // that faces away from them (opened at a spot saved from elsewhere) has its panels on the left, and a bar
    // docked there stood in front of them and took every press meant for their buttons.
    let yaw = spot.yaw;
    if (docked && lessonCardsCentre(this.lessonCards)) {
      const toCards = this.lessonCards.sub(this.head);
      const leftOfLine = this.forward.x * toCards.z - this.forward.z * toCards.x < 0;
      if (leftOfLine) yaw = -spot.yaw;
    }
    this.forward.applyAxisAngle(Object3DUp, yaw);
    // Worked out in the world, then put in the room's frame (anchored to the room, so it can differ).
    const at = this.head.clone().addScaledVector(this.forward, spot.distance);
    // Never inside the game: a big one close to the player (seated low, or enlarged) had the bar docked in its
    // middle, where the model's own parts took every press meant for it. Step out along the same line.
    if (docked && lessonModelBox(this.lessonBox)) {
      this.lessonBox.expandByScalar(PICKER_LESSON_GAP_M);
      for (let d = spot.distance; d < PICKER_MAX_DISTANCE_M && this.lessonBox.containsPoint(at.setY(this.lessonBox.min.y + 0.01)); d += 0.05) {
        at.copy(this.head).addScaledVector(this.forward, d + 0.05);
      }
    }
    // Below the eyes, but never into the floor: a player lying down or sitting on the floor has little room.
    const box = boxAround(this.holder);
    const below = box.isEmpty() ? PICKER_FALLBACK_HALF_HEIGHT_M : this.holder.getWorldPosition(new Vector3()).y - box.min.y;
    at.y = Math.max(this.head.y - spot.belowEyes, floorHeight(this.head) + PICKER_FLOOR_CLEARANCE_M + below);
    const frame = this.holder.parent;
    frame?.updateWorldMatrix(true, false);
    this.holder.position.copy(frame ? frame.worldToLocal(at.clone()) : at);
    // Panels face +Z: yaw toward the head.
    this.holder.rotation.set(0, Math.atan2(this.head.x - at.x, this.head.z - at.z) - worldYaw(frame), 0);
  }

  /** The bar or the board, the status line, and Muse's face. */
  private render() {
    if (!this.document) return;
    const { phase, prompt, message, since, kind } = this.status;
    this.put('mini', 'display', this.folded ? 'flex' : 'none');
    this.put('board', 'display', this.folded ? 'none' : 'flex');
    const thing = kind === 'game' ? 'game' : 'level';
    const title = (prompt && this.titles.get(prompt)) ?? `your ${thing}`;
    this.put('mini-title', 'text', clip(title === `your ${thing}` ? 'Playing' : title, 30));
    // Smaller and bigger resize a game; a lesson has its own handles and size pill.
    for (const id of ['mini-smaller', 'mini-bigger']) this.put(id, 'display', kind === 'game' ? 'flex' : 'none');
    const seconds = Math.max(0, Math.round((performance.now() - since) / 1000));
    const making = this.making.size;
    const text = {
      idle: making > 0 ? `${MASCOT_NAME} is making ${making === 1 ? 'your game' : `${making} games`}. Play one while you wait.` : 'Pick a game to start.',
      building: `Making ${title}${message ? ` (${ascii(message)})` : ''}... ${seconds} s`,
      fixing: `Fixing a problem in the ${thing}... ${seconds} s`,
      ready: `${title} is ready.`,
      failed: `That didn't work: ${ascii(message)}`,
      broken: `Something in the ${thing} broke.`,
    }[phase];
    this.put('status-text', 'text', text);
    this.put('status-dot', 'backgroundColor', phase === 'idle' && making > 0 ? COLORS.orange : PHASE_DOTS[phase]);
    this.put('fix', 'display', phase === 'broken' ? 'flex' : 'none');
  }
}

const Object3DUp = new Vector3(0, 1, 0);

/** The scrolling list's position, in design pixels from the top (uikit's Container). */
type ScrollList = { scrollPosition: { value: [number, number] | undefined }; maxScrollPosition: { value: [number?, number?] } };

/**
 * Let a dragged list keep scrolling in the headset. uikit marks a pointer event's native event as scrolled, so that
 * a list inside a list does not scroll on the same drag; IWSDK hands every pointer move the same native event
 * object, reused frame after frame, so once the list had moved 5 px the mark stayed and every later drag was
 * ignored: pinching and dragging did nothing. Cleared once a frame. Reaches into IWSDK's input internals (as
 * grab.ts pinchAtFingertips does); does nothing if they are shaped differently.
 */
function clearScrollMarks(input: unknown) {
  const pointers = (input as { xr?: { multiPointers?: Record<string, { nativeEvent?: object } | undefined> } } | null)?.xr?.multiPointers;
  for (const hand of ['left', 'right']) {
    const event = pointers?.[hand]?.nativeEvent as Record<symbol, unknown> | undefined;
    if (!event) continue;
    for (const key of Object.getOwnPropertySymbols(event)) if (key.description === 'was-scrolled') delete event[key];
  }
}

/** A course whose title best matches what the player said (shared words), or none. */
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

const TYPOGRAPHY: Record<string, string> = { '—': ' - ', '–': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...' };

/** The panel font has plain ASCII only; keep server messages short and printable. */
function ascii(text: string) {
  const plain = text.replace(/[–—‘’“”…]/g, (ch) => TYPOGRAPHY[ch]).replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim();
  return plain.length > 90 ? `${plain.slice(0, 87)}...` : plain || 'unknown error';
}

/** A card's words: printable, and cut to what its card has room for. */
function clip(text: string, max: number) {
  const plain = ascii(text);
  return plain.length > max ? `${plain.slice(0, max - 3).trimEnd()}...` : plain;
}
