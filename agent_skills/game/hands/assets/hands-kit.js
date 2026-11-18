// ---------------------------------------------------------------- hands kit: tested hand actions for learning games
// Pasted in by scripts/new-game.mjs, beside the motion kit. The real things a hand does to a thing - pour, stir,
// fold, twist and cut - as small helpers that read what the hand did from the thing it holds, and return plain
// numbers the game reads: how much has poured, how many turns, how far a flap is folded. Tilt and twist are read from
// the held thing's own rotation, which turns with the hand in the headset and in the check; never from the hand's
// `tip` against its `palm` (with controllers those are the same point). Each counts only while the hand holds the
// thing (isGrabbed), so with no hand nothing happens. Lengths are in the units the game is built in, angles in
// degrees, times in seconds. Each helper is checked against its rule at 72 and at 30 frames a second, and plays
// through a small game by the gesture written under it (gate/test-hands.ts). A helper's places (pour.above,
// stir.path(), fold.path, cut.path) are empty objects it puts beside the thing, so they stay right wherever the game
// is; ask for them when the pieces are in the scene.
//
//   handPour(THREE, container, isGrabbed, { over, angle, rate, amount })
//        a jug, cup or bowl the hand tips to pour into `over` (an object). .update(dt) every frame returns the
//        helper: .flowing, .poured (how much has left it), .left, .tilt (degrees from upright), .over. It flows while
//        held, tipped past `angle` (30), with its centre over `over` (within its width): `rate` a second when tipped
//        flat, less the less it is tipped past `angle`, never more than `amount` (no limit when left out).
//        .above is the place over `over` to carry it to. .reset() fills it again.
//          gesture: { grab: jug, to: pour.above, tilt: 70, until: () => pour.poured >= 200 }
//   handStir(THREE, tool, isGrabbed, centre, { reach, tip })
//        a spoon or whisk the hand moves round inside a bowl (centre: an object, or a place). .update(dt) returns
//        .turns (whole turns round the centre), .way (1 anticlockwise seen from above, -1 clockwise), .stirring (it
//        moved round this frame). It counts while held with the tool's `tip` (a point in the tool's own units; its
//        origin when left out) within `reach` of the centre (the bowl's half width) and no higher than its rim.
//        .path(turns) is a ring of places inside the bowl to stir along. .reset().
//          gesture: { grab: spoon, path: stir.path(2), seconds: 3 }
//   handFold(THREE, flap, handle, isGrabbed, { axis, to, rate })
//        a flap that turns on a hinge: `flap`'s origin is on the hinge line and it turns about its own `axis` ('x',
//        'y' or 'z'; 'x' when left out) by up to `to` degrees (180; negative folds the other way). The hand pinches
//        `handle`, a grabbable thing at the flap's free edge (beside the flap, not inside it), and the flap follows
//        it round the hinge. Let go past half way it finishes the fold, else it springs back, at `rate` (8); the
//        handle goes back to the edge. .update(dt) returns .angle, .done, .held. .path is the arc to carry the handle
//        along. .reset() unfolds it.
//          gesture: { grab: handle, path: fold.path, seconds: 0.8 }
//   handTwist(THREE, object, isGrabbed, { axis, fixed })
//        a knob, a lid, a key or a screwdriver the hand turns about the thing's own `axis` ('z' when left out).
//        .update(dt) returns .angle (degrees, + is clockwise looking at the face its axis points out of, the way a
//        tap closes and a volume knob turns up) and .turns. fixed (true): a knob stays where it is and only turns
//        about its axis; false for a tool the hand carries. .reset() turns it back.
//          gesture: { hold: knob, pinch: true, roll: 90, seconds: 1 }   (roll turns the hand about its fingers)
//   handCut(THREE, tool, isGrabbed, line, { tip, depth, width })
//        a knife, saw or scissors drawn across a cut line: `line` is [a, b] (objects, or places in the tool's
//        parent's units) or one thin object along the cut. .update(dt) returns .cut (it has crossed the line), .cuts
//        (how many times), .at (where along the line the last cut crossed, 0 to 1) and .length (how far the blade
//        went along the line while on it). The blade (`tip`, a point in the tool's own units; its origin when left
//        out) counts within `depth` (0.03) of the line's height and, along it, within `width` (0.015) of it. .path
//        is a stroke across the middle of the line. .reset().
//          gesture: { grab: knife, path: cut.path, seconds: 0.5 }

// A place as a point in the world, and the half width of the thing when it is one: an object (the centre of its
// box), or [x, y, z] / a vector in `frame`'s units, or a function returning either.
function handKitPlace(THREE, frame, place) {
  const p = typeof place === 'function' ? place() : place;
  if (p && p.isObject3D) {
    p.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(p);
    if (box.isEmpty()) return { point: p.getWorldPosition(new THREE.Vector3()), half: 0, top: null, bottom: null, size: null };
    const size = box.getSize(new THREE.Vector3());
    return { point: box.getCenter(new THREE.Vector3()), half: Math.max(size.x, size.z) / 2, top: box.max.y, bottom: box.min.y, size };
  }
  const v = Array.isArray(p) ? new THREE.Vector3(p[0], p[1], p[2]) : new THREE.Vector3(p?.x ?? 0, p?.y ?? 0, p?.z ?? 0);
  if (frame) {
    frame.updateWorldMatrix(true, false);
    frame.localToWorld(v);
  }
  return { point: v, half: 0, top: null, bottom: null, size: null };
}

// How long one of the game's units is in the world (the game's root may be shown bigger or smaller).
function handKitUnit(THREE, object) {
  if (!object.parent) return 1;
  object.parent.updateWorldMatrix(true, false);
  return object.parent.getWorldScale(new THREE.Vector3()).x || 1;
}

// An empty object at a world point, beside `object` (in its parent), for a gesture to aim at.
function handKitMark(THREE, object, world, mark) {
  const parent = object.parent;
  if (!parent) throw new Error(`Put ${object.name || 'the thing'} in the scene before asking for its gesture's places.`);
  mark.name = mark.name || `${object.name || 'hand'} place`;
  if (mark.parent !== parent) parent.add(mark);
  parent.updateWorldMatrix(true, false);
  mark.position.copy(parent.worldToLocal(world.clone()));
  return mark;
}

const HAND_KIT_AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
function handKitAxis(THREE, axis, fallback) {
  if (axis && axis.isVector3) return axis.clone().normalize();
  return new THREE.Vector3(...(HAND_KIT_AXES[axis] ?? HAND_KIT_AXES[fallback])).normalize();
}

function handKitWrap(angle) {
  return angle - Math.PI * 2 * Math.round(angle / (Math.PI * 2));
}

function handPour(THREE, container, isGrabbed, o = {}) {
  const up = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  const mark = new THREE.Object3D();
  const amount = o.amount ?? Infinity;
  const pour = {
    angle: o.angle ?? 30,
    rate: o.rate ?? 1,
    flowing: false,
    poured: 0,
    left: amount,
    tilt: 0,
    over: false,
    update(dt) {
      container.updateWorldMatrix(true, false);
      up.set(0, 1, 0).applyQuaternion(container.getWorldQuaternion(turn));
      pour.tilt = THREE.MathUtils.radToDeg(Math.acos(Math.min(1, Math.max(-1, up.y))));
      const from = handKitPlace(THREE, null, container);
      pour.over = false;
      if (o.over != null) {
        const into = handKitPlace(THREE, container.parent, o.over);
        const away = Math.hypot(from.point.x - into.point.x, from.point.z - into.point.z);
        pour.over = away <= into.half + (o.reach ?? 0) * handKitUnit(THREE, container) && from.point.y >= (into.bottom ?? into.point.y);
      }
      pour.flowing = Boolean(isGrabbed(container)) && pour.tilt > pour.angle && pour.over && pour.left > 0;
      if (pour.flowing && dt > 0) {
        // Faster the further it is tipped past the pouring angle, at `rate` once it lies flat.
        const share = Math.min(1, (pour.tilt - pour.angle) / Math.max(1, 90 - pour.angle));
        const flow = Math.min(pour.left, pour.rate * share * dt);
        pour.poured += flow;
        pour.left -= flow;
      }
      return pour;
    },
    // Over the middle of `over`, high enough that the container's bottom clears its top.
    get above() {
      const into = handKitPlace(THREE, container.parent, o.over);
      const from = handKitPlace(THREE, null, container);
      const height = from.size ? from.size.y : 0;
      return handKitMark(THREE, container, new THREE.Vector3(into.point.x, (into.top ?? into.point.y) + height * 0.6, into.point.z), mark);
    },
    reset() {
      pour.poured = 0;
      pour.left = amount;
      pour.flowing = false;
      return pour;
    },
  };
  return pour;
}

function handStir(THREE, tool, isGrabbed, centre, o = {}) {
  const tip = new THREE.Vector3(...(o.tip ?? [0, 0, 0]));
  const at = new THREE.Vector3();
  const marks = [];
  let before = null;
  let total = 0;
  const reachOf = (bowl) => (o.reach != null ? o.reach * handKitUnit(THREE, tool) : bowl.half);
  const inside = () => {
    const bowl = handKitPlace(THREE, tool.parent, centre);
    tool.updateWorldMatrix(true, false);
    tool.localToWorld(at.copy(tip));
    const near = Math.hypot(at.x - bowl.point.x, at.z - bowl.point.z) <= reachOf(bowl);
    // No higher than a quarter of the bowl's height above its rim.
    const low = bowl.top === null || at.y <= bowl.top + (bowl.top - bowl.bottom) * 0.25;
    return { near: near && low, angle: Math.atan2(-(at.z - bowl.point.z), at.x - bowl.point.x) };
  };
  const stir = {
    turns: 0,
    way: 0,
    stirring: false,
    update() {
      const now = inside();
      stir.stirring = false;
      if (isGrabbed(tool) && now.near) {
        if (before !== null) {
          const step = handKitWrap(now.angle - before);
          total += step;
          stir.stirring = Math.abs(step) > 1e-4;
        }
        before = now.angle;
      } else before = null;
      stir.turns = Math.abs(total) / (Math.PI * 2);
      stir.way = Math.sign(total);
      return stir;
    },
    // A ring inside the bowl, `turns` times round, eight places a turn, for the hand that holds the tool by its
    // middle: the tool's tip goes round the bowl's centre.
    path(turns = 2) {
      const bowl = handKitPlace(THREE, tool.parent, centre);
      tool.updateWorldMatrix(true, false);
      const grip = handKitPlace(THREE, null, tool).point;
      const offset = tool.localToWorld(tip.clone()).sub(grip);
      const radius = reachOf(bowl) * 0.55;
      const count = Math.max(1, Math.round(turns * 8));
      const places = [];
      for (let i = 0; i <= count; i++) {
        const a = (i / 8) * Math.PI * 2;
        const point = new THREE.Vector3(bowl.point.x + radius * Math.cos(a), bowl.point.y, bowl.point.z - radius * Math.sin(a)).sub(offset);
        places.push(handKitMark(THREE, tool, point, marks[i] ?? (marks[i] = new THREE.Object3D())));
      }
      return places;
    },
    reset() {
      total = 0;
      before = null;
      stir.turns = 0;
      stir.way = 0;
      stir.stirring = false;
      return stir;
    },
  };
  return stir;
}

function handFold(THREE, flap, handle, isGrabbed, o = {}) {
  const local = handKitAxis(THREE, o.axis, 'x');
  const to = THREE.MathUtils.degToRad(o.to ?? 180);
  const rate = o.rate ?? 8;
  const low = Math.min(0, to);
  const high = Math.max(0, to);
  const marks = [];
  let start = null; // the flap's own turn, the hinge axis and the handle's offset from the hinge, before folding
  let followed = 0;
  let before = 0;
  let was = false;
  let angle = 0;
  const handleIn = (v) => {
    flap.parent.updateWorldMatrix(true, false);
    handle.updateWorldMatrix(true, false);
    return flap.parent.worldToLocal(handle.getWorldPosition(v));
  };
  const begin = () => {
    if (start || !flap.parent) return start;
    const turn = flap.quaternion.clone();
    start = { turn, axis: local.clone().applyQuaternion(turn), offset: handleIn(new THREE.Vector3()).sub(flap.position) };
    return start;
  };
  // Where the handle is when the flap is folded by `a` (radians), in the flap's parent's units.
  const edge = (a) => start.offset.clone().applyAxisAngle(start.axis, a).add(flap.position);
  const turnFlap = () => flap.quaternion.copy(start.turn).multiply(new THREE.Quaternion().setFromAxisAngle(local, angle));
  const putHandle = () => {
    const world = flap.parent.localToWorld(edge(angle));
    if (handle.parent) handle.position.copy(handle.parent.worldToLocal(world));
  };
  const fold = {
    handle,
    angle: 0,
    done: false,
    held: false,
    update(dt) {
      if (!begin()) return fold;
      const held = Boolean(isGrabbed(handle));
      if (held) {
        // The handle's turn round the hinge, measured across the hinge line, followed without jumps.
        const along = start.axis;
        const a = start.offset.clone().sub(along.clone().multiplyScalar(start.offset.dot(along)));
        const r = handleIn(new THREE.Vector3()).sub(flap.position);
        const b = r.sub(along.clone().multiplyScalar(r.dot(along)));
        if (b.lengthSq() > a.lengthSq() * 1e-4) {
          const now = Math.atan2(along.dot(a.clone().cross(b)), a.dot(b));
          if (!was) {
            followed = angle;
            before = handKitWrap(angle);
          }
          followed += handKitWrap(now - before);
          before = now;
          angle = Math.min(high, Math.max(low, followed));
        }
        turnFlap();
      } else {
        if (was) fold.done = to !== 0 && angle / to >= 0.5;
        const target = fold.done ? to : 0;
        angle += (target - angle) * (1 - Math.exp(-rate * Math.max(dt, 0)));
        if (Math.abs(target - angle) < 1e-3) angle = target;
        turnFlap();
        putHandle();
      }
      was = held;
      fold.held = held;
      fold.angle = THREE.MathUtils.radToDeg(angle);
      return fold;
    },
    // The handle's arc round the hinge, from where it is to the folded place.
    get path() {
      if (!begin()) throw new Error(`Put ${flap.name || 'the flap'} in the scene before asking for its fold's path.`);
      return [0.3, 0.6, 0.85, 1].map((share, i) => handKitMark(THREE, handle, flap.parent.localToWorld(edge(to * share)), marks[i] ?? (marks[i] = new THREE.Object3D())));
    },
    reset() {
      angle = 0;
      followed = 0;
      was = false;
      fold.done = false;
      fold.held = false;
      fold.angle = 0;
      if (begin()) {
        turnFlap();
        putHandle();
      }
      return fold;
    },
  };
  return fold;
}

function handTwist(THREE, object, isGrabbed, o = {}) {
  const local = handKitAxis(THREE, o.axis, 'z');
  const fixed = o.fixed ?? true;
  const previous = new THREE.Quaternion();
  const change = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  let start = null;
  let total = 0; // radians, anticlockwise about the axis (the right-hand rule)
  const begin = () => {
    if (!start) {
      start = { position: object.position.clone(), turn: object.quaternion.clone() };
      previous.copy(object.quaternion);
    }
    return start;
  };
  const twist = {
    angle: 0,
    turns: 0,
    update() {
      begin();
      if (isGrabbed(object)) {
        // The part of this frame's turn that is about the axis (its twist), however the hand also tipped it.
        change.copy(object.quaternion).multiply(previous.clone().invert());
        if (change.w < 0) change.set(-change.x, -change.y, -change.z, -change.w);
        axis.copy(local).applyQuaternion(previous);
        total += handKitWrap(2 * Math.atan2(change.x * axis.x + change.y * axis.y + change.z * axis.z, change.w));
      }
      if (fixed) {
        object.position.copy(start.position);
        object.quaternion.copy(start.turn).multiply(new THREE.Quaternion().setFromAxisAngle(local, total));
      }
      previous.copy(object.quaternion);
      twist.angle = -THREE.MathUtils.radToDeg(total);
      twist.turns = twist.angle / 360;
      return twist;
    },
    reset() {
      begin();
      total = 0;
      twist.angle = 0;
      twist.turns = 0;
      if (fixed) {
        object.position.copy(start.position);
        object.quaternion.copy(start.turn);
      }
      previous.copy(object.quaternion);
      return twist;
    },
  };
  return twist;
}

function handCut(THREE, tool, isGrabbed, line, o = {}) {
  const tip = new THREE.Vector3(...(o.tip ?? [0, 0, 0]));
  const blade = new THREE.Vector3();
  const marks = [];
  let before = null;
  // The cut line's ends in the world: two places, or the long side of one thin object (along its top).
  const ends = () => {
    if (Array.isArray(line) && line.length === 2 && typeof line[0] !== 'number') {
      return [handKitPlace(THREE, tool.parent, line[0]).point, handKitPlace(THREE, tool.parent, line[1]).point];
    }
    const thing = handKitPlace(THREE, tool.parent, line);
    const size = thing.size ?? new THREE.Vector3();
    const along = size.x >= size.z ? new THREE.Vector3(size.x / 2, 0, 0) : new THREE.Vector3(0, 0, size.z / 2);
    const top = thing.top ?? thing.point.y;
    return [thing.point.clone().sub(along).setY(top), thing.point.clone().add(along).setY(top)];
  };
  const cut = {
    cut: false,
    cuts: 0,
    at: null,
    length: 0,
    update() {
      const [a, b] = ends();
      const unit = handKitUnit(THREE, tool);
      const depth = (o.depth ?? 0.03) * unit;
      const width = (o.width ?? 0.015) * unit;
      tool.updateWorldMatrix(true, false);
      const now = tool.localToWorld(blade.copy(tip)).clone();
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const long = Math.hypot(dx, dz) || 1e-9;
      // Seen from above: which side of the line a point is on (and how far), and how far along the line it is.
      const side = (p) => (dx * (p.z - a.z) - dz * (p.x - a.x)) / long;
      const share = (p) => ((p.x - a.x) * dx + (p.z - a.z) * dz) / (long * long);
      const height = (p) => p.y - (a.y + (b.y - a.y) * Math.min(1, Math.max(0, share(p))));
      const on = (p) => Math.abs(side(p)) <= width && share(p) >= 0 && share(p) <= 1 && Math.abs(height(p)) <= depth;
      if (isGrabbed(tool) && before) {
        const s0 = side(before);
        const s1 = side(now);
        // A blade exactly on the line counts as on the side it came from, so it crosses once when it goes on.
        if (s0 >= 0 !== s1 >= 0) {
          const crossing = before.clone().lerp(now, s0 / (s0 - s1));
          const t = share(crossing);
          if (t >= -0.05 && t <= 1.05 && Math.abs(height(crossing)) <= depth) {
            cut.cuts += 1;
            cut.cut = true;
            cut.at = Math.min(1, Math.max(0, t));
          }
        }
        if (on(before) && on(now)) cut.length += (Math.abs(share(now) - share(before)) * long) / unit;
      }
      before = isGrabbed(tool) ? now : null;
      return cut;
    },
    // A stroke across the middle of the line, for the hand that holds the tool by its middle: from above one side
    // (so reaching it cuts nothing), down to that side, then across to the other.
    get path() {
      const [a, b] = ends();
      const unit = handKitUnit(THREE, tool);
      tool.updateWorldMatrix(true, false);
      const grip = handKitPlace(THREE, null, tool).point;
      const offset = tool.localToWorld(tip.clone()).sub(grip);
      const middle = a.clone().add(b).multiplyScalar(0.5);
      const across = new THREE.Vector3(-(b.z - a.z), 0, b.x - a.x).normalize().multiplyScalar(Math.max(0.04 * unit, a.distanceTo(b) * 0.3));
      const lift = new THREE.Vector3(0, (o.depth ?? 0.03) * unit * 3, 0);
      const points = [middle.clone().add(across).add(lift), middle.clone().add(across), middle.clone().sub(across)];
      return points.map((p, i) => handKitMark(THREE, tool, p.sub(offset), marks[i] ?? (marks[i] = new THREE.Object3D())));
    },
    reset() {
      cut.cut = false;
      cut.cuts = 0;
      cut.at = null;
      cut.length = 0;
      before = null;
      return cut;
    },
  };
  return cut;
}
