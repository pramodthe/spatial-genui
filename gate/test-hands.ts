// The hands kit (agent_skills/game/hands/assets/hands-kit.js): each helper against its rule, at 72 and at 30 frames a
// second, and a small game for each that the gate's play-through plays by the gesture the kit gives for it.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

const source = readFileSync(new URL('../agent_skills/game/hands/assets/hands-kit.js', import.meta.url), 'utf8');
const names = [...source.matchAll(/^function (hand\w+)/gm)].map((m) => m[1]);
const kit = new Function(`${source}\nreturn { ${names.join(', ')} };`)() as Record<string, any>;

let checked = 0;
function near(actual: number, expected: number, within: number, what: string) {
  checked++;
  if (Math.abs(actual - expected) <= within) return;
  console.error(`${what}: expected ${expected} (within ${within}), got ${actual}`);
  process.exit(1);
}
function sure(test: boolean, what: string) {
  checked++;
  if (test) return;
  console.error(`expected ${what}`);
  process.exit(1);
}
/** `seconds` of frames at `hz`: `each(dt, share)` with how far through the time this frame is (0 to 1). */
function frames(seconds: number, hz: number, each: (dt: number, share: number) => void) {
  const count = Math.round(seconds * hz);
  for (let i = 1; i <= count; i++) each(1 / hz, i / count);
}
const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d));
  mesh.position.set(x, y, z);
  return mesh;
};
const deg = THREE.MathUtils.degToRad;
const HZ = [72, 30];

// Pour: it flows while held, tipped past its angle and over the bowl, faster the further it is tipped: tipped 60
// degrees with a 30 degree lip and a rate of 100 a second, half the rate, so 100 in two seconds.
function pourFor(hz: number, o: { held?: boolean; tilt?: number; x?: number; amount?: number; seconds?: number } = {}) {
  const root = new THREE.Group();
  const bowl = box(0.1, 0.04, 0.1, 0.1, 0.02, 0);
  const jug = box(0.05, 0.08, 0.05, o.x ?? 0.1, 0.12, 0);
  root.add(bowl, jug);
  jug.rotation.x = -deg(o.tilt ?? 60);
  const pour = kit.handPour(THREE, jug, () => o.held ?? true, { over: bowl, angle: 30, rate: 100, amount: o.amount });
  frames(o.seconds ?? 2, hz, (dt) => pour.update(dt));
  return pour;
}
for (const hz of HZ) {
  const pour = pourFor(hz);
  near(pour.poured, 100, 1, `poured in 2 s tipped 60 degrees at ${hz} frames a second`);
  near(pour.tilt, 60, 0.01, "the tilt read from the jug's own rotation");
  sure(pour.flowing && pour.over, 'a held, tipped jug over the bowl to be flowing');
}
near(pourFor(72, { tilt: 90 }).poured, 200, 1, 'poured in 2 s lying flat (the full rate)');
sure(pourFor(72, { held: false }).poured === 0, 'nothing poured from a jug no hand holds');
sure(pourFor(72, { tilt: 25 }).poured === 0, 'nothing poured from a jug tipped less than its lip angle');
sure(pourFor(72, { x: -0.2 }).poured === 0, 'nothing poured from a jug that is not over the bowl');
{
  const pour = pourFor(72, { amount: 50 });
  sure(pour.poured === 50 && pour.left === 0 && !pour.flowing, 'a jug holding 50 to pour 50 and stop');
}
{
  // The tilt is the jug's own, in the world: a jug standing upright in a tipped tray is tipped.
  const root = new THREE.Group();
  const tray = new THREE.Group();
  tray.rotation.z = deg(50);
  const jug = box(0.05, 0.08, 0.05);
  tray.add(jug);
  root.add(tray);
  near(kit.handPour(THREE, jug, () => true, {}).update(0.01).tilt, 50, 0.01, 'the tilt of a jug in a tipped tray');
}

// Stir: whole turns of the held tool's tip round the bowl's centre, either way, counted only inside the bowl.
function stirFor(hz: number, moves: { turns: number; radius?: number; y?: number; held?: boolean }[]) {
  const root = new THREE.Group();
  const bowl = box(0.14, 0.06, 0.14, 0, 0.03, 0);
  const spoon = box(0.015, 0.1, 0.015);
  root.add(bowl, spoon);
  let held = true;
  const stir = kit.handStir(THREE, spoon, () => held, bowl);
  let angle = 0;
  for (const move of moves) {
    held = move.held ?? true;
    const from = angle;
    const put = () => spoon.position.set((move.radius ?? 0.04) * Math.cos(angle), move.y ?? 0.03, -(move.radius ?? 0.04) * Math.sin(angle));
    put();
    stir.update();
    frames(Math.abs(move.turns), hz, (_dt, share) => {
      angle = from + share * move.turns * Math.PI * 2;
      put();
      stir.update();
    });
  }
  return stir;
}
for (const hz of HZ) {
  const stir = stirFor(hz, [{ turns: 3 }]);
  near(stir.turns, 3, 0.01, `three turns anticlockwise at ${hz} frames a second`);
  sure(stir.way === 1, 'anticlockwise seen from above to be way 1');
}
sure(stirFor(72, [{ turns: -2 }]).way === -1, 'clockwise seen from above to be way -1');
near(stirFor(72, [{ turns: 1 }, { turns: -0.5 }]).turns, 0.5, 0.01, 'a turn one way and half back');
sure(stirFor(72, [{ turns: 2, radius: 0.2 }]).turns === 0, 'no turns outside the bowl');
sure(stirFor(72, [{ turns: 2, y: 0.2 }]).turns === 0, 'no turns high above the rim');
sure(stirFor(72, [{ turns: 2, held: false }]).turns === 0, 'no turns from a spoon no hand holds');

// Fold: the flap follows the handle round the hinge; let go past half way it finishes the fold, else springs back.
function foldFor(hz: number, until: number, after = 1) {
  const root = new THREE.Group();
  const hinge = new THREE.Group();
  hinge.position.set(0, 0.006, 0);
  const flap = box(0.12, 0.004, 0.08, 0, 0, -0.04);
  hinge.add(flap);
  const handle = box(0.03, 0.01, 0.02, 0, 0.008, -0.075);
  root.add(hinge, handle);
  let held = true;
  const fold = kit.handFold(THREE, hinge, handle, () => held, { axis: 'x', to: 180 });
  fold.update(0);
  const offset = handle.position.clone().sub(hinge.position);
  frames(1, hz, (dt, share) => {
    handle.position.copy(offset).applyAxisAngle(new THREE.Vector3(1, 0, 0), deg(until * share)).add(hinge.position);
    fold.update(dt);
  });
  const whileHeld = fold.angle;
  held = false;
  frames(after, hz, (dt) => fold.update(dt));
  return { fold, whileHeld, hinge, handle, offset };
}
for (const hz of HZ) {
  const finished = foldFor(hz, 126);
  near(finished.whileHeld, 126, 0.5, `the flap following the handle to 126 degrees at ${hz} frames a second`);
  near(finished.fold.angle, 180, 0.5, 'a fold let go past half way finishing at 180 degrees');
  sure(finished.fold.done, 'a fold let go past half way to be done');
  near(new THREE.Euler().setFromQuaternion(finished.hinge.quaternion).x, Math.PI, 0.01, "the flap turned by the fold's angle");
  const edge = finished.offset.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI).add(finished.hinge.position);
  near(finished.handle.position.distanceTo(edge), 0, 1e-3, "the handle back at the folded flap's edge");
  const back = foldFor(hz, 60);
  near(back.fold.angle, 0, 0.5, 'a fold let go before half way springing back');
  sure(!back.fold.done, 'a fold let go before half way not to be done');
  near(back.handle.position.distanceTo(back.offset.clone().add(back.hinge.position)), 0, 1e-3, 'the handle back where it started');
}
near(foldFor(72, 126, 0.15).fold.angle, foldFor(30, 126, 0.15).fold.angle, 2, 'the fold finishing as fast at 30 frames a second');
near(foldFor(72, 250).whileHeld, 180, 0.01, 'a flap folded no further than its fold');
{
  const root = new THREE.Group();
  const hinge = new THREE.Group();
  hinge.add(box(0.12, 0.004, 0.08, 0, 0, -0.04));
  const handle = box(0.03, 0.01, 0.02, 0, 0.008, -0.075);
  root.add(hinge, handle);
  const fold = kit.handFold(THREE, hinge, handle, () => false, {});
  fold.update(1 / 72);
  handle.position.set(0, 0.2, 0.1);
  fold.update(1 / 72);
  sure(fold.angle === 0 && handle.position.z < -0.07, 'a handle no hand holds to stay at the edge, the flap unfolded');
}

// Twist: the held thing's own turn about its axis, + clockwise looking at its face; a knob stays where it is.
function twistFor(hz: number, steps: { turn: number; about?: THREE.Vector3; held?: boolean }[], fixed = true) {
  const root = new THREE.Group();
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.02).rotateX(Math.PI / 2));
  knob.position.set(0, 0.06, 0);
  root.add(knob);
  let held = true;
  const twist = kit.handTwist(THREE, knob, () => held, { axis: 'z', fixed });
  twist.update();
  for (const step of steps) {
    held = step.held ?? true;
    const about = step.about ?? new THREE.Vector3(0, 0, 1);
    frames(1, hz, (dt) => {
      // A hand turns what it holds by a little each frame, and drags it a little.
      knob.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(about, -deg(step.turn) * dt));
      knob.position.x += 0.01 * dt;
      twist.update();
    });
  }
  return { twist, knob };
}
for (const hz of HZ) {
  near(twistFor(hz, [{ turn: 90 }]).twist.angle, 90, 0.01, `a knob turned a quarter clockwise at ${hz} frames a second`);
  near(twistFor(hz, [{ turn: 810 }]).twist.turns, 2.25, 0.001, `two and a quarter turns at ${hz} frames a second`);
}
near(twistFor(72, [{ turn: -45 }]).twist.angle, -45, 0.01, 'a knob turned anticlockwise');
{
  const { twist, knob } = twistFor(72, [{ turn: 90 }, { turn: 30, about: new THREE.Vector3(1, 0, 0) }]);
  near(twist.angle, 90, 0.01, 'a tip of the hand not counted as a twist');
  near(new THREE.Euler().setFromQuaternion(knob.quaternion).x, 0, 1e-6, 'a fixed knob not tipped');
  near(knob.position.x, 0, 1e-9, 'a fixed knob where it was');
}
sure(twistFor(72, [{ turn: 90, held: false }]).twist.angle === 0, 'no twist of a knob no hand holds');
near(twistFor(72, [{ turn: 90 }], false).knob.position.x, 0.01, 1e-6, 'a carried tool moving with the hand');

// Cut: the held blade crossing the line, at its height, counts a cut where it crossed; along it, the length.
function cutFor(hz: number, from: number[], to: number[], o: { held?: boolean; line?: unknown } = {}) {
  const root = new THREE.Group();
  const knife = box(0.1, 0.01, 0.02);
  root.add(knife);
  const line = o.line ?? [[0, 0.07, -0.03], [0, 0.07, 0.03]];
  if (Array.isArray(line) === false) root.add(line as THREE.Object3D);
  const cut = kit.handCut(THREE, knife, () => o.held ?? true, line);
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  knife.position.copy(a);
  cut.update();
  frames(0.5, hz, (_dt, share) => {
    knife.position.lerpVectors(a, b, share);
    cut.update();
  });
  return cut;
}
for (const hz of HZ) {
  const cut = cutFor(hz, [0.05, 0.07, 0.01], [-0.05, 0.07, 0.01]);
  sure(cut.cut && cut.cuts === 1, `one cut across the line at ${hz} frames a second`);
  near(cut.at, 2 / 3, 0.01, 'where along the line it crossed');
  near(cutFor(hz, [0, 0.07, -0.03], [0, 0.07, 0.03]).length, 0.06, 0.003, `the length cut along the line at ${hz} frames a second`);
}
sure(!cutFor(72, [0.05, 0.2, 0], [-0.05, 0.2, 0]).cut, 'no cut by a blade passing high above the line');
sure(!cutFor(72, [0.05, 0.07, 0.2], [-0.05, 0.07, 0.2]).cut, 'no cut past the end of the line');
sure(!cutFor(72, [0.05, 0.07, 0], [-0.05, 0.07, 0], { held: false }).cut, 'no cut by a knife no hand holds');
sure(cutFor(72, [0.05, 0.07, 0], [-0.05, 0.07, 0], { line: box(0.004, 0.002, 0.06, 0, 0.069, 0) }).cut, 'a cut across a thin mark along the cut');

// A small game for each helper, through the gate: the play-through plays it by the gesture the kit gives for it.
const game = (body: string) => `${source}
export default function build({ THREE, traits, isGrabbed }) {
  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial();
  const box = (name, w, h, d, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.name = name;
    mesh.position.set(x, y, z);
    root.add(mesh);
    return mesh;
  };
  box('Table', 0.5, 0.01, 0.3, 0, -0.005, 0);
  const go = box('Go', 0.04, 0.02, 0.04, -0.2, 0.01, 0.12);
  let phase = 'ready', result = null, stars = null;
  const end = (value, good, fair) => {
    phase = 'done';
    result = value;
    stars = good ? 3 : fair ? 2 : 1;
  };
${body}
  traits(go, { onPress() { phase = 'play'; result = null; stars = null; reset(); } });
  return {
    root,
    update(time, delta) {
      if (phase === 'play') step(delta);
    },
    play: { learn: [], challenge, start: { press: go }, again: { press: go }, state: () => ({ phase, move: 0, result, stars }) },
  };
}
`;
const games: Record<string, string> = {
  pour: `
  const bowl = box('Bowl', 0.1, 0.04, 0.1, 0.1, 0.02, 0);
  const jug = box('Jug', 0.05, 0.08, 0.05, -0.1, 0.04, 0);
  traits(jug, { grab: true });
  const home = jug.position.clone();
  const pour = handPour(THREE, jug, isGrabbed, { over: bowl, angle: 30, rate: 200, amount: 300 });
  let was = false;
  const putBack = () => { jug.position.copy(home); jug.quaternion.identity(); };
  const reset = () => { pour.reset(); putBack(); was = false; };
  const step = (delta) => {
    pour.update(delta);
    const held = isGrabbed(jug);
    if (was && !held) {
      putBack();
      if (pour.poured > 0) end(Math.round(pour.poured), Math.abs(pour.poured - 150) < 15, Math.abs(pour.poured - 150) < 40);
    }
    was = held;
  };
  const challenge = [{ grab: jug, to: pour.above, tilt: 70, until: () => pour.poured >= 150 }];`,
  stir: `
  const bowl = box('Bowl', 0.14, 0.06, 0.14, 0.05, 0.03, 0);
  const spoon = box('Spoon', 0.015, 0.1, 0.015, 0.2, 0.05, 0.06);
  traits(spoon, { grab: true });
  const home = spoon.position.clone();
  const stir = handStir(THREE, spoon, isGrabbed, bowl);
  let was = false;
  const reset = () => { stir.reset(); spoon.position.copy(home); was = false; };
  const step = () => {
    stir.update();
    const held = isGrabbed(spoon);
    if (was && !held) {
      spoon.position.copy(home);
      if (stir.turns > 0.2) end(Math.round(stir.turns * 10) / 10, stir.turns >= 1.9, stir.turns >= 1.4);
    }
    was = held;
  };
  const challenge = [{ grab: spoon, path: stir.path(2), seconds: 3 }];`,
  fold: `
  const hinge = new THREE.Group();
  hinge.name = 'Crease';
  hinge.position.set(0, 0.006, 0);
  root.add(hinge);
  box('Card', 0.12, 0.004, 0.08, 0, 0.004, 0.04);
  const flap = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.004, 0.08), mat);
  flap.name = 'Flap';
  flap.position.set(0, 0, -0.04);
  hinge.add(flap);
  const corner = box('Corner', 0.03, 0.01, 0.02, 0, 0.008, -0.075);
  traits(corner, { grab: true });
  const fold = handFold(THREE, hinge, corner, isGrabbed, { axis: 'x', to: 180 });
  let clock = 0;
  const reset = () => { fold.reset(); clock = 0; };
  const step = (delta) => {
    clock += delta;
    fold.update(delta);
    if (fold.done && fold.angle > 175) end(Math.round(clock * 10) / 10, clock < 4, clock < 8);
  };
  const challenge = [{ grab: corner, path: fold.path, seconds: 0.8 }];`,
  twist: `
  box('Stand', 0.08, 0.1, 0.03, 0, 0.05, -0.03);
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.02, 24).rotateX(Math.PI / 2), mat);
  knob.name = 'Knob';
  knob.position.set(0, 0.06, 0);
  root.add(knob);
  traits(knob, { grab: true });
  const twist = handTwist(THREE, knob, isGrabbed, { axis: 'z' });
  let was = false;
  const reset = () => { twist.reset(); was = false; };
  const step = () => {
    twist.update();
    const held = isGrabbed(knob);
    if (was && !held && Math.abs(twist.angle) > 5) end(Math.round(twist.angle), Math.abs(twist.angle - 90) < 10, Math.abs(twist.angle - 90) < 25);
    was = held;
  };
  const challenge = [{ hold: knob, pinch: true, roll: 90, seconds: 1 }];`,
  cut: `
  box('Board', 0.2, 0.02, 0.12, 0, 0.01, 0);
  box('Bread', 0.12, 0.05, 0.06, 0, 0.045, 0);
  const mark = box('Cut mark', 0.004, 0.002, 0.06, 0.02, 0.071, 0);
  const knife = box('Knife', 0.1, 0.01, 0.02, 0.17, 0.03, 0.08);
  traits(knife, { grab: true });
  const home = knife.position.clone();
  const cut = handCut(THREE, knife, isGrabbed, mark);
  let was = false;
  const reset = () => { cut.reset(); knife.position.copy(home); was = false; };
  const step = () => {
    cut.update();
    const held = isGrabbed(knife);
    if (was && !held) {
      knife.position.copy(home);
      // How far from the middle of the mark the cut went, in centimetres.
      if (cut.cut) end(Math.round(Math.abs(cut.at - 0.5) * 60) / 10, Math.abs(cut.at - 0.5) < 0.15, Math.abs(cut.at - 0.5) < 0.3);
    }
    was = held;
  };
  const challenge = [{ grab: knife, path: cut.path, seconds: 0.5 }];`,
};
const tsx = fileURLToPath(new URL('./node_modules/.bin/tsx', import.meta.url));
const gate = fileURLToPath(new URL('./gate.ts', import.meta.url));
const played: string[] = [];
for (const [name, body] of Object.entries(games)) {
  const child = spawnSync(tsx, [gate], { input: JSON.stringify({ code: game(body), knownAssets: [] }), encoding: 'utf8' });
  let out: { ok: boolean; error?: string; stats?: { play: { ok: boolean; findings: unknown[]; rounds: Record<string, { stars: number | null; result: number | null }> } } };
  try {
    out = JSON.parse(child.stdout);
  } catch {
    console.error(`the ${name} game: the gate gave no report`, child.stderr.slice(0, 2000));
    process.exit(1);
  }
  const play = out.stats?.play;
  if (!out.ok || !play?.ok || play.rounds.played?.stars !== 3 || play.rounds.slow?.stars !== 3) {
    console.error(`expected the ${name} game, built on the hands kit, to pass the gate and play through to three stars by the kit's gesture`, out.error ?? JSON.stringify(play, null, 1));
    process.exit(1);
  }
  played.push(`${name} ${play.rounds.played.result}`);
}

console.log(`hands ok: ${names.filter((n) => !n.startsWith('handKit')).length} helpers, ${checked} checks; the games played through (${played.join(', ')})`);
