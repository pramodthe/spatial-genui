import { Box3, Grabbed, Mesh, MeshBasicMaterial, Path, Shape, ShapeGeometry, TwoHandsGrabbable, Vector3, type Entity, type Object3D } from '@iwsdk/core';
import { boxAround, worldYaw } from './handle';

/**
 * Which pinches may move a grabbable entity. IWSDK keeps each entity's grab handle in an internal component; if it
 * isn't there (another IWSDK version), the entity keeps IWSDK's behaviour.
 */
type GrabEvent = { pointerType?: string; object?: Object3D };

export function setGrabFilter(entity: Entity, accept: (event: GrabEvent) => boolean) {
  const component = entity.getComponents().find((c) => c?.id === 'Handle');
  const store = component ? (entity.getValue(component, 'instance' as never) as { getOptions?: () => object } | null) : null;
  if (typeof store?.getOptions !== 'function') return;
  const options = store.getOptions;
  // A later filter adds to the one already there (a near pinch, then "not on a part inside this model").
  store.getOptions = () => {
    const current = options() as { filter?: (event: GrabEvent) => boolean };
    const previous = current.filter;
    return { ...current, filter: (event: GrabEvent) => (previous ? previous(event) : true) && accept(event) };
  };
}

// A near pinch takes what is within this distance of the index fingertip, where the fingers meet.
const PINCH_GRAB_RADIUS_M = 0.03;

/**
 * Make a near pinch take only what is at the fingertips. IWSDK's grab pointer is pmndrs's default: a 7 cm sphere
 * around the hand's grip point (the palm), so pinching a few centimetres beside an object, fingers clearly
 * outside it, still took it. For a hand the sphere now sits on the index fingertip with a 3 cm radius; a controller
 * keeps IWSDK's sphere (its "index tip" is the ray origin at the controller's tip). Reaches into IWSDK's input
 * internals; returns false (change nothing) until they exist, or if they are shaped differently.
 */
export function pinchAtFingertips(input: unknown): boolean {
  const xr = (input as { xr?: { multiPointers?: Record<string, unknown>; isPrimary?: (type: string, side: string) => boolean } } | null)?.xr;
  const pointers = xr?.multiPointers;
  if (!pointers || typeof xr?.isPrimary !== 'function') return false;
  let done = false;
  for (const hand of ['left', 'right']) {
    const multi = pointers[hand] as { grab?: { pointer?: { intersector?: { space?: unknown; getSphereRadius?: () => number } } }; xrOrigin?: { indexTipSpaces?: Record<string, Object3D> } } | undefined;
    const intersector = multi?.grab?.pointer?.intersector;
    const tip = multi?.xrOrigin?.indexTipSpaces?.[hand];
    if (!intersector || typeof intersector.getSphereRadius !== 'function' || !tip) continue;
    const grip = intersector.space as { current?: unknown } | undefined;
    const gripRadius = intersector.getSphereRadius.bind(intersector);
    const onHand = () => xr.isPrimary!('hand', hand);
    intersector.space = { get current() { return onHand() ? tip : grip?.current; } };
    intersector.getSphereRadius = () => (onHand() ? PINCH_GRAB_RADIUS_M : gripRadius());
    done = true;
  }
  return done;
}

// The frame: a faint rounded border just around the card, behind it, that the learner pinches to hold the card.
const FRAME_MARGIN_M = 0.025;
const FRAME_RADIUS_M = 0.03;
const FRAME_OPACITY = [0.07, 0.2] as const; // resting, pointed at or held
// Two hands scale a card between these multiples of its size.
const CARD_SCALE_RANGE = [0.5, 2] as const;
// A card's lowest edge stays this far above the floor.
const FLOOR_CLEARANCE_M = 0.02;

export type CardGrab = {
  /** Once per frame: when the learner lets go, the card turns to face them and rises above the floor if needed. */
  tick(head: Vector3, floor: number): void;
  /** Fit the frame to the card again (a card whose content changes size, like the picker). */
  refit(): void;
  /** Take the grab away while the card is hidden, and give it back. */
  setEnabled(enabled: boolean): void;
  dispose(): void;
};

/**
 * Let the learner hold a card (a lesson panel, or the picker) by its frame, the way a Horizon OS window is held:
 * one hand pinching the frame moves it, two hands pull it bigger or smaller. A pinch on the card itself still
 * presses its buttons: only pinches that land on the frame move the card. `entity` is the card's own entity.
 */
export function makeCardGrabbable(holder: Object3D, entity: Entity, onMoved?: () => void): CardGrab {
  const scale = holder.scale.x || 1;
  const material = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: FRAME_OPACITY[0], depthWrite: false });
  const frame = new Mesh(new ShapeGeometry(new Shape()), material);
  frame.name = 'Card frame';
  let size = { width: 0, height: 0, centreY: 0 };

  /**
   * The card's size in its own frame (panels face +Z), from its world box with the turn taken out. The frame is
   * left out by measuring the card's other parts: taking it off the card, even for a moment, cancels a pinch in
   * progress, and a button pressed then never clicks.
   */
  function measure() {
    const box = new Box3();
    for (const child of holder.children) if (child !== frame) box.union(boxAround(child));
    const origin = holder.getWorldPosition(new Vector3());
    const unit = holder.getWorldScale(new Vector3()).x || 1;
    const yaw = worldYaw(holder);
    if (box.isEmpty()) return { width: 0.36, height: 0.3, centreY: 0 };
    return {
      width: (Math.abs(Math.cos(yaw)) * (box.max.x - box.min.x) + Math.abs(Math.sin(yaw)) * (box.max.z - box.min.z)) / unit,
      height: (box.max.y - box.min.y) / unit,
      centreY: ((box.min.y + box.max.y) / 2 - origin.y) / unit,
    };
  }
  function refit() {
    const next = measure();
    if (Math.abs(next.width - size.width) < 0.005 && Math.abs(next.height - size.height) < 0.005 && Math.abs(next.centreY - size.centreY) < 0.005) return;
    size = next;
    frame.geometry.dispose();
    frame.geometry = roundedRect(size.width + FRAME_MARGIN_M * 2, size.height + FRAME_MARGIN_M * 2, FRAME_RADIUS_M);
    frame.position.set(0, size.centreY, -0.004);
  }
  holder.add(frame);
  refit();

  let enabled = false;
  function setEnabled(on: boolean) {
    if (on === enabled) return;
    enabled = on;
    if (!on) {
      entity.removeComponent(TwoHandsGrabbable);
      return;
    }
    entity.addComponent(TwoHandsGrabbable, {
      rotate: false,
      scaleMin: [scale * CARD_SCALE_RANGE[0], scale * CARD_SCALE_RANGE[0], scale * CARD_SCALE_RANGE[0]],
      scaleMax: [scale * CARD_SCALE_RANGE[1], scale * CARD_SCALE_RANGE[1], scale * CARD_SCALE_RANGE[1]],
    });
    // IWSDK's two-hand grab turns the ray away from the card ({ deny: 'ray' }): let it back in for the buttons.
    holder.pointerEventsType = 'all';
    setGrabFilter(entity, (event) => event.pointerType !== 'touch' && event.object === frame);
  }
  setEnabled(true);

  let pointed = 0;
  frame.addEventListener('pointerenter', () => (pointed++, show()));
  frame.addEventListener('pointerleave', () => ((pointed = Math.max(0, pointed - 1)), show()));
  let held = false;
  function show() {
    material.opacity = FRAME_OPACITY[pointed > 0 || held ? 1 : 0];
  }

  const at = new Vector3();
  return {
    tick(head, floor) {
      const now = entity.hasComponent(Grabbed);
      if (now === held) return;
      held = now;
      show();
      if (held) return;
      // Let go: face the learner, and come up out of the floor if it was pulled into it.
      holder.getWorldPosition(at);
      holder.rotation.y = Math.atan2(head.x - at.x, head.z - at.z) - worldYaw(holder.parent);
      const lowest = boxAround(holder);
      if (!lowest.isEmpty() && lowest.min.y < floor + FLOOR_CLEARANCE_M) {
        at.y += floor + FLOOR_CLEARANCE_M - lowest.min.y;
        holder.position.copy(holder.parent ? holder.parent.worldToLocal(at) : at);
      }
      onMoved?.();
    },
    refit,
    setEnabled,
    dispose() {
      setEnabled(false);
      frame.removeFromParent();
      frame.geometry.dispose();
      material.dispose();
    },
  };
}

/** A rounded rectangle path, centred on the origin. `clockwise` is the hole (opposite winding to the outer edge). */
function traceRounded(path: Path, width: number, height: number, radius: number, clockwise: boolean) {
  const r = Math.min(radius, width / 2, height / 2);
  const x = -width / 2;
  const y = -height / 2;
  if (!clockwise) {
    path.moveTo(x + r, y);
    path.lineTo(x + width - r, y);
    path.quadraticCurveTo(x + width, y, x + width, y + r);
    path.lineTo(x + width, y + height - r);
    path.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    path.lineTo(x + r, y + height);
    path.quadraticCurveTo(x, y + height, x, y + height - r);
    path.lineTo(x, y + r);
    path.quadraticCurveTo(x, y, x + r, y);
    return;
  }
  path.moveTo(x + r, y);
  path.quadraticCurveTo(x, y, x, y + r);
  path.lineTo(x, y + height - r);
  path.quadraticCurveTo(x, y + height, x + r, y + height);
  path.lineTo(x + width - r, y + height);
  path.quadraticCurveTo(x + width, y + height, x + width, y + height - r);
  path.lineTo(x + width, y + r);
  path.quadraticCurveTo(x + width, y, x + width - r, y);
  path.lineTo(x + r, y);
}

/** The card border: the outer rounded rect, with the face cut out so a ray to a button misses the frame. */
function roundedRect(width: number, height: number, radius: number): ShapeGeometry {
  const shape = new Shape();
  traceRounded(shape, width, height, radius, false);
  const innerW = width - FRAME_MARGIN_M * 2;
  const innerH = height - FRAME_MARGIN_M * 2;
  if (innerW > 0.004 && innerH > 0.004) {
    const hole = new Path();
    traceRounded(hole, innerW, innerH, Math.max(0, radius - FRAME_MARGIN_M), true);
    shape.holes.push(hole);
  }
  return new ShapeGeometry(shape, 6);
}
