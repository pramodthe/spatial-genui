import vm from 'node:vm';
import * as THREE from 'three';

/**
 * The play-through: a simulated player does what the game's own `play` block says (one gesture per move to learn,
 * then the gestures of one round), and the rules here check what happened: every move registers, the round starts
 * only on Start and ends with a measured result, Try again works and does not win by itself, the same play at 30
 * frames a second gives about the same result, and with no hand at all nothing completes and nothing wins.
 *
 * `play` is returned by build():
 *   { learn: [gesture], challenge: [gesture] | () => [gesture], start?: gesture, again?: gesture, moves?: number,
 *     levels?: number, next?: gesture,
 *     state: () => ({ phase: 'learn' | 'ready' | 'play' | 'done', move, result, stars, level }) }
 * With levels (the same round, one setting changed each time), a round that earns a star opens the next level by
 * `next` (the panel button 'next' when left out), Try again replays the same level, and every level must be winnable
 * by the challenge's gestures: the play-through plays level 1, then each level to the last.
 * A gesture is one of
 *   { grab: place, to?: place, path?: [place], seconds?, throw?, keep?, until? }   pinch there, carry, let go
 *   { press: object }                                                      press a 3D button
 *   { button: id }                                                         press a panel button (kit.panel)
 *   { hold: place, seconds?, pinch?, until? }                              keep the hand there (pour, steer)
 *   { path: [place], seconds?, pinch? }                                    sweep the hand (swipe, slice)
 *   { wait: seconds, until? }
 * each with hand: 'left' | 'right' (right by default) and the hand's pose in degrees, read every frame when given
 * as functions: tilt (fingertips down), roll (right side down), yaw (turned to the right). A gesture that pinches
 * keeps the hand level until it has pinched, so what it takes turns with the hand (a jug tips, a knob turns). A grab
 * with `until` stays where it carried the thing until it is true (a pour). A place is an object
 * (its centre), [x, y, z] in root's coordinates (the units the game is built in, as `hands` are), or a function
 * returning either.
 *
 * It proves the game can be played. It does not judge whether the motion looks right.
 */

export type PlayFinding = { level: 'fix' | 'note'; rule: string; text: string };
/** How a round ended: `move` is the highest count of moves seen in it, `seconds` the game time until it ended. */
export type PlayRound = { phase: string; move: number; result: number | null; stars: number | null; level: number | null; seconds: number };
export type PlayReport = {
  ok: boolean;
  findings: PlayFinding[];
  /** The round as played at 72 Hz and at 30 Hz, the second round after Try again, the round after another Try again
   * with no hand, and the first round with no hand. */
  rounds: { played?: PlayRound; slow?: PlayRound; again?: PlayRound; unplayed?: PlayRound; idle?: PlayRound; levels?: PlayRound[] };
  /** False when the computing budget ran out; `unchecked` then names the runs that were not finished. */
  complete: boolean;
  unchecked: string[];
  frames: number;
  ms: number;
};

type Side = 'left' | 'right';
type Hand = { tracked: boolean; tip: THREE.Vector3; palm: THREE.Vector3; pinching: boolean; pinched: boolean };

/** What the player needs from one build of the module (dryrun.ts instantiate). */
export type PlayInstance = {
  api: { hands: Record<Side, Hand> };
  context: vm.Context;
  result: any;
  traitTargets: { object: unknown; grab: boolean; press: boolean; onPress?: () => void }[];
  panels: { holder: THREE.Object3D; handlers: Map<string, () => void>; props: Map<string, Record<string, unknown>> }[];
  /** The objects a simulated hand holds: the module's isGrabbed(object). */
  held: Set<unknown>;
  /** Game time in ms, behind the module's Date.now(). */
  clock: { ms: number };
};

const SIDES: Side[] = ['left', 'right'];
const PHASES = ['learn', 'ready', 'play', 'done'];
const FAST_HZ = 72; // the headset
const SLOW_HZ = 30; // motion written per frame instead of per second shows up here
const WORLD_SCALE = 12; // a world is built in desk units and shown this much bigger (layout.ts, headset host.ts)
const HAND_SPEED_M = 0.5; // a relaxed reach, metres a second
const FOLLOW_SPEED_M = 2; // the fastest a hand follows a moving place
const ARM_M = 0.8; // in a world, farther than this is a walk
const WALK_SPEED_M = 1.4;
const TURN_RAD_S = 6; // how fast a wrist turns
const PALM_FROM_TIP = new THREE.Vector3(0, -0.02, 0.05); // the grip behind and below the fingertip of a level hand, metres
const GRAB_REACH_M = 0.04; // a near pinch takes what is this close to the fingertip (dryrun.ts MIN_GRAB_GAP_M)
const THROWN_AT_LEAST_M = 0.03; // a thrown thing has gone at least this far, the way it was thrown, 0.6 s after it is let go
const SHOWN_WAIT_S = 5; // a hidden thing is waited for this long (a piece that comes back when the last move has settled)
const MOVE_WAIT_S = 5;
const READY_WAIT_S = 2;
const START_WAIT_S = 2;
const UNTIL_MAX_S = 20; // a hold or a wait with `until` and no `seconds` gives up after this
const ROUND_END_WAIT_S = 30; // after the last challenge gesture, the round has this long to end by itself
const IDLE_LEARN_S = 5;
const IDLE_ROUND_S = 45;
const BUDGET_CPU_MS = 30_000; // computing time for the whole play-through (CPU time: a busy machine must not change the verdict)
const RUN_WALL_MS = 60_000; // one run taking this long on the clock is a loop that never ends

type State = { phase: string; move: number; result: number | null; stars: number | null; level: number | null };
type Add = (level: PlayFinding['level'], rule: string, text: string) => void;

/** The run cannot go on; its finding is already recorded. */
class Abort extends Error {}

const num = (value: unknown, otherwise: number) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : otherwise);
const nameOf = (o: unknown) => (o instanceof THREE.Object3D ? (o.name ? `"${o.name}"` : `an unnamed ${o.type}`) : 'something');
const cpuMs = () => {
  const used = process.cpuUsage();
  return (used.user + used.system) / 1000;
};

function placeText(value: unknown): string {
  if (value instanceof THREE.Object3D) return nameOf(value);
  if (typeof value === 'function') return 'a moving place';
  const p = Array.isArray(value) ? value : value && typeof value === 'object' ? [(value as any).x, (value as any).y, (value as any).z] : null;
  return p ? `(${p.map((n) => Number(n).toFixed(2)).join(', ')})` : String(value);
}

function gestureText(g: any): string {
  if (!g || typeof g !== 'object') return String(g);
  const hand = g.hand === 'left' ? ' with the left hand' : '';
  if ('grab' in g) {
    const carry = Array.isArray(g.path) ? `, move it along ${g.path.length} points` : 'to' in g ? `, carry it to ${placeText(g.to)}` : '';
    const wait = g.until && !g.throw ? ', hold it there until what it waits for' : '';
    return `pinch ${placeText(g.grab)}${carry}${wait}${g.keep ? ', keep hold' : ', let go'}${hand}`;
  }
  if ('press' in g) return `press ${placeText(g.press)}${hand}`;
  if ('button' in g) return `press the panel button '${g.button}'`;
  if ('hold' in g) return `hold the hand${g.pinch ? ', pinching,' : ''} at ${placeText(g.hold)}${g.until ? ' until what it waits for' : ` for ${num(g.seconds, 1)} s`}${hand}`;
  if ('path' in g) return `sweep the hand${g.pinch ? ', pinching,' : ''} along ${Array.isArray(g.path) ? g.path.length : 0} points${hand}`;
  if ('wait' in g) return `wait ${g.until ? 'for what it waits for' : `${g.wait} s`}`;
  return 'an unknown gesture';
}

/** What is wrong with a list of gestures, before anything is played. */
function gestureProblems(list: unknown, where: string): string[] {
  if (!Array.isArray(list)) return [`${where} must be a list of gestures.`];
  const problems: string[] = [];
  list.forEach((g: any, i: number) => {
    const at = list.length === 1 && !where.endsWith(']') && !/learn|challenge/.test(where) ? where : `${where}[${i}]`;
    if (!g || typeof g !== 'object') return problems.push(`${at} is not a gesture.`);
    const verbs = 'grab' in g ? ['grab'] : ['press', 'button', 'hold', 'path', 'wait'].filter((verb) => verb in g);
    if (verbs.length !== 1) problems.push(`${at} must be one of { grab }, { press }, { button }, { hold }, { path }, { wait }.`);
    if ('path' in g && !(Array.isArray(g.path) && g.path.length >= ('grab' in g ? 1 : 2))) problems.push(`${at}: path is a list of places${'grab' in g ? '' : ', at least two'}.`);
    if ('until' in g && typeof g.until !== 'function') problems.push(`${at}: until is a function that returns true when the wait is over.`);
    return undefined;
  });
  return problems;
}

/** What is wrong with the shape of a `play` block. */
function shapeProblems(play: any): string[] {
  if (!play || typeof play !== 'object') return ['play must be an object: { learn: [...], challenge: [...], state() }.'];
  const problems: string[] = [];
  if (!Array.isArray(play.learn)) problems.push('play.learn must be a list with one gesture per move (an empty list when the moves are done inside the round).');
  else problems.push(...gestureProblems(play.learn, 'play.learn'));
  if (typeof play.challenge !== 'function') {
    if (!Array.isArray(play.challenge) || play.challenge.length === 0) problems.push('play.challenge must list the gestures that play one round (or be a function that returns them).');
    else problems.push(...gestureProblems(play.challenge, 'play.challenge'));
  }
  if (typeof play.state !== 'function') problems.push('play.state must be a function returning { phase, move, result, stars }.');
  if ('levels' in play && !(Number.isInteger(play.levels) && play.levels >= 1)) problems.push('play.levels is how many levels the game has (LEVELS.length), a whole number from 1.');
  if ('next' in play) problems.push(...gestureProblems([play.next], 'play.next'));
  for (const one of ['start', 'again']) if (play[one] !== undefined) problems.push(...gestureProblems([play[one]], `play.${one}`));
  if (play.moves !== undefined && !(Number.isInteger(play.moves) && play.moves >= 0)) problems.push('play.moves is how many moves the game counts (a whole number).');
  return problems;
}

/** One simulated player on one build of the module, at one frame rate. */
class Player {
  readonly root: THREE.Object3D;
  readonly play: any;
  /** One metre in the module's units: a world is built 12 times smaller than it is shown. */
  readonly unit: number;
  readonly dt: number;
  time = 0;
  frames = 0;
  /** What the hand did last, for a message about a failure that follows it. */
  last = 'the start';
  readonly tracked: Record<Side, boolean> = { left: false, right: false };
  private readonly tip: Record<Side, THREE.Vector3>;
  private readonly before: Record<Side, THREE.Vector3>;
  /** How each hand is turned now, the turn of the frame before, and the pose its gesture asks for (null: level). */
  private readonly turn: Record<Side, THREE.Quaternion> = { left: new THREE.Quaternion(), right: new THREE.Quaternion() };
  private readonly turnBefore: Record<Side, THREE.Quaternion> = { left: new THREE.Quaternion(), right: new THREE.Quaternion() };
  private readonly pose: Record<Side, (() => THREE.Quaternion) | null> = { left: null, right: null };
  private readonly pinching: Record<Side, boolean> = { left: false, right: false };
  private readonly was: Record<Side, boolean> = { left: false, right: false };
  private readonly carried: Record<Side, THREE.Object3D | null> = { left: null, right: null };
  /** A throw waiting to be judged: the thing, where it was let go and the way the hand was going. */
  private thrown: { object: THREE.Object3D; from: THREE.Vector3; way: THREE.Vector3; what: string } | null = null;

  constructor(readonly inst: PlayInstance, hz: number, public add: Add) {
    this.root = inst.result.root;
    this.play = inst.result.play;
    this.unit = inst.result.mode === 'world' ? 1 / WORLD_SCALE : 1;
    this.dt = 1 / hz;
    // Where a hand waits: in front of a desk game, toward the player; in a world, in front of the player at the origin.
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.root);
    const desk = this.unit === 1 && !box.isEmpty() && [box.min.x, box.max.x, box.min.y, box.max.z].every(Number.isFinite);
    const rest = (side: Side) => {
      const x = side === 'left' ? -1 : 1;
      return desk
        ? new THREE.Vector3((box.min.x + box.max.x) / 2 + 0.12 * x, box.min.y + 0.12, box.max.z + 0.12)
        : new THREE.Vector3(0.02 * x, 0.09, -0.02);
    };
    this.tip = { left: rest('left'), right: rest('right') };
    this.before = { left: this.tip.left.clone(), right: this.tip.right.clone() };
  }

  state(): State {
    let s: any;
    try {
      s = this.play.state();
    } catch (err) {
      this.add('fix', 'state', `play.state() failed: ${(err as Error).message}`);
      throw new Abort();
    }
    if (!s || !PHASES.includes(s.phase)) {
      this.add('fix', 'state', `play.state() must return { phase, move, result, stars } with phase 'learn', 'ready', 'play' or 'done'; the phase was ${JSON.stringify(s?.phase)}.`);
      throw new Abort();
    }
    return {
      phase: s.phase,
      move: Number.isFinite(Number(s.move)) ? Number(s.move) : 0,
      result: s.result == null ? null : Number(s.result),
      stars: s.stars == null ? null : Number(s.stars),
      level: s.level == null || !Number.isFinite(Number(s.level)) ? null : Number(s.level),
    };
  }

  /** The gestures of one round, read from this build (a function when a later round starts from a different scene). */
  challenge(): unknown[] {
    const list = typeof this.play.challenge === 'function' ? this.play.challenge() : this.play.challenge;
    const problems = gestureProblems(list, 'play.challenge()');
    if (problems.length === 0) return list;
    for (const problem of problems) this.add('fix', 'play', problem);
    throw new Abort();
  }

  /** One frame: the hands as the gestures left them, what they carry, then the game's update(). */
  frame(): void {
    for (const side of SIDES) {
      const hand = this.inst.api.hands[side];
      const tip = this.tip[side];
      const turn = this.turn[side];
      turn.rotateTowards(this.pose[side]?.() ?? new THREE.Quaternion(), TURN_RAD_S * this.dt);
      const pinching = this.tracked[side] && this.pinching[side];
      if (pinching && !this.was[side]) this.pick(side);
      const carried = this.carried[side];
      if (carried) {
        this.carry(carried, side);
        if (!pinching) {
          this.inst.held.delete(carried);
          this.carried[side] = null;
        }
      }
      hand.tracked = this.tracked[side];
      hand.tip.copy(tip);
      hand.palm.copy(PALM_FROM_TIP).applyQuaternion(turn).multiplyScalar(this.unit).add(tip);
      hand.pinched = pinching && !this.was[side];
      hand.pinching = pinching;
      this.was[side] = pinching;
      this.before[side].copy(tip);
      this.turnBefore[side].copy(turn);
    }
    this.inst.clock.ms = Math.round(this.time * 1000);
    if (typeof this.inst.result.update === 'function') this.inst.result.update(this.time, this.dt);
    this.time += this.dt;
    this.frames++;
  }

  private shown(object: THREE.Object3D): boolean {
    for (let o: THREE.Object3D | null = object; o; o = o.parent) {
      if (!o.visible) return false;
      if (o === this.root) return true;
    }
    return false; // not in the scene
  }

  /** The centre of an object, in root's coordinates. */
  private centre(object: THREE.Object3D): THREE.Vector3 {
    object.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(object);
    const centre = box.isEmpty() ? object.getWorldPosition(new THREE.Vector3()) : box.getCenter(new THREE.Vector3());
    return this.root.worldToLocal(centre);
  }

  /** A place as a point in root's coordinates, and the object it names when it names one. */
  private place(value: unknown, what: string): { point: THREE.Vector3; object: THREE.Object3D | null } {
    let v = value;
    if (typeof v === 'function') v = v();
    if (v instanceof THREE.Object3D) return { point: this.centre(v), object: v };
    const p = Array.isArray(v) ? v : v && typeof v === 'object' ? [(v as any).x, (v as any).y, (v as any).z] : [];
    if (p.length === 3 && p.every((n) => typeof n === 'number' && Number.isFinite(n))) return { point: new THREE.Vector3(p[0], p[1], p[2]), object: null };
    this.add('fix', 'play', `${what} is not a place: give an object, [x, y, z] in the game's own units, or a function returning one.`);
    throw new Abort();
  }

  /** A place the hand can go to now. A hidden object is waited for, as a player waits for a piece to come back. */
  private *reachable(value: unknown, what: string, rule: string): Generator<void, { point: THREE.Vector3; object: THREE.Object3D | null }> {
    let at = this.place(value, what);
    for (let i = Math.round(SHOWN_WAIT_S / this.dt); i > 0 && at.object && !this.shown(at.object); i--) {
      yield;
      at = this.place(value, what);
    }
    if (at.object && !this.shown(at.object)) {
      this.add('fix', rule, `${what}: ${nameOf(at.object)} is hidden (or not in the scene), so a player cannot reach it; waited ${SHOWN_WAIT_S} s.`);
      throw new Abort();
    }
    return at;
  }

  /** The pose a gesture asks of the hand, read every frame (its angles may be functions), or null for a level hand. */
  private poseOf(g: any): (() => THREE.Quaternion) | null {
    if (g.tilt === undefined && g.roll === undefined && g.yaw === undefined) return null;
    const angle = (value: unknown) => THREE.MathUtils.degToRad(Number(typeof value === 'function' ? value() : value) || 0);
    const euler = new THREE.Euler();
    const turn = new THREE.Quaternion();
    // Fingers point away from the player (-Z): tilt tips them down, roll lowers the right side, yaw turns them right.
    return () => turn.setFromEuler(euler.set(-angle(g.tilt), -angle(g.yaw), -angle(g.roll), 'YXZ'));
  }

  /** A pinch takes the nearest grabbable thing within reach of the fingertip, as the headset's near grab does. */
  private pick(side: Side): void {
    const tip = this.root.localToWorld(this.tip[side].clone());
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    let best: THREE.Object3D | null = null;
    let bestDistance = GRAB_REACH_M * this.unit;
    let bestSize = Infinity;
    for (const target of this.inst.traitTargets) {
      const object = target.object;
      if (!target.grab || !(object instanceof THREE.Object3D) || !this.shown(object) || this.inst.held.has(object)) continue;
      object.updateWorldMatrix(true, true);
      box.setFromObject(object);
      const distance = box.isEmpty() ? object.getWorldPosition(size).distanceTo(tip) : box.distanceToPoint(tip);
      const extent = box.isEmpty() ? 0 : box.getSize(size).length();
      // Inside two boxes at once (a part and the group around it), the smaller thing is the one pinched.
      if (distance < bestDistance || (distance === bestDistance && best && extent < bestSize)) {
        best = object;
        bestDistance = distance;
        bestSize = extent;
      }
    }
    if (!best) return; // a pinch in the air: games that read `hands` themselves use it
    this.carried[side] = best;
    this.inst.held.add(best);
  }

  /** A held thing moves and turns as the hand did since the last frame, about the fingertip (the headset's one-hand grab). */
  private carry(object: THREE.Object3D, side: Side): void {
    if (!object.parent) return;
    object.parent.updateWorldMatrix(true, false);
    const from = this.root.localToWorld(this.before[side].clone());
    const to = this.root.localToWorld(this.tip[side].clone());
    const turned = this.turn[side].clone().multiply(this.turnBefore[side].clone().invert());
    const rootTurn = this.root.getWorldQuaternion(new THREE.Quaternion());
    const turnedInWorld = rootTurn.clone().multiply(turned).multiply(rootTurn.invert());
    const at = object.getWorldPosition(new THREE.Vector3()).sub(from).applyQuaternion(turnedInWorld).add(to);
    object.position.copy(object.parent.worldToLocal(at));
    if (Math.abs(turned.w) > 1 - 1e-12) return; // the hand did not turn: the thing keeps the turn the game gave it
    const facing = turnedInWorld.multiply(object.getWorldQuaternion(new THREE.Quaternion()));
    object.quaternion.copy(object.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(facing));
  }

  private pressTarget(object: THREE.Object3D) {
    const within = (inner: THREE.Object3D, outer: unknown) => {
      for (let o: THREE.Object3D | null = inner; o; o = o.parent) if (o === outer) return true;
      return false;
    };
    const pressable = this.inst.traitTargets.filter((t) => typeof t.onPress === 'function' && t.object instanceof THREE.Object3D);
    return pressable.find((t) => t.object === object)
      ?? pressable.find((t) => within(object, t.object))
      ?? pressable.find((t) => within(t.object as THREE.Object3D, object));
  }

  *rest(seconds: number): Generator<void, void> {
    for (let i = Math.max(1, Math.round(seconds / this.dt)); i > 0; i--) yield;
  }

  /** Frames until the test holds, at most `seconds` of game time. True when it held. */
  *until(test: () => boolean, seconds: number): Generator<void, boolean> {
    for (let i = Math.round(seconds / this.dt); i > 0 && !test(); i--) yield;
    return test();
  }

  /** How long the hand takes to get that far: a reach, or in a world a walk when it is farther than an arm. */
  private travel(distance: number): number {
    const metres = distance / this.unit;
    return this.unit < 1 && metres > ARM_M ? metres / WALK_SPEED_M : Math.min(1.2, Math.max(0.15, metres / HAND_SPEED_M));
  }

  /** Move the fingertip there. `atLast` runs with the last step (a throw lets go while the hand still moves). */
  private *reach(side: Side, to: THREE.Vector3, seconds?: number, atLast?: () => void): Generator<void, void> {
    const from = this.tip[side].clone();
    const steps = Math.max(1, Math.round((seconds ?? this.travel(from.distanceTo(to))) / this.dt));
    for (let i = 1; i <= steps; i++) {
      this.tip[side].lerpVectors(from, to, i / steps);
      if (i === steps) atLast?.();
      yield;
    }
  }

  /** Along the points at an even speed, in `seconds` (or at the hand's own speed). */
  private *sweep(side: Side, points: THREE.Vector3[], seconds?: number, atLast?: () => void): Generator<void, void> {
    const lengths = points.slice(1).map((p, i) => p.distanceTo(points[i]!));
    const total = lengths.reduce((sum, length) => sum + length, 0);
    const steps = Math.max(1, Math.round((seconds ?? Math.max(0.2, total / (HAND_SPEED_M * this.unit))) / this.dt));
    for (let i = 1; i <= steps; i++) {
      let along = (i / steps) * total;
      let segment = 0;
      while (segment < lengths.length - 1 && along > lengths[segment]!) along -= lengths[segment++]!;
      const length = lengths[segment] ?? 0;
      this.tip[side].lerpVectors(points[segment]!, points[segment + 1] ?? points[segment]!, length > 0 ? Math.min(1, along / length) : 1);
      if (i === steps) atLast?.();
      yield;
    }
  }

  /** Do one gesture. `what` names it in a finding ("Move 2"); `rule` is the rule a failure belongs to. */
  *perform(g: any, what: string, rule: string): Generator<void, void> {
    const side: Side = g?.hand === 'left' ? 'left' : 'right';
    const stop = (text: string): never => {
      this.add('fix', rule, `${what}: ${text}`);
      throw new Abort();
    };
    const release = () => {
      this.pinching[side] = false;
    };
    /** Seconds passed while the gesture's `until` is still false; stops with a finding when its time is up. */
    const waiting = function* (this: Player, seconds: number, each?: () => void): Generator<void, void> {
      const frames = Math.max(1, Math.round(seconds / this.dt));
      for (let i = 0; i < frames; i++) {
        if (g.until?.()) return;
        each?.();
        yield;
      }
      if (g.until && !g.until()) stop(`after ${seconds} s what the gesture waits for (until) had not happened.`);
    }.bind(this);
    this.tracked[side] = true;
    this.last = `${what} (${gestureText(g)})`;
    // A hand that is about to pinch stays as it is until it has: then what it takes turns with it, as a player picks
    // a jug up level and then tips it. A hand that already holds something (keep) or does not pinch turns at once.
    const pose = this.poseOf(g);
    const pinches = 'grab' in g || (('hold' in g || 'path' in g) && Boolean(g.pinch));
    const turned = () => {
      this.pose[side] = pose;
    };
    if (!pinches || (this.pinching[side] && this.carried[side])) turned();
    if ('grab' in g) {
      const { point, object } = yield* this.reachable(g.grab, `${what}: grab`, rule);
      // A hand that kept hold (keep: true) of this very thing does not let go to take it again.
      if (!(this.pinching[side] && this.carried[side])) {
        release();
        yield* this.reach(side, point);
        this.pinching[side] = true;
        turned();
        yield* this.rest(0.15);
      }
      const thrown = this.carried[side] ?? object;
      const from = this.tip[side].clone();
      // A throw lets go on the last moving frame, so the thing leaves with the hand's speed; a carry puts it down still.
      const flying = g.throw ? release : undefined;
      let last = from;
      if (Array.isArray(g.path)) {
        const points = [from, ...g.path.map((p: unknown) => this.place(p, `${what}: path`).point)];
        last = points[points.length - 2]!;
        yield* this.sweep(side, points, num(g.seconds, 0) || undefined, flying);
      } else if ('to' in g) {
        const to = this.place(g.to, `${what}: to`).point;
        yield* this.reach(side, to, num(g.seconds, 0) || Math.max(0.3, this.travel(from.distanceTo(to))), flying);
      } else yield* this.rest(num(g.seconds, 0.3));
      // Held where it was carried until what the gesture waits for has happened (a jug over the bowl, pouring).
      if (g.until && !g.throw) yield* waiting(UNTIL_MAX_S);
      if (this.pinching[side] && !g.keep) {
        release();
        yield;
      }
      if (g.throw && thrown) {
        // The way the hand was going when it let go, and where the thing was then.
        const way = this.root.localToWorld(this.tip[side].clone()).sub(this.root.localToWorld(last.clone())).normalize();
        this.thrown = { object: thrown, from: thrown.getWorldPosition(new THREE.Vector3()), way, what };
        yield* this.rest(0.6);
        this.judgeThrow();
      }
      yield* this.rest(0.2);
    } else if ('press' in g) {
      const { point, object } = yield* this.reachable(g.press, `${what}: press`, rule);
      const target = object && this.pressTarget(object);
      if (!target) stop(`${placeText(g.press)} cannot be pressed: give it traits(object, { onPress }) or spawn it with game.Pressable.`);
      yield* this.reach(side, point);
      target!.onPress!();
      yield* this.rest(0.1);
    } else if ('button' in g) {
      const key = `${String(g.button)}:click`;
      const panel = this.inst.panels.find((p) => p.handlers.has(key));
      if (!panel) {
        const ids = [...new Set(this.inst.panels.flatMap((p) => [...p.handlers.keys()]).filter((k) => k.endsWith(':click')).map((k) => k.slice(0, -6)))];
        stop(`there is no panel button with the id '${g.button}' (buttons: ${ids.join(', ') || 'none'}).`);
      }
      const hidden = () => panel!.props.get(String(g.button))?.display === 'none' || !this.shown(panel!.holder);
      yield* this.until(() => !hidden(), SHOWN_WAIT_S);
      if (hidden()) stop(`the panel button '${g.button}' is hidden, so a player cannot press it; waited ${SHOWN_WAIT_S} s.`);
      yield* this.reach(side, this.root.worldToLocal(panel!.holder.getWorldPosition(new THREE.Vector3())));
      panel!.handlers.get(key)!();
      yield* this.rest(0.1);
    } else if ('hold' in g) {
      yield* this.reach(side, this.place(g.hold, `${what}: hold`).point);
      if (g.pinch) this.pinching[side] = true;
      turned();
      // The place may move (a kite, the next hoop): the hand follows it, no faster than a hand can.
      const step = FOLLOW_SPEED_M * this.unit * this.dt;
      yield* waiting(num(g.seconds, g.until ? UNTIL_MAX_S : 1), () => {
        const at = this.place(g.hold, `${what}: hold`);
        if (at.object && at.object === this.carried[side]) return; // the hand holds it: it follows the hand, not the hand it
        const to = at.point;
        const far = this.tip[side].distanceTo(to);
        this.tip[side].lerp(to, far > step ? step / far : 1);
      });
      if (this.pinching[side] && !g.keep) {
        release();
        yield;
      }
    } else if ('path' in g) {
      const points = g.path.map((p: unknown) => this.place(p, `${what}: path`).point);
      yield* this.reach(side, points[0]);
      if (g.pinch) this.pinching[side] = true;
      turned();
      if (g.pinch) yield* this.rest(0.1);
      yield* this.sweep(side, points, num(g.seconds, 0) || undefined);
      if (this.pinching[side] && !g.keep) {
        release();
        yield;
      }
    } else yield* waiting(num(g.wait, g.until ? UNTIL_MAX_S : 0.5));
    this.pose[side] = null;
  }

  /** Did the thing just thrown fly? Judged 0.6 s after the hand let go, or sooner when the round ends first. */
  private judgeThrow(): void {
    const thrown = this.thrown;
    this.thrown = null;
    if (!thrown) return;
    const flown = thrown.object.getWorldPosition(new THREE.Vector3()).sub(thrown.from).dot(thrown.way);
    if (flown >= THROWN_AT_LEAST_M * this.unit) return;
    this.add('fix', 'throw', `${thrown.what}: ${nameOf(thrown.object)} did not fly: after the hand let it go it went ${(flown / this.unit).toFixed(2)} m the way it was thrown. A thrown thing leaves with the hand's speed at release: take it from how far the hand moved in the last frames.`);
  }

  /** Let go of everything and level the hands (a round ended mid-gesture). */
  letGo(): void {
    this.judgeThrow();
    for (const side of SIDES) {
      this.pinching[side] = false;
      this.pose[side] = null;
    }
  }

  /** No hand in view. */
  hide(): void {
    this.letGo();
    for (const side of SIDES) this.tracked[side] = false;
  }
}

/** The moves to learn, each by its gesture, until the game waits for Start. */
function* learn(p: Player): Generator<void, void> {
  const gestures: unknown[] = p.play.learn;
  for (let i = 0; i < gestures.length; i++) {
    const before = p.state();
    if (before.phase !== 'learn') {
      p.add('note', 'move', `The game left its learn phase after ${i} of ${gestures.length} learn gestures: play.learn has more gestures than the game has moves.`);
      break;
    }
    yield* p.perform(gestures[i], `Move ${i + 1}`, 'move');
    const counted = yield* p.until(() => {
      const now = p.state();
      return now.move > before.move || now.phase !== 'learn';
    }, MOVE_WAIT_S);
    if (!counted) {
      p.add('fix', 'move', `Move ${i + 1} did not register: after its gesture (${gestureText(gestures[i])}) the game still waits at move ${before.move + 1}. Either the gesture does not do what the move asks, or the move is never counted as done.`);
      throw new Abort();
    }
    // One gesture that completes two moves: the moves are not two things to do.
    yield* p.rest(0.3);
    const rose = p.state().move - before.move;
    if (rose > 1 && i + 1 < gestures.length) {
      p.add('note', 'move', `The gesture for move ${i + 1} also completed move ${i + 2}: the two moves are not separate things for the hand to do.`);
      i += rose - 1;
    }
  }
  yield* p.until(() => p.state().phase !== 'learn', READY_WAIT_S);
  const s = p.state();
  if (s.phase === 'learn') {
    p.add('fix', 'move', `After the last learn gesture the game still waits at move ${s.move + 1}: play.learn needs one gesture for every move.`);
    throw new Abort();
  }
  if (s.phase !== 'ready') {
    p.add('fix', 'start', `After the moves the game went to '${s.phase}' by itself: it waits in 'ready' until the player presses Start, and nothing scores before that.`);
    throw new Abort();
  }
}

const startOf = (p: Player) => p.play.start ?? { button: 'start' };
const againOf = (p: Player) => p.play.again ?? { button: 'again' };
const nextOf = (p: Player) => p.play.next ?? { button: 'next' };

function* start(p: Player, what = 'Start', rule = 'start'): Generator<void, void> {
  yield* p.perform(startOf(p), what, rule);
  if (yield* p.until(() => p.state().phase === 'play', START_WAIT_S)) return;
  p.add('fix', rule, `${what} did not begin a round: ${START_WAIT_S} s later the game is in phase '${p.state().phase}'.`);
  throw new Abort();
}

/** Try again, then whatever the game asks before the next round: some go straight into it, some wait for Start again. */
function* restart(p: Player): Generator<void, void> {
  yield* p.perform(againOf(p), 'Try again', 'again');
  if (!(yield* p.until(() => p.state().phase !== 'done', START_WAIT_S))) {
    p.add('fix', 'again', `Try again did not restart the game: ${START_WAIT_S} s later it is still in phase 'done'.`);
    throw new Abort();
  }
  if (p.state().phase === 'learn') yield* learn(p);
  if (p.state().phase === 'ready') yield* start(p, 'Start after Try again', 'again');
}

/**
 * One round: the challenge gestures (none for a round with no hand), cut short when the game ends the round, then
 * `wait` seconds for the game to end it by itself.
 */
function* round(p: Player, wait: number, hand = true): Generator<void, PlayRound> {
  const began = p.time;
  let top = p.state().move;
  const over = () => {
    const s = p.state();
    top = Math.max(top, s.move);
    return s.phase !== 'play';
  };
  const gestures = hand ? p.challenge() : [];
  playing: for (let i = 0; i < gestures.length; i++) {
    const gesture = p.perform(gestures[i], `Challenge gesture ${i + 1}`, 'round');
    while (!gesture.next().done) {
      yield;
      if (over()) break playing;
    }
  }
  p.letGo();
  yield* p.until(over, wait);
  return { ...p.state(), move: top, seconds: Math.round((p.time - began) * 10) / 10 };
}

const measured = (r: PlayRound) => r.phase === 'done' && r.result !== null && Number.isFinite(r.result) && Number.isInteger(r.stars) && r.stars! >= 0 && r.stars! <= 3;

/**
 * Play the game on fresh builds (`make`): with no hand in view, as the headset runs it, a round with no hand, and at
 * a slow frame rate with a second round. `describeError` words an error the game threw (dryrun.ts).
 */
export function playThrough(make: () => PlayInstance, describeError: (err: unknown) => string): PlayReport {
  const began = performance.now();
  const cpuBegan = cpuMs();
  const findings: PlayFinding[] = [];
  const rounds: PlayReport['rounds'] = {};
  const unchecked: string[] = [];
  let frames = 0;
  let outOfTime = false;
  const add: Add = (level, rule, text) => {
    if (!findings.some((f) => f.text === text)) findings.push({ level, rule, text });
  };
  const failed = () => findings.some((f) => f.level === 'fix');
  const report = (): PlayReport => {
    if (unchecked.length) add('note', 'time', `The play-through ran out of computing time after ${frames} frames. Not checked: ${unchecked.join('; ')}.`);
    return { ok: !failed(), findings, rounds, complete: unchecked.length === 0, unchecked, frames, ms: Math.round(performance.now() - began) };
  };

  /** Run one script to its end on a fresh build, one frame of the game after each step of the script. */
  const run = (name: string, hz: number, script: (p: Player) => Generator<void, void>): void => {
    if (outOfTime) {
      unchecked.push(name);
      return;
    }
    let p: Player | null = null;
    try {
      const inst = make();
      const player = (p = new Player(inst, hz, add));
      const steps = script(player);
      (inst.context as any).__tick = () => {
        if (cpuMs() - cpuBegan > BUDGET_CPU_MS) {
          outOfTime = true;
          return false;
        }
        if (steps.next().done) return false;
        player.frame();
        return true;
      };
      vm.runInContext('while (__tick()) {}', inst.context, { filename: 'play.js', timeout: RUN_WALL_MS });
      if (outOfTime) unchecked.push(name);
      const broken: string[] = [];
      player.root.traverse((o) => {
        if (![...o.position.toArray(), ...o.scale.toArray()].every(Number.isFinite)) broken.push(nameOf(o));
      });
      if (broken.length) add('fix', 'error', `After the play-through ${broken.slice(0, 3).join(', ')} ${broken.length > 1 ? 'have' : 'has'} a position or a size that is not a number (a division by zero, or a value used before it was set).`);
    } catch (err) {
      if (err instanceof Abort) return;
      const after = p ? `, after ${p.last}` : '';
      if ((err as { code?: string })?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') add('fix', 'error', `The game stopped answering during the play-through${after}: update() did not return (a loop that never ends).`);
      else add('fix', 'error', `The game failed during the play-through${after}: ${describeError(err)}`);
    } finally {
      frames += p?.frames ?? 0;
    }
  };

  let play: any;
  try {
    play = make().result?.play;
  } catch (err) {
    add('fix', 'error', `The game failed when it was built again for the play-through: ${describeError(err)}`);
    return report();
  }
  for (const problem of shapeProblems(play)) add('fix', 'play', problem);
  if (failed()) return report();
  const learned: number = play.learn.length;

  // First with no hand in view: nothing may complete by itself (the runs after this would fail in confusing ways).
  if (learned > 0) {
    run('the first seconds with no hand', SLOW_HZ, function* (p) {
      yield* p.rest(IDLE_LEARN_S);
      const still = p.state();
      if (still.move === 0 && still.phase === 'learn') return;
      add('fix', 'idle', `With no hand in view, ${still.phase === 'learn' ? `${still.move} move${still.move > 1 ? 's' : ''} completed` : `the game reached '${still.phase}'`} in the first ${IDLE_LEARN_S} s: a move is done only when the player's hand has done it.`);
    });
    if (failed()) return report();
  }

  // As the headset runs it: every move, Start, one round, Try again.
  run(`the round at ${FAST_HZ} frames a second`, FAST_HZ, function* (p) {
    yield* p.rest(0.5);
    yield* learn(p);
    yield* start(p);
    const played = (rounds.played = yield* round(p, ROUND_END_WAIT_S));
    if (played.phase !== 'done') {
      p.add('fix', 'round', `The round did not end: ${played.seconds} s after Start, and ${ROUND_END_WAIT_S} s after the last challenge gesture, the game is still in phase '${played.phase}'. Either the round never ends by itself (the goal reached, the clock out, the last piece placed), or the gestures did not do what the game needs: check where each one aims and the pose of the hand the game reads.`);
      throw new Abort();
    }
    if (!measured(played)) {
      p.add('fix', 'result', `The round ended without a measured result: play.state() gave result ${played.result} and stars ${played.stars}. The result is a number and the stars are 0 to 3.`);
      throw new Abort();
    }
    if (played.stars === 0) p.add('fix', 'stars', `The round as play.challenge plays it earned no star (result ${played.result}): either its gestures do not play the game well, or the game does not answer them.`);
    if (typeof play.moves === 'number' && played.move < play.moves) p.add('fix', 'move', `The round as play.challenge plays it completed ${played.move} of the game's ${play.moves} moves: a move the gestures do is never counted, or the gestures skip it.`);
    yield* restart(p);
  });
  if (failed() || !rounds.played || !measured(rounds.played)) return report();
  const played = rounds.played;

  // Every level as a player meets them: level 1, then Next after each round that earns a star, to the last. Each level
  // must be winnable by the challenge's gestures, and Try again stays on the level.
  const levels = Number.isInteger(play.levels) ? play.levels : 1;
  if (levels > 1) {
    run(`the ${levels} levels`, FAST_HZ, function* (p) {
      p.add = (level, _rule, text) => add(level, 'level', text);
      yield* p.rest(0.5);
      yield* learn(p);
      yield* start(p);
      const each: PlayRound[] = (rounds.levels = []);
      for (let n = 1; n <= levels; n++) {
        const at = p.state().level;
        if (at !== n) {
          p.add('fix', 'level', `play.state() gives level ${at} while level ${n} of ${levels} is played: state() returns level, 1 for the first, and Next level adds one.`);
          throw new Abort();
        }
        const r = yield* round(p, ROUND_END_WAIT_S);
        each.push(r);
        if (!measured(r)) {
          p.add('fix', 'level', `Level ${n} of ${levels} did not end with a measured result (phase '${r.phase}', result ${r.result}): every level's round ends with a result and stars.`);
          throw new Abort();
        }
        if (r.stars === 0) {
          p.add('fix', 'level', `Level ${n} of ${levels} cannot earn a star as play.challenge plays it (result ${r.result}): every level must be winnable. Make the level's one change smaller, or let play.challenge play that level (a function can read the level).`);
          throw new Abort();
        }
        if (n === levels) break;
        yield* p.perform(nextOf(p), `Next level after level ${n}`, 'level');
        if (!(yield* p.until(() => p.state().level === n + 1, START_WAIT_S))) {
          p.add('fix', 'level', `Next level after level ${n} did not open level ${n + 1}: ${START_WAIT_S} s later play.state() gives level ${p.state().level}. A round that earns a star shows a Next level button that adds one to the level.`);
          throw new Abort();
        }
        if (p.state().phase === 'ready') yield* start(p, `Start on level ${n + 1}`, 'level');
        else if (!(yield* p.until(() => p.state().phase === 'play', START_WAIT_S))) {
          p.add('fix', 'level', `Level ${n + 1} did not begin a round after Next level: the game is in phase '${p.state().phase}'.`);
          throw new Abort();
        }
      }
      // Try again replays the same level.
      yield* p.perform(againOf(p), `Try again on level ${levels}`, 'level');
      yield* p.until(() => p.state().phase !== 'done', START_WAIT_S);
      if (p.state().level !== levels) p.add('fix', 'level', `Try again on level ${levels} went to level ${p.state().level}: Try again replays the same level.`);
    });
    if (failed()) return report();
  }

  // A first round with no hand at all does not win by waiting, and counts no move.
  run('a round with no hand', SLOW_HZ, function* (p) {
    p.add = (level, _rule, text) => {
      if (level === 'fix') add('note', 'idle', `The round with no hand could not be reached: ${text}`);
    };
    yield* p.rest(0.5);
    yield* learn(p);
    yield* start(p);
    p.hide();
    const from = p.state().move;
    const idle = (rounds.idle = yield* round(p, IDLE_ROUND_S, false));
    if (idle.move > from) add('fix', 'idle', `With no hand at all, ${idle.move - from} move${idle.move - from > 1 ? 's were' : ' was'} counted during the round: a move is done only when the player's hand has done it.`);
    if (idle.phase !== 'done') return;
    if ((idle.stars ?? 0) >= 2) add('fix', 'idle', `With no hand at all the round ended with ${idle.stars} stars (result ${idle.result}): the result must depend on what the player does.`);
    else if ((idle.stars ?? 0) >= played.stars!) add('note', 'idle', `Doing nothing earns as many stars (${idle.stars}) as playing (${played.stars}): make the result depend more on the player's action.`);
  });

  // The same play at a slow frame rate, a second round after Try again, and Try again once more with no hand.
  run(`the round at ${SLOW_HZ} frames a second and the round after Try again`, SLOW_HZ, function* (p) {
    // What fails here passed at the headset's frame rate, so the frame rate is the cause; its notes were given already.
    p.add = (level, _rule, text) => {
      if (level === 'fix') add('fix', 'frame-rate', `At ${SLOW_HZ} frames a second (it passed at ${FAST_HZ}): ${text}`);
    };
    yield* p.rest(0.5);
    yield* learn(p);
    yield* start(p);
    const slow = (rounds.slow = yield* round(p, ROUND_END_WAIT_S));
    if (!measured(slow)) p.add('fix', 'frame-rate', `the round did not end with a result (phase '${slow.phase}', result ${slow.result}). Something is counted per frame instead of per second: multiply speeds and clocks by delta.`);
    else if (Math.abs(slow.stars! - played.stars!) >= 2) {
      add('fix', 'frame-rate', `The same play earned ${played.stars} stars (result ${played.result}) at ${FAST_HZ} frames a second and ${slow.stars} (result ${slow.result}) at ${SLOW_HZ}: something moves per frame instead of per second. Multiply speeds by delta.`);
    } else if (Math.abs(slow.result! - played.result!) > 0.25 * Math.max(Math.abs(slow.result!), Math.abs(played.result!), 1e-6)) {
      add('note', 'frame-rate', `The same play gave ${played.result} at ${FAST_HZ} frames a second and ${slow.result} at ${SLOW_HZ}: check that every speed and clock is multiplied by delta.`);
    }
    if (!measured(slow)) throw new Abort();
    p.add = (level, _rule, text) => add(level, 'again', `Second round: ${text}`);
    yield* restart(p);
    const again = (rounds.again = yield* round(p, ROUND_END_WAIT_S));
    if (!measured(again)) {
      p.add('fix', 'again', `after Try again the round did not end with a result (phase '${again.phase}', result ${again.result}): Try again must put everything back as Start found it.`);
      throw new Abort();
    }
    // Try again, then nothing: what the last round left behind must not win the next one.
    p.add = (level, _rule, text) => add(level, 'again', `Third round: ${text}`);
    yield* restart(p);
    p.hide();
    const unplayed = (rounds.unplayed = yield* round(p, IDLE_ROUND_S, false));
    if (unplayed.phase === 'done' && (unplayed.stars ?? 0) >= 2) {
      add('fix', 'again', `After a played round, Try again and then no hand at all ended the next round with ${unplayed.stars} stars (result ${unplayed.result}): Try again must put everything back as Start found it, so that the round has to be played again.`);
    }
  });

  return report();
}
