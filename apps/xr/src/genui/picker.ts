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
import type { LessonStatus } from './overlay';

/**
 * In-headset lesson picker. The desktop prompt box is a DOM overlay, which an immersive session doesn't
 * show, so in XR this panel is how a learner starts a lesson with hands only (point and pinch, or touch).
 * With no lesson it stands front and centre; once a lesson is ready it docks to the learner's left, out of
 * the lesson's way but a glance away, to pick another. It also shows build progress and, when a lesson
 * breaks after the automatic repair, a "Fix it" button.
 */

type PickerHandlers = {
  start: (prompt: string) => void;
  fix: () => void;
  onStatus: (listener: (status: LessonStatus) => void) => () => void;
};

const CENTRE = { width: 0.5, distance: 0.6, belowEyes: 0.12, yaw: 0 };
// To the left, outside the 35 degrees either side of straight ahead where the host lays out lesson panels.
const DOCKED = { width: 0.32, distance: 0.5, belowEyes: 0.3, yaw: (60 * Math.PI) / 180 };
// Frames to wait after entering XR before placing: the first frames can still have the pre-session camera pose.
const SETTLE_FRAMES = 20;

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
  private placeIn = -1;
  private ticker = 0;
  private readonly head = new Vector3();
  private readonly forward = new Vector3();

  init(): void {
    picker = this;
    this.holder = new Group();
    this.holder.name = 'Lesson Picker';
    this.holder.visible = false;
    this.entity = this.world.createTransformEntity(this.holder);
    this.entity.addComponent(PanelUI, { config: `${import.meta.env.BASE_URL}ui/lesson-picker.uikitml` });
    this.entity.addComponent(RayInteractable, {});
    this.entity.addComponent(PokeInteractable, {});

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
        this.refreshVisibility();
      }),
      handlers!.onStatus((status) => this.onStatus(status)),
      () => clearInterval(this.ticker),
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
    };
  }

  private onStatus(status: LessonStatus) {
    const before = this.status.phase;
    this.status = status;
    // Dock beside a lesson once it is in; come back to the centre when there is none.
    const dock = status.phase === 'ready' || (this.docked && (status.phase === 'building' || status.phase === 'fixing' || status.phase === 'broken'));
    if (dock !== this.docked || (status.phase === 'ready' && before !== 'ready')) {
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
  }

  private applySize() {
    const width = this.docked ? DOCKED.width : CENTRE.width;
    // Height is generous so the width is what sets the scale (as the host does for lesson panels).
    this.document?.setTargetDimensions(width, width * 4);
    this.document?.getElementById('hint')?.setProperties({ display: this.docked ? 'none' : 'flex' });
    this.document?.getElementById('heading')?.setProperties({ text: this.docked ? 'Pick another lesson' : 'What do you want to learn?' });
  }

  /** Stand the picker in front of (or, docked, to the left of) where the learner is looking, facing them. */
  private place() {
    const spot = this.docked ? DOCKED : CENTRE;
    const camera = this.world.camera;
    camera.getWorldPosition(this.head);
    camera.getWorldDirection(this.forward);
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
    const title = EXAMPLE_LESSONS.find((lesson) => lesson.prompt === prompt)?.title ?? 'your lesson';
    const text = {
      idle: 'Pick a lesson to start.',
      building: `Writing ${title === 'your lesson' ? title : `the ${title} lesson`}... ${seconds} s`,
      fixing: `Fixing a problem in the lesson... ${seconds} s`,
      ready: `${title === 'your lesson' ? 'Your lesson' : title} is ready.`,
      failed: `That didn't work: ${ascii(message)}`,
      broken: 'Something in the lesson broke.',
    }[phase];
    document.getElementById('status-text')?.setProperties({ text });
    document.getElementById('status-dot')?.setProperties({ backgroundColor: PHASES[phase].dot });
    document.getElementById('status')?.setProperties({ backgroundColor: PHASES[phase].background });
    document.getElementById('fix')?.setProperties({ display: phase === 'broken' ? 'flex' : 'none' });
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
