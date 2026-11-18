// The motion kit (agent_skills/game/motion/assets/motion-kit.js): each helper against the formula it stands for, and
// a throwing game built on the kit through the gate and its play-through.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

const source = readFileSync(new URL('../agent_skills/game/motion/assets/motion-kit.js', import.meta.url), 'utf8');
const names = [...source.matchAll(/^function (motion\w+)/gm)].map((m) => m[1]);
const kit = new Function(`${source}\nreturn { ${names.join(', ')} };`)() as Record<string, any>;

let checked = 0;
function near(actual: number, expected: number, share: number, what: string) {
  checked++;
  if (Math.abs(actual - expected) <= Math.abs(expected) * share + 1e-9) return;
  console.error(`${what}: expected ${expected} (within ${share * 100}%), got ${actual}`);
  process.exit(1);
}
function sure(test: boolean, what: string) {
  checked++;
  if (test) return;
  console.error(`expected ${what}`);
  process.exit(1);
}
/** Run `seconds` of game time at a frame rate, through the kit's fixed steps. */
function run(seconds: number, hz: number, each: (dt: number) => void) {
  const steps = kit.motionSteps();
  for (let i = 0; i < Math.round(seconds * hz); i++) steps.run(1 / hz, each);
}
const G = 9.8;
const vec = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// Falling: half g t squared, and the same at 72 and at 30 frames a second.
const fall = (hz: number) => {
  const body = kit.motionBody(THREE, { gravity: G });
  run(1, hz, (dt) => body.step(dt));
  return body.position.y;
};
near(fall(72), -G / 2, 0.01, 'a fall of one second');
near(fall(30), fall(72), 0.001, 'the same fall at 30 frames a second');

// A throw at 45 degrees lands at speed squared over g.
const shot = kit.motionBody(THREE, { gravity: G, radius: 0.001, floor: -0.001, bounce: 0 });
shot.launch(vec(3 * Math.SQRT1_2, 3 * Math.SQRT1_2, 0));
let range = NaN;
run(2, 72, (dt) => {
  shot.step(dt);
  if (shot.landed) range = shot.position.x;
});
near(range, (3 * 3) / G, 0.02, 'the range of a throw');

// A bounce keeps its share of the speed, so it climbs back to that share squared of the height; then it rolls to rest.
const ball = kit.motionBody(THREE, { gravity: G, radius: 0.02, floor: 0, bounce: 0.6, position: vec(0, 1.02, 0) });
let apex = 0;
let bounced = false;
run(1.2, 72, (dt) => {
  ball.step(dt);
  if (ball.landed) bounced = true;
  else if (bounced) apex = Math.max(apex, ball.position.y - 0.02);
});
near(apex, 0.36, 0.05, 'the height after one bounce');
ball.velocity.x = 0.5;
run(12, 72, (dt) => ball.step(dt));
sure(ball.resting && ball.velocity.length() === 0 && Math.abs(ball.position.y - 0.02) < 1e-9, 'a bouncing ball to come to rest on the floor');

// Walls keep it in.
const caged = kit.motionBody(THREE, { gravity: G, radius: 0.02, floor: 0, bounce: 0.9, friction: 0, walls: [vec(-0.2, 0, -0.2), vec(0.2, 1, 0.2)] });
caged.launch(vec(1.3, 2, -0.9));
let escaped = false;
run(3, 72, (dt) => {
  caged.step(dt);
  if (Math.abs(caged.position.x) > 0.18 + 1e-9 || Math.abs(caged.position.z) > 0.18 + 1e-9 || caged.position.y < 0.02 - 1e-9) escaped = true;
});
sure(!escaped, 'a ball to stay inside its walls');

// Two bodies: equal ones swap speeds in a perfect bounce, and what they carry together is kept in any bounce.
const a = kit.motionBody(THREE, { radius: 0.05, bounce: 1, position: vec(-0.04, 0, 0) });
const b = kit.motionBody(THREE, { radius: 0.05, bounce: 1, position: vec(0.04, 0, 0) });
a.velocity.set(2, 0, 0);
b.velocity.set(-1, 0, 0);
sure(kit.motionCollide(a, b), 'two overlapping balls to collide');
near(a.velocity.x, -1, 0.001, 'the first ball after a perfect bounce');
near(b.velocity.x, 2, 0.001, 'the second ball after a perfect bounce');
near(b.position.x - a.position.x, 0.1, 0.001, 'the balls to be apart after the bounce');
const heavy = kit.motionBody(THREE, { radius: 0.05, bounce: 0.5, mass: 3, position: vec(-0.04, 0, 0) });
const light = kit.motionBody(THREE, { radius: 0.05, bounce: 0.5, mass: 1, position: vec(0.04, 0, 0) });
heavy.velocity.set(1, 0, 0);
kit.motionCollide(heavy, light);
near(3 * heavy.velocity.x + light.velocity.x, 3, 0.001, 'what two balls carry together');
near(light.velocity.x - heavy.velocity.x, 0.5, 0.001, 'how fast they part: the bounce times how fast they met');
sure(!kit.motionCollide(a, kit.motionBody(THREE, { radius: 0.05, position: vec(5, 0, 0) })), 'far balls not to collide');

// A box that does not move sends the ball back.
const struck = kit.motionBody(THREE, { radius: 0.02, bounce: 0.5, position: vec(-0.015, 0.05, 0) });
struck.velocity.set(2, 0, 0);
sure(kit.motionBlock(struck, vec(0, 0, -0.1), vec(0.1, 0.1, 0.1)), 'a ball touching a box to hit it');
near(struck.velocity.x, -1, 0.001, 'the ball sent back by the box');
near(struck.position.x, -0.02, 0.001, 'the ball left touching the box from outside');

// A wing: it settles into a glide that sinks at drag over lift, at the speed where lift carries the weight.
const glider = kit.motionBody(THREE, { gravity: G });
glider.launch(vec(4, 0, 0));
run(30, 72, (dt) => {
  kit.motionGlide(glider, { lift: 2, drag: 0.4 }, dt);
  glider.step(dt);
});
const slope = -glider.velocity.y / Math.hypot(glider.velocity.x, glider.velocity.z);
near(slope, 0.4 / 2, 0.03, 'the sink of a glide');
near(glider.velocity.length(), Math.sqrt((G * Math.cos(Math.atan(0.2))) / 2), 0.03, 'the speed of a glide');

// Air: a fall settles at g over the rate; a flow carries a body to its own speed.
const leaf = kit.motionBody(THREE, { gravity: G });
run(5, 72, (dt) => {
  kit.motionDrift(leaf, vec(), 5, dt);
  leaf.step(dt);
});
near(-leaf.velocity.y, G / 5, 0.05, 'the steady speed of a fall through air');
const raft = kit.motionBody(THREE, { gravity: 0 });
run(5, 72, (dt) => {
  kit.motionDrift(raft, vec(0.3, 0, -0.1), 2, dt);
  raft.step(dt);
});
near(raft.velocity.x, 0.3, 0.01, 'a raft carried at the speed of the current');

// A pendulum swings in two pi root length over g.
const pendulum = kit.motionPendulum({ length: 0.5, angle: 0.1, gravity: G });
let crossings = 0;
let first = 0;
let last = 0;
let time = 0;
let side = Math.sign(pendulum.angle);
run(10, 120, (dt) => {
  pendulum.step(dt);
  time += dt;
  if (Math.sign(pendulum.angle) !== side) {
    side = Math.sign(pendulum.angle);
    if (++crossings === 1) first = time;
    last = time;
  }
});
near((2 * (last - first)) / (crossings - 1), 2 * Math.PI * Math.sqrt(0.5 / G), 0.01, 'the swing of a pendulum');

// A spring settles on its target without going past it; with no damping it swings in two pi over root stiffness.
const spring = kit.motionSpring({ stiffness: 120 });
let past = 0;
run(1.5, 72, (dt) => {
  past = Math.max(past, spring.step(dt, 1));
});
sure(past <= 1.001, 'a spring not to overshoot its target');
near(spring.value, 1, 0.01, 'a spring to settle on its target');
const swinging = kit.motionSpring({ stiffness: 100, damping: 0, value: 1 });
let turns = 0;
let from = 0;
let to = 0;
time = 0;
side = 1;
run(5, 120, (dt) => {
  const value = swinging.step(dt, 0);
  time += dt;
  if (Math.sign(value) !== side) {
    side = Math.sign(value);
    if (++turns === 1) from = time;
    to = time;
  }
});
near((2 * (to - from)) / (turns - 1), (2 * Math.PI) / 10, 0.02, 'the swing of a spring');

// A rope keeps its length and hangs as a chain does (for 0.3 of rope over a gap of 0.2, about 0.10 at the middle).
const rope = kit.motionRope(THREE, { segments: 12, length: 0.3, gravity: G });
const left = vec(-0.1, 0, 0);
const right = vec(0.1, 0, 0);
rope.lay(left, right);
run(4, 72, (dt) => rope.step(dt, left, right));
let length = 0;
for (let i = 1; i < rope.points.length; i++) length += rope.points[i].distanceTo(rope.points[i - 1]);
near(length, 0.3, 0.03, 'the length of a hanging rope');
near(-rope.points[6].y, 0.1005, 0.12, 'the sag of a hanging rope');
sure(rope.points[0].distanceTo(left) === 0 && rope.points[12].distanceTo(right) === 0, 'the ends of a rope to stay where they are held');

// Balance: mass times distance on each side; the beam settles level when they match and tips when they do not.
near(kit.motionTurning([{ mass: 2, x: 1 }, { mass: 1, x: -2 }]) + 1, 1, 1e-9, 'two kilos at one against one kilo at two');
const lever = kit.motionLever({ limit: 0.3, give: 1 });
run(2, 72, (dt) => lever.step(dt, 0));
sure(Math.abs(lever.angle) < 1e-6 && lever.balanced(0.02) && !lever.balanced(0.2), 'a balanced beam to stay level');
run(2, 72, (dt) => lever.step(dt, kit.motionTurning([{ mass: 2, x: 1 }, { mass: 1, x: -1 }])));
near(lever.angle, 0.3, 0.01, 'a beam heavier on the +x side to tip that way');
const centre = kit.motionCentre([{ mass: 1, x: 0, y: 0.1 }, { mass: 3, x: 1, y: 0.5 }]);
near(centre.x, 0.75, 1e-9, 'the centre of mass');
near(centre.y, 0.4, 1e-9, 'the height of the centre of mass');
sure(kit.motionTopples(centre.x, 0, 0.5) && !kit.motionTopples(centre.x, 0, 1), 'a centre of mass outside its base to topple');

// Water: pressure grows with depth; wood floats with its share under the surface.
near(kit.motionPressure(2), 19600, 1e-9, 'the pressure two metres down');
near(kit.motionPressure(4) / kit.motionPressure(2), 2, 1e-9, 'pressure to double with depth');
sure(kit.motionPressure(-1) === 0, 'no pressure above the surface');
near(kit.motionFloat(0.6, 0.001), 0.6, 1e-9, 'how deep wood floats');

// Easing is the same at any frame rate, and an angle turns the short way.
const eased = (hz: number) => {
  let value = 0;
  for (let i = 0; i < hz; i++) value = kit.motionFollow(value, 1, 3, 1 / hz);
  return value;
};
near(eased(72), 1 - Math.exp(-3), 1e-9, 'easing for one second');
near(eased(30), eased(72), 1e-9, 'the same easing at 30 frames a second');
sure(kit.motionTurnTo(3, -3, 5, 0.1) > 3, 'an angle to turn the short way round');
const spot = vec(1, 0, 0);
kit.motionFollowTo(spot, vec(0, 0, 0), 3, 1);
near(spot.x, Math.exp(-3), 1e-9, 'a vector easing to its target');

// The speed of a hand, and of a thing a hand carries and lets go.
const hands = { right: { tracked: true, tip: vec() } };
const hand = kit.motionHand(THREE, hands);
for (let i = 0; i < 22; i++) {
  hands.right.tip.x += 0.5 / 72;
  hand.update(1 / 72);
}
near(hand.velocity.x, 0.5, 0.02, 'the speed of a moving hand');
hands.right.tracked = false;
hand.update(1 / 72);
hands.right.tracked = true;
hand.update(1 / 72);
sure(hand.speed === 0, 'a hand that was out of view to start from still');
const carried = new THREE.Object3D();
let grabbed = false;
const held = kit.motionHeld(THREE, carried, () => grabbed);
const events: (string | null)[] = [held.update(1 / 72)];
grabbed = true;
events.push(held.update(1 / 72));
for (let i = 0; i < 22; i++) {
  carried.position.z -= 0.4 / 72;
  events.push(held.update(1 / 72));
}
grabbed = false;
events.push(held.update(1 / 72), held.update(1 / 72));
sure(events.filter(Boolean).join() === 'taken,thrown' && events[events.length - 2] === 'thrown', 'a carried thing to be taken once and thrown once');
near(held.velocity.z, -0.4, 0.02, 'the speed a thing leaves the hand with');

// The nearest place within reach.
const places = [vec(0, 0, 0), { position: vec(0.1, 0, 0) }];
sure(kit.motionSnap(vec(0.08, 0, 0), places, 0.05) === 1 && kit.motionSnap(vec(0.3, 0, 0), places, 0.05) === -1, 'the nearest place within reach, or none');

// A throwing game built on the kit: it passes the gate as part of a module, and the simulated hand throws the ball.
const game = `${source}
export default function build({ THREE, traits, isGrabbed }) {
  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(1, 0.01, 0.3), mat);
  floor.position.set(0.1, -0.005, 0.05);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.02), mat);
  ball.name = 'Ball';
  const home = new THREE.Vector3(-0.3, 0.03, 0.05);
  ball.position.copy(home);
  const go = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.04), mat);
  go.name = 'Go';
  go.position.set(-0.3, 0.02, 0.12);
  root.add(floor, ball, go);
  traits(ball, { grab: true });
  let phase = 'ready', result = null, stars = null, flying = false;
  traits(go, { onPress() { phase = 'play'; result = null; stars = null; flying = false; ball.position.copy(home); } });
  const steps = motionSteps();
  const held = motionHeld(THREE, ball, isGrabbed);
  const body = motionBody(THREE, { position: ball.position, radius: 0.02, gravity: 9.8 * 0.2, bounce: 0.3, floor: 0 });
  return {
    root,
    update(time, delta) {
      if (held.update(delta) === 'thrown' && phase === 'play') { body.launch(held.velocity); flying = true; }
      steps.run(Math.min(delta, 0.05), (dt) => {
        if (!flying) return;
        body.step(dt);
        if (!body.landed) return;
        flying = false;
        phase = 'done';
        result = ball.position.x - home.x;
        stars = result > 0.3 ? 3 : result > 0.2 ? 2 : result > 0.1 ? 1 : 0;
      });
      go.rotation.y = time;
    },
    play: {
      learn: [],
      challenge: [{ grab: ball, path: [[-0.28, 0.12, 0.05], [-0.14, 0.16, 0.05]], seconds: 0.3, throw: true }],
      start: { press: go },
      again: { press: go },
      state: () => ({ phase, move: 0, result, stars }),
    },
  };
}
`;
const tsx = fileURLToPath(new URL('./node_modules/.bin/tsx', import.meta.url));
const gate = fileURLToPath(new URL('./gate.ts', import.meta.url));
const child = spawnSync(tsx, [gate], { input: JSON.stringify({ code: game, knownAssets: [] }), encoding: 'utf8' });
const thrown = JSON.parse(child.stdout) as { ok: boolean; error?: string; stats?: { play: { ok: boolean; findings: unknown[]; rounds: Record<string, { stars: number | null; result: number | null }> } } };
const played = thrown.stats?.play;
if (!thrown.ok || !played?.ok || played.rounds.played?.stars !== 3 || played.rounds.slow?.stars !== 3) {
  console.error('expected a throwing game built on the kit to pass the gate and be thrown to three stars', thrown.error ?? JSON.stringify(played, null, 1));
  process.exit(1);
}
near(played.rounds.slow.result!, played.rounds.played.result!, 0.1, 'the same throw at 30 frames a second');

console.log(`motion ok: ${names.length} helpers, ${checked} checks; the kit's throw flew ${played.rounds.played.result!.toFixed(2)} (${played.rounds.slow.result!.toFixed(2)} at 30 frames a second)`);
