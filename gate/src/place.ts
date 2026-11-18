import * as THREE from 'three';
import { measureLayout, type LayoutTarget } from './layout.js';

/**
 * The placement solver: a scene plan in (every thing once, with the box it fills, its role and how it stands to the
 * others), a place for every thing out. The model says what the relations are; this finds places where they hold,
 * nothing collides, and the layout checker (layout.ts) has nothing to fix. It is a depth-first search with
 * backtracking, after HOLODECK 2.0's DFS solver, and its test of a candidate is the checker itself, run on the plan
 * built as plain boxes: what is solved here passes there.
 *
 *   { mode: 'desk' | 'world',
 *     things: { plane: { role: 'hero', size: [w, h, d], count?, lift? }, ... },
 *     relations: [['runway', 'right of', 'plane'], ['kite', 'above', 'handle', 0.3], ['kite', 'room', [w, h, d]], ...] }
 *
 * Lengths are in the game's own units; a place is the centre of the thing's box, its height measured from the ground
 * the game stands on. The player sits in front of a desk game (+z) and stands at a world's origin, facing -z.
 */

export type Role = 'hero' | 'tool' | 'target' | 'button' | 'panel' | 'set' | 'ground' | 'scenery';
export type PlanThing = { role: Role; size: [number, number, number]; count?: number; lift?: number };
export type Relation = [string, string, unknown, unknown?];
export type Plan = { mode?: 'desk' | 'world'; things: Record<string, PlanThing>; relations?: Relation[] };
export type Place = { position: [number, number, number]; turn: number };
export type Layout =
  | { ok: true; mode: 'desk' | 'world'; places: Record<string, Place | Place[]>; notes: string[]; map: string }
  | { ok: false; mode: 'desk' | 'world'; error: string; notes: string[] };

const ROLES: Role[] = ['hero', 'tool', 'target', 'button', 'panel', 'set', 'ground', 'scenery'];
// The order things are placed in when no relation says otherwise: what the hands need first, the set round it after.
const ORDER: Record<Role, number> = { hero: 0, tool: 1, target: 1, button: 2, ground: 3, set: 4, scenery: 6, panel: 7 };
const HAND_ROLES: Role[] = ['hero', 'tool', 'target', 'button'];
const KINDS = ['left of', 'right of', 'in front of', 'behind', 'beside', 'near', 'far', 'on', 'above', 'in', 'between', 'around', 'facing', 'room'];

// Where things may stand, the grid they are tried on, and the distances the words mean, by mode. A world is built
// in desk units and shown 12 times bigger: its near and far are metres divided by 12.
const SPACE = {
  desk: { x: [-0.36, 0.36], z: [-0.4, 0.3], step: 0.02, gap: 0.01, near: 0.1, far: 0.25, above: 0.1, player: new THREE.Vector3(0, 0, 0.55) },
  world: { x: [-0.6, 0.6], z: [-1, 0.1], step: 0.02, gap: 0.006, near: 0.1, far: 0.35, above: 0.1, player: new THREE.Vector3(0, 0, 0) },
} as const;
// In a world a hand reaches 0.6 to 1.4 m up (layout.ts): what the hands use stands this high unless the plan says.
const WORLD_HAND_HEIGHT = 0.085;
const MAX_TRIES = 6000; // candidates put to the layout checker before the search gives up
const SCATTER_TRIES = 40;

type Rel = { kind: string; target: string; other?: string; value: unknown; text: string };
type Item = { id: string; thing: string; index: number; role: Role; size: THREE.Vector3; lift: number | null; relations: Rel[]; room: THREE.Vector3 | null };
type Put = { item: Item; centre: THREE.Vector3; turn: number; box: THREE.Box3; keep: THREE.Box3; mesh: THREE.Mesh };

const fail = (mode: 'desk' | 'world', error: string, notes: string[] = []): Layout => ({ ok: false, mode, error, notes });
const round = (n: number) => Math.round(n * 1000) / 1000;
const boxOf = (centre: THREE.Vector3, size: THREE.Vector3) => new THREE.Box3().setFromCenterAndSize(centre, size);
/** How far apart two boxes are on the ground (0 when one is over the other). */
const apart = (a: THREE.Box3, b: THREE.Box3) => Math.hypot(Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x), Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z));
const sizeText = (s: THREE.Vector3) => `${round(s.x)} x ${round(s.y)} x ${round(s.z)}`;

/** What is wrong with a plan before anything is placed, or the items to place, in order. */
function read(plan: Plan, mode: 'desk' | 'world'): { items: Item[] } | { error: string } {
  if (!plan || typeof plan !== 'object' || !plan.things || typeof plan.things !== 'object') return { error: 'The scene plan needs `things`: { name: { role, size: [w, h, d] } }.' };
  const problems: string[] = [];
  const things = Object.entries(plan.things);
  if (things.length === 0) problems.push('The scene plan has no things.');
  for (const [name, thing] of things) {
    if (name === 'player' || name === 'edge') problems.push(`\`${name}\` is a word of the plan, not a thing: give the thing another name.`);
    if (!thing || !ROLES.includes(thing.role)) problems.push(`\`${name}\`: role must be one of ${ROLES.join(', ')}.`);
    if (!Array.isArray(thing?.size) || thing.size.length !== 3 || !thing.size.every((n) => typeof n === 'number' && n > 0 && Number.isFinite(n))) problems.push(`\`${name}\`: size is [width, height, depth], each above 0, in the game's units.`);
    if (thing?.count !== undefined && !(Number.isInteger(thing.count) && thing.count >= 1 && thing.count <= 60)) problems.push(`\`${name}\`: count is a whole number from 1 to 60.`);
  }
  const known = new Set(things.map(([name]) => name));
  const relations: Record<string, Rel[]> = {};
  for (const relation of plan.relations ?? []) {
    const [source, kind, target, value] = Array.isArray(relation) ? relation : [];
    const text = `['${String(source)}', '${String(kind)}', ${Array.isArray(target) ? `[${target.join(', ')}]` : `'${String(target)}'`}${value === undefined ? '' : `, ${JSON.stringify(value)}`}]`;
    if (typeof source !== 'string' || !known.has(source)) problems.push(`${text}: \`${String(source)}\` is not a thing of the plan.`);
    else if (typeof kind !== 'string' || !KINDS.includes(kind)) problems.push(`${text}: the relations are ${KINDS.join(', ')}.`);
    else if (kind === 'room') {
      if (!(Array.isArray(target) && target.length === 3 && target.every((n) => typeof n === 'number' && n > 0))) problems.push(`${text}: room is the space kept free round the thing, [width, height, depth].`);
      else (relations[source] ??= []).push({ kind, target: '', value: target, text });
    } else if (typeof target !== 'string' || !(known.has(target) || target === 'player' || (kind === 'around' && target === 'edge'))) problems.push(`${text}: \`${String(target)}\` is not a thing of the plan${kind === 'around' ? ' (or `edge`)' : ' (or `player`)'}.`);
    else if (target === source) problems.push(`${text}: a thing cannot stand to itself.`);
    else if (kind === 'between' && !(typeof value === 'string' && known.has(value) && value !== source)) problems.push(`${text}: between takes two things, ['bridge', 'between', 'left bank', 'right bank'].`);
    else (relations[source] ??= []).push({ kind, target, other: kind === 'between' ? (value as string) : undefined, value: kind === 'between' ? undefined : value, text });
  }
  if (problems.length) return { error: problems.join('\n') };

  // A thing is placed after the things its relations name; among those free to go, by role.
  const needs = (name: string) => (relations[name] ?? []).flatMap((r) => [r.target, r.other]).filter((t): t is string => Boolean(t) && known.has(t as string));
  const left = new Set(known);
  const ordered: string[] = [];
  while (left.size) {
    const free = [...left].filter((name) => needs(name).every((t) => !left.has(t)));
    if (free.length === 0) return { error: `The relations go round in a circle (${[...left].join(', ')}): each thing must stand to one that is placed before it.` };
    free.sort((a, b) => ORDER[plan.things[a]!.role] - ORDER[plan.things[b]!.role]);
    ordered.push(free[0]!);
    left.delete(free[0]!);
  }
  const items: Item[] = [];
  for (const name of ordered) {
    const thing = plan.things[name]!;
    const room = (relations[name] ?? []).find((r) => r.kind === 'room');
    for (let i = 0; i < (thing.count ?? 1); i++) {
      items.push({
        id: thing.count && thing.count > 1 ? `${name}[${i}]` : name, thing: name, index: i, role: thing.role, size: new THREE.Vector3(...thing.size),
        lift: typeof thing.lift === 'number' ? thing.lift : null, relations: (relations[name] ?? []).filter((r) => r.kind !== 'room'),
        room: room ? new THREE.Vector3(...(room.value as [number, number, number])) : null,
      });
    }
  }
  if (mode === 'world' && items.some((item) => item.role === 'panel')) {
    // The headset stands a world's panel beside the player by itself (host.ts enterWorld).
    return { items: items.filter((item) => item.role !== 'panel') };
  }
  return { items };
}

export function solve(plan: Plan): Layout {
  const mode = plan?.mode === 'world' ? 'world' : 'desk';
  const space = SPACE[mode];
  const parsed = read(plan, mode);
  if ('error' in parsed) return fail(mode, parsed.error);
  const notes: string[] = [];
  if (mode === 'world' && Object.values(plan.things).some((thing) => thing.role === 'panel')) notes.push('In a world the app stands the panel beside the player: it is not placed here.');

  const scene = new THREE.Group();
  const material = new THREE.MeshBasicMaterial();
  const puts: Put[] = [];
  const byThing = (name: string) => puts.filter((p) => p.item.thing === name);
  let tries = 0;

  /** The layout checker's must-fixes for the plan as placed so far (plus one more box, when given). */
  const fixes = (extra?: THREE.Mesh) => {
    if (extra) scene.add(extra);
    const meshes = scene.children as THREE.Mesh[];
    const targets: LayoutTarget[] = meshes.filter((m) => HAND_ROLES.includes(m.userData.role)).map((m) => ({ object: m, grab: m.userData.role === 'hero' || m.userData.role === 'tool', press: m.userData.role === 'target' || m.userData.role === 'button' }));
    const found = measureLayout(scene, targets, meshes.filter((m) => m.userData.role === 'panel'), mode === 'world').findings.filter((f) => f.level === 'fix');
    if (extra) scene.remove(extra);
    return found;
  };

  const meshOf = (item: Item, centre: THREE.Vector3) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(item.size.x, item.size.y, item.size.z), material);
    mesh.name = item.id;
    mesh.position.copy(centre);
    mesh.userData.role = item.role;
    if (item.role === 'ground') mesh.userData.walkable = true; // the player walks over it: it is not in the way
    return mesh;
  };

  /** The height of an item's centre: on what it stands on, above what it hangs over, lifted, or on the ground. */
  const heightOf = (item: Item): number | string => {
    const half = item.size.y / 2;
    for (const r of item.relations) {
      if (r.kind !== 'on' && r.kind !== 'above') continue;
      const under = targetBox(r.target, space.player, item);
      if (!under) return `\`${r.target}\` was not placed`;
      return under.max.y + (r.kind === 'above' ? (typeof r.value === 'number' ? r.value : space.above) : 0) + half;
    }
    if (item.lift !== null) return item.lift + half;
    if (mode === 'world' && HAND_ROLES.includes(item.role)) return Math.max(half, WORLD_HAND_HEIGHT);
    return half;
  };

  /**
   * A relation's target as a box: the player as a point, or a placed thing. Of several, the one that pairs with this
   * item (the first stone on the first ledge, the second on the second), or with no item given the nearest.
   */
  const targetBox = (name: string, from: THREE.Vector3, item?: Item): THREE.Box3 | null => {
    if (name === 'player') return new THREE.Box3(space.player.clone(), space.player.clone());
    const placed = byThing(name);
    if (placed.length === 0) return null;
    if (item && placed.length > 1 && (plan.things[item.thing]!.count ?? 1) > 1) return placed[item.index % placed.length]!.box;
    return placed.reduce((best, p) => (p.centre.distanceTo(from) < best.centre.distanceTo(from) ? p : best)).box;
  };

  /** Does the relation hold for a box at this place? */
  const holds = (r: Rel, box: THREE.Box3, centre: THREE.Vector3, item: Item): boolean => {
    const t = targetBox(r.target, centre, item);
    if (!t) return false;
    const player = r.target === 'player';
    const sideways = Math.max(0, t.min.x - box.max.x, box.min.x - t.max.x); // how far they miss each other across
    const deep = Math.max(0, t.min.z - box.max.z, box.min.z - t.max.z); // and toward the player
    const distance = typeof r.value === 'number' ? r.value : undefined;
    switch (r.kind) {
      // Beside a thing is about level with it: lined up, or missing it by no more than `near` (a row of three rocks
      // behind a pool is wider than the pool).
      case 'left of': return player ? box.max.x <= -space.gap : box.max.x <= t.min.x - space.gap && deep <= space.near;
      case 'right of': return player ? box.min.x >= space.gap : box.min.x >= t.max.x + space.gap && deep <= space.near;
      // In front of a thing is the side toward the player; in front of the player is ahead of them.
      case 'in front of': return player ? box.max.z < t.min.z && Math.abs(centre.x) <= Math.max(space.near, Math.abs(centre.z - t.min.z) * 0.7) : box.min.z >= t.max.z + space.gap && sideways <= space.near;
      case 'behind': return player ? box.min.z > t.max.z : box.max.z <= t.min.z - space.gap && sideways <= space.near;
      case 'beside': return (box.max.x <= t.min.x - space.gap || box.min.x >= t.max.x + space.gap) && deep <= space.near;
      case 'near': return apart(box, t) <= (distance ?? space.near);
      case 'far': return apart(box, t) >= (distance ?? space.far);
      case 'on': case 'in': return centre.x >= t.min.x && centre.x <= t.max.x && centre.z >= t.min.z && centre.z <= t.max.z;
      case 'above': return apart(box, t) <= space.near;
      case 'between': {
        const o = r.other ? targetBox(r.other, centre, item) : null;
        if (!o) return false;
        const mid = t.getCenter(new THREE.Vector3()).add(o.getCenter(new THREE.Vector3())).multiplyScalar(0.5);
        return Math.hypot(centre.x - mid.x, centre.z - mid.z) <= space.step * 1.5;
      }
      default: return true; // facing and around do not limit where it stands
    }
  };

  /** The places a relation points to first: right beside its target, in the middle of it, half way between. */
  const ideals = (item: Item, y: number): THREE.Vector3[] => {
    const out: THREE.Vector3[] = [];
    const half = item.size.clone().multiplyScalar(0.5);
    const pad = space.gap * 2;
    const ahead = mode === 'desk' ? new THREE.Vector3(0, y, 0.02) : new THREE.Vector3(0, y, -0.11);
    for (const r of item.relations) {
      if (r.target === 'player') {
        const far = typeof r.value === 'number' ? r.value : r.kind === 'far' ? space.far : 0;
        if (r.kind === 'in front of' || r.kind === 'near') out.push(ahead.clone());
        else if (r.kind === 'left of' || r.kind === 'right of') out.push(ahead.clone().setX((r.kind === 'left of' ? -1 : 1) * (space.near + half.x)));
        else if (r.kind === 'far') out.push(new THREE.Vector3(0, y, space.player.z - far - half.z));
        continue;
      }
      const t = targetBox(r.target, space.player, item);
      if (!t) continue;
      const c = t.getCenter(new THREE.Vector3());
      const right = new THREE.Vector3(t.max.x + pad + half.x, y, c.z);
      const leftSide = new THREE.Vector3(t.min.x - pad - half.x, y, c.z);
      const front = new THREE.Vector3(c.x, y, t.max.z + pad + half.z);
      const back = new THREE.Vector3(c.x, y, t.min.z - pad - half.z);
      if (r.kind === 'right of') out.push(right);
      else if (r.kind === 'left of') out.push(leftSide);
      else if (r.kind === 'in front of') out.push(front);
      else if (r.kind === 'behind') out.push(back);
      else if (r.kind === 'beside' || r.kind === 'near') out.push(right, leftSide, front, back);
      else if (r.kind === 'above') out.push(new THREE.Vector3(c.x, y, c.z));
      else if (r.kind === 'on' || r.kind === 'in') {
        // Anywhere on it will do: where its role likes to stand if that is on it, else its middle.
        const liked = home(item, y);
        out.push(liked.x >= t.min.x && liked.x <= t.max.x && liked.z >= t.min.z && liked.z <= t.max.z ? liked : new THREE.Vector3(c.x, y, c.z));
      }
      else if (r.kind === 'between' && r.other) {
        const o = targetBox(r.other, space.player, item);
        if (o) out.push(c.clone().add(o.getCenter(new THREE.Vector3())).multiplyScalar(0.5).setY(y));
      }
    }
    return out;
  };

  /** Where a role likes to stand when its relations do not say: the hero in front of the player, Start by the hand. */
  const home = (item: Item, y: number): THREE.Vector3 => {
    const hero = puts.find((p) => p.item.role === 'hero');
    if (mode === 'desk') {
      if (item.role === 'hero') return new THREE.Vector3(0, y, 0.02);
      if (item.role === 'button') return new THREE.Vector3(-0.14, y, 0.14);
      if (item.role === 'set' || item.role === 'ground') return new THREE.Vector3(0, y, -0.08);
      return hero ? hero.centre.clone().setY(y) : new THREE.Vector3(0, y, 0);
    }
    if (item.role === 'hero') return new THREE.Vector3(0, y, -0.11);
    if (item.role === 'button') return new THREE.Vector3(-0.06, y, -0.09);
    if (item.role === 'set' || item.role === 'ground') return new THREE.Vector3(0, y, -0.3);
    return hero ? hero.centre.clone().setY(y) : new THREE.Vector3(0, y, -0.12);
  };

  /**
   * Where one of several of the same thing goes when its relations name no spot of their own (hoops far from the
   * player, targets round the hero): its place in a fan across the player's view, at the distance the relation gives.
   */
  const fanOf = (item: Item, y: number): THREE.Vector3 | null => {
    const count = plan.things[item.thing]!.count ?? 1;
    if (count < 2 || item.relations.some((r) => !(r.target === 'player' && (r.kind === 'far' || r.kind === 'near' || r.kind === 'in front of')))) return null;
    const index = item.index;
    const far = item.relations.find((r) => r.kind === 'far');
    const reach = far ? (typeof far.value === 'number' ? far.value : space.far) + item.size.z : mode === 'desk' ? 0.35 : 0.2;
    const angle = ((index / (count - 1)) - 0.5) * (Math.PI * 2) / 3; // across 120 degrees
    return new THREE.Vector3(space.player.x + Math.sin(angle) * reach, y, space.player.z - Math.cos(angle) * reach);
  };

  /** May these two boxes overlap? A thing and what it stands on or in; and ground, which everything stands over. */
  const together = (a: Item, b: Item) => a.role === 'ground' || b.role === 'ground'
    || [[a, b], [b, a]].some(([s, t]) => s!.relations.some((r) => (r.kind === 'on' || r.kind === 'in') && r.target === t!.thing));

  // What removed candidates, by reason, for the message when a thing finds no place.
  type Lost = { area: number; relations: Map<string, number>; collide: Map<string, number>; layout: Map<string, number>; said: Map<string, string>; left: number };
  let stuck: { item: Item; lost: Lost } | null = null;

  /** Every place an item could go, best first. */
  const candidates = (item: Item, lost: Lost): { centre: THREE.Vector3; box: THREE.Box3; keep: THREE.Box3 }[] | string => {
    const y = heightOf(item);
    if (typeof y === 'string') return y;
    const wanted = ideals(item, y);
    const base = home(item, y);
    const points = [...wanted, base];
    for (let x = space.x[0]; x <= space.x[1] + 1e-9; x += space.step) for (let z = space.z[0]; z <= space.z[1] + 1e-9; z += space.step) points.push(new THREE.Vector3(round(x), y, round(z)));
    const fan = fanOf(item, y);
    const goals = fan ? [fan] : wanted.length ? wanted : [base];
    // Nearest to where its relations point; of two as near, the one nearer where its role likes to stand. Several of
    // the same thing stand in a row across the player's view rather than one behind the other.
    const first = fan ? null : byThing(item.thing)[0];
    const score = (p: THREE.Vector3) => Math.min(...goals.map((g) => Math.hypot(p.x - g.x, p.z - g.z))) + 0.01 * Math.hypot(p.x - base.x, p.z - base.z) + (first ? Math.abs(p.z - first.centre.z) : 0);
    const out: { centre: THREE.Vector3; box: THREE.Box3; keep: THREE.Box3; score: number }[] = [];
    for (const centre of points) {
      const box = boxOf(centre, item.size);
      if (box.min.x < space.x[0] - 1e-9 || box.max.x > space.x[1] + 1e-9 || box.min.z < space.z[0] - 1e-9 || box.max.z > space.z[1] + 1e-9) {
        lost.area++;
        continue;
      }
      const broken = item.relations.find((r) => !holds(r, box, centre, item));
      if (broken) {
        lost.relations.set(broken.text, (lost.relations.get(broken.text) ?? 0) + 1);
        continue;
      }
      // What it keeps free round itself: its own box with a gap, or the room the plan gives it to move in.
      const keep = boxOf(centre, item.room ? item.room.clone().max(item.size) : item.size).expandByScalar(space.gap / 2);
      const hit = puts.find((p) => !together(item, p.item) && p.keep.intersectsBox(keep));
      if (hit) {
        lost.collide.set(hit.item.id, (lost.collide.get(hit.item.id) ?? 0) + 1);
        continue;
      }
      out.push({ centre, box, keep, score: score(centre) });
    }
    lost.left = out.length;
    return out.sort((a, b) => a.score - b.score);
  };

  const place = (index: number): boolean => {
    if (index === solid.length) return true;
    const item = solid[index]!;
    const lost: Lost = { area: 0, relations: new Map(), collide: new Map(), layout: new Map(), said: new Map(), left: 0 };
    const found = candidates(item, lost);
    if (typeof found === 'string') {
      stuck = { item, lost };
      return false;
    }
    for (const c of found) {
      if (++tries > MAX_TRIES) return false;
      const mesh = meshOf(item, c.centre);
      const broken = fixes(mesh);
      if (broken.length) {
        for (const f of broken) {
          lost.layout.set(f.rule, (lost.layout.get(f.rule) ?? 0) + 1);
          if (!lost.said.has(f.rule)) lost.said.set(f.rule, f.text);
        }
        continue;
      }
      scene.add(mesh);
      puts.push({ item, centre: c.centre, turn: 0, box: c.box, keep: c.keep, mesh });
      if (place(index + 1)) return true;
      scene.remove(mesh);
      puts.pop();
    }
    if (!stuck || solid.indexOf(stuck.item) <= index) stuck = { item, lost };
    return false;
  };

  const solid = parsed.items.filter((item) => item.role !== 'scenery' && item.role !== 'panel');
  if (!place(0)) {
    if (tries > MAX_TRIES && !stuck) return fail(mode, `The search gave up after ${MAX_TRIES} tries: the plan is too tight. Take a relation out, or make the biggest things smaller.`, notes);
    const { item, lost } = stuck!;
    const most = (map: Map<string, number>) => [...map].sort((a, b) => b[1] - a[1]).slice(0, 2);
    const why: string[] = [];
    for (const [text, n] of most(lost.relations)) why.push(`${n} places do not fit ${text}`);
    for (const [id, n] of most(lost.collide)) why.push(`${n} are taken by \`${id}\`${byThing(id.replace(/\[\d+\]$/, ''))[0]?.item.room ? ' and the room it keeps' : ''}`);
    for (const [rule, n] of most(lost.layout)) why.push(`${n} break the layout rule "${rule}" (${(lost.said.get(rule) ?? '').slice(0, 200)})`);
    if (lost.area) why.push(`${lost.area} are off the ${mode === 'desk' ? 'desk' : 'ground'}`);
    return fail(mode, `No place for \`${item.id}\` (${item.role}, ${sizeText(item.size)}): ${why.join('; ') || 'nothing is left'}. Change a relation, make something smaller, or give it less room.`, notes);
  }

  // Scenery is scattered last, round what it names or round the edge, wherever it is in nobody's way. One that finds
  // no place is left out: the game is not held up for a tree.
  let seed = 20261118;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (const item of parsed.items.filter((i) => i.role === 'scenery')) {
    const y = heightOf(item);
    if (typeof y === 'string') continue;
    const around = item.relations.find((r) => r.kind === 'around');
    const about = around && around.target !== 'edge' ? targetBox(around.target, space.player)?.getCenter(new THREE.Vector3()) : null;
    const middle = about ?? new THREE.Vector3((space.x[0] + space.x[1]) / 2, 0, (space.z[0] + space.z[1]) / 2);
    const reach = about ? [space.near, typeof around!.value === 'number' ? around!.value : space.far] : [Math.min(space.x[1], -space.z[0]) * 0.6, Math.max(space.x[1], -space.z[0])];
    let put = false;
    for (let i = 0; i < SCATTER_TRIES && !put; i++) {
      const angle = random() * Math.PI * 2;
      const far = reach[0]! + random() * (reach[1]! - reach[0]!);
      const centre = new THREE.Vector3(round(middle.x + Math.sin(angle) * far), y, round(middle.z + Math.cos(angle) * far));
      const box = boxOf(centre, item.size);
      if (box.min.x < space.x[0] || box.max.x > space.x[1] || box.min.z < space.z[0] || box.max.z > space.z[1]) continue;
      if (item.relations.some((r) => r.kind !== 'around' && !holds(r, box, centre, item))) continue;
      const keep = box.clone().expandByScalar(space.gap / 2);
      if (puts.some((p) => !together(item, p.item) && p.keep.intersectsBox(keep))) continue;
      const mesh = meshOf(item, centre);
      if (fixes(mesh).length) continue;
      scene.add(mesh);
      puts.push({ item, centre, turn: 0, box, keep, mesh });
      put = true;
    }
    if (!put) notes.push(`No free place for \`${item.id}\`: it was left out.`);
  }

  // A desk game's panel stands beside everything, in reach, turned to the player (as the starter's does).
  for (const item of parsed.items.filter((i) => i.role === 'panel')) {
    const all = new THREE.Box3();
    for (const p of puts) all.union(p.box);
    const extent = all.isEmpty() ? 0.3 : Math.max(...all.getSize(new THREE.Vector3()).toArray());
    const leftSide = item.relations.some((r) => r.kind === 'left of');
    const x = all.isEmpty() ? 0.3 : leftSide ? all.min.x - 0.05 - item.size.x / 2 : all.max.x + 0.05 + item.size.x / 2;
    const centre = new THREE.Vector3(round(x), round(Math.max(item.size.y / 2 + 0.02, 0.6 * extent)), 0);
    const box = boxOf(centre, item.size);
    const mesh = meshOf(item, centre);
    scene.add(mesh);
    puts.push({ item, centre, turn: leftSide ? 0.3 : -0.3, box, keep: box, mesh });
  }

  // Turn what faces something toward it (a thing's front is its +z side).
  for (const p of puts) {
    const facing = p.item.relations.find((r) => r.kind === 'facing');
    const toward = facing ? targetBox(facing.target, p.centre)?.getCenter(new THREE.Vector3()) : null;
    if (toward) p.turn = round(Math.atan2(toward.x - p.centre.x, toward.z - p.centre.z));
  }

  const places: Record<string, Place | Place[]> = {};
  for (const p of puts) {
    const place: Place = { position: [round(p.centre.x), round(p.centre.y), round(p.centre.z)], turn: p.turn };
    const several = (plan.things[p.item.thing]!.count ?? 1) > 1;
    if (several) ((places[p.item.thing] ??= []) as Place[]).push(place);
    else places[p.item.thing] = place;
  }
  if (mode === 'world') {
    for (const p of puts) {
      if (HAND_ROLES.includes(p.item.role) && p.box.min.y > 0.01 && !p.item.relations.some((r) => r.kind === 'on' || r.kind === 'above') && p.item.lift === null) {
        notes.push(`\`${p.item.id}\` stands ${round(p.box.min.y)} up (${round(p.box.min.y * 12)} m), where a hand reaches it: build a post, a stand or a ledge under it.`);
      }
    }
  }
  return { ok: true, mode, places, notes, map: topView(puts, mode) };
}

/** The layout from above, as text: far at the top, the player at the bottom of a desk or at the @ of a world. */
function topView(puts: Put[], mode: 'desk' | 'world'): string {
  const space = SPACE[mode];
  const cell = (space.x[1] - space.x[0]) / 30;
  const columns = 30;
  const rows = Math.ceil((space.z[1] - space.z[0]) / cell);
  const grid = Array.from({ length: rows }, () => Array.from({ length: columns }, () => '.'));
  const letters = new Map<string, string>();
  const legend: string[] = [];
  for (const p of puts) {
    let letter = letters.get(p.item.thing);
    if (!letter) {
      letter = [...p.item.thing.toUpperCase(), ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'].find((ch) => /[A-Z0-9]/.test(ch) && ![...letters.values()].includes(ch)) ?? '#';
      letters.set(p.item.thing, letter);
      legend.push(`${letter} ${p.item.thing} (${p.item.role})`);
    }
    for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
      const x = space.x[0] + (c + 0.5) * cell;
      const z = space.z[0] + (r + 0.5) * cell;
      if (x >= p.box.min.x && x <= p.box.max.x && z >= p.box.min.z && z <= p.box.max.z) grid[r]![c] = letter;
    }
  }
  if (mode === 'world') {
    const r = Math.min(rows - 1, Math.max(0, Math.floor((0 - space.z[0]) / cell)));
    const c = Math.floor((0 - space.x[0]) / cell);
    grid[r]![c] = '@';
  }
  return [...grid.map((row) => row.join('')), mode === 'desk' ? `${' '.repeat(12)}(player)` : '@ the player, facing up the page', ...legend].join('\n');
}
