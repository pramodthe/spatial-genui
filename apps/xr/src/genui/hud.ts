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
