// The play-through (src/play.ts): a small game that plays well passes, and the same game broken in one way at a
// time fails the rule made for that way.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tsx = fileURLToPath(new URL('./node_modules/.bin/tsx', import.meta.url));
const gate = fileURLToPath(new URL('./gate.ts', import.meta.url));

type Round = { phase: string; move: number; result: number | null; stars: number | null; level?: number | null };
type Play = { ok: boolean; complete: boolean; findings: { level: string; rule: string; text: string }[]; rounds: Record<string, Round> & { levels?: Round[] } };
type Result = { ok: boolean; error?: string; stats?: { play: Play | null } };

function run(code: string, extra: Record<string, unknown> = {}): Result {
  const child = spawnSync(tsx, [gate], { input: JSON.stringify({ code, knownAssets: [], ...extra }), encoding: 'utf8' });
  if (child.status !== 0) throw new Error(child.stderr || `gate exit ${child.status}`);
  return JSON.parse(child.stdout) as Result;
}

/** The module with one passage swapped; the passage must be there, so a renamed line cannot quietly skip a case. */
function swap(code: string, ...pairs: [string, string][]): string {
  for (const [from, to] of pairs) {
    if (!code.includes(from)) throw new Error(`test-play: the game no longer contains "${from}"`);
    code = code.replace(from, to);
  }
  return code;
}

const rulesOf = (r: Result) => [...new Set((r.stats?.play?.findings ?? []).map((f) => `${f.level}:${f.rule}`))].sort().join(',');

// Learn: carry the ball to the cup, then press the lever. Challenge: the ball in the cup, as fast as you can.
const ball = `export default function build({ THREE, kit, traits, ui, isGrabbed }) {
  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial();
  const table = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.01, 0.3), mat);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.02), mat);
  ball.name = 'Ball';
  ball.position.set(-0.1, 0.03, 0.05);
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02), mat);
  cup.name = 'Cup';
  cup.position.set(0.1, 0.02, 0.05);
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), mat);
  lever.name = 'Lever';
  lever.position.set(0, 0.03, -0.08);
  root.add(table, ball, cup, lever);
  traits(ball, { grab: true });
  let pressed = false;
  traits(lever, { onPress() { pressed = true; } });
  let phase = 'learn', move = 0, result = null, stars = null, clock = 0, fill = 0;
  const home = ball.position.clone();
  const panel = kit.panel(ui, { width: 0.3, position: [0.3, 0.15, 0], title: 'Ball in the cup', items: [
    { text: 'Carry the ball to the cup.', id: 'goal' },
    { stat: '-', label: 'seconds', id: 'result' },
    { buttons: [{ label: 'Start', id: 'start', onPress() { begin(); } }, { label: 'Try again', id: 'again', onPress() { begin(); } }] },
  ] });
  root.add(panel.object3D);
  panel.show('start', false);
  panel.show('again', false);
  function begin() { phase = 'play'; clock = 0; fill = 0; result = null; stars = null; ball.position.copy(home); panel.show('start', false); panel.show('again', false); }
  function end(k) { phase = 'done'; result = clock; stars = k; panel.set('result', clock.toFixed(1)); panel.show('again', true); }
  const inCup = () => !isGrabbed(ball) && ball.position.distanceTo(cup.position) < 0.04;
  return {
    root,
    update(time, delta) {
      const dt = Math.min(delta, 0.05);
      if (phase === 'learn') {
        if (move === 0 && inCup()) { move = 1; ball.position.copy(home); }
        else if (move === 1 && pressed) { move = 2; phase = 'ready'; panel.show('start', true); }
      } else if (phase === 'play') {
        clock += dt;
        if (inCup()) end(clock < 5 ? 3 : clock < 10 ? 2 : 1);
        else if (clock > 20) end(0);
      }
      lever.rotation.y = time;
    },
    play: {
      learn: [{ grab: ball, to: cup }, { press: lever }],
      challenge: [{ grab: ball, to: cup }],
      state: () => ({ phase, move, result, stars }),
    },
  };
}
`;

const good = run(ball);
const play = good.stats?.play;
if (!good.ok || !play?.ok || play.findings.length > 0 || play.rounds.played?.stars !== 3 || play.rounds.idle?.stars !== 0) {
  console.error('expected the ball game to play through cleanly: three stars played, none with no hand', good.error ?? JSON.stringify(play, null, 1));
  process.exit(1);
}
// The same game gives the same play-through every time (all but how long the computing took).
const steady = (r: Result) => JSON.stringify(r.stats, (key, value) => (key === 'ms' ? 0 : value));
if (steady(run(ball)) !== steady(good)) {
  console.error('two play-throughs of the same game disagreed');
  process.exit(1);
}
if (run(ball, { play: false }).stats?.play !== null || run(swap(ball, ['    play: {', '    notPlay: {'])).stats?.play !== null) {
  console.error('expected no play-through when it is switched off or the game has no play block');
  process.exit(1);
}

// One thing broken at a time, and the rule that names it.
const broken: [string, string, string][] = [
  ['a move the hand cannot complete', 'fix:move', swap(ball, ['if (move === 0 && inCup()) { move = 1; ball.position.copy(home); }', 'if (false) {}'])],
  ['Start hidden when the moves are done', 'fix:start', swap(ball, ["phase = 'ready'; panel.show('start', true); }", "phase = 'ready'; }"])],
  ['a round that starts by itself', 'fix:start', swap(ball, ["{ move = 2; phase = 'ready'; panel.show('start', true); }", '{ move = 2; begin(); }'])],
  ['a round that never ends', 'fix:round', swap(ball, ['if (inCup()) end(clock < 5 ? 3 : clock < 10 ? 2 : 1);', 'if (false) {}'], ['else if (clock > 20) end(0);', 'else {}'])],
  ['a result that is not a number', 'fix:result', swap(ball, ["phase = 'done'; result = clock;", "phase = 'done'; result = Number('far');"])],
  ['a played round that earns no star', 'fix:stars', swap(ball, ['if (inCup()) end(clock < 5 ? 3 : clock < 10 ? 2 : 1);', 'if (inCup()) end(0);'])],
  ['Try again that does not restart', 'fix:again', swap(ball, ["{ label: 'Try again', id: 'again', onPress() { begin(); } }", "{ label: 'Try again', id: 'again', onPress() {} }"])],
  ['a wait counted per frame, not per second', 'fix:frame-rate', swap(ball, ['if (inCup()) end(clock < 5 ? 3 : clock < 10 ? 2 : 1);', 'if (inCup()) { fill += 1 / 72; if (fill >= 3) end(clock < 5 ? 3 : clock < 7 ? 2 : 1); }'])],
  ['a clock counted per frame', 'note:frame-rate', swap(ball, ['clock += dt;', 'clock += 1 / 72;'])],
  ['a move that completes with no hand', 'fix:idle', swap(ball, ['if (move === 0 && inCup()) { move = 1; ball.position.copy(home); }', 'if (move === 0) { move = 1; }'])],
  ['a round won by waiting', 'fix:again,fix:idle', swap(ball, ['else if (clock > 20) end(0);', 'else if (clock > 3) end(3);'])],
  ['an error once the ball is held', 'fix:error', swap(ball, ['clock += dt;', 'clock += dt; if (isGrabbed(ball)) nope();'])],
  ['no challenge gestures', 'fix:play', swap(ball, ['challenge: [{ grab: ball, to: cup }],', 'challenge: [],'])],
  ['a phase the check does not know', 'fix:state', swap(ball, ['state: () => ({ phase, move, result, stars }),', "state: () => ({ phase: 'paused', move, result, stars }),"])],
];
for (const [what, expected, code] of broken) {
  const result = run(code);
  if (!result.ok || rulesOf(result) !== expected) {
    console.error(`expected ${what} to give ${expected}, got ${rulesOf(result) || 'nothing'}`, result.error ?? JSON.stringify(result.stats?.play, null, 1));
    process.exit(1);
  }
}

// A piece that is hidden for a moment is waited for, as a player would wait; one that never comes back is a failure.
const comesBack = run(swap(ball,
  ["let phase = 'learn',", "let back = 0, phase = 'learn',"],
  ["function begin() { phase = 'play';", "function begin() { ball.visible = false; back = 1; phase = 'play';"],
  ['const dt = Math.min(delta, 0.05);', 'const dt = Math.min(delta, 0.05); if (back > 0 && (back -= dt) <= 0) ball.visible = true;'],
));
if (!comesBack.ok || !comesBack.stats?.play?.ok || (comesBack.stats.play.rounds.played?.result ?? 0) < 2) {
  console.error('expected the hand to wait a second for a ball that is hidden when the round starts', comesBack.error ?? JSON.stringify(comesBack.stats?.play, null, 1));
  process.exit(1);
}
const gone = run(swap(ball, ["function begin() { phase = 'play';", "function begin() { ball.visible = false; phase = 'play';"]));
if (!gone.ok || rulesOf(gone) !== 'fix:round') {
  console.error('expected a ball that stays hidden to give fix:round', gone.error ?? JSON.stringify(gone.stats?.play, null, 1));
  process.exit(1);
}

// A throw: the ball leaves with the hand's speed and is scored by how far it lands. Start is a block to press.
const toss = `export default function build({ THREE, traits, isGrabbed, hands }) {
  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.01, 0.3), mat);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.02), mat);
  ball.name = 'Ball';
  const home = new THREE.Vector3(-0.3, 0.03, 0.05);
  ball.position.copy(home);
  const go = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.04), mat);
  go.name = 'Go';
  go.position.set(-0.3, 0.02, 0.12);
  root.add(floor, ball, go);
  traits(ball, { grab: true });
  let phase = 'ready', result = null, stars = null, was = false, flying = false;
  traits(go, { onPress() { phase = 'play'; result = null; stars = null; flying = false; ball.position.copy(home); } });
  const v = new THREE.Vector3(), last = new THREE.Vector3(), hand = new THREE.Vector3();
  return {
    root,
    update(time, delta) {
      const dt = Math.min(delta, 0.05);
      if (dt > 0) hand.copy(hands.right.tip).sub(last).divideScalar(dt);
      last.copy(hands.right.tip);
      const held = isGrabbed(ball);
      if (was && !held && phase === 'play') { v.copy(hand); flying = true; }
      was = held;
      if (flying) {
        v.y -= 2 * dt;
        ball.position.addScaledVector(v, dt);
        if (ball.position.y <= 0.02) { flying = false; phase = 'done'; result = ball.position.x - home.x; stars = result > 0.3 ? 3 : result > 0.2 ? 2 : result > 0.1 ? 1 : 0; }
      }
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
const thrown = run(toss);
if (!thrown.ok || !thrown.stats?.play?.ok || (thrown.stats.play.rounds.played?.stars ?? 0) < 1) {
  console.error('expected the toss game to play through: the ball flies and lands', thrown.error ?? JSON.stringify(thrown.stats?.play, null, 1));
  process.exit(1);
}
const dropped = run(swap(toss, ['{ v.copy(hand); flying = true; }', '{ v.set(0, 0, 0); flying = true; }']));
if (!dropped.ok || !rulesOf(dropped).split(',').includes('fix:throw')) {
  console.error('expected a ball that drops where it is let go to give fix:throw', dropped.error ?? JSON.stringify(dropped.stats?.play, null, 1));
  process.exit(1);
}

// The hand's pose: a jug follows the hand and pours only while the fingertips are below the palm, over the cup. The
// hold ends when the cup is full (until), not after a guessed time.
const pour = `export default function build({ THREE, kit, ui, hands }) {
  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial();
  const table = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.01, 0.3), mat);
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.04), mat);
  cup.name = 'Cup';
  cup.position.set(0.05, 0.03, 0);
  const jug = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.03), mat);
  jug.name = 'Jug';
  root.add(table, cup, jug);
  let phase = 'ready', fill = 0, clock = 0, result = null, stars = null;
  const panel = kit.panel(ui, { width: 0.3, position: [0.3, 0.15, 0], title: 'Fill the cup', items: [
    { buttons: [{ label: 'Start', id: 'start', onPress() { begin(); } }, { label: 'Try again', id: 'again', onPress() { begin(); } }] },
  ] });
  root.add(panel.object3D);
  panel.show('again', false);
  function begin() { phase = 'play'; fill = 0; clock = 0; result = null; stars = null; panel.show('start', false); panel.show('again', false); }
  function end(k) { phase = 'done'; result = clock; stars = k; panel.show('again', true); }
  return {
    root,
    update(time, delta) {
      const dt = Math.min(delta, 0.05), h = hands.right;
      if (h.tracked) jug.position.copy(h.tip);
      if (phase !== 'play') return;
      clock += dt;
      const pouring = h.tracked && h.tip.y < h.palm.y - 0.01 && Math.hypot(h.tip.x - cup.position.x, h.tip.z - cup.position.z) < 0.03;
      if (pouring) fill += dt / 3;
      if (fill >= 1) end(clock < 8 ? 3 : 2);
      else if (clock > 25) end(0);
    },
    play: {
      learn: [],
      challenge: [{ hold: [0.05, 0.12, 0], tilt: 45, until: () => fill >= 1, seconds: 15 }],
      state: () => ({ phase, move: 0, result, stars }),
    },
  };
}
`;
const poured = run(pour);
if (!poured.ok || !poured.stats?.play?.ok || poured.stats.play.rounds.played?.stars !== 3) {
  console.error('expected a tilted hand to pour the cup full', poured.error ?? JSON.stringify(poured.stats?.play, null, 1));
  process.exit(1);
}
const level = run(swap(pour, ['tilt: 45, ', '']));
if (!level.ok || rulesOf(level) !== 'fix:round') {
  console.error('expected a level hand, which pours nothing, to give fix:round', level.error ?? JSON.stringify(level.stats?.play, null, 1));
  process.exit(1);
}

// A held bar that the wrist rolls: taking it starts the round (the hand keeps hold), its roll moves the boat, the one
// move is counted inside the round, and Try again goes back to waiting for the bar.
const tiller = `export default function build({ THREE, kit, traits, ui, isGrabbed }) {
  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial();
  const sea = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.01, 0.3), mat);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.01, 0.01), mat);
  bar.name = 'Tiller';
  bar.position.set(0, 0.06, 0.1);
  const boat = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.05), mat);
  boat.name = 'Boat';
  boat.position.set(-0.1, 0.02, -0.05);
  root.add(sea, bar, boat);
  traits(bar, { grab: true });
  let phase = 'ready', move = 0, clock = 0, result = null, stars = null;
  const panel = kit.panel(ui, { width: 0.3, position: [0.3, 0.15, 0], title: 'Steer across', items: [
    { buttons: [{ label: 'Try again', id: 'again', onPress() { phase = 'ready'; move = 0; result = null; stars = null; boat.position.x = -0.1; bar.rotation.set(0, 0, 0); panel.show('again', false); } }] },
  ] });
  root.add(panel.object3D);
  panel.show('again', false);
  function end(k) { phase = 'done'; result = clock; stars = k; panel.show('again', true); }
  return {
    root,
    update(time, delta) {
      const dt = Math.min(delta, 0.05);
      if (phase === 'ready' && isGrabbed(bar)) { phase = 'play'; clock = 0; }
      if (phase !== 'play') return;
      clock += dt;
      if (isGrabbed(bar)) boat.position.x -= bar.rotation.z * 0.15 * dt;
      if (boat.position.x > 0) move = 1;
      if (boat.position.x >= 0.1) end(clock < 6 ? 3 : 2);
      else if (clock > 15) end(0);
    },
    play: {
      learn: [],
      moves: 1,
      start: { grab: bar, keep: true },
      challenge: () => [{ hold: bar, pinch: true, roll: 25, seconds: 12 }],
      state: () => ({ phase, move, result, stars }),
    },
  };
}
`;
const steered = run(tiller);
const sail = steered.stats?.play;
if (!steered.ok || !sail?.ok || sail.rounds.played?.stars !== 3 || sail.rounds.played.move !== 1 || sail.rounds.again?.phase !== 'done' || sail.rounds.unplayed?.stars !== 0 || sail.rounds.idle?.stars !== 0) {
  console.error('expected a rolled wrist to steer the boat across, twice, and no star for a round without a hand', steered.error ?? JSON.stringify(sail, null, 1));
  process.exit(1);
}
const later: [string, string, string][] = [
  ['a level wrist that steers nowhere', 'fix:move,fix:stars', swap(tiller, ['roll: 25, ', ''])],
  ['a move the round never counts', 'fix:move', swap(tiller, ['moves: 1,', 'moves: 2,'])],
  ['Try again that leaves the boat across', 'fix:again', swap(tiller, ["boat.position.x = -0.1; bar.rotation.set(0, 0, 0);", 'bar.rotation.set(0, 0, 0);'])],
];
for (const [what, expected, code] of later) {
  const result = run(code);
  if (!result.ok || rulesOf(result) !== expected) {
    console.error(`expected ${what} to give ${expected}, got ${rulesOf(result) || 'nothing'}`, result.error ?? JSON.stringify(result.stats?.play, null, 1));
    process.exit(1);
  }
}

// Levels: the ball game with three levels, each with less time for three stars; Next level after a star, Try again
// on the same level. The play-through plays level 1 and on to the last, and fails a level that cannot be won.
const leveled = swap(ball,
  ["let phase = 'learn', move = 0,", "let level = 1, phase = 'learn', move = 0,"],
  ["{ label: 'Try again', id: 'again', onPress() { begin(); } }]", "{ label: 'Next level', id: 'next', onPress() { if (phase === 'done' && stars > 0 && level < 3) { level++; begin(); } } }, { label: 'Try again', id: 'again', onPress() { begin(); } }]"],
  ['if (inCup()) end(clock < 5 ? 3 : clock < 10 ? 2 : 1);', 'if (inCup()) end(clock < [5, 4, 3][level - 1] ? 3 : 0);'],
  ['state: () => ({ phase, move, result, stars }),', 'levels: 3,\n      state: () => ({ phase, move, result, stars, level }),'],
);
const climbed = run(leveled);
const climb = climbed.stats?.play;
if (!climbed.ok || !climb?.ok || climb.rounds.levels?.map((r) => `${r.level}:${r.stars}`).join(' ') !== '1:3 2:3 3:3') {
  console.error('expected the ball game to be played through its three levels, three stars each', climbed.error ?? JSON.stringify(climb, null, 1));
  process.exit(1);
}
const levelsBroken: [string, string, string][] = [
  ['a last level that cannot be won', 'fix:level', swap(leveled, ['[5, 4, 3][level - 1]', '[5, 4, 0.01][level - 1]'])],
  ['Next level that does not open the next level', 'fix:level', swap(leveled, ["if (phase === 'done' && stars > 0 && level < 3) { level++; begin(); }", 'begin();'])],
  ['Try again that goes back to level 1', 'fix:level', swap(leveled, ["{ label: 'Try again', id: 'again', onPress() { begin(); } }", "{ label: 'Try again', id: 'again', onPress() { level = 1; begin(); } }"])],
  ['a state with no level', 'fix:level', swap(leveled, ['state: () => ({ phase, move, result, stars, level }),', 'state: () => ({ phase, move, result, stars }),'])],
  ['Try again that does nothing once the last level is played', 'fix:level', swap(leveled, ["{ label: 'Try again', id: 'again', onPress() { begin(); } }", "{ label: 'Try again', id: 'again', onPress() { if (level < 3) begin(); } }"])],
];
for (const [what, expected, code] of levelsBroken) {
  const result = run(code);
  if (!result.ok || rulesOf(result) !== expected) {
    console.error(`expected ${what} to give ${expected}, got ${rulesOf(result) || 'nothing'}`, result.error ?? JSON.stringify(result.stats?.play, null, 1));
    process.exit(1);
  }
}

// The learning game's starter (new-game.mjs), untouched: it plays through, every level with a star.
const work = mkdtempSync(join(tmpdir(), 'starter-'));
try {
  const made = spawnSync('node', [fileURLToPath(new URL('../agent_skills/play/learning-game/scripts/new-game.mjs', import.meta.url)), 'plain', join(work, 'module.js')], { encoding: 'utf8' });
  if (made.status !== 0) throw new Error(made.stdout + made.stderr);
  const starter = run(readFileSync(join(work, 'module.js'), 'utf8'));
  const levels = starter.stats?.play?.rounds.levels ?? [];
  if (!starter.ok || !starter.stats?.play?.ok || levels.length !== 3 || levels.some((r) => !(Number(r.stars) > 0))) {
    console.error("expected the learning game's starter to play through all three of its levels", starter.error ?? JSON.stringify(starter.stats?.play, null, 1));
    process.exit(1);
  }
  // A game with LEVELS that does not say so in its play block is still held to its play-through's findings: here
  // its round never ends, and the check fails it as well as noting the missing `levels`.
  const ending = "    if (phase === 'play' && touched.size === targets.length) finish();";
  const own = readFileSync(join(work, 'game.js'), 'utf8');
  if (!own.includes(ending) || !own.includes('levels: LEVELS.length,')) throw new Error('test-play: the starter no longer has the lines this test breaks');
  writeFileSync(join(work, 'game.js'), own.replace('levels: LEVELS.length,', '').replace(ending, ''));
  const checked = spawnSync('node', [fileURLToPath(new URL('../agent_skills/play/learning-game/scripts/check.mjs', import.meta.url)), join(work, 'module.js')], {
    encoding: 'utf8',
    env: { ...process.env, GATE_TSX: fileURLToPath(new URL('./node_modules/.bin/tsx', import.meta.url)), GATE_ENTRY: gate },
  });
  if (checked.status === 0 || !/levels: LEVELS.length/.test(checked.stdout) || !/^FIX: Play: .*did not end/m.test(checked.stdout)) {
    console.error('expected the check to note LEVELS without `levels` and still fail the round that never ends', checked.stdout.slice(0, 3000));
    process.exit(1);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(`play ok: ${broken.length + later.length + levelsBroken.length + 3} broken games caught; ball ${play.rounds.played?.result?.toFixed(2)} s, toss ${thrown.stats.play.rounds.played?.result?.toFixed(2)} m; the starter's 3 levels won`);
