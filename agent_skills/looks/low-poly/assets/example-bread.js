// Worked example (low-poly): from a field of wheat to loaves in a shop. Built on the look kit and lowPolyLook (pasted
// above it by new-lesson.mjs); passes scripts/check.mjs. Take its method, not its subject:
// - each stage is a place on the island with a numbered paper flag the learner presses (field, mill, bakery, shop);
// - the quantity is in the landscape: crates of grain, sacks of flour and bran, a pile of loaves and a cut-paper count;
// - the learner runs the process by hand: pick up a crate, drop it on the mill's hopper, and the mill, the truck and the
//   bakery carry the result along the road (a traveller on a lookPath) until the shop's count changes;
// - true numbers (20 kg of grain = 15 kg of white flour + 5 kg of bran; 500 g of flour per loaf), counted from the
//   scene's state, so the panel and the piles always agree; nothing allocated in update().
export default function build({ THREE, kit, traits, ui, isGrabbed }) {
  const root = new THREE.Group();
  const look = lowPolyLook(THREE, kit);
  const set = look.set({ width: 0.48, depth: 0.34 });
  root.add(set);
  const subject = new THREE.Group();
  subject.name = 'Wheat to bread';
  subject.userData.subject = true;
  subject.position.y = set.userData.top;
  root.add(subject);

  // The place: mountains and woods at the back, so the ground is never an empty plain.
  const peak = look.mountain(0.05, 0.085, 'Mountain');
  peak.position.set(-0.17, 0, -0.105);
  const peak2 = look.mountain(0.035, 0.055, 'Small mountain', { snow: false });
  peak2.position.set(-0.115, 0, -0.125);
  const woods = look.forest([[0.03, -0.125], [0.065, -0.135, 0.8], [0.15, -0.125], [0.175, -0.1, 0.8], [0.0, -0.14, 0.7], [0.18, -0.07, 0.9]], 'Woods');
  const cloud = look.cloud('Cloud', { r: 0.028 });
  cloud.position.set(-0.12, 0.17, -0.09);
  subject.add(peak, peak2, woods, cloud);

  // Stage 1, the field: four crates of grain, 20 kg each, standing on the ploughed rows.
  const field = look.field(0.125, 0.115, 'Wheat field', { crop: 'ochre', rows: 6 });
  field.position.set(-0.13, 0, 0.05);
  subject.add(field);
  const grow = look.unfold(field, { from: [0.07, 0, 0] });
  const CRATE_KG = 20;
  const crates = [[-0.17, 0.012], [-0.095, 0.012], [-0.17, 0.087], [-0.095, 0.087]].map(([x, z], i) => {
    const c = look.crate(0.032, `Crate ${i + 1} (20 kg of grain)`, { fill: 'ochre' });
    c.position.set(x, 0.004, z);
    subject.add(c);
    return c;
  });

  // Stage 2, the mill: a windmill (built from facets, then merged) with sails that turn faster while it grinds, a
  // hopper in front where crates are tipped in, and the flour and bran it makes piled in the yard.
  const mill = new THREE.Group();
  mill.name = 'Mill';
  const towerGeo = new THREE.CylinderGeometry(0.017, 0.025, 0.072, 6);
  towerGeo.translate(0, 0.036, 0);
  const capGeo = new THREE.ConeGeometry(0.024, 0.026, 6);
  capGeo.translate(0, 0.085, 0);
  const doorGeo = new THREE.BoxGeometry(0.01, 0.018, 0.003);
  doorGeo.translate(0, 0.009, 0.023);
  mill.add(look.facet(towerGeo, 'paper', 'Mill tower', { ground: true }), look.facet(capGeo, 'accent', 'Mill cap'), look.facet(doorGeo, 'ink', 'Mill door', { jitter: 0 }));
  look.merge(mill);
  mill.position.set(-0.06, 0, -0.09);
  const sails = new THREE.Group();
  sails.name = 'Mill sails';
  sails.add(look.facet(new THREE.IcosahedronGeometry(0.005, 0), 'ink', 'Hub', { jitter: 0 }));
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Group();
    const cloth = look.facet(new THREE.BoxGeometry(0.01, 0.036, 0.002), 'paper', 'Sail', { jitter: 0.0005 });
    cloth.position.set(0.006, 0.026, 0);
    const spar = look.facet(new THREE.BoxGeometry(0.002, 0.044, 0.003), 'trunk', 'Spar', { jitter: 0 });
    spar.position.y = 0.022;
    blade.add(cloth, spar);
    blade.rotation.z = (i * Math.PI) / 2;
    sails.add(blade);
  }
  look.merge(sails);
  sails.position.set(0, 0.068, 0.026);
  mill.add(sails);
  subject.add(mill);
  const HOPPER = new THREE.Vector3(-0.055, 0, -0.035);
  const hopper = look.crate(0.038, 'Mill hopper', { colour: 'rockDark' });
  hopper.position.copy(HOPPER);
  const flour = look.pile(4, 'Flour sacks (15 kg each)', { shape: 'sack', colour: 'paper', size: 0.021 });
  flour.position.set(0.01, 0, -0.075);
  const bran = look.pile(4, 'Bran sacks (5 kg each)', { shape: 'sack', colour: 'trunk', size: 0.014 });
  bran.position.set(0.064, 0, -0.08);
  subject.add(hopper, flour, bran);

  // Stages 3 and 4: the bakery and the shop, joined to the mill by a road the truck drives.
  const bakery = look.house('Bakery', { w: 0.055, d: 0.04, h: 0.032, roof: 'ochre' });
  bakery.position.set(0.115, 0, -0.085);
  const smoke = look.cloud('Oven smoke', { r: 0.009 });
  smoke.position.set(0.13, 0.06, -0.09);
  const shop = look.house('Shop', { w: 0.05, d: 0.045, h: 0.028, roof: 'river' });
  shop.position.set(0.18, 0, 0.05);
  shop.rotation.y = -Math.PI / 2;                     // its door faces the road
  const ROAD = [[0.0, 0, -0.025], [0.05, 0, -0.03], [0.115, 0, -0.04], [0.135, 0, 0.0], [0.13, 0, 0.05]];
  const road = look.road(ROAD, 'Road');
  const toBakery = lookPath(THREE, ROAD.slice(0, 3));
  const toShop = lookPath(THREE, ROAD.slice(2));
  const truck = look.vehicle('truck', 'Truck');
  const sack = look.facet(new THREE.IcosahedronGeometry(0.009, 0), 'paper', 'Flour on the truck');
  sack.position.set(-0.007, truck.userData.bed + 0.006, 0);
  const bread = look.pile(3, 'Bread on the truck', { shape: 'sack', colour: 'ochre', size: 0.01 });
  bread.position.set(-0.007, truck.userData.bed, 0);
  truck.add(sack, bread);
  look.follow(truck, toBakery, 0);
  const loaves = look.pile(12, 'Loaves at the shop (1 = 10 loaves)', { shape: 'sack', colour: 'ochre', size: 0.016 });
  loaves.position.set(0.105, 0, 0.095);
  // The count at the shop in cut-paper digits: each value built once, the right one shown.
  const LOAVES = ['0', '30', '60', '90', '120'];
  const counts = LOAVES.map((v) => {
    const n = look.number(v, 'ink', `${v} loaves`, { h: 0.024 });
    n.position.set(0.058 - n.userData.width, 0, 0.1);
    subject.add(n);
    return n;
  });
  subject.add(bakery, smoke, shop, road, truck, loaves);

  // The flags at the stages, each with its name on a tag just above it.
  const flags = [['Field', -0.2, -0.03], ['Mill', -0.115, -0.045], ['Bakery', 0.165, -0.04], ['Shop', 0.175, 0.105]].map(([word, x, z], i) => {
    const f = look.flag(i + 1, `Flag ${i + 1}: ${word}`);
    f.position.set(x, 0, z);
    const tag = kit.card(word);
    tag.position.set(x + 0.026, 0.125, z);
    subject.add(f, tag);
    return f;
  });

  // Steps: one question each, answered by the landscape.
  const STEPS = [
    { title: 'Where does a loaf begin?', text: 'This harvest, 80 kg of wheat, became 120 loaves. Pick up a crate, or press flag 1, to follow the grain from the field.' },
    { title: 'How much grain is in a crate?', text: 'Each crate holds 20 kg of threshed wheat grain. Pick one up and drop it on the hopper in front of the mill.' },
    { title: 'Where does the rest of the grain go?', text: 'The millstones turn 20 kg of grain into 15 kg of white flour (big sacks) and 5 kg of bran, the husk (small sacks). 15 + 5 = 20: nothing is lost.' },
    { title: 'How many loaves from one sack?', text: 'The truck takes the flour to the bakery. A loaf needs 500 g of flour (with water, yeast and salt), so 15 kg of flour makes 30 loaves.' },
    { title: 'How many from the whole harvest?', text: 'Mill all four crates and watch the count at the shop: 80 kg of wheat, 60 kg of flour, 60 / 0.5 = 120 loaves.' },
  ];
  const FLOUR = ['0 kg', '15 kg', '30 kg', '45 kg', '60 kg'];
  let step = 0;
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  const big = Math.max(size.x, size.y, size.z);
  const right = new THREE.Box3().setFromObject(root).max.x;
  const panel = kit.panel(ui, {
    width: 0.36, position: [Math.max(1.06 * big, right + 0.05), 0.6 * big, 0], rotationY: -0.3,
    eyebrow: 'FIELD TO TABLE', title: 'From wheat to bread',
    items: [
      { status: STEPS[0].title, tone: 'neutral', id: 'state' },
      { text: STEPS[0].text, id: 'info' },
      { stat: '60 kg', label: 'flour milled', id: 'flour' },
      { stat: '120', label: 'loaves at the shop', id: 'loaves' },
      { buttons: [{ label: 'Back', onPress() { go(step - 1); } }, { label: 'Next', onPress() { go(step + 1); } }] },
      { note: 'Press a flag to visit its stage. Press the mill to start the harvest again.' },
    ],
  });
  root.add(panel.object3D);

  // The state of the harvest. Everything shown is drawn from these numbers.
  let milled = 0;        // crates ground so far
  let queue = 0;         // flour sacks waiting at the mill for the truck
  let pending = 0;       // crates tipped in, not yet ground
  let grind = 0;         // seconds left grinding the current crate
  let sold = 0;          // 30-loaf batches at the shop
  let leg = 0;           // truck: 0 parked, 1 to bakery, 2 baking, 3 to shop, 4 and 5 driving back
  let u = 0;
  let load = 0;
  let wait = 0;
  let growK = 1;
  let sackK = 0;
  let breadK = 0;
  let smokeK = 0;
  const show = () => {
    flour.userData.show(queue);
    bran.userData.show(milled);
    loaves.userData.show(sold * 3);
    counts.forEach((n, i) => { n.visible = i === sold; });
    panel.set('flour', FLOUR[milled]);
    panel.set('loaves', LOAVES[sold]);
  };
  function finished() {                       // step 0: the whole harvest already made into bread
    milled = 4; queue = 0; pending = 0; grind = 0; sold = 4; leg = 0; load = 0;
    crates.forEach((c) => { c.userData.fill.visible = false; });
    look.follow(truck, toBakery, 0);
    show();
  }
  function restart() {                        // the harvest is back in the field
    milled = 0; queue = 0; pending = 0; grind = 0; sold = 0; leg = 0; load = 0; growK = 0;
    crates.forEach((c, i) => {
      c.userData.fill.visible = true;
      if (!isGrabbed(c)) c.position.copy(seats[i].home);
    });
    look.follow(truck, toBakery, 0);
    show();
  }
  function go(n) {
    const from = step;
    step = Math.max(0, Math.min(STEPS.length - 1, n));
    if (step === 0 && from !== 0) finished();
    if (step > 0 && from === 0) restart();
    panel.set('state', STEPS[step].title);
    panel.set('info', STEPS[step].text);
  }

  // Hands: crates are picked up and dropped on the hopper (they slide home afterwards, empty); flags go to their
  // stage; the mill starts the harvest again.
  const seats = crates.map((c) => {
    traits(c, { grab: true });
    return lookSeat(THREE, c, isGrabbed, { radius: 0.03, returnAfter: 0.7, onAway() { tipIn(c); } });
  });
  function tipIn(c) {
    if (Math.hypot(c.position.x - HOPPER.x, c.position.z - HOPPER.z) > 0.05) {
      panel.set('state', 'Drop the crate on the hopper in front of the mill', 'neutral');
      return;
    }
    if (!c.userData.fill.visible) { panel.set('state', 'That crate is empty: try a full one', 'poor'); return; }
    c.userData.fill.visible = false;
    pending++;
    if (step < 2) go(2);
    panel.set('state', 'Grinding 20 kg of grain...', 'good');
  }
  flags.forEach((f, i) => traits(f, { onPress() { go(i + 1); } }));
  traits(mill, { onPress() { restart(); go(1); panel.set('state', 'A new harvest: 4 crates of 20 kg', 'good'); } });
  finished();

  const flagK = [0, 0, 0, 0];
  return {
    root,
    update(time, delta) {
      look.update(time);
      for (const seat of seats) seat.update(delta);
      if (step === 0) for (const c of crates) if (isGrabbed(c)) { go(1); break; }

      // The wheat unfolds facet by facet when a new harvest starts.
      if (growK < 1) { growK = Math.min(1, growK + delta * 0.8); grow.set(growK); }

      // The mill grinds one crate at a time: 20 kg in, 15 kg of flour and 5 kg of bran out.
      if (grind > 0) {
        grind -= delta;
        if (grind <= 0) {
          milled++; queue++;
          show();
          panel.set('state', `${FLOUR[milled]} of flour milled, ${milled * 5} kg of bran`, 'good');
        }
      } else if (pending > 0) { pending--; grind = 1.4; }
      sails.rotation.z -= delta * (grind > 0 ? 7 : 0.6);

      // The truck carries the flour to the bakery, waits while it bakes, takes the bread to the shop, and comes back.
      const travel = delta * 0.07;               // 7 cm a second
      if (leg === 0 && queue > 0) { load = queue; queue = 0; show(); leg = 1; u = 0; sackK = 0; }
      else if (leg === 1) { u += travel / toBakery.length; look.follow(truck, toBakery, u); if (u >= 1) { leg = 2; wait = 1.4; } }
      else if (leg === 2) { wait -= delta; if (wait <= 0) { leg = 3; u = 0; breadK = 0; if (step < 3) go(3); } }
      else if (leg === 3) {
        u += travel / toShop.length;
        look.follow(truck, toShop, u);
        if (u >= 1) {
          sold = Math.min(4, sold + load); show(); leg = 4; u = 1;
          if (sold === 4) panel.set('state', '80 kg of wheat made 120 loaves', 'good');
          else panel.set('state', `${LOAVES[sold]} loaves at the shop`, 'good');
        }
      } else if (leg === 4) { u -= travel / toShop.length; look.follow(truck, toShop, u, -1); if (u <= 0) { leg = 5; u = 1; } }
      else if (leg === 5) { u -= travel / toBakery.length; look.follow(truck, toBakery, u, -1); if (u <= 0) { leg = 0; look.follow(truck, toBakery, 0); } }
      sackK = leg === 1 || leg === 2 ? Math.min(1, sackK + delta * 3) : 0;
      breadK = leg === 3 ? Math.min(1, breadK + delta * 3) : 0;
      look.pop(sack, leg === 2 ? Math.max(0, wait - 0.7) * 1.4 : sackK);
      look.pop(bread, breadK);
      bread.userData.show(Math.min(3, load));
      smokeK = leg === 2 ? Math.min(1, smokeK + delta * 2) : Math.max(0, smokeK - delta * 2);
      look.pop(smoke, smokeK);
      smoke.position.y = 0.06 + 0.012 * (1 - smokeK);

      // The current stage's flag rises and lights; the cloud drifts.
      for (let i = 0; i < 4; i++) {
        flagK[i] += ((step === i + 1 ? 1 : 0) - flagK[i]) * Math.min(1, delta * 6);
        flags[i].userData.active(flagK[i]);
      }
      cloud.position.x = -0.12 + 0.025 * Math.sin(time * 0.15);
    },
  };
}
