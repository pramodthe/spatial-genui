// Starter lesson for a look (scripts/new-lesson.mjs puts look-kit.js and the look's module above it and fills in
// __LOOK__). It runs as it is, with the look's demo. Replace the demo with the lesson's parts, keep the structure:
// the set, a subject group, hand targets with feedback, steps on the panel, and nothing allocated in update().
export default function build({ THREE, kit, traits, ui, isGrabbed }) {
  const root = new THREE.Group();
  const look = __LOOK__(THREE, kit);

  // The ground of the look on the desk. Never grabbable.
  const set = look.set();
  root.add(set);

  // The subject: everything the lesson is about stands in here, on top of the set.
  const subject = new THREE.Group();
  subject.name = 'Subject';
  subject.userData.subject = true;
  subject.position.y = set.userData.top;
  root.add(subject);

  // REPLACE: build the lesson's parts in the look and list the hand targets: { object, grab } or { object, press }.
  const targets = look.demo(subject);

  // Steps: what the learner sees, and which hand action moves the lesson on. REPLACE the text.
  const STEPS = [
    { title: 'The whole thing', text: 'Pick up a part and put it back, or press one to look closer.' },
    { title: 'A closer look', text: 'One sentence on what this step shows.' },
  ];
  let step = 0;
  // The panel stands to the right of the model, in reach. The host scales the 3D so its largest size is 0.5 m, and
  // the panel's position scales with it: x = 1.06 x the largest size lands it about 0.53 m out, where both a poke and a
  // pointed pinch reach it (tested in the emulator for every look); a fixed x drifts out of reach on a small model.
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  const big = Math.max(size.x, size.y, size.z);
  const right = new THREE.Box3().setFromObject(root).max.x;
  const panel = kit.panel(ui, {
    width: 0.3, position: [Math.max(1.06 * big, right + 0.05), 0.6 * big, 0], rotationY: -0.3, eyebrow: 'LESSON', title: 'Lesson title',
    items: [
      { status: STEPS[0].title, tone: 'neutral', id: 'state' },
      { text: STEPS[0].text, id: 'info' },
      { buttons: [{ label: 'Back', onPress() { go(step - 1); } }, { label: 'Next', onPress() { go(step + 1); } }] },
    ],
  });
  root.add(panel.object3D);
  function go(n) {
    step = Math.max(0, Math.min(STEPS.length - 1, n));
    panel.set('state', STEPS[step].title);
    panel.set('info', STEPS[step].text);
  }

  // Hands: grab targets can be put back (they slide home when let go near their place); presses move the lesson on.
  // Every hand action shows at once: a pressed thing bounces, a part put back says so on the panel.
  const seats = [];
  const bounce = new Map();
  for (const t of targets) {
    if (t.grab) {
      traits(t.object, { grab: true });
      seats.push(lookSeat(THREE, t.object, isGrabbed, {
        onHome() { panel.set('state', `${t.object.name} is back in place`, 'good'); },
        onAway() { panel.set('state', `${t.object.name} is out: put it back`, 'neutral'); },
      }));
    } else if (t.press) {
      bounce.set(t.object, { k: 0, base: t.object.scale.x });
      traits(t.object, { onPress() { bounce.get(t.object).k = 1; panel.set('info', `${t.object.name}: REPLACE with what it does.`); go(step + 1); } });
    }
  }

  return {
    root,
    update(time, delta) {
      for (const seat of seats) seat.update(delta);
      for (const [object, b] of bounce) {
        if (b.k <= 0) continue;
        b.k = Math.max(0, b.k - delta * 3);
        object.scale.setScalar(b.base * (1 + 0.12 * Math.sin(b.k * Math.PI)));
      }
    },
  };
}
