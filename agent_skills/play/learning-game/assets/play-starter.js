// Starter learning game (scripts/new-game.mjs puts the look kit, the look, the play kit, the parts and this file
// together and fills in __LOOK__). It runs as it is, with the look's demo pieces. Replace the demo, MOVES and
// CHALLENGE; the game's name, pitch and colours come from IDENTITY and its sounds from SOUNDS (the parts above,
// /work/parts; references/parts.md). Keep the shape: learn by doing (one hand action per move, each with its why),
// then the same idea as a challenge with a measured result, stars and Try again. Nothing scores before Start;
// nothing is allocated in update().
export default function build({ THREE, kit, traits, ui, isGrabbed, hands, sound }) {
  const root = new THREE.Group();
  // Desk or world (new-game.mjs --world; references/world.md). A world is built in the same desk units around the
  // player's spot (the origin, facing -Z) and shown 12 times bigger: the place starts a little ahead of them.
  const WORLD = __WORLD__;
  // Sound answers the hands: sfx.fire(event) plays what SOUNDS lists for it (parts/sounds.js); silent without a host sound.
  const sfx = playSounds(sound, SOUNDS);
  const look = __LOOK__(THREE, kit);

  // The ground of the look on the desk. Never grabbable.
  const set = look.set();
  root.add(set);

  // Everything the game is about stands in here, on top of the set.
  const subject = new THREE.Group();
  subject.name = 'Subject';
  subject.userData.subject = true;
  subject.position.y = set.userData.top;
  root.add(subject);
  if (WORLD) {
    set.position.z -= 0.25;
    subject.position.z -= 0.25;
  }


  // REPLACE: build the game's pieces in the look (the thing the player handles is big and in front), and list the
  // hand targets: { object, grab: true } for pieces the player moves, { object, press: true } for things they press.
  const targets = look.demo(subject);

  // Learn by doing: one hand action per move. done() says when the player has done it; then the scene answers (a pop
  // and a burst on the piece) and the panel shows why it matters. `target` is the piece Show me points at.
  // REPLACE the moves (references/design.md).
  const MOVES = [
    { say: 'Pick up a piece, or press one.', why: 'REPLACE: why this move matters, in one short line.', target: 0, done: () => touched.size > 0 },
  ];
  // The challenge: the same idea, now measured. Stars by thresholds: [one star, two, three]. REPLACE.
  const CHALLENGE = { say: 'Touch every piece, fast.', label: 'seconds', stars: [20, 10, 5], lowerIsBetter: true };

  let phase = 'learn'; // learn -> ready -> play -> done
  let move = 0;
  let clock = 0;
  let shown = 0;
  let nudge = 0;
  let best = null;
  let lastResult = null;
  let lastStars = null;
  const touched = new Set();

  // The panel stands to the right of the game, in reach (the host scales the 3D so its largest size is 0.5 m and the
  // panel's position scales with it).
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const big = Math.max(size.x, size.y, size.z);
  const panel = kit.panel(ui, {
    width: 0.3, position: [Math.max(1.06 * big, box.max.x + 0.05), 0.6 * big, 0], rotationY: -0.3, eyebrow: IDENTITY.eyebrow, title: IDENTITY.title, skin: IDENTITY.skin,
    items: [
      { text: IDENTITY.pitch, id: 'goal' },
      { status: MOVES[0].say, tone: 'neutral', id: 'state' },
      { text: 'Do it with your hands: the why shows up here.', id: 'why' },
      { progress: 0, label: `0 of ${MOVES.length}`, id: 'moves' },
      { stat: '-', label: CHALLENGE.label, id: 'result' },
      { stat: '-', label: 'best', id: 'best' },
      { buttons: [
        { label: 'Start', id: 'start', onPress() { start(); } },
        { label: 'Try again', id: 'again', onPress() { start(); } },
        { label: 'Show me', id: 'hint', onPress() { showMe(); } },
      ] },
    ],
  });
  root.add(panel.object3D);
  panel.show('start', false);
  panel.show('again', false);

  // Rewards: stars over the game when a challenge ends, a burst and a pop when a move is done.
  const stars = playStars(THREE);
  stars.position.set((box.min.x + box.max.x) / 2, box.max.y + 0.04, box.min.z + 0.02);
  root.add(stars);
  const burst = playBurst(THREE, root);
  const pops = playPop();
  // Game feel in the world, not only on the panel: an arrow over the next thing to touch, a Start button on the
  // playfield (in front, where the hand already is), a ring where the result happened.
  // A world shows everything 12 times bigger: the pointer and the Start button stay hand-sized there.
  const pointer = playPointer(THREE, WORLD ? { size: 0.4 } : {});
  root.add(pointer);
  const ring = playRing(THREE, root);
  // The game's name: the app shows IDENTITY.title as a title card when the game opens, then it fades; the game builds
  // no title sign. A result sign pops up where a result happened.
  const resultSign = kit.sign('3 OF 3 STARS', { width: 0.16, ...IDENTITY.resultSign, sub: CHALLENGE.label });
  resultSign.visible = false;
  root.add(resultSign);
  const startButton = playStartButton(THREE, WORLD ? { size: 0.025 } : {});
  startButton.position.set(box.min.x + 0.06, set.userData.top, box.max.z - 0.05);
  startButton.visible = false;
  root.add(startButton);
  traits(startButton, { onPress() { if (phase === 'ready' || phase === 'done') { startButton.userData.press(); start(); } } });
  const at = new THREE.Vector3();
  function cheer(object) {
    sfx.fire('cheer');
    pops.pop(object);
    object.getWorldPosition(at);
    root.worldToLocal(at);
    burst.fire(at.x, at.y, at.z);
  }

  // Hands: a press or the start of a grab touches a piece; a grabbed piece let go near its place slides home.
  const held = [];
  targets.forEach((t, i) => {
    if (t.grab) {
      traits(t.object, { grab: true });
      held.push({ i, object: t.object, was: false, seat: lookSeat(THREE, t.object, isGrabbed) });
    } else if (t.press) {
      traits(t.object, { onPress() { touch(i); } });
    }
  });
  function touch(i) {
    touched.add(i);
    sfx.fire('touch');
    pops.pop(targets[i].object, 0.1);
    if (phase === 'play' && touched.size === targets.length) finish();
  }

  pointer.userData.at(targets[MOVES[0].target ?? 0].object);
  function nextMove() {
    cheer(targets[MOVES[move].target ?? 0].object);
    panel.set('why', MOVES[move].why);
    move++;
    panel.set('moves', move / MOVES.length);
    if (move < MOVES.length) {
      panel.set('state', MOVES[move].say, 'neutral');
      pointer.userData.at(targets[MOVES[move].target ?? 0].object);
      return;
    }
    phase = 'ready';
    startButton.visible = true;
    pointer.userData.at(startButton);
    panel.set('state', `${CHALLENGE.say} Press Start.`, 'good');
    panel.show('start', true);
  }
  function start() {
    sfx.fire('start');
    sfx.fire('music'); // the game's music loop, when it has one (SOUNDS.music)
    phase = 'play';
    clock = 0;
    shown = 0;
    touched.clear();
    stars.userData.hide();
    resultSign.visible = false;
    startButton.visible = false;
    pointer.userData.at(null);
    panel.set('state', CHALLENGE.say, 'neutral');
    panel.set('result', '0.0');
    panel.show('start', false);
    panel.show('again', false);
  }
  function finish() {
    phase = 'done';
    const result = clock;
    best = best === null ? result : CHALLENGE.lowerIsBetter ? Math.min(best, result) : Math.max(best, result);
    const k = playStarsFor(result, CHALLENGE.stars, CHALLENGE.lowerIsBetter);
    lastResult = result;
    lastStars = k;
    stars.userData.show(k);
    sfx.stop('music');
    sfx.fire(k > 0 ? 'win' : 'miss');
    // REPLACE: the ring and the confetti go where the result happened (the landing point, the last catch).
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    ring.at(cx, set.userData.top, cz);
    resultSign.userData.setText(`${k} OF 3 STARS`, `${result.toFixed(1)} ${CHALLENGE.label}`);
    resultSign.position.set(cx, set.userData.top + 0.09, cz + 0.02);
    resultSign.visible = true;
    pops.pop(resultSign, 0.3);
    if (k === 3) burst.fire(cx, set.userData.top + 0.05, cz, true);
    startButton.visible = true;
    pointer.userData.at(startButton);
    panel.set('result', result.toFixed(1));
    panel.set('best', best.toFixed(1));
    panel.set('state', k === 3 ? 'Three stars!' : `${k} of 3 stars. Try again to beat ${best.toFixed(1)}.`, k >= 2 ? 'good' : 'neutral');
    panel.show('again', true);
  }
  function showMe() {
    const t = targets[phase === 'learn' ? MOVES[move].target ?? 0 : 0];
    if (t) cheer(t.object);
  }

  // A world: the land around the game (world-kit.js), added after the game is measured, so the mountains do not move
  // its signs and buttons. Flat where the player starts and where the game stands, a path between, trees and rocks
  // round about, mountains at the edge. REPLACE the land to suit the place (references/world.md).
  if (WORLD) {
    const start = { x: 0, z: 0, r: 0.1 };
    const plaza = { x: 0, z: -0.25, r: 0.22 };
    const land = worldTerrain(THREE, { seed: 3, flat: [start, plaza], hills: [{ x: -0.7, z: -0.8, r: 0.35, h: 0.16 }, { x: 0.8, z: -0.45, r: 0.3, h: 0.1 }] });
    root.add(
      land,
      worldPath(THREE, land, [[0, 0.04], [0, -0.04]]),
      worldScatter(THREE, land, 'pine', { count: 36, from: 0.45, to: 1.1, avoid: [start, plaza], seed: 5 }),
      worldScatter(THREE, land, 'rock', { count: 14, from: 0.3, to: 1.0, avoid: [start, plaza], seed: 9 }),
      worldEdge(THREE, { kind: 'mountains' }),
    );
  }

  // How a hand plays this game, for the check's play-through (references/play.md): one gesture for each move, in
  // order, then the gestures of one round. The check does them with a simulated hand and fails when a move does not
  // register, the round gives no result, or it scores without the hand. REPLACE the gestures with the game's own.
  const touchOf = (i) => (targets[i].grab ? { grab: targets[i].object } : { press: targets[i].object });

  return {
    root,
    // A world's sky (day, dawn, dusk, night, overcast) and ground (grass, sand, snow, rock): references/world.md.
    ...(WORLD ? { mode: 'world', sky: 'day', ground: 'grass' } : {}),
    play: {
      learn: MOVES.map((m) => touchOf(m.target ?? 0)),
      challenge: targets.map((_, i) => touchOf(i)),
      state: () => ({ phase, move, result: phase === 'done' ? lastResult : null, stars: phase === 'done' ? lastStars : null }),
    },
    update(time, delta) {
      const dt = Math.min(delta, 0.05);
      if (look.update) look.update(time);
      for (const h of held) {
        const now = isGrabbed(h.object);
        if (now && !h.was) touch(h.i);
        h.was = now;
        h.seat.update(dt);
      }
      if (phase === 'learn' && MOVES[move].done()) nextMove();
      // While the player is learning, the piece to try next gives a small bounce now and then: always clear where to start.
      nudge -= dt;
      if (phase === 'learn' && nudge <= 0) {
        nudge = 2.5;
        pops.pop(targets[MOVES[move].target ?? 0].object, 0.06);
      }
      if (phase === 'play') {
        clock += dt;
        if (clock - shown >= 0.1) { shown = clock; panel.set('result', clock.toFixed(1)); }
      }
      pops.update(dt);
      burst.update(dt);
      stars.userData.update(dt);
      ring.update(dt);
      startButton.userData.update(dt);
      pointer.userData.update(time);
    },
  };
}
