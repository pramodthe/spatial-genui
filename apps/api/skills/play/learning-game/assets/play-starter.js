// Starter learning game (scripts/new-game.mjs puts the look kit, the look, the play kit and this file together and
// fills in __LOOK__). It runs as it is, with the look's demo pieces. Replace the demo, TITLE, GOAL, MOVES and
// CHALLENGE; keep the shape: learn by doing (one hand action per move, each with its why), then the same idea as a
// challenge with a measured result, stars and Try again. Nothing scores before Start; nothing is allocated in update().
export default function build({ THREE, kit, traits, ui, isGrabbed, hands, sound }) {
  const root = new THREE.Group();
  // Sound answers the hands (/skills/common/sound); silent where the host has none.
  const sfx = sound ?? { play() {}, tone() {}, note() {}, hum() {} };
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

  // REPLACE: a title (2 to 4 words) and the goal in one sentence the player could repeat.
  const TITLE = 'Piece by piece';
  const GOAL = 'Learn each piece, then touch them all against the clock.';

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
  const touched = new Set();

  // The panel stands to the right of the game, in reach (the host scales the 3D so its largest size is 0.5 m and the
  // panel's position scales with it).
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const big = Math.max(size.x, size.y, size.z);
  const panel = kit.panel(ui, {
    width: 0.3, position: [Math.max(1.06 * big, box.max.x + 0.05), 0.6 * big, 0], rotationY: -0.3, eyebrow: 'PLAY AND LEARN', title: TITLE,
    items: [
      { text: GOAL, id: 'goal' },
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
  const at = new THREE.Vector3();
  function cheer(object) {
    sfx.play('good');
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
    sfx.play('click');
    pops.pop(targets[i].object, 0.1);
    if (phase === 'play' && touched.size === targets.length) finish();
  }

  function nextMove() {
    cheer(targets[MOVES[move].target ?? 0].object);
    panel.set('why', MOVES[move].why);
    move++;
    panel.set('moves', move / MOVES.length);
    if (move < MOVES.length) {
      panel.set('state', MOVES[move].say, 'neutral');
      return;
    }
    phase = 'ready';
    panel.set('state', `${CHALLENGE.say} Press Start.`, 'good');
    panel.show('start', true);
  }
  function start() {
    sfx.play('whoosh');
    phase = 'play';
    clock = 0;
    shown = 0;
    touched.clear();
    stars.userData.hide();
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
    stars.userData.show(k);
    sfx.play(k > 0 ? 'win' : 'bad', { volume: k > 0 ? 0.8 : 0.3 });
    panel.set('result', result.toFixed(1));
    panel.set('best', best.toFixed(1));
    panel.set('state', k === 3 ? 'Three stars!' : `${k} of 3 stars. Try again to beat ${best.toFixed(1)}.`, k >= 2 ? 'good' : 'neutral');
    panel.show('again', true);
  }
  function showMe() {
    const t = targets[phase === 'learn' ? MOVES[move].target ?? 0 : 0];
    if (t) cheer(t.object);
  }

  return {
    root,
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
    },
  };
}
