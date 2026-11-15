import {
  Box3,
  BoxGeometry,
  CylinderGeometry,
  Group,
  Hovered,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  RayInteractable,
  SphereGeometry,
  Vector3,
  type Entity,
  type Object3D,
  type World,
} from '@iwsdk/core';

/**
 * The frame around a lesson's 3D: thin lines along its box, measured in the lesson's own frame so they turn with
 * it. Handles sit on the lines:
 *   - the four bottom edges move the lesson (point at one, or touch it, then pinch and drag);
 *   - a knob in the middle of each upright edge turns it about the vertical;
 *   - a pinch at a corner scales the 3D about the opposite corner.
 * The frame is faint until a hand comes near; a handle thickens and turns blue when pointed at and while held.
 * Handles only take a pinch that starts on them, so a pinch on a part or a button inside still lands there.
 * A game gets the handles only (no lines, no corners), set a little outside its playfield, where play isn't.
 */
export type LessonBounds = {
  /** `held`: a part of the lesson is in a hand (the frame then stays out of the way). `floor`: world y of the floor. */
  tick(input: unknown, held: boolean, floor: number): void;
  /** The hand dragging a handle, if any (a game doesn't count that hand's pinch as play). */
  dragging(): 'left' | 'right' | null;
  /** For tests: the handles and what is being dragged. */
  inspect(): { handles: { kind: HandleKind; center: number[]; hovered: boolean }[]; drag: HandleKind | 'scale' | null; near: boolean };
  dispose(): void;
};

type HandleKind = 'move' | 'turn';
type Side = 'left' | 'right';
type HandPose = { side: Side; tip: Object3D; pinching: boolean };

const EDGE_M = 0.003;
const CORNER_M = 0.008;
// A move handle is a thin rod along a bottom edge; its pinchable volume is fatter than what is drawn.
const ROD_M = 0.004;
const ROD_HIT_M = 0.016;
const KNOB_M = 0.011;
const KNOB_HIT_M = 0.03;
// Curling the fingers to pinch moves the hand ray: a pinch this soon after a handle was pointed at still takes it.
const POINT_GRACE_MS = 350;
// A fingertip this close to a handle (or a corner) can pinch it without pointing.
const TOUCH_REACH_M = 0.05;
const CORNER_REACH_M = 0.05;
// A hand this close to the box brightens the frame.
const NEAR_M = 0.22;
const FLOOR_CLEARANCE_M = 0.02;
const SCALE_RANGE = [0.35, 3] as const;
// Idle, a hand near, pointed at, held.
const LINE_OPACITY = [0.12, 0.45] as const;
const HANDLE_LOOK = [
  { color: '#ffffff', opacity: 0.3, grow: 1 },
  { color: '#ffffff', opacity: 0.85, grow: 1 },
  { color: '#31a8f3', opacity: 1, grow: 1.7 },
  { color: '#31a8f3', opacity: 1, grow: 1.7 },
] as const;

const SIDES: Side[] = ['left', 'right'];
const AXIS_X = new Vector3(1, 0, 0);
// Corner n is (x, y, z) = bit 2, bit 1, bit 0 of n: 0 min, 1 max.
const EDGES: [number, number][] = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];
const BOTTOM_EDGES: [number, number][] = [[0, 1], [4, 5], [0, 4], [1, 5]];
const UPRIGHT_EDGES: [number, number][] = [[0, 2], [1, 3], [4, 6], [5, 7]];

type Handle = { kind: HandleKind; hit: Mesh; look: Mesh; material: MeshBasicMaterial; entity: Entity; edge: [number, number]; state: number };
type Drag =
  | { kind: 'move'; side: Side; last: Vector3; handle: Handle }
  | { kind: 'turn'; side: Side; pivot: Vector3; lastAngle: number; handle: Handle }
  | { kind: 'scale'; side: Side; oppositeLocal: Vector3; oppositeAnchor: Vector3; startDist: number; startScale: number };

/**
 * `anchor` is what moves and turns (the lesson's anchor, inside the room's frame); `root` is its 3D, which is
 * what is measured and scaled. Handle entities are made under `anchorEntity` so hand rays can point at them.
 */
export function createLessonBounds(
  world: World,
  anchor: Object3D,
  anchorEntity: Entity,
  root: Object3D,
  options: {
    onMoved?: () => void;
    /** Draw the box's lines and corners, and let a corner scale (default true; a game has handles only). */
    frame?: boolean;
    /** How far outside the box the handles sit, in metres (default 0: on its lines). */
    outset?: number;
  } = {},
): LessonBounds {
  const withFrame = options.frame ?? true;
  const outset = options.outset ?? 0;
  const group = new Group();
  group.name = 'Lesson bounds';
  const lineMat = new MeshBasicMaterial({ color: '#e8eef7', transparent: true, opacity: LINE_OPACITY[0], depthWrite: false });
  const cornerMat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: LINE_OPACITY[0], depthTest: false, depthWrite: false });
  const unitBox = new BoxGeometry(1, 1, 1);
  const cornerGeo = new SphereGeometry(CORNER_M, 10, 8);
  const rodGeo = new CylinderGeometry(ROD_M, ROD_M, 1, 8).rotateZ(Math.PI / 2);
  const rodHitGeo = new CylinderGeometry(ROD_HIT_M, ROD_HIT_M, 1, 8).rotateZ(Math.PI / 2);
  const knobGeo = new CylinderGeometry(KNOB_M, KNOB_M, KNOB_M * 2.4, 16);
  const knobHitGeo = new SphereGeometry(KNOB_HIT_M, 10, 8);
  // Pinchable volumes are not drawn (colorWrite off), but rays still find them.
  const hitMat = new MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, opacity: 0 });

  const lines = EDGES.map(() => {
    const mesh = new Mesh(unitBox, lineMat);
    mesh.raycast = () => {};
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    group.add(mesh);
    return mesh;
  });
  const corners = Array.from({ length: 8 }, () => {
    const mesh = new Mesh(cornerGeo, cornerMat);
    mesh.raycast = () => {};
    mesh.frustumCulled = false;
    mesh.renderOrder = 11;
    group.add(mesh);
    return mesh;
  });
  anchor.add(group);

  const handles: Handle[] = [];
  const makeHandle = (kind: HandleKind, edge: [number, number]) => {
    const material = new MeshBasicMaterial({ color: HANDLE_LOOK[0].color, transparent: true, opacity: HANDLE_LOOK[0].opacity, depthTest: false, depthWrite: false });
    const hit = new Mesh(kind === 'move' ? rodHitGeo : knobHitGeo, hitMat);
    hit.name = kind === 'move' ? 'Move handle' : 'Turn handle';
    hit.frustumCulled = false;
    const look = new Mesh(kind === 'move' ? rodGeo : knobGeo, material);
    look.raycast = () => {};
    look.frustumCulled = false;
    look.renderOrder = 12;
    hit.add(look);
    const entity = world.createTransformEntity(hit, { parent: anchorEntity });
    entity.addComponent(RayInteractable, {});
    handles.push({ kind, hit, look, material, entity, edge, state: 0 });
  };
  for (const edge of BOTTOM_EDGES) makeHandle('move', edge);
  for (const edge of UPRIGHT_EDGES) makeHandle('turn', edge);

  // The box in the anchor's frame, its corners there and in the world, and (for scaling) in root's frame.
  const box = new Box3();
  const local = Array.from({ length: 8 }, () => new Vector3());
  const worldCorner = Array.from({ length: 8 }, () => new Vector3());
  const toAnchor = new Matrix4();
  const meshToAnchor = new Matrix4();
  const meshBox = new Box3();
  const v = [new Vector3(), new Vector3(), new Vector3()];
  const tipNow = new Vector3();
  const wasPinching: Record<Side, boolean> = { left: false, right: false };
  let drag: Drag | null = null;
  let near = false;
  /** The handle last pointed at, and when (for POINT_GRACE_MS). */
  let lastPointed: { handle: Handle; at: number } | null = null;

  /** The visible 3D's box in the anchor's frame (so it turns with the lesson instead of growing as it turns). */
  function measure() {
    box.makeEmpty();
    anchor.updateWorldMatrix(true, false);
    root.updateMatrixWorld(true);
    toAnchor.copy(anchor.matrixWorld).invert();
    const visit = (object: Object3D) => {
      if (!object.visible || (object as { isLine?: boolean }).isLine) return;
      const mesh = object as Mesh & { isInstancedMesh?: boolean; count?: number; boundingBox?: Box3 | null; computeBoundingBox?: () => void };
      if (mesh.isMesh) {
        let local: Box3 | null = null;
        if (mesh.isInstancedMesh) {
          if ((mesh.count ?? 0) > 0) {
            mesh.computeBoundingBox?.();
            local = mesh.boundingBox ?? null;
          }
        } else if (mesh.geometry) {
          if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
          local = mesh.geometry.boundingBox;
        }
        if (local && !local.isEmpty()) box.union(meshBox.copy(local).applyMatrix4(meshToAnchor.multiplyMatrices(toAnchor, mesh.matrixWorld)));
      }
      for (const child of object.children) visit(child);
    };
    visit(root);
    if (box.isEmpty()) return;
    for (let n = 0; n < 8; n++) {
      local[n]!.set(n & 4 ? box.max.x : box.min.x, n & 2 ? box.max.y : box.min.y, n & 1 ? box.max.z : box.min.z);
      worldCorner[n]!.copy(local[n]!).applyMatrix4(anchor.matrixWorld);
    }
  }

  /** Lay a unit-length x-axis mesh from local point a to b. */
  function lay(mesh: Object3D, a: Vector3, b: Vector3, thickness?: number) {
    const length = a.distanceTo(b);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    v[2]!.subVectors(b, a);
    if (v[2]!.lengthSq() > 1e-10) mesh.quaternion.setFromUnitVectors(AXIS_X, v[2]!.normalize());
    if (thickness === undefined) mesh.scale.set(Math.max(length, 0.001), 1, 1);
    else mesh.scale.set(Math.max(length, 0.001), thickness, thickness);
  }

  /** Push local point `p` straight out from the box's vertical middle line by the outset. */
  function pushOut(p: Vector3) {
    if (outset <= 0) return p;
    box.getCenter(v[2]!);
    v[2]!.set(p.x - v[2]!.x, 0, p.z - v[2]!.z);
    if (v[2]!.lengthSq() > 1e-10) p.addScaledVector(v[2]!.normalize(), outset);
    return p;
  }

  function place() {
    const empty = box.isEmpty();
    group.visible = !empty && withFrame;
    for (const handle of handles) handle.hit.visible = !empty;
    if (empty) return;
    EDGES.forEach(([i, j], n) => lay(lines[n]!, local[i]!, local[j]!, EDGE_M));
    for (let n = 0; n < 8; n++) corners[n]!.position.copy(local[n]!);
    for (const handle of handles) {
      const [i, j] = handle.edge;
      if (handle.kind === 'move') {
        // The rod leaves the corners free for scaling. Pushed out from the middle of its edge, so it stays parallel.
        const mid = pushOut(v[1]!.lerpVectors(local[i]!, local[j]!, 0.5)).sub(v[0]!.lerpVectors(local[i]!, local[j]!, 0.5));
        const a = v[0]!.lerpVectors(local[i]!, local[j]!, 0.15).add(mid);
        const b = new Vector3().lerpVectors(local[i]!, local[j]!, 0.85).add(mid);
        lay(handle.hit, a, b);
      } else {
        pushOut(handle.hit.position.lerpVectors(local[i]!, local[j]!, 0.5));
        handle.hit.quaternion.identity();
        handle.hit.scale.setScalar(1);
      }
    }
  }

  function hands(input: unknown): HandPose[] {
    const xr = (input as { xr?: { xrOrigin?: { indexTipSpaces?: Partial<Record<Side, Object3D>> }; getSelectState?(side: Side): { active: boolean } } } | null)?.xr;
    const tips = xr?.xrOrigin?.indexTipSpaces;
    if (!tips) return [];
    const found: HandPose[] = [];
    for (const side of SIDES) {
      const tip = tips[side];
      if (tip) found.push({ side, tip, pinching: xr.getSelectState?.(side)?.active === true });
    }
    return found;
  }

  /** The handle a pinch starting at `tip` takes: one pointed at, else one within touching reach. */
  function handleFor(tip: Vector3): Handle | null {
    // A ray on a knob can graze a rod beside it too: the knob is the smaller target, so it was the one aimed at.
    const pointed = handles.filter((h) => h.entity.hasComponent(Hovered));
    if (pointed.length) return pointed.find((h) => h.kind === 'turn') ?? pointed[0]!;
    if (lastPointed && performance.now() - lastPointed.at < POINT_GRACE_MS) return lastPointed.handle;
    let best: Handle | null = null;
    let bestDist = TOUCH_REACH_M;
    for (const handle of handles) {
      let dist: number;
      handle.hit.updateWorldMatrix(true, false);
      if (handle.kind === 'move') {
        // Distance to the rod: a unit length along its own x, stretched to the rod's length.
        const a = handle.hit.localToWorld(v[0]!.set(-0.5, 0, 0));
        const b = handle.hit.localToWorld(v[1]!.set(0.5, 0, 0));
        b.sub(a);
        const t = Math.min(1, Math.max(0, v[2]!.subVectors(tip, a).dot(b) / Math.max(b.lengthSq(), 1e-9)));
        dist = tip.distanceTo(v[2]!.copy(a).addScaledVector(b, t));
      } else {
        dist = tip.distanceTo(handle.hit.getWorldPosition(v[2]!));
      }
      if (dist < bestDist) [best, bestDist] = [handle, dist];
    }
    return best;
  }


  function nearestCorner(tip: Vector3): number {
    let best = -1;
    let bestDist = CORNER_REACH_M;
    for (let n = 0; n < 8; n++) {
      const dist = tip.distanceTo(worldCorner[n]!);
      if (dist < bestDist) [best, bestDist] = [n, dist];
    }
    return best;
  }

  function begin(pose: HandPose, tip: Vector3) {
    const handle = handleFor(tip);
    if (handle?.kind === 'move') {
      drag = { kind: 'move', side: pose.side, last: tip.clone(), handle };
      return;
    }
    if (handle?.kind === 'turn') {
      const pivot = v[0]!.copy(box.getCenter(v[1]!)).setY(box.min.y).applyMatrix4(anchor.matrixWorld).clone();
      drag = { kind: 'turn', side: pose.side, pivot, lastAngle: Math.atan2(tip.x - pivot.x, tip.z - pivot.z), handle };
      return;
    }
    if (!withFrame) return;
    const corner = nearestCorner(tip);
    if (corner < 0 || !root.parent) return;
    const opposite = corner ^ 7;
    root.updateWorldMatrix(true, false);
    drag = {
      kind: 'scale', side: pose.side,
      oppositeLocal: root.worldToLocal(worldCorner[opposite]!.clone()),
      oppositeAnchor: root.parent.worldToLocal(worldCorner[opposite]!.clone()),
      startDist: tip.distanceTo(worldCorner[opposite]!),
      startScale: root.scale.x || 1,
    };
  }

  /** Slide the anchor by a world-space step, keeping the 3D above the floor. */
  function moveBy(step: Vector3, floor: number) {
    const frame = anchor.parent;
    if (!frame) return;
    const bottom = Math.min(...worldCorner.map((c) => c.y));
    step.y = Math.max(step.y, floor + FLOOR_CLEARANCE_M - bottom);
    anchor.getWorldPosition(v[0]!);
    v[1]!.copy(v[0]!).add(step);
    frame.worldToLocal(v[0]!);
    frame.worldToLocal(v[1]!);
    anchor.position.add(v[1]!.sub(v[0]!));
  }

  /** Turn the anchor about the vertical through `pivot` (world) by `angle`. */
  function turnBy(pivot: Vector3, angle: number) {
    const frame = anchor.parent;
    if (!frame) return;
    anchor.getWorldPosition(v[0]!);
    const ox = v[0]!.x - pivot.x;
    const oz = v[0]!.z - pivot.z;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    v[1]!.set(pivot.x + ox * c + oz * s, v[0]!.y, pivot.z - ox * s + oz * c);
    anchor.position.copy(frame.worldToLocal(v[1]!));
    anchor.rotation.y += angle;
  }

  function scaleTo(d: Extract<Drag, { kind: 'scale' }>, tip: Vector3) {
    if (!root.parent || d.startDist < 1e-4) return;
    const factor = Math.min(SCALE_RANGE[1], Math.max(SCALE_RANGE[0], tip.distanceTo(root.parent.localToWorld(v[0]!.copy(d.oppositeAnchor))) / d.startDist));
    root.scale.setScalar(d.startScale * factor);
    v[1]!.copy(d.oppositeLocal).multiplyScalar(root.scale.x).applyQuaternion(root.quaternion);
    root.position.copy(d.oppositeAnchor).sub(v[1]!);
  }

  function setLook(handle: Handle, state: number) {
    if (state === handle.state) return;
    handle.state = state;
    const look = HANDLE_LOOK[state]!;
    handle.material.color.set(look.color);
    handle.material.opacity = look.opacity;
    // A rod gets thicker, never longer (its length is the edge's); a knob grows all round.
    if (handle.kind === 'move') handle.look.scale.set(1, look.grow, look.grow);
    else handle.look.scale.setScalar(look.grow);
  }

  return {
    tick(input, held, floor) {
      measure();
      const now = handles.filter((h) => h.entity.hasComponent(Hovered));
      if (now.length) lastPointed = { handle: now.find((h) => h.kind === 'turn') ?? now[0]!, at: performance.now() };
      const poses = hands(input);
      const tip = tipNow;
      if (held) drag = null;
      // Start: a pinch that begins on a handle or a corner (never one that began elsewhere and slid over).
      for (const pose of poses) {
        pose.tip.getWorldPosition(tip);
        if (!held && !drag && pose.pinching && !wasPinching[pose.side] && !box.isEmpty()) begin(pose, tip);
      }
      for (const side of SIDES) wasPinching[side] = poses.some((p) => p.side === side && p.pinching);
      // Follow the hand that started the drag; let go when it stops pinching or is lost.
      const active = drag;
      if (active) {
        const pose = poses.find((p) => p.side === active.side);
        if (!pose?.pinching) {
          drag = null;
          options.onMoved?.();
        } else {
          pose.tip.getWorldPosition(tip);
          if (active.kind === 'move') {
            moveBy(v[2]!.subVectors(tip, active.last), floor);
            active.last.copy(tip);
          } else if (active.kind === 'turn') {
            const angle = Math.atan2(tip.x - active.pivot.x, tip.z - active.pivot.z);
            let step = angle - active.lastAngle;
            if (step > Math.PI) step -= Math.PI * 2;
            if (step < -Math.PI) step += Math.PI * 2;
            // One to one: the hand swung 45 degrees about the middle turns it 45 degrees. Close to the pivot an angle is noise.
            const dist = Math.hypot(tip.x - active.pivot.x, tip.z - active.pivot.z);
            if (dist > 0.05) turnBy(active.pivot, step);
            active.lastAngle = angle;
          } else {
            scaleTo(active, tip);
          }
          measure();
        }
      }
      place();
      // The frame shows itself when a hand comes near.
      near = false;
      if (!box.isEmpty()) {
        const reach = v[0]!.copy(box.min).subScalar(NEAR_M);
        const far = v[1]!.copy(box.max).addScalar(NEAR_M);
        for (const pose of poses) {
          anchor.worldToLocal(pose.tip.getWorldPosition(v[2]!));
          if (v[2]!.x > reach.x && v[2]!.y > reach.y && v[2]!.z > reach.z && v[2]!.x < far.x && v[2]!.y < far.y && v[2]!.z < far.z) near = true;
        }
      }
      const show = near || drag !== null;
      lineMat.opacity = LINE_OPACITY[show ? 1 : 0];
      cornerMat.opacity = drag?.kind === 'scale' ? 1 : LINE_OPACITY[show ? 1 : 0];
      for (const handle of handles) {
        const dragging = drag !== null && drag.kind !== 'scale' && drag.handle === handle;
        setLook(handle, dragging ? 3 : handle.entity.hasComponent(Hovered) && !held ? 2 : show ? 1 : 0);
      }
    },
    dragging() {
      return drag && drag.kind !== 'scale' ? drag.side : null;
    },
    inspect() {
      return {
        handles: handles.map((h) => ({ kind: h.kind, center: h.hit.getWorldPosition(new Vector3()).toArray().map((n) => Math.round(n * 1000) / 1000), hovered: h.entity.hasComponent(Hovered) })),
        drag: drag?.kind ?? null,
        near,
      };
    },
    dispose() {
      for (const handle of handles) {
        handle.entity.dispose();
        handle.material.dispose();
      }
      group.removeFromParent();
      for (const geometry of [unitBox, cornerGeo, rodGeo, rodHitGeo, knobGeo, knobHitGeo]) geometry.dispose();
      for (const material of [lineMat, cornerMat, hitMat]) material.dispose();
    },
  };
}
