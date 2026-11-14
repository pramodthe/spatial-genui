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
import { VoiceTutor } from './voice-agent';
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

const CENTRE = { width: 0.56, distance: 0.7, belowEyes: 0.2, yaw: 0 };
// To the left, outside the 35 degrees either side of straight ahead where the host lays out lesson panels.
const DOCKED = { width: 0.36, distance: 0.5, belowEyes: 0.3, yaw: (60 * Math.PI) / 180 };
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
      () => this.tutor.stop(),
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
    if (!voiceAvailable()) this.setVoice('Voice input is not available in this browser.', 'off');
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
      this.setVoice(`That didn't work: ${ascii((err as Error).message)}`, 'off');
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
    const active = this.courses.some((c) => c.status === 'planning' || c.model?.status === 'building' || c.lessons.some((l) => l.status === 'generating'));
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
      const ready = row.lessons.filter((l) => l.status === 'ready').length;
      document.getElementById(`course-${i}-fill`)?.setProperties({ width: `${row.lessons.length ? Math.round((100 * ready) / row.lessons.length) : 0}%` });
    }
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
      document.getElementById(`step-${i}-state`)?.setProperties({ text: modelling && lesson.status === 'pending' ? 'Waits for the 3D model' : STEP_STATES[lesson.status] });
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
        try {
          await this.tutor.start(await this.tutorContext());
          return;
        } catch {
          // No tutor on this server (or it can't be reached): one-shot voice requests instead.
          this.tutor.stop();
          this.tutorOff = true;
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

  private setVoice(text: string, tone: VoiceTone) {
    this.document?.getElementById('voice-label')?.setProperties({ text });
    this.document?.getElementById('voice-circle')?.setProperties({ backgroundColor: VOICE_TONES[tone] });
  }

  private applySize() {
    const width = this.docked ? DOCKED.width : CENTRE.width;
    this.handle.offset.x = width / 2 + HANDLE_GAP_M;
    // Height is generous so the width is what sets the scale (as the host does for lesson panels).
    this.document?.setTargetDimensions(width, width * 4);
    const course = this.courses.find((c) => c.id === this.shown);
    this.document?.getElementById('hint')?.setProperties({ display: this.docked || course ? 'none' : 'flex' });
    this.document?.getElementById('heading')?.setProperties({ text: course ? ascii(course.title) : this.docked ? 'Pick another lesson' : 'What do you want to learn?' });
    this.document?.getElementById('eyebrow')?.setProperties({ text: course ? 'COURSE' : 'LESSONS ON YOUR DESK' });
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
