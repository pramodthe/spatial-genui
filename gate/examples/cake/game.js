// ---- parts (from /work/parts, joined by scripts/assemble.mjs: edit the part files, not this block) ----
// ---- end of parts ----

// Rise and Bake: the worked example of agent_skills/design/xr-design-doc/references/example-cake.md, built as a real
// learning game. Three hand actions, each learned in its own move before the round uses it: place (the butter into
// the bowl), pour by tipping (the sugar jug, with handPour) and stir (the whisk, with handStir). The round uses them
// again: pour the flour, fold it in, place the bowl in the oven. The oven and the cake heat by Newton's law
// (motionHeat): a hot oven sets the cake before its air escapes, so the rise in cm depends on the air beaten in, the
// flour weighed out, a gentle fold and the heat. Three levels, each changing one setting.
export default function build({ THREE, kit, traits, ui, isGrabbed, sound }) {
  const root = new THREE.Group();
  const sfx = playSounds(sound, SOUNDS);
  const look = inkToonLook(THREE, kit);
  const set = look.set({ width: 0.62, depth: 0.5 });
  root.add(set);
  const ground = set.userData.top;
  const kitchen = new THREE.Group();
  kitchen.name = 'Kitchen';
  root.add(kitchen);

  // The moves: one gesture each, three kinds of hand action (place, pour, stir), each learned before the round.
  const MOVES = [
    { say: 'Put the butter in the bowl.', why: 'Butter holds the air you will beat in, so the sponge is soft.', done: () => butterIn },
    { say: 'Tip the sugar jug over the bowl: pour 100 g.', why: 'Sugar crystals cut tiny pockets in the butter that fill with air.', done: () => sugarDone },
    { say: 'Whisk the butter and sugar: two turns round the bowl.', why: 'Beating traps millions of small bubbles, and they lift the cake.', done: () => creamDone },
  ];
  const CHALLENGE = { say: 'Pour 100 g of flour, fold it in gently, then put the bowl in the hot oven.', label: 'cm rise' };
  // Levels: the same round with one setting changed. Stars in cm of rise.
  const LEVELS = [
    { name: 'Follow the card', guides: true, foldMost: 2.5, stars: [1.5, 2.5, 3.5] },
    { name: 'From memory', guides: false, foldMost: 2.5, stars: [1.5, 2.5, 3.5] },
    { name: 'Delicate sponge', guides: false, foldMost: 1.2, stars: [1.5, 2.5, 3.5] },
  ];
  const OVEN_C = 180; // the card's oven: 180 degrees, switched on when the round starts
  const SET_C = 95; // a sponge sets when its middle reaches about 95 degrees

  // The bowl, the hero: two eggs already in it. The mix inside fills and changes colour as the moves are done.
  const bowl = new THREE.Group();
  bowl.name = 'Bowl';
  bowl.add(look.turned([[0, 0], [0.044, 0], [0.065, 0.05], [0.065, 0.066], [0.061, 0.066], [0.059, 0.05], [0.041, 0.006], [0, 0.006]], 'persimmon', 'Bowl body', { halftone: true }));
  const mix = look.turned([[0, 0], [0.048, 0], [0.052, 0.01], [0, 0.01]], 'cream', 'Mix', { outline: false });
  mix.position.y = 0.007;
  bowl.add(mix);
  const fillLine = look.ink(new THREE.TorusGeometry(0.058, 0.0015, 6, 40), 'ink', 'Fill line', { outline: false });
  fillLine.rotation.x = Math.PI / 2;
  fillLine.position.y = 0.045;
  bowl.add(fillLine);
  kitchen.add(bowl);
  sceneAt(THREE, bowl, 'bowl', { ground });
  traits(bowl, { grab: true });

  const butter = look.box(0.045, 0.025, 0.035, 'mustard', 'Butter');
  kitchen.add(butter);
  sceneAt(THREE, butter, 'butter', { ground });
  traits(butter, { grab: true });

  const jug = (colour, name) => {
    const group = new THREE.Group();
    group.name = name;
    group.add(look.turned([[0, 0], [0.026, 0], [0.028, 0.08], [0.024, 0.085], [0, 0.085]], colour, `${name} body`, { halftone: true }));
    group.add(look.tube([[0.026, 0.07, 0], [0.04, 0.066, 0], [0.042, 0.03, 0], [0.027, 0.02, 0]], 0.0045, colour, `${name} handle`));
    kitchen.add(group);
    traits(group, { grab: true });
    return group;
  };
  const sugarJug = jug('teal', 'Sugar jug');
  sceneAt(THREE, sugarJug, 'sugarJug', { ground });
  const flourJug = jug('navy', 'Flour jug');
  sceneAt(THREE, flourJug, 'flourJug', { ground });

  // The whisk lies on the desk; its origin is the wires, the end that stirs.
  const whisk = new THREE.Group();
  whisk.name = 'Whisk';
  const wires = look.ball(0.017, 'navy', 'Whisk wires');
  wires.scale.set(1.3, 1, 1);
  const handle = look.rod(0.006, 0.07, 'charcoal', 'Whisk handle');
  handle.rotation.z = Math.PI / 2;
  handle.position.x = -0.055;
  whisk.add(wires, handle);
  kitchen.add(whisk);
  sceneAt(THREE, whisk, 'whisk', { ground });
  traits(whisk, { grab: true });

  // The oven: open at the front, a glowing back that shows the heat, steam once the cake bakes.
  const ovenBox = new THREE.Group();
  ovenBox.name = 'Oven';
  const wall = (w, h, d, x, y, z, name) => {
    const part = look.box(w, h, d, 'charcoal', name, { outline: false });
    part.position.set(x, y, z);
    ovenBox.add(part);
  };
  wall(0.2, 0.02, 0.16, 0, 0.01, 0, 'Oven floor');
  wall(0.2, 0.02, 0.16, 0, 0.14, 0, 'Oven top');
  wall(0.02, 0.12, 0.16, -0.09, 0.075, 0, 'Oven left');
  wall(0.02, 0.12, 0.16, 0.09, 0.075, 0, 'Oven right');
  wall(0.2, 0.12, 0.02, 0, 0.075, -0.07, 'Oven back');
  const heat = look.ink(new THREE.PlaneGeometry(0.15, 0.09), 'mustard', 'Oven heat', { outline: false, flat: true, own: true });
  heat.position.set(0, 0.075, -0.0595);
  ovenBox.add(heat);
  const steam = look.steam(0.05, { name: 'Oven steam' });
  steam.position.set(0, 0.15, 0);
  steam.visible = false;
  ovenBox.add(steam);
  // Where the bowl's middle goes when it is put in.
  const ovenSlot = new THREE.Object3D();
  ovenSlot.name = 'Oven shelf';
  ovenSlot.position.set(0, 0.054, 0.01);
  ovenBox.add(ovenSlot);
  kitchen.add(ovenBox);
  sceneAt(THREE, ovenBox, 'oven', { ground });

  // Where everything goes back to when it is put down anywhere else.
  const homes = new Map([bowl, butter, sugarJug, flourJug, whisk].map((o) => [o, { at: o.position.clone(), turn: o.quaternion.clone() }]));
  const goHome = (o) => {
    o.position.copy(homes.get(o).at);
    o.quaternion.copy(homes.get(o).turn);
  };

  // The hand actions and the physics, from the kits.
  const sugarPour = handPour(THREE, sugarJug, isGrabbed, { over: bowl, angle: 30, rate: 200, amount: 300 });
  const flourPour = handPour(THREE, flourJug, isGrabbed, { over: bowl, angle: 30, rate: 200, amount: 400 });
  const cream = handStir(THREE, whisk, isGrabbed, bowl);
  const fold = handStir(THREE, whisk, isGrabbed, bowl);
  const oven = motionHeat({ value: 20, setting: 20, rate: 0.35 });
  const cake = motionHeat({ value: 20, setting: 20, rate: 0.12 });
  const steps = motionSteps();

  let phase = 'learn'; // learn -> ready -> play -> done
  let move = 0;
  let level = 0;
  let butterIn = false;
  let sugarDone = false;
  let creamDone = false;
  let creamTurns = 0;
  let baking = false;
  let bakeClock = 0;
  let best = null;
  let lastResult = null;
  let lastStars = null;
  let nudge = 0;

  const tint = (colour, fill) => {
    mix.material = look.mat(colour);
    mix.scale.y = fill;
  };
  // How much a weight is off the card's 100 g, as a share of what the cake gets from it.
  const share = (grams, want) => Math.max(0, 1 - Math.abs(grams - want) / want);
  // The rise: the air beaten in and kept (whisked, the right amounts, folded gently), less what escapes before the
  // oven sets the cake. A hot oven sets it sooner, so more of the air is kept.
  const riseOf = (setSeconds) => {
    const whisked = Math.min(1, creamTurns / 2);
    const folded = fold.turns < 0.5 ? 0.7 : fold.turns <= LEVELS[level].foldMost ? 1 : 0.6;
    return 4.8 * whisked * share(sugarPour.poured, 100) * share(flourPour.poured, 100) * folded * Math.exp(-setSeconds / 40);
  };
  const near = (a, b, far) => {
    const p = new THREE.Box3().setFromObject(a).getCenter(new THREE.Vector3());
    const q = b.isObject3D && !b.isMesh && b.children.length === 0 ? b.getWorldPosition(new THREE.Vector3()) : new THREE.Box3().setFromObject(b).getCenter(new THREE.Vector3());
    return Math.hypot(p.x - q.x, p.z - q.z) < far && Math.abs(p.y - q.y) < 0.12;
  };
  // The bowl's middle onto the oven shelf, upright.
  const intoOven = () => {
    bowl.quaternion.copy(homes.get(bowl).turn);
    bowl.updateWorldMatrix(true, true);
    const middle = new THREE.Box3().setFromObject(bowl).getCenter(new THREE.Vector3());
    const shelf = ovenSlot.getWorldPosition(new THREE.Vector3());
    const origin = bowl.getWorldPosition(new THREE.Vector3()).add(shelf.sub(middle));
    bowl.position.copy(bowl.parent.worldToLocal(origin));
  };

  // The panel stands where the scene plan put it, beside the game.
  const at = scenePlace('panel');
  const panel = kit.panel(ui, {
    width: 0.3, position: [at.position[0], ground + at.position[1], at.position[2]], rotationY: at.turn, eyebrow: IDENTITY.eyebrow, title: IDENTITY.title, skin: IDENTITY.skin,
    items: [
      { text: IDENTITY.pitch, id: 'goal' },
      { status: MOVES[0].say, tone: 'neutral', id: 'state' },
      { text: 'Do it with your hands: the why shows up here.', id: 'why' },
      { progress: 0, label: `0 of ${MOVES.length}`, id: 'moves' },
      { stat: '-', label: CHALLENGE.label, id: 'result' },
      { stat: '-', label: 'best', id: 'best' },
      { stat: `1 of ${LEVELS.length}`, label: 'level', id: 'level' },
      { buttons: [
        { label: 'Start', id: 'start', onPress() { start(); } },
        { label: 'Next level', id: 'next', onPress() { nextLevel(); } },
        { label: 'Try again', id: 'again', onPress() { start(); } },
      ] },
    ],
  });
  root.add(panel.object3D);
  panel.show('start', false);
  panel.show('next', false);
  panel.show('again', false);

  const box = new THREE.Box3().setFromObject(kitchen);
  const stars = playStars(THREE);
  stars.position.set((box.min.x + box.max.x) / 2, box.max.y + 0.05, box.min.z + 0.02);
  root.add(stars);
  const burst = playBurst(THREE, root);
  const pops = playPop();
  const pointer = playPointer(THREE);
  root.add(pointer);
  const resultSign = kit.sign('3 OF 3 STARS', { width: 0.16, ...IDENTITY.resultSign, sub: CHALLENGE.label });
  resultSign.visible = false;
  root.add(resultSign);
  const startButton = playStartButton(THREE);
  kitchen.add(startButton);
  sceneAt(THREE, startButton, 'start', { ground });
  startButton.visible = false;
  traits(startButton, { onPress() { if (phase === 'ready' || phase === 'done') { startButton.userData.press(); start(); } } });
  const spot = new THREE.Vector3();
  function cheer(object) {
    sfx.fire('cheer');
    pops.pop(object);
    object.getWorldPosition(spot);
    root.worldToLocal(spot);
    burst.fire(spot.x, spot.y + 0.04, spot.z);
  }
  const targetOf = [butter, sugarJug, whisk];
  pointer.userData.at(butter);

  function nextMove() {
    cheer(bowl);
    panel.set('why', MOVES[move].why);
    move++;
    panel.set('moves', move / MOVES.length, `${move} of ${MOVES.length}`);
    if (move < MOVES.length) {
      panel.set('state', MOVES[move].say, 'neutral');
      pointer.userData.at(targetOf[move]);
      return;
    }
    phase = 'ready';
    startButton.visible = true;
    pointer.userData.at(startButton);
    panel.set('state', `${CHALLENGE.say} Press Start: the oven goes on.`, 'good');
    panel.show('start', true);
  }
  // A round, from the moment the creamed mix is ready: the flour, the fold and the bake are done again each time.
  function start() {
    sfx.fire('start');
    phase = 'play';
    flourPour.reset();
    fold.reset();
    baking = false;
    bakeClock = 0;
    oven.value = 20;
    cake.value = 20;
    for (const o of [bowl, flourJug, whisk]) goHome(o);
    tint('cream', 2);
    steam.visible = false;
    fillLine.visible = LEVELS[level].guides;
    stars.userData.hide();
    resultSign.visible = false;
    startButton.visible = false;
    pointer.userData.at(flourJug);
    panel.set('state', level > 0 ? `Level ${level + 1}, ${LEVELS[level].name}: ${CHALLENGE.say}` : CHALLENGE.say, 'neutral');
    panel.set('result', '-');
    panel.set('level', `${level + 1} of ${LEVELS.length}`);
    panel.show('start', false);
    panel.show('next', false);
    panel.show('again', false);
  }
  function nextLevel() {
    if (phase !== 'done' || !(lastStars > 0) || level >= LEVELS.length - 1) return;
    level++;
    best = null;
    panel.set('best', '-');
    start();
  }
  function finish(rise) {
    phase = 'done';
    baking = false;
    steam.visible = false;
    const result = Math.round(rise * 10) / 10;
    const k = playStarsFor(result, LEVELS[level].stars);
    best = best === null ? result : Math.max(best, result);
    lastResult = result;
    lastStars = k;
    tint('mustard', 1 + rise * 0.9);
    stars.userData.show(k);
    sfx.fire(k > 0 ? 'win' : 'miss');
    const centre = ovenBox.getWorldPosition(new THREE.Vector3());
    root.worldToLocal(centre);
    resultSign.userData.setText(`${k} OF 3 STARS`, `${result.toFixed(1)} ${CHALLENGE.label}`);
    resultSign.position.set(centre.x, centre.y + 0.12, centre.z + 0.04);
    resultSign.visible = true;
    pops.pop(resultSign, 0.3);
    if (k === 3) burst.fire(centre.x, centre.y + 0.08, centre.z, true);
    startButton.visible = true;
    pointer.userData.at(startButton);
    panel.set('result', result.toFixed(1));
    panel.set('best', best.toFixed(1));
    const more = k > 0 && level < LEVELS.length - 1;
    const next = more ? ` Next level: ${LEVELS[level + 1].name}.` : k > 0 ? ' Every level done!' : '';
    const why = k === 3 ? 'Three stars: the hot oven set it with the air inside!' : `${k} of 3 stars. Weigh 100 g, fold gently, and let the oven heat first.`;
    panel.set('state', `${why}${next}`, k >= 2 ? 'good' : 'neutral');
    panel.show('next', more);
    panel.show('again', true);
  }

  // The frame a hand lets go of a piece.
  const was = new Map();
  const letGo = (o) => {
    const now = Boolean(isGrabbed(o));
    const before = was.get(o) ?? false;
    was.set(o, now);
    return before && !now;
  };

  function learnStep(dt, put) {
    sugarPour.update(dt);
    cream.update(dt);
    if (put.butter) {
      if (!butterIn && near(butter, bowl, 0.06)) {
        butterIn = true;
        butter.visible = false;
        tint('mustard', 1);
        sfx.fire('plop');
      } else goHome(butter);
    }
    if (put.sugarJug) {
      goHome(sugarJug);
      if (butterIn && sugarPour.poured >= 90) {
        sugarDone = true;
        tint('mustard', 1.6);
      }
    }
    if (put.whisk) {
      goHome(whisk);
      if (sugarDone && cream.turns >= 1.9) {
        creamDone = true;
        creamTurns = cream.turns;
        tint('cream', 2);
      }
    }
    for (const name of ['flourJug', 'bowl']) if (put[name]) goHome(name === 'bowl' ? bowl : flourJug);
    if (MOVES[move].done()) nextMove();
  }

  function roundStep(dt, put) {
    if (!baking) {
      flourPour.update(dt);
      fold.update(dt);
      if (flourPour.flowing) tint('white', 2 + Math.min(1, flourPour.poured / 100) * 0.6);
    }
    if (put.flourJug) goHome(flourJug);
    if (put.whisk) goHome(whisk);
    if (put.sugarJug) goHome(sugarJug);
    if (put.bowl) {
      if (baking || near(bowl, ovenSlot, 0.07)) {
        intoOven();
        if (!baking) {
          baking = true;
          bakeClock = 0;
          cake.value = 20;
          steam.visible = true;
          pointer.userData.at(null);
          sfx.fire('oven');
          panel.set('state', 'Baking: the oven sets the air in the sponge.', 'neutral');
        }
      } else goHome(bowl);
    }
  }

  return {
    root,
    play: {
      learn: [
        { grab: butter, to: bowl },
        { grab: sugarJug, to: sugarPour.above, tilt: 70, until: () => sugarPour.poured >= 100 },
        { grab: whisk, path: cream.path(2), seconds: 2.5 },
      ],
      challenge: [
        { grab: flourJug, to: flourPour.above, tilt: 70, until: () => flourPour.poured >= 100 },
        { grab: whisk, path: fold.path(1), seconds: 1.5 },
        { grab: bowl, to: ovenSlot },
      ],
      levels: LEVELS.length,
      state: () => ({
        phase, move, result: phase === 'done' ? lastResult : null, stars: phase === 'done' ? lastStars : null, level: level + 1,
        // The values the design's checks name.
        sugarGrams: Math.round(sugarPour.poured), flourGrams: Math.round(flourPour.poured), creamTurns: Math.round(creamTurns * 10) / 10,
        foldTurns: Math.round(fold.turns * 10) / 10, ovenC: Math.round(oven.value), riseCm: lastResult,
      }),
    },
    update(time, delta) {
      const dt = Math.min(delta, 0.05);
      const put = { butter: letGo(butter), sugarJug: letGo(sugarJug), flourJug: letGo(flourJug), whisk: letGo(whisk), bowl: letGo(bowl) };
      if (phase === 'learn') learnStep(dt, put);
      else if (phase === 'play') roundStep(dt, put);
      else for (const [name, o] of [['butter', butter], ['sugarJug', sugarJug], ['flourJug', flourJug], ['whisk', whisk], ['bowl', bowl]]) if (put[name]) goHome(o);
      // The oven heats toward its setting once the round starts, and the cake toward the oven while it bakes.
      steps.run(dt, (h) => {
        oven.step(h, phase === 'play' ? OVEN_C : 20);
        if (!baking) return;
        bakeClock += h;
        cake.step(h, oven.value);
      });
      if (baking && cake.value >= SET_C) finish(riseOf(bakeClock));
      look.glow(heat, Math.min(1, Math.max(0, (oven.value - 20) / 160)));
      if (baking) mix.scale.y = 2 + (cake.value - 20) / (SET_C - 20) * riseOf(bakeClock) * 0.9;
      nudge -= dt;
      if (phase === 'learn' && nudge <= 0) {
        nudge = 2.5;
        pops.pop(targetOf[move], 0.06);
      }
      pops.update(dt);
      burst.update(dt);
      stars.userData.update(dt);
      startButton.userData.update(dt);
      pointer.userData.update(time);
    },
  };
}
