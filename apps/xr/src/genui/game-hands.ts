import { Vector3, type Object3D } from '@iwsdk/core';

/**
 * Play: the player's hands, handed to a game's code as `hands` and refreshed every frame before its update().
 * Positions are in the game root's own coordinates (the units the game is built in, whatever the host's fit
 * scale), so a paddle can simply follow `hands.right.tip`. With controllers, tip and palm are the grip.
 */
export type GameHand = {
  /** The hand (or controller) is seen this frame. */
  tracked: boolean;
  /** Index fingertip. */
  tip: Vector3;
  /** Palm (grip). */
  palm: Vector3;
  /** Pinching now (or the trigger held). */
  pinching: boolean;
  /** True on the one frame a pinch starts. */
  pinched: boolean;
};
export type GameHands = { left: GameHand; right: GameHand };

type Side = 'left' | 'right';
const SIDES: Side[] = ['left', 'right'];

type XRInput = {
  xrOrigin?: { indexTipSpaces?: Partial<Record<Side, Object3D>>; gripSpaces?: Partial<Record<Side, Object3D>> };
  getPrimaryInputSource?(side: Side): unknown;
  isPrimary?(device: 'controller' | 'hand', side: Side): boolean;
  getSelectState?(side: Side): { active: boolean; start: boolean };
  untrackedPrimary?: Partial<Record<Side, boolean>>;
};

export function createGameHands(): GameHands {
  const hand = (): GameHand => ({ tracked: false, tip: new Vector3(), palm: new Vector3(), pinching: false, pinched: false });
  return { left: hand(), right: hand() };
}

/** Read both hands from the XR input into `hands`, in `root`'s coordinates. Unseen hands keep their last place. */
export function updateGameHands(hands: GameHands, input: unknown, root: Object3D) {
  const xr = (input as { xr?: XRInput } | null)?.xr;
  root.updateWorldMatrix(true, false);
  for (const side of SIDES) {
    const hand = hands[side];
    const source = xr?.getPrimaryInputSource?.(side);
    const isHand = xr?.isPrimary?.('hand', side) ?? false;
    const tip = (isHand ? xr?.xrOrigin?.indexTipSpaces?.[side] : undefined) ?? xr?.xrOrigin?.gripSpaces?.[side];
    const palm = xr?.xrOrigin?.gripSpaces?.[side] ?? tip;
    hand.tracked = Boolean(source && tip && !xr?.untrackedPrimary?.[side]);
    if (!hand.tracked) {
      hand.pinching = false;
      hand.pinched = false;
      continue;
    }
    tip!.getWorldPosition(hand.tip);
    root.worldToLocal(hand.tip);
    palm!.getWorldPosition(hand.palm);
    root.worldToLocal(hand.palm);
    const select = xr?.getSelectState?.(side);
    const pinching = select?.active === true;
    hand.pinched = pinching && !hand.pinching;
    hand.pinching = pinching;
  }
}
