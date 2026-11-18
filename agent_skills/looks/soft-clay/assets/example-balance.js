// Worked example (soft clay): why a seesaw balances. Built on the look kit and softClayLook (pasted above it by
// new-lesson.mjs); passes scripts/check.mjs and the emulator hand test. Take its method, not its subject:
// - the idea is made physical: weight is a clay arrow under each child, distance is marks on the plank, and the
//   panel names the quantity that decides it (weight x distance on each side);
// - the learner runs the experiment with their hands: pick a child up, drop it on a mark, watch the plank answer;
// - each step asks one question the scene can answer, and the panel says what to notice;
// - clay motion on twos (lookTwos), arrivals that bounce, nothing allocated in update().
export default function build({ THREE, kit, traits, ui, isGrabbed }) {
  const root = new THREE.Group();
  const look = softClayLook(THREE, kit);
  const set = look.set({ width: 0.44, depth: 0.26 });
  root.add(set);
  const subject = new THREE.Group();
  subject.name = 'Seesaw';
  subject.userData.subject = true;
  subject.position.y = set.userData.top;
  root.add(subject);

  // The seesaw: a navy fulcrum and a cream plank on a pivot, with distance marks 1 to 4 on each side.
  const MARK = 0.045;              // metres between marks: distance 1 = one mark
  const FULCRUM_H = 0.07;
  const fulcrum = look.fulcrum(FULCRUM_H, 'navy', 'Fulcrum');
  subject.add(fulcrum);
  const pivot = new THREE.Group();
  pivot.name = 'Plank pivot';
  pivot.position.y = FULCRUM_H + 0.007;
  subject.add(pivot);
  const plank = look.plank(0.42, 'cream', 'Plank');
  pivot.add(plank);
  for (const side of [-1, 1]) {
    for (let d = 1; d <= 4; d++) {
      const dot = look.ball(0.004, 'navy', `Mark ${side < 0 ? 'left' : 'right'} ${d}`);
      dot.position.set(side * d * MARK, 0.008, 0.026);
      pivot.add(dot);
    }
  }

  // Two children: weight 2 (coral) and weight 1 (yellow), each with its weight as a fat clay number and a red clay
  // arrow below the plank whose length is the weight.
  const kids = [
    { name: 'Big child', colour: 'coral', weight: 2, h: 0.1, start: -2 },
    { name: 'Small child', colour: 'yellow', weight: 1, h: 0.075, start: 2 },
  ].map((k) => {
    const g = look.character(k.colour, k.name, { h: k.h });
    const label = look.number(String(k.weight), 'white', `${k.name} weight`, { h: k.h * 0.28 });
    label.position.set(-label.userData.width / 2, k.h * 0.32, k.h * 0.2);
    g.add(label);
    const arrow = look.arrow(0.03 * k.weight, 'coral', `${k.name} weight arrow`);
    arrow.rotation.z = Math.PI;                    // pointing down, from just under the plank
    arrow.position.set(0, -0.012, 0.04);
    g.add(arrow);
    pivot.add(g);
    return { ...k, g, mark: k.start, was: false, land: 0 };
  });
  const placeOn = (kid, mark) => {
    kid.mark = mark;
    kid.g.position.set(mark * MARK, 0.007, 0);
    kid.g.rotation.set(0, 0, 0);
    kid.land = 1;
  };
  kids.forEach((k) => placeOn(k, k.start));

  // The steps: one question each, answered by the scene.
  const STEPS = [
    { title: 'Which side goes down?', text: 'The big child weighs 2, the small one 1, both 2 marks out. The heavier side goes down.' },
    { title: 'Make it balance', text: 'Pick up a child and drop it on another mark. Find a place where the plank stays level.' },
    { title: 'The rule', text: 'Each side turns the plank by weight x distance. Equal turning on both sides: it balances.' },
    { title: 'Try another', text: 'Can the small child balance the big one from mark 3? Why not? Try it.' },
  ];
  let step = 0;
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  const big = Math.max(size.x, size.y, size.z);
  const right = new THREE.Box3().setFromObject(root).max.x;
  const panel = kit.panel(ui, {
    width: 0.3, position: [Math.max(1.06 * big, right + 0.05), 0.6 * big, 0], rotationY: -0.3,
    eyebrow: 'BALANCE', title: 'Why a seesaw balances',
    items: [
      { status: STEPS[0].title, tone: 'neutral', id: 'state' },
      { text: STEPS[0].text, id: 'info' },
      { stat: '4 : 2', label: 'turning, left : right', id: 'turn' },
      { buttons: [{ label: 'Back', onPress() { go(step - 1); } }, { label: 'Next', onPress() { go(step + 1); } }] },
      { note: 'Press the fulcrum to start again.' },
    ],
  });
  root.add(panel.object3D);
  function go(n) {
    step = Math.max(0, Math.min(STEPS.length - 1, n));
    panel.set('state', STEPS[step].title);
    panel.set('info', STEPS[step].text);
  }

  // Hands: each child is picked up and dropped on a mark (it snaps to the nearest one, or goes back); the fulcrum
  // resets the seesaw.
  kids.forEach((k) => traits(k.g, { grab: true }));
  traits(fulcrum, {
    onPress() {
      kids.forEach((k) => placeOn(k, k.start));
      go(0);
    },
  });

  const local = new THREE.Vector3();
  let tilt = 0;
  let shownTurn = '';
  let wasBalanced = false;
  return {
    root,
    update(time, delta) {
      // A child let go: snap to the nearest mark on the plank, or back where it was.
      for (const k of kids) {
        const held = isGrabbed(k.g);
        if (k.was && !held) {
          local.copy(k.g.position);
          const near = Math.abs(local.z) < 0.08 && local.y > -0.05 && local.y < 0.12;
          const d = Math.round(Math.abs(local.x) / MARK);
          if (near && d >= 1 && d <= 4) placeOn(k, Math.sign(local.x) * d);
          else placeOn(k, k.mark);
        }
        k.was = held;
        if (k.land > 0) {                                // a small bounce as it lands
          k.land = Math.max(0, k.land - delta * 3);
          if (!held) k.g.position.y = 0.007 + 0.012 * Math.sin(k.land * Math.PI) * k.land;
        }
      }
      // The physics the lesson is about: turning = weight x distance on each side.
      let left = 0;
      let rightTurn = 0;
      for (const k of kids) {
        if (isGrabbed(k.g)) continue;
        if (k.mark < 0) left += k.weight * -k.mark;
        else rightTurn += k.weight * k.mark;
      }
      const turn = `${left} : ${rightTurn}`;
      if (turn !== shownTurn) {
        shownTurn = turn;
        panel.set('turn', turn);
        const balanced = left === rightTurn && left > 0;
        if (balanced && !wasBalanced) panel.set('state', 'Balanced!', 'good');
        else if (!balanced && wasBalanced) panel.set('state', STEPS[step].title);
        wasBalanced = balanced;
      }
      // The plank answers on twos (stop-motion), easing toward the tilt the turning gives.
      const target = Math.max(-0.22, Math.min(0.22, (left - rightTurn) * 0.06));
      tilt += (target - tilt) * Math.min(1, delta * 4);
      pivot.rotation.z = Math.round(lookTwos(time) * 15) % 1 === 0 ? Math.round(tilt * 40) / 40 : pivot.rotation.z;
    },
  };
}
