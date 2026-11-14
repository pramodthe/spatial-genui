import {
  CapsuleGeometry,
  createSystem,
  DistanceGrabbable,
  Grabbed,
  Hovered,
  Mesh,
  MeshBasicMaterial,
  MovementMode,
  RayInteractable,
  Vector3,
  VisibilityState,
  type Entity,
  type Object3D,
  type World,
} from '@iwsdk/core';

/**
 * Move handles: a small bar the learner points at, pinches and drags to move a whole lesson, the picker or one
 * of a lesson's cards. The bar is its own entity in the scene, not the target's parent: a grabbable parent would
 * take every pinch meant for a part or a button inside it. While the bar is held the target follows it and keeps
 * facing the learner; otherwise the bar follows the target. Targets may sit inside other frames (a lesson in the
 * room's anchored frame, a card inside a lesson): the bar works in world space and the target in its parent's.
 */

export type MoveHandle = {
  /** Where the bar sits, in the target's own frame. */
  readonly offset: Vector3;
  /** Hide the bar along with its target (a hidden bar must not catch a hand ray). */
  setShown(shown: boolean): void;
  dispose(): void;
};

type Options = {
  /** Where the bar sits from the target's origin, in metres, turned with the target's facing. */
  offset: [number, number, number];
  /** Stand the bar upright (beside a panel) instead of lying flat (in front of a lesson). */
  upright?: boolean;
  /** The learner let go: the target is where they want it. */
  onMoved?: () => void;
};

type Record = {
  entity: Entity;
  bar: Mesh;
  material: MeshBasicMaterial;
  target: Object3D;
  offset: Vector3;
  held: boolean;
  shown: boolean;
  /** Whether the target itself is drawn (a lesson hides cards between steps; its bar goes with it). */
  drawn: boolean;
  look: number;
  onMoved?: () => void;
};

const BAR_LENGTH_M = 0.16;
const BAR_RADIUS_M = 0.014;
const COLORS = ['#c0c0c0', '#ffffff', '#31a8f3'] as const; // resting, pointed at, held (Horizon greys, selection blue)
const UP = new Vector3(0, 1, 0);

const records = new Set<Record>();
let hiddenByHost = false;
let inXR = false;

export const MOVE_HANDLE_RADIUS_M = BAR_RADIUS_M;

export function initMoveHandles(world: World) {
  world.registerSystem(MoveHandleSystem);
}

/** Hide every handle regardless of XR state (the benchmark hides all chrome before its screenshots). */
export function setMoveHandlesHidden(hidden: boolean) {
  hiddenByHost = hidden;
  for (const record of records) show(record);
}

/** For tests: where each handle is and whether it is held. */
export function inspectMoveHandles() {
  return [...records].map((record) => ({
    target: record.target.name,
    visible: record.bar.visible,
    held: record.held,
    position: record.bar.position.toArray().map((v) => Math.round(v * 1000) / 1000),
    targetPosition: record.target.position.toArray().map((v) => Math.round(v * 1000) / 1000),
  }));
}

/** Give `target` (turned only about the vertical, inside frames that are too) a move handle. */
export function createMoveHandle(world: World, target: Object3D, options: Options): MoveHandle {
  const geometry = new CapsuleGeometry(BAR_RADIUS_M, BAR_LENGTH_M - BAR_RADIUS_M * 2, 6, 16);
  if (!options.upright) geometry.rotateZ(Math.PI / 2);
  const material = new MeshBasicMaterial({ color: COLORS[0], transparent: true, opacity: 0.9 });
  const bar = new Mesh(geometry, material);
  bar.name = `Move handle: ${target.name}`;
  const entity = world.createTransformEntity(bar);
  entity.addComponent(DistanceGrabbable, { movementMode: MovementMode.MoveAtSource, rotate: false, scale: false });
  const record: Record = { entity, bar, material, target, offset: new Vector3(...options.offset), held: false, shown: false, drawn: drawn(target), look: 0, onMoved: options.onMoved };
  records.add(record);
  follow(record);
  show(record);
  return {
    offset: record.offset,
    setShown(shown) {
      record.shown = shown;
      show(record);
    },
    dispose() {
      records.delete(record);
      entity.dispose();
    },
  };
}

function drawn(object: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

function show(record: Record) {
  const visible = record.shown && record.drawn && inXR && !hiddenByHost;
  record.bar.visible = visible;
  if (visible === record.entity.hasComponent(RayInteractable)) return;
  if (visible) record.entity.addComponent(RayInteractable, {});
  else record.entity.removeComponent(RayInteractable);
}

const shift = new Vector3();
const at = new Vector3();
const facing = new Vector3();

/** Which way `object` faces in the world, as a turn about the vertical (its +Z, as for lessons and panels). */
export function worldYaw(object: Object3D | null): number {
  if (!object) return 0;
  object.updateWorldMatrix(true, false);
  facing.set(0, 0, 1).transformDirection(object.matrixWorld);
  return Math.atan2(facing.x, facing.z);
}

/** Put the bar at its place beside the target. */
function follow(record: Record) {
  const { bar, target } = record;
  const yaw = worldYaw(target);
  shift.copy(record.offset).applyAxisAngle(UP, yaw);
  bar.position.copy(target.getWorldPosition(at)).add(shift);
  bar.rotation.set(0, yaw, 0);
}

class MoveHandleSystem extends createSystem({}) {
  private head!: Vector3;

  init(): void {
    this.head = new Vector3();
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((visibility) => {
        inXR = visibility !== VisibilityState.NonImmersive;
        for (const record of records) show(record);
      }),
    );
  }

  update(): void {
    for (const record of records) {
      const targetDrawn = drawn(record.target);
      if (targetDrawn !== record.drawn) {
        record.drawn = targetDrawn;
        show(record);
      }
      const held = record.entity.hasComponent(Grabbed);
      if (held) {
        // The target keeps its place beside the bar and turns to face the learner.
        const { bar, target } = record;
        this.world.camera.getWorldPosition(this.head);
        shift.copy(record.offset).applyAxisAngle(UP, worldYaw(target));
        at.copy(bar.position).sub(shift);
        const toHead = Math.atan2(this.head.x - at.x, this.head.z - at.z);
        target.position.copy(target.parent ? target.parent.worldToLocal(at) : at);
        target.rotation.y = toHead - worldYaw(target.parent);
      } else {
        follow(record);
      }
      const look = held ? 2 : record.entity.hasComponent(Hovered) ? 1 : 0;
      if (look !== record.look) {
        record.look = look;
        record.material.color.set(COLORS[look]);
      }
      if (record.held && !held) record.onMoved?.();
      record.held = held;
    }
  }
}
