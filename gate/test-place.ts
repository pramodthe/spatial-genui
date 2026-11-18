// The placement solver (src/place.ts): plans it can place, with every relation holding and nothing for the layout
// checker to fix, and plans it cannot, each refused in words that name the thing and the relation.
import * as THREE from 'three';
import { measureLayout, type LayoutTarget } from './src/layout.js';
import { solve, type Layout, type Place, type Plan } from './src/place.js';

let checked = 0;
function sure(test: boolean, what: string, show?: unknown) {
  checked++;
  if (test) return;
  console.error(`expected ${what}`, show === undefined ? '' : JSON.stringify(show, null, 1));
  process.exit(1);
}
type Solved = Extract<Layout, { ok: true }>;
function solved(plan: Plan, what: string): Solved {
  const layout = solve(plan);
  sure(layout.ok, `${what} to be placed`, layout);
  return layout as Solved;
}
const one = (layout: Solved, name: string) => layout.places[name] as Place;
const all = (layout: Solved, name: string) => layout.places[name] as Place[];
const boxOf = (plan: Plan, name: string, place: Place) => new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(...place.position), new THREE.Vector3(...plan.things[name]!.size));

/** The layout checker on the solved plan, built again here as plain boxes: its must-fixes, and overlapping pairs. */
function recheck(plan: Plan, layout: Solved, mayTouch: [string, string][] = []) {
  const scene = new THREE.Group();
  const material = new THREE.MeshBasicMaterial();
  const boxes: { name: string; box: THREE.Box3 }[] = [];
  const targets: LayoutTarget[] = [];
  const panels: THREE.Object3D[] = [];
  for (const [name, placed] of Object.entries(layout.places)) {
    for (const place of Array.isArray(placed) ? placed : [placed]) {
      const thing = plan.things[name]!;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...thing.size), material);
      mesh.name = name;
      mesh.position.set(...place.position);
      if (thing.role === 'ground') mesh.userData.walkable = true;
      scene.add(mesh);
      if (thing.role === 'panel') panels.push(mesh);
      else boxes.push({ name, box: boxOf(plan, name, place) });
      if (['hero', 'tool'].includes(thing.role)) targets.push({ object: mesh, grab: true, press: false });
      if (['target', 'button'].includes(thing.role)) targets.push({ object: mesh, grab: false, press: true });
    }
  }
  const fixes = measureLayout(scene, targets, panels, layout.mode === 'world').findings.filter((f) => f.level === 'fix');
  const overlaps: string[] = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i]!, b = boxes[j]!;
    if (mayTouch.some(([x, y]) => (x === a.name && y === b.name) || (x === b.name && y === a.name))) continue;
    if (a.box.intersectsBox(b.box)) overlaps.push(`${a.name} and ${b.name}`);
  }
  return { fixes, overlaps };
}

// A desk game: the hero in front of the player, a runway beside it, Start near it, the panel beside everything.
const desk: Plan = {
  mode: 'desk',
  things: {
    plane: { role: 'hero', size: [0.2, 0.02, 0.28] },
    runway: { role: 'set', size: [0.1, 0.01, 0.5] },
    start: { role: 'button', size: [0.08, 0.03, 0.04] },
    panel: { role: 'panel', size: [0.23, 0.2, 0.01] },
  },
  relations: [['runway', 'right of', 'plane'], ['start', 'near', 'plane']],
};
const onDesk = solved(desk, 'a desk plan');
const plane = boxOf(desk, 'plane', one(onDesk, 'plane'));
const runway = boxOf(desk, 'runway', one(onDesk, 'runway'));
const start = boxOf(desk, 'start', one(onDesk, 'start'));
sure(Math.abs(one(onDesk, 'plane').position[0]) <= 0.1, 'the hero in front of the player', one(onDesk, 'plane'));
sure(runway.min.x >= plane.max.x, 'the runway to the right of the plane', onDesk.places);
sure(Math.hypot(Math.max(0, start.min.x - plane.max.x, plane.min.x - start.max.x), Math.max(0, start.min.z - plane.max.z, plane.min.z - start.max.z)) <= 0.1, 'Start near the plane', onDesk.places);
sure(one(onDesk, 'panel').position[0] > runway.max.x && one(onDesk, 'panel').turn === -0.3, 'the panel beside everything, turned to the player', one(onDesk, 'panel'));
let again = recheck(desk, onDesk);
sure(again.fixes.length === 0 && again.overlaps.length === 0, 'nothing for the layout checker to fix and nothing overlapping on the desk', again);
sure(JSON.stringify(solve(desk)) === JSON.stringify(onDesk), 'the same plan to give the same layout');
sure(onDesk.map.includes('P plane (hero)') && onDesk.map.includes('(player)'), 'a top view with its legend', onDesk.map);

// A world: a handle on a stand in front of the player, a kite above it with room to fly, hoops in the sky, trees.
const world: Plan = {
  mode: 'world',
  things: {
    stand: { role: 'set', size: [0.02, 0.07, 0.02] },
    handle: { role: 'hero', size: [0.03, 0.01, 0.01] },
    kite: { role: 'set', size: [0.06, 0.06, 0.01] },
    hoops: { role: 'set', size: [0.05, 0.05, 0.005], count: 6, lift: 0.3 },
    trees: { role: 'scenery', size: [0.04, 0.09, 0.04], count: 10 },
    panel: { role: 'panel', size: [0.2, 0.2, 0.01] },
  },
  relations: [['stand', 'in front of', 'player'], ['handle', 'on', 'stand'], ['kite', 'above', 'handle', 0.2], ['kite', 'room', [0.4, 0.3, 0.3]], ['hoops', 'far', 'player'], ['trees', 'around', 'edge']],
};
const inWorld = solved(world, 'a world plan');
const handle = one(inWorld, 'handle').position;
const stand = one(inWorld, 'stand').position;
sure(stand[2] < -0.035 && Math.abs(handle[0] - stand[0]) < 1e-9 && Math.abs(handle[1] - 0.075) < 1e-9, 'the handle on its stand, ahead of the player, where a hand reaches', inWorld.places);
sure(Math.abs(one(inWorld, 'kite').position[1] - (0.08 + 0.2 + 0.03)) < 1e-9, 'the kite above the handle', one(inWorld, 'kite'));
sure(all(inWorld, 'hoops').length === 6 && all(inWorld, 'hoops').every((h) => Math.hypot(h.position[0], h.position[2]) >= 0.3), 'six hoops far from the player', inWorld.places.hoops);
const room = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(...one(inWorld, 'kite').position), new THREE.Vector3(0.4, 0.3, 0.3));
sure(all(inWorld, 'hoops').every((h) => !room.intersectsBox(boxOf(world, 'hoops', h))) && all(inWorld, 'trees').every((t) => !room.intersectsBox(boxOf(world, 'trees', t))), "nothing in the kite's room", inWorld.places);
sure(all(inWorld, 'trees').length >= 8 && !('panel' in inWorld.places) && inWorld.notes.some((n) => n.includes('panel')), 'trees scattered, and the panel left to the app in a world', inWorld);
again = recheck(world, inWorld, [['handle', 'stand']]);
sure(again.fixes.length === 0 && again.overlaps.length === 0, 'nothing for the layout checker to fix and nothing overlapping in the world', again);

// What the hands use in a world stands where a hand reaches, and the plan is told to build something under it.
const lone = solved({ mode: 'world', things: { bell: { role: 'button', size: [0.02, 0.02, 0.02] } } }, 'a lone button in a world');
sure(Math.abs(one(lone, 'bell').position[1] - 0.085) < 1e-9 && lone.notes.some((n) => n.includes('`bell`') && n.includes('post')), 'a button in a world lifted to hand height, with a note', lone);

// Things meant to touch may overlap; a thing between two others stands half way; a thing facing another is turned.
const river: Plan = {
  mode: 'world',
  things: {
    river: { role: 'ground', size: [0.5, 0.01, 0.12] },
    dam: { role: 'set', size: [0.2, 0.05, 0.03] },
    left: { role: 'set', size: [0.04, 0.05, 0.04] },
    right: { role: 'set', size: [0.04, 0.05, 0.04] },
    sign: { role: 'set', size: [0.05, 0.05, 0.005] },
  },
  relations: [['river', 'far', 'player', 0.15], ['dam', 'in', 'river'], ['left', 'left of', 'dam'], ['right', 'right of', 'dam'], ['sign', 'between', 'left', 'right'], ['sign', 'above', 'dam', 0.05], ['sign', 'facing', 'player']],
};
const atRiver = solved(river, 'a river plan');
const dam = boxOf(river, 'dam', one(atRiver, 'dam'));
sure(boxOf(river, 'river', one(atRiver, 'river')).containsPoint(new THREE.Vector3(one(atRiver, 'dam').position[0], 0.005, one(atRiver, 'dam').position[2])), 'the dam in the river', atRiver.places);
sure(boxOf(river, 'left', one(atRiver, 'left')).max.x <= dam.min.x && boxOf(river, 'right', one(atRiver, 'right')).min.x >= dam.max.x, 'a bank on each side of the dam', atRiver.places);
const middle = (one(atRiver, 'left').position[0] + one(atRiver, 'right').position[0]) / 2;
sure(Math.abs(one(atRiver, 'sign').position[0] - middle) <= 0.03, 'the sign half way between the banks', atRiver.places);
const sign = one(atRiver, 'sign');
sure(Math.abs(sign.turn - Math.atan2(-sign.position[0], -sign.position[2])) < 0.002, 'the sign turned to the player', sign);

// Plans that cannot be placed are refused in words: the thing, and what took its places away.
const refused = (plan: Plan, words: string[], what: string) => {
  const layout = solve(plan);
  sure(!layout.ok && words.every((w) => (layout as { error: string }).error.includes(w)), `${what} to be refused, naming ${words.join(' and ')}`, layout);
};
const two = { a: { role: 'set', size: [0.05, 0.05, 0.05] }, b: { role: 'set', size: [0.05, 0.05, 0.05] } } as Plan['things'];
refused({ mode: 'desk', things: two, relations: [['a', 'near', 'b'], ['a', 'far', 'b']] }, ['No place for `a`', "'far'"], 'near and far at once');
refused({ mode: 'desk', things: two, relations: [['a', 'right of', 'b'], ['b', 'right of', 'a']] }, ['circle'], 'relations in a circle');
refused({ mode: 'desk', things: two, relations: [['a', 'near', 'b', 0.02], ['b', 'room', [0.3, 0.2, 0.3]]] }, ['No place for `a`', '`b`', 'room'], 'a thing that must stand in the room another keeps');
refused({ mode: 'desk', things: { big: { role: 'set', size: [0.9, 0.1, 0.1] } } }, ['No place for `big`', 'off the desk'], 'a thing wider than the desk');
refused({ mode: 'desk', things: { a: { role: 'boss' as never, size: [0.05, 0.05, 0.05] } } }, ['role must be one of'], 'an unknown role');
refused({ mode: 'desk', things: two, relations: [['a', 'beneath', 'b']] }, ['the relations are'], 'an unknown relation');
refused({ mode: 'desk', things: two, relations: [['a', 'near', 'c']] }, ['`c` is not a thing'], 'a relation to a thing that is not in the plan');
refused({ mode: 'desk', things: { a: { role: 'set', size: [0.05, 0, 0.05] } } }, ['size is [width, height, depth]'], 'a size of nothing');

// The four example games, as scene plans written from their built scenes (sizes measured in the dry run): each is
// placed, and what matters lands near where the game itself stood it.
const builtLike: [string, Plan, (layout: Solved) => boolean][] = [
  ['the paper plane', { mode: 'desk', things: {
    sheet: { role: 'ground', size: [0.49, 0.007, 0.57] }, plane: { role: 'hero', size: [0.21, 0.02, 0.3] },
    runway: { role: 'set', size: [0.11, 0.014, 0.5] }, start: { role: 'button', size: [0.076, 0.027, 0.041] }, panel: { role: 'panel', size: [0.23, 0.25, 0.01] } },
    relations: [['plane', 'on', 'sheet'], ['runway', 'right of', 'plane'], ['start', 'near', 'plane']] },
    // Built: the plane in front, the runway to its right, Start to its left.
    (l) => Math.abs(one(l, 'plane').position[0]) <= 0.11 && one(l, 'runway').position[0] > one(l, 'plane').position[0] + 0.15 && one(l, 'start').position[0] < one(l, 'plane').position[0]],
  ['the kite hill', { mode: 'world', things: {
    stand: { role: 'set', size: [0.059, 0.071, 0.037] }, handle: { role: 'hero', size: [0.067, 0.01, 0.012] },
    kite: { role: 'set', size: [0.098, 0.121, 0.024] }, hoops: { role: 'set', size: [0.158, 0.157, 0.003], count: 6, lift: 0.3 } },
    relations: [['stand', 'in front of', 'player'], ['handle', 'on', 'stand'], ['kite', 'above', 'handle', 0.2], ['kite', 'room', [0.5, 0.3, 0.3]], ['hoops', 'far', 'player']] },
    // Built: the stand 0.104 ahead with the handle on it; the six hoops spread across the sky, not in a heap.
    (l) => Math.abs(one(l, 'stand').position[2] + 0.104) <= 0.02 && Math.abs(one(l, 'handle').position[1] - 0.076) < 1e-9
      && Math.max(...all(l, 'hoops').map((h) => h.position[0])) - Math.min(...all(l, 'hoops').map((h) => h.position[0])) >= 0.5],
  ['the desert canyon', { mode: 'world', things: {
    ledge: { role: 'set', size: [0.131, 0.056, 0.07] }, jug: { role: 'hero', size: [0.026, 0.032, 0.021] }, start: { role: 'button', size: [0.029, 0.009, 0.029] },
    pool: { role: 'ground', size: [0.176, 0.004, 0.111] }, barriers: { role: 'set', size: [0.136, 0.067, 0.142], count: 3 } },
    relations: [['ledge', 'in front of', 'player'], ['jug', 'on', 'ledge'], ['start', 'on', 'ledge'], ['pool', 'behind', 'ledge'], ['barriers', 'behind', 'pool']] },
    // Built: the ledge 0.068 ahead with the jug and Start on it, the pool at -0.216, the rocks beyond it at -0.39.
    (l) => Math.abs(one(l, 'ledge').position[2] + 0.068) <= 0.05 && Math.abs(one(l, 'pool').position[2] + 0.216) <= 0.03 && all(l, 'barriers').every((b) => Math.abs(b.position[2] + 0.39) <= 0.06)],
  ['the river dam', { mode: 'world', things: {
    river: { role: 'ground', size: [0.26, 0.01, 0.6] }, ledges: { role: 'set', size: [0.041, 0.048, 0.048], count: 8 },
    stones: { role: 'tool', size: [0.039, 0.025, 0.029], count: 8 }, start: { role: 'button', size: [0.038, 0.045, 0.02] } },
    relations: [['river', 'in front of', 'player'], ['ledges', 'beside', 'river'], ['stones', 'on', 'ledges'], ['start', 'in', 'river']] },
    // Built: ledges on both banks, each stone on a ledge of its own, Start in the river near the player.
    (l) => all(l, 'ledges').length === 8 && all(l, 'stones').length === 8 && all(l, 'stones').every((s, i) => Math.abs(s.position[1] - 0.0605) < 0.001 && Math.abs(s.position[0] - all(l, 'ledges')[i]!.position[0]) < 0.005 && Math.abs(s.position[2] - all(l, 'ledges')[i]!.position[2]) < 0.005) && one(l, 'start').position[2] >= -0.15],
];
for (const [what, plan, like] of builtLike) {
  const layout = solved(plan, `${what} as a scene plan`);
  sure(like(layout), `${what} placed like the game built it`, layout.places);
  const twice = recheck(plan, layout, [['handle', 'stand'], ['jug', 'ledge'], ['start', 'ledge'], ['stones', 'ledges'], ['plane', 'sheet'], ['runway', 'sheet'], ['start', 'sheet'], ['start', 'river'], ['ledges', 'river'], ['stones', 'river'], ['pool', 'barriers'], ['pool', 'ledge']]);
  sure(twice.fixes.length === 0, `nothing for the layout checker to fix in ${what}`, twice.fixes);
}

console.log(`place ok: ${checked} checks; the desk plan from above:\n${onDesk.map}`);
