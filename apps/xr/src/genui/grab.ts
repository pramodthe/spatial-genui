import { Grabbed, Mesh, MeshBasicMaterial, Shape, ShapeGeometry, TwoHandsGrabbable, Vector3, type Entity, type Object3D } from '@iwsdk/core';
import { boxAround, worldYaw } from './handle';

/**
 * Which pinches may move a grabbable entity. IWSDK keeps each entity's grab handle in an internal component; if it
 * isn't there (another IWSDK version), the entity keeps IWSDK's behaviour.
 */
export function setGrabFilter(entity: Entity, accept: (event: { pointerType?: string; object?: Object3D }) => boolean) {
  const component = entity.getComponents().find((c) => c?.id === 'Handle');
  const store = component ? (entity.getValue(component, 'instance' as never) as { getOptions?: () => object } | null) : null;
  if (typeof store?.getOptions !== 'function') return;
  const options = store.getOptions;
  store.getOptions = () => ({ ...options(), filter: accept });
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

  /** The card's size in its own frame (panels face +Z), from its world box with the turn taken out. */
  function measure() {
    frame.removeFromParent(); // the frame is not part of the card
    const box = boxAround(holder);
    holder.add(frame);
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

function roundedRect(width: number, height: number, radius: number): ShapeGeometry {
  const r = Math.min(radius, width / 2, height / 2);
  const x = -width / 2;
  const y = -height / 2;
  const shape = new Shape();
  shape.moveTo(x + r, y);
  shape.lineTo(x + width - r, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + r);
  shape.lineTo(x + width, y + height - r);
  shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  shape.lineTo(x + r, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return new ShapeGeometry(shape, 6);
}
