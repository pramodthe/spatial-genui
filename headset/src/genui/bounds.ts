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
 *   - the four bottom edges move the lesson (pinch the rod, then drag);
 *   - a knob in the middle of each upright edge turns it about the vertical;
 *   - a pinch on a corner scales the 3D about the opposite corner.
 * The frame is faint until a hand comes near; a handle thickens and turns blue when a pinch would take it, and
 * while held. A pinch takes a handle when the fingertip is on it, or (lessons) when the hand points at it.
 * The handles stand a little outside the box, so a pinch on the model's own parts (a base on the bottom edge)
 * or a ray aimed at them doesn't land on a handle instead. A game gets the handles only (no lines, no corners)
 * and no pointing: its play is pinching in the air, which must never take a handle the ray happens to cross.
 */
export type LessonBounds = {
  /** `held`: a part of the lesson is in a hand (the frame then stays out of the way). `floor`: world y of the floor. */
  tick(input: unknown, held: boolean, floor: number): void;
  /** The hand dragging a handle, if any (a game doesn't count that hand's pinch as play). */
  dragging(): 'left' | 'right' | null;
  /** World `point` is over the 3D's box: within `marginXZ` of its footprint and `marginY` of its height. */
  inside(point: Vector3, marginXZ: number, marginY: number): boolean;
  /** For tests: the handles and what is being dragged. */
  inspect(): { handles: { kind: HandleKind; center: number[]; hovered: boolean }[]; drag: HandleKind | 'scale' | null; near: boolean };
  dispose(): void;
};

type HandleKind = 'move' | 'turn';
type Side = 'left' | 'right';
type HandPose = { side: Side; tip: Object3D; pinching: boolean };

const EDGE_M = 0.003;
const CORNER_M = 0.008;
// A move handle is a short, thin grip in the middle of a bottom edge; its pinchable volume is fatter than what is
// drawn. On the headset the old rods (70% of each edge, 4 mm) ran along the front of the lesson and took pinches
// meant for the model, so they are short and thin, and a pinch has to be closer to take one.
const ROD_M = 0.0025;
const ROD_HIT_M = 0.012;
const ROD_MAX_M = 0.08;
const KNOB_M = 0.008;
const KNOB_HIT_M = 0.022;
// A fingertip this close to a handle (or a corner) takes it with a pinch. It is measured where the fingertip was
// just before the pinch: closing a pinch pulls the index tip a few centimetres toward the thumb.
const TOUCH_REACH_M = 0.03;
const CORNER_REACH_M = 0.04;
const PRE_PINCH_MS = 120;
// Lessons: a pinch this soon after a handle was pointed at still takes it (closing the pinch moves the ray).
const POINT_GRACE_MS = 200;
// A hand this close to the box, coming from outside it, may want to move it: the frame shows, and the grip nearest
// that hand. A hand over the playfield (inside the box's footprint, by more than PLAY_INSET_M, up to PLAY_ABOVE_M
// above it) is playing: nothing shows and its pinches are never a handle's. On the headset an always-visible frame
// kept catching the eye and the fingers during play.
const NEAR_M = 0.22;
const REVEAL_M = 0.15;
const PLAY_INSET_M = 0.02;
const PLAY_ABOVE_M = 0.3;
const FLOOR_CLEARANCE_M = 0.02;
const SCALE_RANGE = [0.35, 3] as const;
// Idle, a hand near, pointed at, held.
const LINE_OPACITY = [0, 0.3] as const;
const HANDLE_LOOK = [
  { color: '#ffffff', opacity: 0, grow: 1 },
  { color: '#ffffff', opacity: 0.85, grow: 1 },
  { color: '#31a8f3', opacity: 1, grow: 1.5 },
  { color: '#31a8f3', opacity: 1, grow: 1.5 },
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
    /** A pinch while pointing at a handle takes it (default true; a game's handles take only a fingertip). */
    pointing?: boolean;
  } = {},
): LessonBounds {
  const withFrame = options.frame ?? true;
  const outset = options.outset ?? 0;
  const pointing = options.pointing ?? true;
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
    // Without pointing, a handle doesn't catch rays at all (they go on to what is behind it).
    if (pointing) entity.addComponent(RayInteractable, {});
    else hit.raycast = () => {};
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
  const v = [new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3()];
  const tipNow = new Vector3();
  const insidePoint = new Vector3();
  const wasPinching: Record<Side, boolean> = { left: false, right: false };
  // Each fingertip's recent places (world), for where it was just before a pinch closed.
  const trail: Record<Side, { at: number; tip: Vector3 }[]> = { left: [], right: [] };
  let drag: Drag | null = null;
  let near = false;
  /** Lessons: the handle last pointed at, and when (for POINT_GRACE_MS). */
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
    // Which grips are shown (and so can be hit) is decided in tick(); with no box, none.
    if (empty) for (const handle of handles) handle.hit.visible = false;
    if (empty) return;
    EDGES.forEach(([i, j], n) => lay(lines[n]!, local[i]!, local[j]!, EDGE_M));
    for (let n = 0; n < 8; n++) corners[n]!.position.copy(local[n]!);
    for (const handle of handles) {
      const [i, j] = handle.edge;
      if (handle.kind === 'move') {
        // A short grip in the middle of its edge (at most ROD_MAX_M), leaving the corners free for scaling. Pushed
        // out from the middle of its edge, so it stays parallel.
        const half = Math.min(0.35, ROD_MAX_M / 2 / Math.max(local[i]!.distanceTo(local[j]!), 1e-6));
        const mid = pushOut(v[1]!.lerpVectors(local[i]!, local[j]!, 0.5)).sub(v[0]!.lerpVectors(local[i]!, local[j]!, 0.5));
        const a = v[0]!.lerpVectors(local[i]!, local[j]!, 0.5 - half).add(mid);
        const b = new Vector3().lerpVectors(local[i]!, local[j]!, 0.5 + half).add(mid);
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

  const revealed = new Set<Handle>();
  const playPoint = new Vector3();
  /** A fingertip (world) over the playfield: inside the box's footprint, from its bottom to PLAY_ABOVE_M above its top. */
  function overPlay(tip: Vector3): boolean {
    if (box.isEmpty()) return false;
    anchor.updateWorldMatrix(true, false);
    const p = anchor.worldToLocal(playPoint.copy(tip));
    const scale = anchor.getWorldScale(v[4]!).x || 1;
    const inset = PLAY_INSET_M / scale;
    return p.x > box.min.x + inset && p.x < box.max.x - inset && p.z > box.min.z + inset && p.z < box.max.z - inset
      && p.y > box.min.y - 0.03 / scale && p.y < box.max.y + PLAY_ABOVE_M / scale;
  }

  /** Distance from `tip` to a handle: to the rod's segment, or to the knob's centre. */
  function distanceToHandle(handle: Handle, tip: Vector3): number {
    handle.hit.updateWorldMatrix(true, false);
    if (handle.kind === 'move') {
      // A unit length along its own x, stretched to the rod's length.
      const a = handle.hit.localToWorld(v[0]!.set(-0.5, 0, 0));
      const b = handle.hit.localToWorld(v[1]!.set(0.5, 0, 0));
      b.sub(a);
      const t = Math.min(1, Math.max(0, v[2]!.subVectors(tip, a).dot(b) / Math.max(b.lengthSq(), 1e-9)));
      return tip.distanceTo(v[2]!.copy(a).addScaledVector(b, t));
    }
    return tip.distanceTo(handle.hit.getWorldPosition(v[2]!));
  }

  /** Where `side`'s fingertip was PRE_PINCH_MS ago (or the oldest place kept), in the world. */
  function tipBefore(side: Side, now: number): Vector3 | null {
    const kept = trail[side];
    for (let i = kept.length - 1; i >= 0; i--) if (now - kept[i]!.at >= PRE_PINCH_MS) return kept[i]!.tip;
    return kept[0]?.tip ?? null;
  }

  /** The handle a fingertip at `tips` (now, and just before the pinch) is on, if any. */
  function touched(tips: Vector3[]): Handle | null {
    let best: Handle | null = null;
    let bestDist = TOUCH_REACH_M;
    for (const handle of handles) {
      if (!handle.hit.visible) continue; // a hidden grip is not there
      const dist = Math.min(...tips.map((t) => distanceToHandle(handle, t)));
      if (dist <= bestDist) [best, bestDist] = [handle, dist];
    }
    return best;
  }

  /** Lessons: the handle pointed at now, or a moment ago. A ray on a knob can graze the rod beside it: take the knob. */
  function pointed(now: number): Handle | null {
    if (!pointing) return null;
    const on = handles.filter((h) => h.entity.hasComponent(Hovered));
    if (on.length) return on.find((h) => h.kind === 'turn') ?? on[0]!;
    return lastPointed && now - lastPointed.at < POINT_GRACE_MS ? lastPointed.handle : null;
  }


  function nearestCorner(tips: Vector3[]): number {
    let best = -1;
    let bestDist = CORNER_REACH_M;
    for (let n = 0; n < 8; n++) {
      const dist = Math.min(...tips.map((t) => t.distanceTo(worldCorner[n]!)));
      if (dist < bestDist) [best, bestDist] = [n, dist];
    }
    return best;
  }

  function begin(pose: HandPose, tip: Vector3, now: number) {
    const before = tipBefore(pose.side, now);
    const tips = before ? [tip, before] : [tip];
    const handle = touched(tips) ?? pointed(now);
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
    const corner = nearestCorner(tips);
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
    handle.look.visible = look.opacity > 0;
    // A rod gets thicker, never longer (its length is the edge's); a knob grows all round.
    if (handle.kind === 'move') handle.look.scale.set(1, look.grow, look.grow);
    else handle.look.scale.setScalar(look.grow);
  }

  return {
    tick(input, held, floor) {
      measure();
      const now = performance.now();
      const poses = hands(input);
      const tip = tipNow;
      if (held) drag = null;
      if (pointing) {
        const on = handles.filter((h) => h.entity.hasComponent(Hovered));
        if (on.length) lastPointed = { handle: on.find((h) => h.kind === 'turn') ?? on[0]!, at: now };
      }
      // Start: a pinch that begins on a handle or a corner (never one that began elsewhere and slid over, and never
      // one made over the playfield: that is play).
      for (const pose of poses) {
        pose.tip.getWorldPosition(tip);
        if (!held && !drag && pose.pinching && !wasPinching[pose.side] && !box.isEmpty() && !overPlay(tip)) begin(pose, tip, now);
        // Keep this fingertip's last few places (after the start check, so "before" is never this frame).
        const kept = trail[pose.side];
        kept.push({ at: now, tip: tip.clone() });
        while (kept.length > 2 && now - kept[0]!.at > PRE_PINCH_MS * 3) kept.shift();
      }
      for (const side of SIDES) if (!poses.some((p) => p.side === side)) trail[side].length = 0;
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
      // Quiet while playing: the frame shows only for a hand near the box from outside it, and only the grip
      // nearest that hand; a hand over the playfield hides it all.
      near = false;
      let playing = false;
      revealed.clear();
      if (!box.isEmpty()) {
        // Own vectors: distanceToHandle below uses v[0] to v[2].
        const reach = v[5]!.copy(box.min).subScalar(NEAR_M);
        const far = v[6]!.copy(box.max).addScalar(NEAR_M);
        for (const pose of poses) {
          const world = pose.tip.getWorldPosition(v[3]!);
          if (overPlay(world)) {
            playing = true;
            continue;
          }
          anchor.worldToLocal(v[2]!.copy(world));
          if (!(v[2]!.x > reach.x && v[2]!.y > reach.y && v[2]!.z > reach.z && v[2]!.x < far.x && v[2]!.y < far.y && v[2]!.z < far.z)) continue;
          near = true;
          let closest: Handle | null = null;
          let closestDist = REVEAL_M;
          for (const handle of handles) {
            const dist = distanceToHandle(handle, world);
            if (dist < closestDist) [closest, closestDist] = [handle, dist];
          }
          if (closest) revealed.add(closest);
        }
      }
      const show = drag !== null || (near && !playing);
      lineMat.opacity = LINE_OPACITY[show ? 1 : 0];
      cornerMat.opacity = drag?.kind === 'scale' ? 1 : LINE_OPACITY[show ? 1 : 0];
      // Blue means a pinch now would take it: pointed at (lessons) or a fingertip on it, from outside the playfield.
      const fingertips = poses.map((p) => p.tip.getWorldPosition(new Vector3())).filter((t) => !overPlay(t));
      const onHandle = held || !fingertips.length ? null : touched(fingertips);
      for (const handle of handles) {
        const dragging = drag !== null && drag.kind !== 'scale' && drag.handle === handle;
        // A grip that is not shown is not there: it catches no ray, so a ray aimed past it (at a card's frame, at
        // the model) reaches what is behind it. Hidden objects lose their raycast in the host.
        handle.hit.visible = !box.isEmpty() && (dragging || (!playing && revealed.has(handle)));
        const ready = !held && !playing && (handle === onHandle || (pointing && handle.entity.hasComponent(Hovered)));
        setLook(handle, dragging ? 3 : ready ? 2 : show && revealed.has(handle) ? 1 : 0);
      }
    },
    dragging() {
      return drag && drag.kind !== 'scale' ? drag.side : null;
    },
    inside(point, marginXZ, marginY) {
      if (box.isEmpty()) return false;
      anchor.updateWorldMatrix(true, false);
      const p = anchor.worldToLocal(insidePoint.copy(point));
      return p.x >= box.min.x - marginXZ && p.x <= box.max.x + marginXZ
        && p.y >= box.min.y - marginY && p.y <= box.max.y + marginY
        && p.z >= box.min.z - marginXZ && p.z <= box.max.z + marginXZ;
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
