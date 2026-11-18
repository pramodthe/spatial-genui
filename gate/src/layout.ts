import * as THREE from 'three';

/**
 * Layout checks on a built scene, from where the player stands: hand targets hidden behind other things, and in a
 * world (build() returned mode: 'world') things standing where the player starts, hand targets out of reach, nothing
 * to do near the start, and name tags or signs huge up close. Distances are in the module's own units; a world is
 * shown WORLD_SCALE times bigger (headset/src/genui/host.ts), so the messages give both.
 */
export type LayoutFinding = { level: 'fix' | 'note'; rule: string; text: string };
export type Layout = { mode: 'desk' | 'world'; targets: number; findings: LayoutFinding[] };
export type LayoutTarget = { object: THREE.Object3D; grab: boolean; press: boolean };

const WORLD_SCALE = 12;
const EYE_HEIGHT_M = 1.6;
// A desk game stands about 0.55 m ahead of the eyes and 0.35 m below them (host.ts REACH_DISTANCE_M, BELOW_EYES_M);
// the player's head moves, so a target counts as hidden only when no eye of these sees it.
const DESK_AHEAD_M = 0.55;
const DESK_BELOW_EYES_M = 0.35;
const DESK_EYES_X_M = [0, -0.2, 0.2];
// World rules in desk units (learning-game references/world.md): hands touch things 5 to 12 cm up (0.6 to 1.4 m).
const REACH_LOW = 0.02; // 0.24 m: on the ground
const REACH_COMFORT_LOW = 0.04; // 0.48 m
const REACH_COMFORT_HIGH = 0.13; // 1.56 m
const REACH_HIGH = 0.16; // 1.9 m: over the head
const START_CLEAR = 0.035; // 0.42 m around the player's feet
const KNEE = 0.02; // 0.24 m: lower than this the player walks over it
const BODY_HEIGHTS = [0.03, 0.06, 0.1]; // knee, waist and chest (0.36, 0.72, 1.2 m)
const FIRST_FAR = 0.3; // 3.6 m
// The first view: yaw and pitch of the rays (degrees), how near counts, and how much blocked is a note or a fix.
const VIEW_YAW_DEG = 35;
const VIEW_PITCH_DEG = [-45, 10] as const;
const VIEW_NEAR = 0.125; // 1.5 m
const VIEW_NOTE = 0.1;
const VIEW_FIX = 0.2;
const HOLD_MAX = 0.03; // 0.36 m
const HOLD_FIX = 0.04; // 0.48 m: a giant in the hand
const CARRY_NEAR = 0.04; // a moving part this close to the hand moves with it
const CARRY_REACH = 0.1; // and all of it this close (1.2 m): a line or a beam from the hand is not held
// How tall a label looks from where it is read, in degrees: [note above, fix above]. On the desk a tag is about 3°.
const TAG_DEG = [8, 14] as const;
const SIGN_DEG = [16, 26] as const;
const MAX_LISTED = 4;

export function measureLayout(root: THREE.Object3D, targets: LayoutTarget[], panelHolders: THREE.Object3D[], world: boolean, hand?: THREE.Vector3, moved: Set<unknown> = new Set()): Layout {
  root.updateMatrixWorld(true);
  layoutRoot = root;
  const findings: LayoutFinding[] = [];
  const add = (level: LayoutFinding['level'], rule: string, text: string) => findings.push({ level, rule, text });
  const inPanel = new Set<THREE.Object3D>();
  for (const holder of panelHolders) holder.traverse((o) => inPanel.add(o));
  const walkable: THREE.Mesh[] = [];
  const solid: THREE.Mesh[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || inPanel.has(o) || !shown(o)) return;
    if (isWalkable(o)) walkable.push(mesh);
    else if (!seeThrough(mesh)) solid.push(mesh);
  });
  const groundAt = (x: number, z: number) => groundHeight(walkable, x, z);
  const reachable = targets.filter((t) => shown(t.object) && !inPanel.has(t.object));
  const where = (v: THREE.Vector3) => `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`;
  const worldM = (d: number) => (d * WORLD_SCALE).toFixed(1);

  // The eyes: a world's player stands at the origin facing -Z; a desk player sits in front of the game.
  const box = new THREE.Box3().setFromObject(root, true);
  const eyes = world
    ? [new THREE.Vector3(0, groundAt(0, 0) + EYE_HEIGHT_M / WORLD_SCALE, 0)]
    : DESK_EYES_X_M.map((dx) => {
        const centre = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
        return new THREE.Vector3(centre.x + dx, (box.isEmpty() ? 0 : box.min.y) + DESK_BELOW_EYES_M, centre.z + DESK_AHEAD_M);
      });

  // Hand targets hidden: every line from the eyes to the target crosses something solid first.
  const hidden: string[] = [];
  for (const t of reachable) {
    const own = family(t.object);
    const tb = new THREE.Box3().setFromObject(t.object, true);
    if (tb.isEmpty()) continue;
    const c = tb.getCenter(new THREE.Vector3());
    const points = [c, new THREE.Vector3(c.x, tb.max.y, c.z), new THREE.Vector3(tb.min.x * 0.7 + c.x * 0.3, c.y, c.z), new THREE.Vector3(tb.max.x * 0.7 + c.x * 0.3, c.y, c.z)];
    const blockers = new Set<string>();
    const seen = eyes.some((eye) => points.some((p) => {
      const blocker = firstBlocker(solid, own, eye, p);
      if (blocker) blockers.add(nameOf(blocker));
      return !blocker;
    }));
    if (!seen) hidden.push(`${nameOf(t.object)} at ${where(c)}, behind ${[...blockers].slice(0, 2).join(' and ')}`);
  }
  if (hidden.length) {
    const list = hidden.slice(0, MAX_LISTED).join('; ');
    if (world) add('note', 'hidden', `From the start spot the player cannot see ${hidden.length === 1 ? 'a hand target' : `${hidden.length} hand targets`}: ${list}. Fine for something to find; the first thing to do must be in plain view.`);
    else add('fix', 'hidden', `${hidden.length === 1 ? 'A hand target is' : `${hidden.length} hand targets are`} hidden from the player at the desk: ${list}. Move it in front of what hides it, or move that aside.`);
  }
  // Signs are one-sided cards facing +z: from behind, their text reads backwards.
  const backwards: string[] = [];
  const facing = new THREE.Vector3();
  root.traverse((o) => {
    if (!isFlatText(o) || !shown(o) || inPanel.has(o)) return;
    const c = new THREE.Box3().setFromObject(o, true).getCenter(new THREE.Vector3());
    facing.set(0, 0, 1).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion()));
    if (facing.dot(eyes[0]!.clone().sub(c).normalize()) < -0.2) backwards.push(`${nameOf(o)} at ${where(c)}`);
  });
  if (backwards.length) {
    add(world ? 'note' : 'fix', 'facing', `Facing away from the player${world ? ' at the start' : ''}, so its text reads backwards: ${backwards.slice(0, MAX_LISTED).join('; ')}. Turn it (rotation.y) to face where it is read from.`);
  }
  if (!world) return { mode: 'desk', targets: reachable.length, findings };

  // Things where the player stands: any part within START_CLEAR of their feet, from knee to head height (lower
  // things, water and paths, are walked over). Measured on the shapes' points: one merged mesh of a look can span
  // the whole scene, so its box says nothing.
  const crowding = new Map<string, number>();
  const ground0 = groundAt(0, 0);
  const band = [ground0 + KNEE, ground0 + EYE_HEIGHT_M / WORLD_SCALE + 0.02] as const;
  const point = new THREE.Vector3();
  // What follows the player's hand (a jug, a net, a torch) is carried, not in the way: judged by its size below. It
  // moved in the dry run's frames (itself or a group it hangs from), ended next to the hand and stays within reach of
  // it (a kite's line runs from the hand to the kite: it is not held).
  const movedWith = (o: THREE.Object3D) => {
    for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (moved.has(p)) return true;
    return false;
  };
  const carried = new THREE.Box3();
  const carriedNames = new Set<string>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || inPanel.has(o) || !shown(o) || isWalkable(o) || (mesh as THREE.InstancedMesh).isInstancedMesh) return;
    const b = new THREE.Box3().setFromObject(o, true);
    if (hand && !b.isEmpty() && movedWith(o) && b.distanceToPoint(hand) < CARRY_NEAR && reachOf(b, hand) < CARRY_REACH) {
      carried.union(b);
      carriedNames.add(nameOf(o));
      return;
    }
    if (b.isEmpty() || b.max.y < band[0] || b.min.y > band[1] || Math.hypot(Math.max(b.min.x, 0, -b.max.x), Math.max(b.min.z, 0, -b.max.z)) >= START_CLEAR) return;
    const position = mesh.geometry?.attributes?.position;
    if (!position) return;
    let d = Infinity;
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      if (point.y >= band[0] && point.y <= band[1]) d = Math.min(d, Math.hypot(point.x, point.z));
    }
    if (d < START_CLEAR) {
      const name = nameOf(o);
      crowding.set(name, Math.min(crowding.get(name) ?? Infinity, d));
    }
  });
  // A big flat face (a wall, a slab) can cross the start spot with all its corners far away: feel round the
  // player's body with short level rays too.
  const around = solid.filter((m) => !inPanel.has(m));
  for (const h of BODY_HEIGHTS) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      ray.set(new THREE.Vector3(0, ground0 + h, 0), new THREE.Vector3(Math.sin(a), 0, -Math.cos(a)));
      ray.far = START_CLEAR;
      const hit = ray.intersectObjects(around, false)[0];
      if (hit) {
        const name = nameOf(hit.object);
        crowding.set(name, Math.min(crowding.get(name) ?? Infinity, hit.distance));
      }
    }
  }
  if (crowding.size) {
    const list = [...crowding].sort((a, b) => a[1] - b[1]).slice(0, MAX_LISTED).map(([n, d]) => `${n} (${worldM(d)} m away)`).join(', ');
    add('fix', 'start-clear', `Where the player starts is crowded: ${list}. Keep ${START_CLEAR} (${worldM(START_CLEAR)} m) round the origin clear; put the first thing to do 0.08 to 0.15 ahead (1 to 2 m, z -0.08 to -0.15) and the rest beyond it.`);
  }

  // The first view: straight ahead from the start, how much of it is filled by things within VIEW_NEAR. A desk-sized
  // prop shown 12 times bigger half a metre away is a wall in the player's face.
  const blockers = new Map<string, number>();
  let rays = 0;
  let blocked = 0;
  const near = solid.filter((m) => !inPanel.has(m));
  for (let yaw = -VIEW_YAW_DEG; yaw <= VIEW_YAW_DEG; yaw += 5) {
    for (let pitch = VIEW_PITCH_DEG[0]; pitch <= VIEW_PITCH_DEG[1]; pitch += 5) {
      const y = (yaw * Math.PI) / 180;
      const p = (pitch * Math.PI) / 180;
      ray.set(eyes[0]!, new THREE.Vector3(Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p)));
      ray.far = VIEW_NEAR;
      const hit = ray.intersectObjects(near, false)[0];
      rays++;
      if (hit) {
        blocked++;
        const name = nameOf(hit.object);
        blockers.set(name, (blockers.get(name) ?? 0) + 1);
      }
    }
  }
  const share = blocked / Math.max(1, rays);
  if (share > VIEW_NOTE) {
    const list = [...blockers].sort((a, b) => b[1] - a[1]).slice(0, MAX_LISTED).map(([n, k]) => `${n} (${Math.round((100 * k) / rays)}%)`).join(', ');
    add(share > VIEW_FIX ? 'fix' : 'note', 'view', `The first view is ${Math.round(share * 100)}% blocked by things within ${VIEW_NEAR} (${worldM(VIEW_NEAR)} m) of the player: ${list}. A world shows the game 12 times bigger: keep the near things small and low (under 0.08 high within 0.15 ahead) so the player sees the place, and set big things farther off.`);
  }

  // Things to pick up must still fit a hand when the world shows them 12 times bigger.
  const bulky: string[] = [];
  let bulkiest = 0;
  for (const t of reachable) {
    if (!t.grab) continue;
    const size = new THREE.Box3().setFromObject(t.object, true).getSize(new THREE.Vector3());
    // The middle of its three sizes: a long plank is still held, a slab or a barrel-sized jug is not.
    const middle = [size.x, size.y, size.z].sort((a, b) => a - b)[1]!;
    bulkiest = Math.max(bulkiest, middle);
    if (middle > HOLD_MAX) bulky.push(`${nameOf(t.object)} ${size.x.toFixed(3)} x ${size.y.toFixed(3)} x ${size.z.toFixed(3)} (${worldM(size.x)} x ${worldM(size.y)} x ${worldM(size.z)} m)`);
  }
  if (!carried.isEmpty()) {
    const size = carried.getSize(new THREE.Vector3());
    const middle = [size.x, size.y, size.z].sort((a, b) => a - b)[1]!;
    bulkiest = Math.max(bulkiest, middle);
    if (middle > HOLD_MAX) bulky.push(`what the hand carries (${[...carriedNames].slice(0, 3).join(', ')}) ${size.x.toFixed(3)} x ${size.y.toFixed(3)} x ${size.z.toFixed(3)} (${worldM(size.x)} x ${worldM(size.y)} x ${worldM(size.z)} m)`);
  }
  if (bulky.length) add(bulkiest > HOLD_FIX ? 'fix' : 'note', 'hold-size', `Too big to hold in a world: ${bulky.slice(0, MAX_LISTED).join('; ')}. Something the hands carry is at most ${HOLD_MAX} wide (${worldM(HOLD_MAX)} m) in its middle size; make it smaller, or make it a fixed thing the hand presses or turns.`);

  // Hand targets: how high above the ground under them, and how far from the start the nearest one is.
  let nearest: { name: string; d: number } | null = null;
  const tooHigh: string[] = [];
  const tooLow: string[] = [];
  const awkward: string[] = [];
  for (const t of reachable) {
    const tb = new THREE.Box3().setFromObject(t.object, true);
    if (tb.isEmpty()) continue;
    const c = tb.getCenter(new THREE.Vector3());
    const up = c.y - groundAt(c.x, c.z);
    const name = nameOf(t.object);
    const d = Math.hypot(c.x, c.z);
    if (!nearest || d < nearest.d) nearest = { name, d };
    const said = `${name} at ${where(c)}, ${up.toFixed(3)} up (${worldM(up)} m)`;
    if (up > REACH_HIGH) tooHigh.push(said);
    else if (up < REACH_LOW) tooLow.push(said);
    else if (up < REACH_COMFORT_LOW || up > REACH_COMFORT_HIGH) awkward.push(said);
  }
  if (tooHigh.length) add('fix', 'reach', `Out of reach overhead: ${tooHigh.slice(0, MAX_LISTED).join('; ')}. Hands touch things 0.05 to 0.12 above the ground (0.6 to 1.4 m); put it on a post or a ledge at that height.`);
  if (tooLow.length) add('fix', 'reach', `On the ground, where the player must crouch: ${tooLow.slice(0, MAX_LISTED).join('; ')}. Stand it on a rock, a post or a table 0.05 to 0.12 up.`);
  if (awkward.length) add('note', 'reach', `Awkward to reach: ${awkward.slice(0, MAX_LISTED).join('; ')}. The easiest height is 0.05 to 0.12 above the ground.`);
  if (nearest && nearest.d > FIRST_FAR) {
    add('note', 'first-far', `The nearest thing to do (${nearest.name}) is ${nearest.d.toFixed(2)} from the start (${worldM(nearest.d)} m): put the first thing to do 0.08 to 0.15 ahead (1 to 2 m).`);
  }

  // Name tags and signs: how big they look from the start spot (a world shows them 12 times bigger). A tag names a
  // thing, so it stays small; a sign may be big, not filling the view. The title art is a billboard: not judged.
  const huge: { text: string; deg: number; fix: boolean }[] = [];
  root.traverse((o) => {
    const tag = isTag(o);
    if ((!tag && !o.name.startsWith('sign: ')) || !shown(o) || inPanel.has(o)) return;
    const b = new THREE.Box3().setFromObject(o, true);
    if (b.isEmpty()) return;
    const c = b.getCenter(new THREE.Vector3());
    const h = b.max.y - b.min.y;
    const deg = (2 * Math.atan(h / 2 / Math.max(1e-4, c.distanceTo(eyes[0]!))) * 180) / Math.PI;
    const [noteDeg, fixDeg] = tag ? TAG_DEG : SIGN_DEG;
    if (deg > noteDeg) huge.push({ text: `${nameOf(o)} at ${where(c)}: ${worldM(h)} m tall, ${Math.round(deg)}° of view`, deg, fix: deg > fixDeg });
  });
  if (huge.length) {
    huge.sort((a, b) => b.deg - a.deg);
    add(huge.some((h) => h.fix) ? 'fix' : 'note', 'label-size', `Labels huge up close (a world shows them ${WORLD_SCALE} times bigger): ${huge.slice(0, MAX_LISTED).map((h) => h.text).join('; ')}. A tag should fill about ${TAG_DEG[0] / 2}° from where it is read: make it smaller (kit.card height 0.005 to 0.01) or farther from the start; a sign under ${SIGN_DEG[0]}°.`);
  }
  return { mode: 'world', targets: reachable.length, findings };
}

/** How far the farthest corner of a box is from a point. */
function reachOf(box: THREE.Box3, point: THREE.Vector3): number {
  const far = new THREE.Vector3(
    Math.max(Math.abs(box.min.x - point.x), Math.abs(box.max.x - point.x)),
    Math.max(Math.abs(box.min.y - point.y), Math.abs(box.max.y - point.y)),
    Math.max(Math.abs(box.min.z - point.z), Math.abs(box.max.z - point.z)),
  );
  return far.length();
}

function shown(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

function isWalkable(o: THREE.Object3D): boolean {
  return o.userData?.walkable === true;
}

/** A kit name tag (kit.card): dark glass, readable from both sides. */
function isTag(o: THREE.Object3D): boolean {
  return o.userData?.nameTag === true || o.name.startsWith('card: ');
}

/** A kit sign: a flat card facing +z. */
function isFlatText(o: THREE.Object3D): boolean {
  return o.name.startsWith('sign: ');
}

/** Glass, glows and effects: the eye sees through them. */
function seeThrough(mesh: THREE.Mesh): boolean {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return materials.every((m) => !m || !m.visible || (m.transparent && m.opacity < 0.6) || m.depthWrite === false);
}

/** The target, everything inside it and everything it hangs from: none of them hides it. */
function family(object: THREE.Object3D): Set<THREE.Object3D> {
  const set = new Set<THREE.Object3D>();
  object.traverse((o) => set.add(o));
  for (let p = object.parent; p; p = p.parent) set.add(p);
  return set;
}

const ray = new THREE.Raycaster();
// The scene being measured: names stop at it, so a named root does not name everything.
let layoutRoot: THREE.Object3D | null = null;
const down = new THREE.Vector3(0, -1, 0);

function firstBlocker(solid: THREE.Mesh[], own: Set<THREE.Object3D>, eye: THREE.Vector3, point: THREE.Vector3): THREE.Object3D | null {
  const toward = point.clone().sub(eye);
  const distance = toward.length();
  if (distance < 1e-4) return null;
  ray.set(eye, toward.normalize());
  ray.far = distance;
  const hits = ray.intersectObjects(solid.filter((m) => !own.has(m)), false);
  // A hit right at the target is the thing it stands on or touches, not something in the way.
  const hit = hits.find((h) => h.distance < distance - 0.004);
  return hit ? hit.object : null;
}

function groundHeight(walkable: THREE.Mesh[], x: number, z: number): number {
  if (!walkable.length) return 0;
  ray.set(new THREE.Vector3(x, 50, z), down);
  ray.far = 100;
  const hit = ray.intersectObjects(walkable, false)[0];
  return hit ? hit.point.y : 0;
}

/** What to call an object in a message: its own name or its nearest named group's, else its shape. */
function nameOf(o: THREE.Object3D): string {
  for (let p: THREE.Object3D | null = o; p && p !== layoutRoot; p = p.parent) {
    // A look's merged meshes are named after their group, which may have no name.
    const name = p.name.replace(/\s*\(merged\)$/, '').replace(/^merged$/, '').trim();
    if (name) return `"${name.slice(0, 40)}"`;
  }
  const geometry = (o as THREE.Mesh).geometry?.type?.replace(/Geometry$/, '').toLowerCase();
  return `an unnamed ${geometry || o.type.toLowerCase()}`;
}
