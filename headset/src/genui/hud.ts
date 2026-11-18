import {
  CanvasTexture,
  createSystem,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PokeInteractable,
  Pressed,
  Quaternion,
  RayInteractable,
  SRGBColorSpace,
  Vector3,
  VisibilityState,
  type Entity,
  type World,
} from '@iwsdk/core';
import { COLORS } from './brand';

/**
 * The view pill: a small button at the top right of the learner's view, not in the room, that switches a lesson
 * between its fitted view (the model in a 50 cm box on the desk) and its real size. It follows the head softly
 * (a fixed spot in view, eased so it doesn't shake with every small head movement) and draws over everything.
 */

export type PillState = {
  /** Shown at all (a lesson with a known real size is open). */
  shown: boolean;
  /** The words on the pill, e.g. "Real size" with "1:16" beside it. */
  label: string;
  detail: string;
  /** False: the pill only informs (a bacterium at its real size would be invisible). */
  enabled: boolean;
};

// Where the pill sits in view: right of and above the centre, 60 cm out (about 16 degrees right, 10 up).
const OFFSET = new Vector3(0.17, 0.11, -0.6);
const WIDTH_M = 0.16;
const HEIGHT_M = 0.044;
const FOLLOW = 0.2; // share of the way to its spot in view each frame

let pill: { mesh: Mesh; entity: Entity; canvas: HTMLCanvasElement; texture: CanvasTexture; material: MeshBasicMaterial; snap: boolean } | null = null;
let state: PillState = { shown: false, label: '', detail: '', enabled: false };
let onPress: (() => void) | null = null;
let inXR = false;
let hidden = false;

export function initViewPill(world: World, press: () => void) {
  onPress = press;
  world.registerSystem(ViewPillSystem);
}

/** What the pill says and whether it shows. */
export function setPill(next: PillState) {
  state = next;
  draw();
  show();
}

/** Hide it with the rest of the chrome (the benchmark's screenshots show the lesson only). */
export function setPillHidden(value: boolean) {
  hidden = value;
  show();
}

/** For tests: what the pill says and where it is. */
export function inspectPill() {
  if (!pill) return null;
  const at = pill.mesh.getWorldPosition(new Vector3());
  return { ...state, visible: pill.mesh.visible, position: [at.x, at.y, at.z].map((v) => Math.round(v * 1000) / 1000) };
}

/** For tests: press the pill as a learner would. */
export function pressPill() {
  if (pill?.mesh.visible && state.enabled) onPress?.();
}

function show() {
  if (!pill) return;
  const visible = state.shown && inXR && !hidden;
  if (visible && !pill.mesh.visible) pill.snap = true; // appear in place rather than glide in from the last spot
  pill.mesh.visible = visible;
  if (visible === pill.entity.hasComponent(RayInteractable)) return;
  if (visible) {
    pill.entity.addComponent(RayInteractable, {});
    pill.entity.addComponent(PokeInteractable, {});
  } else {
    pill.entity.removeComponent(RayInteractable);
    pill.entity.removeComponent(PokeInteractable);
  }
}

function draw() {
  if (!pill) return;
  const { canvas, texture } = pill;
  const g = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;
  g.clearRect(0, 0, w, h);
  // Dark glass, as the Horizon kit's panels.
  g.fillStyle = state.enabled ? 'rgba(28, 30, 36, 0.88)' : 'rgba(28, 30, 36, 0.6)';
  g.beginPath();
  g.roundRect(2, 2, w - 4, h - 4, (h - 4) / 2);
  g.fill();
  g.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  g.lineWidth = 3;
  g.stroke();
  g.textBaseline = 'middle';
  g.font = '600 52px Inter, system-ui, sans-serif';
  g.fillStyle = state.enabled ? '#ffffff' : 'rgba(255, 255, 255, 0.55)';
  g.fillText(state.label, 44, h / 2 + 2);
  const labelWidth = g.measureText(state.label).width;
  g.font = '500 44px Inter, system-ui, sans-serif';
  g.fillStyle = 'rgba(255, 255, 255, 0.6)';
  g.fillText(state.detail, 44 + labelWidth + (state.label ? 26 : 0), h / 2 + 2);
  texture.needsUpdate = true;
}

class ViewPillSystem extends createSystem({ pressed: { required: [Pressed] } }) {
  private readonly target = new Vector3();
  private readonly facing = new Quaternion();

  init(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = 200;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    const material = new MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
    const mesh = new Mesh(new PlaneGeometry(WIDTH_M, HEIGHT_M), material);
    mesh.name = 'View pill';
    mesh.renderOrder = 1000; // over the lesson and the room
    mesh.visible = false;
    const entity = this.world.createTransformEntity(mesh, { persistent: true });
    pill = { mesh, entity, canvas, texture, material, snap: true };
    draw();
    this.queries.pressed.subscribe('qualify', (pressed) => {
      if (pressed === entity && state.enabled) onPress?.();
    });
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((visibility) => {
        inXR = visibility !== VisibilityState.NonImmersive;
        show();
      }),
    );
  }

  update(): void {
    if (!pill?.mesh.visible) return;
    const camera = this.world.camera;
    camera.updateMatrixWorld();
    this.target.copy(OFFSET).applyMatrix4(camera.matrixWorld);
    camera.getWorldQuaternion(this.facing);
    const follow = pill.snap ? 1 : FOLLOW;
    pill.snap = false;
    pill.mesh.position.lerp(this.target, follow);
    pill.mesh.quaternion.slerp(this.facing, follow);
  }
}

/**
 * The title card: a game's name, big, in the middle of the view when the game opens, like a game's opening. It grows
 * in, holds, fades and is gone; nothing of it stays in the room. Drawn over everything, it follows the head softly.
 */
const TITLE_OFFSET = new Vector3(0, 0.04, -1.0);
const TITLE_WIDTH_M = 0.8;
const TITLE_HEIGHT_M = 0.2;
const TITLE_IN_S = 0.35;
const TITLE_FADE_AT_S = 2.6;
const TITLE_GONE_S = 3.3;

let title: { mesh: Mesh; canvas: HTMLCanvasElement; texture: CanvasTexture; material: MeshBasicMaterial; age: number } | null = null;

export function initTitleCard(world: World) {
  world.registerSystem(TitleCardSystem);
}

/** Show a game's name as its opening title card (replacing one still showing). */
export function showTitle(text: string) {
  if (!title || !inXR || hidden) return;
  const { canvas, texture } = title;
  const g = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;
  g.clearRect(0, 0, w, h);
  // The app's colours (brand.ts): a yellow card with an ink outline reads against a room and against a sky.
  g.fillStyle = COLORS.sun;
  g.beginPath();
  g.roundRect(10, 10, w - 20, h - 20, 56);
  g.fill();
  g.strokeStyle = COLORS.ink;
  g.lineWidth = 14;
  g.stroke();
  const words = text.trim().toUpperCase();
  let size = 132;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  do {
    g.font = `800 ${size}px Inter, system-ui, sans-serif`;
    size -= 6;
  } while (g.measureText(words).width > w - 140 && size > 48);
  g.fillStyle = COLORS.ink;
  g.fillText(words, w / 2, h / 2 + 6);
  texture.needsUpdate = true;
  title.age = 0;
  title.mesh.visible = true;
}

/** Take the title card away at once (its game was closed). */
export function hideTitle() {
  if (title) title.mesh.visible = false;
}

/** For tests: whether the title card shows and what it says is drawn, not read back. */
export function inspectTitle() {
  return title ? { visible: title.mesh.visible, age: Math.round(title.age * 100) / 100 } : null;
}

class TitleCardSystem extends createSystem({}) {
  private readonly target = new Vector3();
  private readonly facing = new Quaternion();

  init(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 1440;
    canvas.height = 360;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    const material = new MeshBasicMaterial({ map: texture, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
    const mesh = new Mesh(new PlaneGeometry(TITLE_WIDTH_M, TITLE_HEIGHT_M), material);
    mesh.name = 'Title card';
    mesh.renderOrder = 1001; // over the game, the room and the pill
    mesh.visible = false;
    mesh.raycast = () => {}; // the hands point through it
    this.world.createTransformEntity(mesh, { persistent: true });
    title = { mesh, canvas, texture, material, age: 0 };
  }

  update(delta: number): void {
    if (!title?.mesh.visible) return;
    if (!inXR || hidden) {
      title.mesh.visible = false;
      return;
    }
    const first = title.age === 0;
    title.age += Math.min(delta, 0.05);
    const t = title.age;
    if (t >= TITLE_GONE_S) {
      title.mesh.visible = false;
      return;
    }
    const grow = Math.min(1, t / TITLE_IN_S);
    title.material.opacity = Math.min(grow, Math.max(0, (TITLE_GONE_S - t) / (TITLE_GONE_S - TITLE_FADE_AT_S)));
    title.mesh.scale.setScalar(0.88 + 0.12 * (1 - (1 - grow) ** 3));
    const camera = this.world.camera;
    camera.updateMatrixWorld();
    this.target.copy(TITLE_OFFSET).applyMatrix4(camera.matrixWorld);
    camera.getWorldQuaternion(this.facing);
    const follow = first ? 1 : FOLLOW;
    title.mesh.position.lerp(this.target, follow);
    title.mesh.quaternion.slerp(this.facing, follow);
  }
}
