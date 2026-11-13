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
import { cancelListening, isListening, startListening, stopAndTranscribe, voiceAvailable } from './voice';
import type { LessonStatus } from './overlay';
import { courseProgress, createCourse, fetchCourseLesson, listCourses, polishCourseLesson, type CourseSummary } from './courses';
import { capture, lessonPosition } from './host';
import { createMoveHandle, type MoveHandle } from './handle';

/**
 * In-headset lesson picker. The desktop prompt box is a DOM overlay, which an immersive session doesn't
 * show, so in XR this panel is how a learner starts a lesson with hands only (point and pinch, or touch).
 * With no lesson it stands front and centre; once a lesson is ready it docks to the learner's left, out of
 * the lesson's way but a glance away, to pick another. It also shows build progress and, when a lesson
 * breaks after the automatic repair, a "Fix it" button.
 *
 * Below the cards is the course shelf: a spoken subject becomes a saved course, planned at once and written
 * in the background (courses.ts). A course row opens its list of lessons; a ready lesson opens with a pinch.
 */

type PickerHandlers = {
  start: (prompt: string) => void;
  fix: () => void;
  /** Write a fresh version of the current lesson live. */
  fresh: () => void;
  /** A request the learner spoke (written live). */
  ask: (prompt: string) => void;
  /** Open a lesson that is already written (from a saved course). */
  open: (code: string, prompt: string) => void;
  onStatus: (listener: (status: LessonStatus) => void) => () => void;
};

const CENTRE = { width: 0.5, distance: 0.7, belowEyes: 0.2, yaw: 0 };
// To the left, outside the 35 degrees either side of straight ahead where the host lays out lesson panels.
const DOCKED = { width: 0.32, distance: 0.5, belowEyes: 0.3, yaw: (60 * Math.PI) / 180 };
// Frames to wait after entering XR before placing: the first frames can still have the pre-session camera pose.
const SETTLE_FRAMES = 20;
// The move handle stands this far outside the panel's right edge.
const HANDLE_GAP_M = 0.035;
const SHELF_ROWS = 3;
const COURSE_STEPS = 5;
// How often the shelf asks the server while a course is being planned or written.
const COURSE_POLL_MS = 4000;
// A lesson's textures and panels are in by now; its pictures then go to the agent for one revision.
const REVIEW_AFTER_MS = 7000;
const STEP_STATES = { pending: 'Pinch to write it', generating: 'Writing...', ready: 'Ready: pinch to open', failed: 'Failed: pinch to retry' } as const;

const PHASES: Record<LessonStatus['phase'], { dot: string; background: string }> = {
  idle: { dot: '#8a8f99', background: '#262930' },
  building: { dot: '#f5a524', background: '#3d3215' },
  fixing: { dot: '#f5a524', background: '#3d3215' },
  ready: { dot: '#3cb44b', background: '#173a22' },
  failed: { dot: '#e6194b', background: '#3f1a1f' },
  broken: { dot: '#e6194b', background: '#3f1a1f' },
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

/** For tests: where the picker is and what it shows. */
export function inspectPicker() {
  if (!picker) return null;
  return picker.inspect();
}

/** For tests: what a learner does on the course shelf by voice and pinch. */
export const pickerCourses = {
  request: (subject: string) => picker?.requestCourse(subject),
  show: (id: string | null) => picker?.showCourse(id),
  step: (index: number) => picker?.openStep(index),
  refresh: () => picker?.refreshCourses(),
};

class LessonPickerSystem extends createSystem({
  documents: { required: [PanelUI, PanelDocument] },
}) {
  private holder!: Group;
  private entity!: Entity;
  private document: UIKitDocument | null = null;
  private status: LessonStatus = { phase: 'idle', prompt: null, message: '', since: 0 };
  private inXR = false;
  private interactive = true;
  private docked = false;
  private handle!: MoveHandle;
  /** The learner dragged the picker somewhere: it stays there for the rest of the session. */
  private moved = false;
  private placeIn = -1;
  private ticker = 0;
  private courses: CourseSummary[] = [];
  /** The course whose lessons are listed (null: the home view). */
  private shown: string | null = null;
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
    this.entity = this.world.createTransformEntity(this.holder);
    this.entity.addComponent(PanelUI, { config: `${import.meta.env.BASE_URL}ui/lesson-picker.uikitml` });
    this.entity.addComponent(RayInteractable, {});
    this.entity.addComponent(PokeInteractable, {});
    this.handle = createMoveHandle(this.world, this.holder, {
      offset: [CENTRE.width / 2 + HANDLE_GAP_M, 0, 0],
      upright: true,
      onMoved: () => (this.moved = true),
    });

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
      () => cancelListening(),
      () => this.handle.dispose(),
      () => (picker = null),
    );
    // While a lesson is being written, count the seconds (once a second, not every frame).
    this.ticker = window.setInterval(() => {
      if (this.status.phase === 'building' || this.status.phase === 'fixing') this.render();
    }, 1000);
  }

  update(): void {
    if (this.placeIn > 0 && --this.placeIn === 0) this.place();
  }

  refreshVisibility() {
    const show = this.inXR && !hiddenByHost;
    this.holder.visible = show;
    this.handle.setShown(show);
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
      cards: EXAMPLE_LESSONS.map((lesson, i) => ({ id: `lesson-${i}`, title: lesson.title })),
      shown: this.shown,
      courses: this.courses.map((c) => ({ id: c.id, title: c.title, status: c.status, progress: courseProgress(c), lessons: c.lessons.map((l) => l.status) })),
    };
  }

  private onStatus(status: LessonStatus) {
    this.status = status;
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
    if (!voiceAvailable()) this.setVoice('Voice input is not available in this browser.', '#3a3d44');
    for (let i = 0; i < SHELF_ROWS; i++) document.getElementById(`course-${i}`)?.addEventListener('click', () => this.showCourse(this.courses[i]?.id ?? null));
    for (let i = 0; i < COURSE_STEPS; i++) document.getElementById(`step-${i}`)?.addEventListener('click', () => void this.openStep(i));
    document.getElementById('back')?.addEventListener('click', () => this.showCourse(null));
    void this.refreshCourses();
  }

  /** A spoken (or typed) subject becomes a saved course: planned now, written in the background. */
  async requestCourse(subject: string) {
    try {
      const course = await createCourse(subject);
      this.courses = [course, ...this.courses.filter((c) => c.id !== course.id)];
      this.showCourse(course.id);
      this.pollCourses();
    } catch (err) {
      this.setVoice(`That didn't work: ${ascii((err as Error).message)}`, '#3a3d44');
    }
  }

  showCourse(id: string | null) {
    this.shown = id && this.courses.some((c) => c.id === id) ? id : null;
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
      this.courses = await listCourses();
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
    const active = this.courses.some((c) => c.status === 'planning' || c.lessons.some((l) => l.status === 'generating'));
    if (active) this.coursePoll = window.setTimeout(() => void this.refreshCourses(), COURSE_POLL_MS);
  }

  private renderCourses() {
    const document = this.document;
    if (!document) return;
    const course = this.courses.find((c) => c.id === this.shown);
    document.getElementById('home')?.setProperties({ display: course ? 'none' : 'flex' });
    document.getElementById('course')?.setProperties({ display: course ? 'flex' : 'none' });
    document.getElementById('shelf-label')?.setProperties({ display: this.courses.length ? 'flex' : 'none' });
    for (let i = 0; i < SHELF_ROWS; i++) {
      const row = this.courses[i];
      document.getElementById(`course-${i}`)?.setProperties({ display: row ? 'flex' : 'none' });
      if (!row) continue;
      document.getElementById(`course-${i}-title`)?.setProperties({ text: ascii(row.title) });
      document.getElementById(`course-${i}-state`)?.setProperties({ text: courseProgress(row) });
    }
    if (!course) return;
    document.getElementById('course-sub')?.setProperties({
      text: ascii(course.status === 'failed' ? `Could not be planned: ${course.error ?? ''}` : course.subtitle || 'Pinch a lesson to open it.'),
    });
    for (let i = 0; i < COURSE_STEPS; i++) {
      const lesson = course.lessons[i];
      document.getElementById(`step-${i}`)?.setProperties({ display: lesson ? 'flex' : 'none', borderColor: lesson?.status === 'ready' ? '#3cb44b' : '#4a4e57' });
      if (!lesson) continue;
      document.getElementById(`step-${i}-title`)?.setProperties({ text: `${i + 1}. ${ascii(lesson.title)}` });
      document.getElementById(`step-${i}-state`)?.setProperties({ text: STEP_STATES[lesson.status] });
    }
  }

  /** Pinch once to start talking, again to finish; the request is then written live. */
  private async toggleVoice() {
    if (!voiceAvailable() || this.voiceBusy) return;
    if (!isListening()) {
      try {
        await startListening(() => void this.toggleVoice());
        this.setVoice("Listening... pinch here when you're done", '#7a2333');
      } catch {
        this.setVoice('Microphone blocked: allow it for this site, then try again.', '#3a3d44');
      }
      return;
    }
    this.voiceBusy = true;
    this.setVoice('Understanding...', '#3d3215');
    try {
      const text = await stopAndTranscribe();
      if (!text) {
        this.setVoice("I didn't catch that. Pinch here and try again.", '#1f3354');
      } else {
        this.setVoice(`Planning a course on: "${ascii(text)}"`, '#1f3354');
        await this.requestCourse(text);
      }
    } catch (err) {
      this.setVoice(`Voice failed: ${ascii((err as Error).message)}`, '#3a3d44');
    } finally {
      this.voiceBusy = false;
    }
  }

  private voiceBusy = false;

  private setVoice(text: string, background: string) {
    this.document?.getElementById('voice-label')?.setProperties({ text });
    this.document?.getElementById('voice')?.setProperties({ backgroundColor: background });
  }

  private applySize() {
    const width = this.docked ? DOCKED.width : CENTRE.width;
    this.handle.offset.x = width / 2 + HANDLE_GAP_M;
    // Height is generous so the width is what sets the scale (as the host does for lesson panels).
    this.document?.setTargetDimensions(width, width * 4);
    const course = this.courses.find((c) => c.id === this.shown);
    this.document?.getElementById('hint')?.setProperties({ display: this.docked || course ? 'none' : 'flex' });
    this.document?.getElementById('heading')?.setProperties({ text: course ? ascii(course.title) : this.docked ? 'Pick another lesson' : 'What do you want to learn?' });
  }

  /**
   * Stand the picker in front of where the learner is looking or, docked, to the left of the lesson (not of
   * their gaze: they are often looking at the picker itself when the next lesson arrives), facing them.
   */
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
    this.holder.position.copy(this.head).addScaledVector(this.forward, spot.distance);
    this.holder.position.y = this.head.y - spot.belowEyes;
    // Panels face +Z: yaw toward the head.
    this.holder.rotation.set(0, Math.atan2(this.head.x - this.holder.position.x, this.head.z - this.holder.position.z), 0);
  }

  private render() {
    const document = this.document;
    if (!document) return;
    const { phase, prompt, message, since } = this.status;
    const seconds = Math.max(0, Math.round((performance.now() - since) / 1000));
    const title = EXAMPLE_LESSONS.find((lesson) => lesson.prompt === prompt)?.title ?? (prompt && this.titles.get(prompt)) ?? 'your lesson';
    const text = {
      idle: 'Pick a lesson to start.',
      building: `Writing ${title === 'your lesson' ? title : `the ${title} lesson`}${message ? ` (${ascii(message)})` : ''}... ${seconds} s`,
      fixing: `Fixing a problem in the lesson... ${seconds} s`,
      ready: `${title === 'your lesson' ? 'Your lesson' : title} is ready.`,
      failed: `That didn't work: ${ascii(message)}`,
      broken: 'Something in the lesson broke.',
    }[phase];
    document.getElementById('status-text')?.setProperties({ text });
    document.getElementById('status-dot')?.setProperties({ backgroundColor: PHASES[phase].dot });
    document.getElementById('status')?.setProperties({ backgroundColor: PHASES[phase].background });
    document.getElementById('fix')?.setProperties({ display: phase === 'broken' ? 'flex' : 'none' });
    document.getElementById('fresh')?.setProperties({ display: phase === 'ready' ? 'flex' : 'none' });
    // The chosen card stays marked while it is being written and once it is showing.
    EXAMPLE_LESSONS.forEach((lesson, i) => {
      const chosen = lesson.prompt === prompt && phase !== 'idle' && phase !== 'failed';
      document.getElementById(`lesson-${i}`)?.setProperties({ borderColor: chosen ? PHASES[phase].dot : '#4a4e57' });
    });
  }
}

const Object3DUp = new Vector3(0, 1, 0);

/** The panel font has plain ASCII only; keep server messages short and printable. */
function ascii(text: string) {
  const plain = text.replace(/[^\x20-\x7e]/g, '').trim();
  return plain.length > 90 ? `${plain.slice(0, 87)}...` : plain || 'unknown error';
}
