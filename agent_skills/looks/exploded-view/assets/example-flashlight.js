// Worked example (exploded view): what is inside a flashlight and how the current gets round it. Built on the look
// kit and explodedViewLook (pasted above it by new-lesson.mjs); passes scripts/check.mjs. Take its method, not its
// subject:
// - true numbers: every part is drawn from its real millimetres (mm()), enlarged 2 x; the panel and real.size say so;
// - the row is the order of assembly (tail to head), every part a real finish, one orange accent;
// - each part's job is one sentence the learner gets by pressing it, and what fails without it when it is pulled out;
// - the idea, a closed loop of current, is a glowing path through the parts that stops at a gap or an open switch;
// - the hands take it apart and put it back: pull a part out, seat it with a click, close it, click the switch;
// - each step asks one question the scene answers; nothing allocated in update().
export default function build({ THREE, kit, traits, ui, isGrabbed }) {
  const root = new THREE.Group();
  const look = explodedViewLook(THREE, kit);
  const ENLARGE = 2;                                 // shown 2 x real size
  const mm = (v) => v * 0.001 * ENLARGE;            // a real millimetre, on the desk

  const subject = new THREE.Group();
  subject.name = 'Flashlight';
  subject.userData.subject = true;
  root.add(subject);

  // A 1 x AA LED flashlight, 99 mm long, measured from the tail (x = 0) to the head (x = 99). Each part is built
  // along +x round its own origin; `at` in the row is where that origin sits in the closed flashlight.
  // 1 Tail cap (0-22 mm): a black anodised cup closed at the back, the orange rubber switch button behind it.
  const tail = look.cap(mm(11.5), mm(18), 'gunmetal', 'Tail cap', { closed: 'front', wall: mm(0.9) });
  const button = look.mesh(look.turnedGeometry([[mm(-13), 0], [mm(-12.4), mm(4), 1], [mm(-11), mm(6), 1], [mm(-9), mm(6.5)], [mm(-9), 0]]), 'orange');
  button.name = 'Switch button';
  tail.add(button);
  // 2 Spring: 15 mm long free, squeezed to 12 mm between the cap and the battery.
  const spring = look.spring(mm(5), mm(15), 6, { wire: mm(0.7), name: 'Spring' });
  // 3 Battery: an AA cell, 50.5 mm long and 14.5 mm across, + end toward the head.
  const battery = look.battery(mm(50.5), mm(7.25), 'Battery');
  // 4 Body: the aluminium tube (20 mm across) and the head (30 mm) in one piece, a thread at the back for the cap.
  const body = look.turned([[-40, 7.8], [-40, 10], [14, 10], [17, 15], [40, 15], [40, 13], [18, 13], [18, 7.8], [-40, 7.8]].map(([x, r]) => [mm(x), mm(r)]), 'satin', 'Body', { bevel: mm(0.4) });
  const thread = look.thread(mm(10.3), mm(5), mm(0.8), 'satin', 'Body thread');
  thread.position.x = mm(-37);
  body.add(thread);
  // 5 LED board: a brass pin that meets the battery's + end, the green driver board, the LED.
  const ledBoard = look.part(null, null, 'LED board');
  const board = look.mesh(look.turnedGeometry([[mm(-0.8), 0], [mm(-0.8), mm(12.8)], [mm(0.8), mm(12.8)], [mm(0.8), 0]]), 'pcb');
  const pin = look.mesh(look.turnedGeometry([[mm(-4.5), 0], [mm(-4.5), mm(1.3)], [mm(-0.8), mm(1.3)], [mm(-0.8), 0]], { bevel: mm(0.3) }), 'brass');
  const chip = look.mesh(new THREE.BoxGeometry(mm(1.2), mm(4), mm(4)), 'black');
  chip.position.set(mm(-1.4), mm(6), 0);
  const led = look.led(mm(2.5), 'LED');
  led.position.x = mm(2.3);
  ledBoard.add(board, pin, chip, led);
  // 6 Reflector: a chrome cup, 7 mm across at the LED and 25 mm at the front.
  const reflector = look.reflector(mm(12.5), mm(3.5), mm(14), 'Reflector');
  // 7 Lens: a clear window, 2.5 mm thick.
  const lens = look.lens(mm(12.9), mm(2.5), 'Lens', { dome: 0 });
  subject.add(tail, spring, battery, body, ledBoard, reflector, lens);

  // The row: assembly order from the tail, each part's place in the closed flashlight, 18 mm apart when open.
  const row = look.row([
    { object: tail, at: mm(13) }, { object: spring, at: mm(11.4) }, { object: battery, at: mm(42.75) },
    { object: body, at: mm(59) }, { object: ledBoard, at: mm(71.8) }, { object: reflector, at: mm(84) },
    { object: lens, at: mm(96.25) },
  ], { gap: 0.018 });
  const PARTS = [
    { name: 'Tail cap', does: 'Holds the spring and the switch. Click the button and the spring is joined to the cap, which closes the loop.', fails: 'No tail cap: the spring touches nothing at the back, so the loop is open. No light.' },
    { name: 'Spring', does: 'Pushes the battery forward onto the LED board, and carries the current from the battery - end to the cap.', fails: 'No spring: the battery - end touches nothing. The loop is open at the back.' },
    { name: 'Battery', does: 'A 1.5 V AA cell. It pushes current out of its + end and takes it back in at its - end.', fails: 'No battery: nothing pushes the current round.' },
    { name: 'Body', does: 'The aluminium tube holds the battery and is the wire back: current runs along it from the head to the tail cap.', fails: 'No body: nothing carries the current from the head back to the tail.' },
    { name: 'LED board', does: 'The board steps 1.5 V up to the 3 V the LED needs; the LED turns the current into light.', fails: 'No LED board: no light, and the + end of the battery touches nothing.' },
    { name: 'Reflector', does: 'The chrome cup catches the light the LED sends sideways and turns it forward into a beam.', fails: 'No reflector: it still lights, but as a weak wide glow, not a beam.' },
    { name: 'Lens', does: 'The clear window lets the beam out and keeps dust and water off the LED.', fails: 'No lens: it still lights, but dirt and water reach the LED.' },
  ];
  look.callouts(row, PARTS.map((p) => p.name));
  subject.add(look.axis(row));
  const set = look.set({ length: row.length + 0.08, depth: 0.12 });
  root.add(set);
  subject.position.y = set.userData.top;

  // The current's loop, point by point in each part's own frame: + end, LED, out to the head, back along the body,
  // through the switch and the spring to the - end.
  const LOOP = [
    { object: battery, at: [mm(26.2), 0, 0] }, { object: ledBoard, at: [mm(-4.5), 0, 0] },
    { object: ledBoard, at: [mm(7), 0, 0] }, { object: ledBoard, at: [0, mm(12.8), 0] },
    { object: body, at: [mm(18), mm(13), 0] }, { object: body, at: [mm(-40), mm(10), 0] },
    { object: tail, at: [mm(9), mm(10.6), 0] }, { object: tail, at: [mm(-11), 0, 0] },
    { object: spring, at: [mm(-6), 0, 0] }, { object: spring, at: [mm(6), 0, 0] },
    { object: battery, at: [mm(-25.25), 0, 0] },
  ];
  const SWITCH = 7;
  const path = look.powerPath(LOOP, { colour: '#ffb12e' });
  subject.add(path.group);
  const onLoop = LOOP.map((pt) => row.parts.find((p) => p.object === pt.object));
  // The beam, in front of the closed flashlight's head while it is lit (hidden: it does not count toward the size).
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(mm(32), mm(12.5), 0.15, 32, 1, true).rotateZ(-Math.PI / 2), kit.material('light', { color: '#fff3cf', glow: 1, opacity: 0.14 }));
  beam.position.set(row.parts[5].seated.x + mm(7) + 0.075, row.origin.y, 0);
  beam.visible = false;
  subject.add(beam);

  // Steps: one question each, answered by the scene and the hands.
  const STEPS = [
    { title: 'What is inside?', text: 'Seven parts, in the order they go together, 2 x real size. Press a part to hear its job; pull one out of the row and put it back.' },
    { title: 'Which way does the current go?', text: 'Follow the glowing line: out of the battery + end, through the LED, back along the metal body, through the switch and the spring to the - end. One loop.' },
    { title: 'What closes the loop?', text: 'The parts seat with a click. Now press the tail cap to click the switch: the light comes on only when every part touches the next.' },
    { title: 'What if a part is missing?', text: 'Pull one part out and leave it on the floor, then press Together. Where does the current stop? Put the part back to light it again.' },
  ];
  let step = 0;
  let switchOn = false;
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  const big = Math.max(size.x, size.y, size.z);
  const right = new THREE.Box3().setFromObject(root).max.x;
  const panel = kit.panel(ui, {
    width: 0.36, position: [Math.max(1.06 * big, right + 0.05), 0.6 * big, 0], rotationY: -0.3,
    eyebrow: 'TEARDOWN', title: 'Inside a flashlight',
    items: [
      { status: STEPS[0].title, tone: 'neutral', id: 'state' },
      { text: STEPS[0].text, id: 'info' },
      { stat: 'Apart', label: 'the loop', id: 'loop' },
      { slider: 'Apart', min: 0, max: 1, step: 0.05, value: 1, id: 'apart', onChange(v) { row.place(v); } },
      { buttons: [{ label: 'Apart', onPress() { apart(1); } }, { label: 'Together', onPress() { apart(0); } }] },
      { buttons: [{ label: 'Back', onPress() { go(step - 1); } }, { label: 'Next', onPress() { go(step + 1); } }] },
      { note: 'Shown 2 x real size: the real flashlight is 99 mm long, 30 mm across the head.' },
    ],
  });
  root.add(panel.object3D);
  function apart(k) {
    row.go(k);
    panel.set('apart', k);
  }
  function go(n) {
    step = Math.max(0, Math.min(STEPS.length - 1, n));
    panel.set('state', STEPS[step].title);
    panel.set('info', STEPS[step].text);
    row.focus(-1);
    if (step === 2) apart(0);
    else if (step === 3) { switchOn = true; apart(1); }
    else if (row.amount() !== 1) apart(1);
  }

  // Hands: pinch a part to pull it out of the row; let go near its place and it clicks back in. A press lifts it and
  // says its job; on the closed flashlight a press on the tail cap clicks the switch.
  let press = 0;
  row.hands(traits, isGrabbed, {
    onPress(p, i) {
      if (i === 0 && row.amount() === 0) { switchOn = !switchOn; press = 1; }
      panel.set('state', `${i + 1}  ${PARTS[i].name}`);
      panel.set('info', i === 0 && row.amount() === 0 ? `Switch ${switchOn ? 'on' : 'off'}. ${PARTS[0].does}` : PARTS[i].does);
    },
    onOut(p, i) {
      panel.set('state', `${PARTS[i].name} is out`, 'poor');
      panel.set('info', PARTS[i].fails);
    },
    onSeat(p, i) {
      panel.set('state', `${PARTS[i].name} clicks back in`, 'good');
      panel.set('info', PARTS[i].does);
    },
  });

  let shownLoop = '';
  return {
    root,
    real: { size: big / ENLARGE },
    update(time, delta) {
      row.update(delta);
      // The spring squeezes from 15 to 12 mm as it seats; the switch button dips when it is clicked.
      const sp = row.parts[1];
      spring.children[0].scale.x = sp.out || sp.held ? 1 : 0.81 + 0.19 * Math.min(1, Math.max(0, sp.k));
      press = Math.max(0, press - delta * 4);
      button.position.x = mm(1.2) * Math.sin(press * Math.PI) + (switchOn ? mm(0.8) : 0);
      // The loop stops at the first part on it that is out of the row, or at an open switch.
      let stop = -1;
      for (let i = 0; i < LOOP.length; i++) if (onLoop[i] && (onLoop[i].out || onLoop[i].held)) { stop = i; break; }
      if (stop < 0 && !switchOn) stop = SWITCH;
      let open = 0;
      for (const p of row.parts) if (!p.out && !p.held) open = Math.max(open, Math.abs(p.k));
      const together = open < 0.02;
      path.group.visible = step >= 1;
      path.update(time, stop, together);
      const lit = together && stop < 0;
      led.userData.light.emissiveIntensity = lit ? 2.5 : 0;
      led.userData.halo.visible = lit;
      beam.visible = lit && !row.parts[5].out && !row.parts[5].held;
      const loop = !together ? 'Apart' : lit ? 'Closed: lit' : stop === SWITCH ? 'Open: switch off' : 'Open: a gap';
      if (loop !== shownLoop) {
        shownLoop = loop;
        panel.set('loop', loop);
        if (lit) panel.set('state', 'The loop is closed: light!', 'good');
      }
    },
  };
}
