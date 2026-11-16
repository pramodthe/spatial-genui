// Worked example (paper pop-up): why bread rises. Built on the look kit and paperPopUpLook (pasted above it by
// new-lesson.mjs); passes scripts/check.mjs. Take its method, not its subject:
// - one spread per stage (mix, rise, bake), the subject big in the middle on V-folds, the page turn as the arrow of
//   time, the stage's line on a paper ribbon;
// - the change happens on the spot under the learner's hand: lift the yeast flap to see it is alive, pull the tab to
//   let an hour pass and watch the dough reach the 2x line, press the oven to bake, lift the crust to see the holes;
// - true numbers (500 g, 300 ml, 7 g, an hour to double, 220 C for 30 minutes) in the scene and on the panel;
// - each step asks one question the spread answers; nothing allocated in update().
export default function build({ THREE, kit, traits, ui, isGrabbed }) {
  const root = new THREE.Group();
  const look = paperPopUpLook(THREE, kit);
  const S = look.shape;
  const book = look.set({ spreads: 3 });
  root.add(book);
  const [mix, rise, bake] = book.spreads;
  const DOUGH = '#f2d9a6';

  // A kitchen wall at the back of a spread: a V-fold that is almost a flat wall.
  const wall = (sp, extra) => look.vFold(sp, { z: -0.07, alpha: 80, name: 'Kitchen wall' }, [
    look.card(S.rect(-0.15, 0, 0.3, 0.12, 0.006), 'sky', 'Wall'),
    front(look.card(S.rect(-0.15, 0.002, 0.3, 0.006), 'navy', 'Skirting')),
    ...extra,
  ]);
  const front = (card, z = 0.0016) => { card.position.z = z; return card; };   // a print 1 card in front
  const at = (card, x, y, z = 0.0016) => { card.position.set(x, y, z); return card; };
  // The bowl: a coral cut-out with a cream rim, on its own V-fold in front of whatever is in it.
  const bowl = (sp) => look.vFold(sp, { z: 0.02, alpha: 62, name: 'Bowl' }, [
    look.card([[-0.05, 0], [0.05, 0], [0.066, 0.035], [-0.066, 0.035]], 'coral', 'Bowl', { margin: true }),
    front(look.card(S.rect(-0.07, 0.03, 0.14, 0.007, 0.003), 'cream', 'Rim')),
  ]);
  // A gingham band printed along the front of both pages, glued into one mesh per page.
  const tablecloth = (sp) => {
    for (const side of [-1, 1]) {
      const g = new THREE.Group();
      g.name = 'Tablecloth';
      g.add(look.flat(S.rect(side < 0 ? -0.185 : 0.003, 0.092, 0.182, 0.028), 'pink', 'Tablecloth'));
      for (let x = 0.012; x < 0.18; x += 0.02) g.add(look.flat(S.rect(side * x - 0.005, 0.1, 0.01, 0.01), 'cream', 'Check', { level: 1 }));
      (side < 0 ? sp.left : sp.right).add(g);
      look.glue(g);
    }
  };
  const tag = (text, parent, x, y) => { const t = kit.card(text, { color: look.PAL.navy }); t.position.set(x, y, 0.005); parent.add(t); return t; };

  // ---- Spread 1: mix. Flour and water stand on parallel folds in front of the wall; the yeast packet is a flap.
  const w1 = wall(mix, [front(look.card(S.rect(-0.045, 0.05, 0.09, 0.045, 0.004), 'cream', 'Window')), front(look.card(S.circle(0.02, 0.08, 0.009), 'yellow', 'Sun'), 0.0032)]);
  const flour = look.box(mix, w1, { side: -1, depth: 0.05, strap: 0.03, name: 'Flour' }, [
    look.card(S.rect(-0.14, 0, 0.055, 0.07, 0.01), 'cream', 'Flour sack', { margin: true }),
    front(look.card(S.rect(-0.13, 0.064, 0.035, 0.008, 0.003), 'amber', 'Sack tie')),
    at(look.number('500', 'navy', 'Flour 500 g', { h: 0.016 }), -0.13, 0.025),
  ]);
  tag('Flour 500 g', flour.group, -0.112, 0.09);
  const jug = look.box(mix, w1, { side: 1, depth: 0.05, strap: 0.03, name: 'Water' }, [
    look.card(S.rect(0.085, 0, 0.045, 0.065, 0.008), 'cream', 'Jug', { margin: true }),
    front(look.card(S.rect(0.089, 0.004, 0.037, 0.042, 0.005), 'sky', 'Water')),
    look.card(S.rect(0.128, 0.015, 0.012, 0.04, 0.004), 'navy', 'Handle'),
  ]);
  tag('Water 300 ml', jug.group, 0.108, 0.085);
  look.vFold(mix, { z: 0.006, alpha: 62, name: 'Flour heap' }, [look.card(S.ellipse(0, 0.034, 0.058, 0.02), 'card', 'Flour in the bowl')]);
  bowl(mix);
  const yeast = look.flap(mix.right, { x: 0.12, z: 0.035, w: 0.06, d: 0.05, colour: 'yellow', name: 'Yeast packet' });
  yeast.top.add(look.flat(S.rect(-0.03, 0.006, 0.06, 0.008), 'navy', 'Packet stripe'));
  const seven = look.number('7', 'navy', 'Yeast 7 g', { h: 0.022 });
  seven.rotation.x = -Math.PI / 2;                       // lying on the lid, read from the front
  seven.position.set(-0.006, 0.0012, 0.042);
  yeast.top.add(seven);
  yeast.under.add(look.flat(S.rect(-0.027, 0.003, 0.054, 0.044, 0.003), 'cream', 'Inside the packet'));
  for (const [x, z, r] of [[-0.014, 0.012, 0.006], [0.008, 0.016, 0.007], [-0.006, 0.032, 0.006], [0.015, 0.035, 0.005]]) {
    yeast.under.add(look.flat(S.circle(x, z, r, 16), 'honey', 'Yeast cell', { level: 1 }));
    yeast.under.add(look.flat(S.circle(x + r * 0.9, z - r * 0.6, r * 0.45, 12), 'honey', 'Bud', { level: 1 }));
  }
  look.glue(yeast.under);
  tablecloth(mix);
  look.ribbon(mix, 'Mix flour, water, yeast');

  // ---- Spread 2: rise. A height chart on the wall, a clock on a paper arm, and the dough in the bowl, which the
  // pull tab grows: an hour passes, the gas the yeast breathes out swells the bubbles, the dough doubles.
  const w2 = wall(rise, [
    front(look.card(S.rect(-0.1, 0.05, 0.2, 0.0025), 'navy', '1x line')), front(look.card(S.rect(-0.1, 0.1, 0.2, 0.0025), 'navy', '2x line')),
    at(look.number('1X', 'navy', '1x', { h: 0.012 }), -0.14, 0.045), at(look.number('2X', 'navy', '2x', { h: 0.012 }), -0.14, 0.095),
  ]);
  const clock = look.float(rise, w2, { side: 1, at: [0.115, 0.075], gap: 0.012, name: 'Clock' }, [
    look.card(S.circle(0.115, 0.075, 0.022), 'navy', 'Clock rim'), front(look.card(S.circle(0.115, 0.075, 0.018), 'cream', 'Clock face')),
  ]);
  const hand = look.card(S.rect(-0.0015, 0, 0.003, 0.015, 0.0012), 'coral', 'Minute hand');
  hand.position.set(0.115, 0.075, 0.0035);
  clock.group.add(hand);
  const bubbles = [[-0.03, 0.03, 0.004], [0.012, 0.04, 0.005], [-0.008, 0.02, 0.0035], [0.03, 0.026, 0.004], [-0.018, 0.043, 0.003], [0.002, 0.03, 0.003]];
  const dough = look.vFold(rise, { z: 0.008, alpha: 62, name: 'Dough' }, [
    look.card(S.ridge(-0.058, 0.058, (x) => 0.05 * Math.sqrt(Math.max(0, 1 - (x / 0.06) ** 2))), DOUGH, 'Dough'),
    ...bubbles.map(([x, y, r]) => front(look.card(S.circle(x, y, r, 14), 'card', 'Gas bubble'))),
  ]);
  const b2 = bowl(rise);
  tag('Gas bubbles (CO2)', b2.right, 0.11, 0.055);
  const tab = look.pullTab(rise.right, { x: 0.12, z: 0.065, length: 0.05, name: 'Time tab' });
  tablecloth(rise);
  look.ribbon(rise, 'Wait one hour');

  // ---- Spread 3: bake. The oven, the loaf in its window (pale, then golden), and a slice whose crust lifts.
  const oven = look.vFold(bake, { z: -0.04, alpha: 76, name: 'Oven' }, [
    look.card(S.rect(-0.085, 0, 0.17, 0.13, 0.008), 'navy', 'Oven'),
    front(look.card(S.rect(-0.08, 0.104, 0.16, 0.021, 0.004), 'deep', 'Controls')),
    front(look.card(S.rect(-0.065, 0.02, 0.13, 0.07, 0.006), '#1b2a3d', 'Window')),
    front(look.card(S.wave(-0.06, 0.06, 0.08, 0.002, 6, 0.004), 'coral', 'Heater'), 0.0032),
    front(look.card(S.circle(-0.06, 0.1145, 0.005, 14), 'yellow', 'Dial'), 0.0032),
    at(look.number('220C', 'yellow', '220 C', { h: 0.013 }), 0.005, 0.108, 0.0032),
  ]);
  const loafShape = S.ridge(-0.045, 0.045, (x) => 0.026 + 0.034 * Math.sqrt(Math.max(0, 1 - (x / 0.047) ** 2)), 0.026);
  const pale = look.vFold(bake, { z: -0.034, alpha: 76, name: 'Loaf (raw)' }, [look.card(loafShape, DOUGH, 'Raw loaf')]);
  const golden = look.vFold(bake, { z: -0.034, alpha: 76, name: 'Loaf (baked)' }, [
    look.card(loafShape, 'amber', 'Baked loaf'),
    ...[-0.02, 0, 0.02].map((x) => front(look.card(S.leaf(x - 0.006, 0.05, 0.014, 0.5, 0.2), 'honey', 'Score'))),
  ]);
  const slice = look.flap(bake.right, { x: 0.125, z: 0.035, w: 0.064, d: 0.05, colour: 'amber', name: 'Slice' });
  slice.top.add(look.flat(S.rect(-0.026, 0.006, 0.052, 0.038, 0.01), 'honey', 'Crust'));
  slice.under.add(look.flat(S.rect(-0.03, 0.002, 0.06, 0.046, 0.012), DOUGH, 'Crumb'));
  for (const [x, z, r] of [[-0.016, 0.012, 0.004], [0.006, 0.01, 0.003], [0.014, 0.024, 0.005], [-0.008, 0.03, 0.0035], [0.004, 0.038, 0.003], [-0.02, 0.036, 0.003]]) {
    slice.under.add(look.flat(S.circle(x, z, r, 12), 'card', 'Hole', { level: 1 }));
  }
  look.glue(slice.under);
  tablecloth(bake);
  look.ribbon(bake, 'Bake: 220 C, 30 min');

  // ---- Steps: one spread each, one question each.
  const STEPS = [
    { title: 'What goes in?', text: 'Bread is 500 g flour, 300 ml warm water, 7 g yeast and a pinch of salt. Lift the yellow yeast packet: what is inside?', stat: '500 g + 300 ml + 7 g', label: 'flour + water + yeast' },
    { title: 'What makes it rise?', text: 'Pull the tab to let an hour go by. Watch the dough and the 2x line on the wall.', stat: '0 min', label: 'time in a warm room' },
    { title: 'What does the oven do?', text: 'Press the oven to bake it. Then lift the crust of the slice.', stat: '220 C', label: 'oven, 30 minutes' },
  ];
  const RISE = [];
  for (let m = 0; m <= 60; m += 5) RISE.push(`${m} min: dough x${(1 + m / 60).toFixed(1)}`);
  const BAKE = [];
  for (let m = 0; m <= 30; m += 5) BAKE.push(`${m} of 30 min`);
  let step = 0;
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  const big = Math.max(size.x, size.y, size.z);
  const right = new THREE.Box3().setFromObject(root).max.x;
  const panel = kit.panel(ui, {
    width: 0.3, position: [Math.max(1.06 * big, right + 0.05), 0.6 * big, 0], rotationY: -0.3,
    eyebrow: 'BREAD', title: 'Why bread rises',
    items: [
      { status: STEPS[0].title, tone: 'neutral', id: 'state' },
      { text: STEPS[0].text, id: 'info' },
      { stat: STEPS[0].stat, label: STEPS[0].label, id: 'stat' },
      { buttons: [{ label: 'Back', onPress() { go(step - 1); } }, { label: 'Next', onPress() { go(step + 1); } }] },
      { note: 'Press the coral corner tabs to turn the page.' },
    ],
  });
  root.add(panel.object3D);
  function go(n) {
    step = Math.max(0, Math.min(STEPS.length - 1, n));
    book.turnTo(step);
    panel.set('state', STEPS[step].title);
    panel.set('info', STEPS[step].text);
    panel.set('stat', STEPS[step].stat);
    shownRise = -1;
  }

  // ---- Hands: corners turn the page; the flaps lift; the tab is pulled; the oven is pressed.
  traits(book.next, { onPress() { go(step + 1); } });
  traits(book.back, { onPress() { go(step - 1); } });
  traits(yeast.object, {
    onPress() {
      yeast.toggle();
      if (yeast.open) panel.set('info', 'Yeast is alive: billions of tiny fungus cells. In the warm wet dough they eat sugar from the flour and breathe out carbon dioxide gas.');
    },
  });
  traits(tab.object, { grab: true });
  let baking = false;
  let baked = 0;
  traits(oven.group, {
    onPress() {
      if (baking || baked >= 1) { baked = 0; baking = false; panel.set('stat', BAKE[0]); return; }
      baking = true;
      panel.set('info', 'In the heat the gas swells once more (the oven spring), then the dough sets and the crust browns.');
    },
  });
  traits(slice.object, {
    onPress() {
      slice.toggle();
      if (slice.open) panel.set('info', 'Every hole in the slice is a gas bubble the yeast made, baked in place. No yeast, no holes: flat bread.');
    },
  });

  let shownRise = -1;
  let shownBake = -1;
  return {
    root,
    update(time, delta) {
      book.update(time, delta);
      yeast.update(delta);
      slice.update(delta);
      tab.update(isGrabbed, delta);
      // An hour on the tab: the dough's height doubles (in a straight-sided bowl, height is volume), the clock turns.
      const k = tab.k;
      dough.left.scale.set(1 + 0.12 * k, 1 + k, 1);
      dough.right.scale.set(1 + 0.12 * k, 1 + k, 1);
      hand.rotation.z = -k * Math.PI * 2;
      const r = Math.round(k * 12);
      if (step === 1 && r !== shownRise) {
        shownRise = r;
        panel.set('stat', RISE[r]);
        if (r === 12) panel.set('state', 'Doubled in an hour', 'good');
        else panel.set('state', STEPS[1].title);
      }
      // Baking: 30 minutes in 3 seconds. The loaf springs up 15 % and turns golden half way.
      if (baking) {
        baked = Math.min(1, baked + delta / 3);
        if (baked >= 1) { baking = false; panel.set('state', 'Baked', 'good'); }
      }
      const b = Math.round(baked * 6);
      if (b !== shownBake) { shownBake = b; if (step === 2) panel.set('stat', BAKE[b]); }
      const spring = 1 + 0.15 * lookBack(lookSeg(baked, 0, 0.6), 1.5);
      pale.group.visible = baked < 0.5;
      golden.group.visible = baked >= 0.5;
      pale.left.scale.y = pale.right.scale.y = golden.left.scale.y = golden.right.scale.y = spring;
    },
  };
}
