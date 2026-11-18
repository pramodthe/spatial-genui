// ---------------------------------------------------------------- motion kit: tested motion for learning games
// Pasted in by scripts/new-game.mjs. Things that are thrown, fall, bounce, roll, glide, swing, hang, balance, float
// or are carried by wind and water, as small helpers with the physics already right and the same at any frame
// rate. Nothing here draws: a helper moves numbers and THREE vectors, and the game shows them. Lengths are in the
// units the game is built in and times in seconds, so `gravity` is 9.8 times the game's scale (a desk game slowed
// down to watch: 9.8 * 0.2). Each helper is checked against its known formula (gate/test-motion.ts).
//
// Time
//   motionSteps(step)                    a fixed time step (1/120 s): steps.run(delta, (dt) => { ... }) calls the
//                                        function a whole number of times, so a slow frame moves things as far as
//                                        fast ones. Put every .step(dt) below inside it.
//   motionFollow(now, target, rate, delta)     a number that eases to its target, the same at any frame rate
//   motionFollowTo(vector, target, rate, delta)   the same for a THREE.Vector3, in place
//   motionTurnTo(angle, target, rate, delta)   an angle that turns to its target the short way round
// Hands
//   motionHand(THREE, hands, side)       how fast a hand moves: .update(delta) every frame, then .velocity (a
//                                        vector, per second, smoothed over a few frames) and .speed
//   motionHeld(THREE, object, isGrabbed) a thing the hand carries: .update(delta) every frame returns 'taken' on
//                                        the frame it is picked up and 'thrown' on the frame it is let go, when
//                                        .velocity is the speed it leaves the hand with
//   motionSnap(position, places, radius) the index of the nearest place within radius, or -1
// Bodies
//   motionBody(THREE, { position, radius, mass, gravity, drag, bounce, friction, floor, walls })
//                                        a ball-like body. position may be a mesh's own position, so the mesh moves.
//                                        .launch(velocity) sends it off; .step(dt) moves it (gravity, air drag, a
//                                        floor to bounce and roll to rest on, walls [min, max] to stay inside).
//                                        .landed is true on the step it first touches the floor, .grounded while it
//                                        touches, .resting once it lies still.
//   motionCollide(a, b)                  two bodies bounce off each other (true when they touched)
//   motionBlock(body, min, max)          a body bounces off a box that does not move (a paddle, a wall, a ramp's end)
//   motionGlide(body, { lift, drag }, dt)   a wing on the body, before its step: lift across the way it flies, drag
//                                        against it, both growing with speed squared. It sinks at drag / lift.
//   motionDrift(body, flow, rate, dt)    wind or a current carries the body: its velocity eases to the flow's
//                                        (rate: a leaf 5, a stone 0.5). With no flow it is air that slows a fall.
// Swinging, springing, hanging
//   motionPendulum({ length, angle, gravity, damping })   .step(dt), then .angle from straight down and .speed
//   motionSpring({ value, stiffness, damping })   .step(dt, target) returns the value: it settles without
//                                        overshooting unless a smaller damping is given
//   motionRope(THREE, { segments, length, gravity })   a line that hangs: .lay(from, to) once, .step(dt, from, to)
//                                        every step (to: null for a free end), then .points to draw it through
// Balance
//   motionTurning(weights, pivot)        how hard [{ mass, x }] turn a beam about its pivot: the sum of mass times
//                                        distance, + for the +x side. Zero is balanced.
//   motionLever({ limit, give })         a beam on its pivot: .step(dt, turning), then .angle (+ is the +x side
//                                        down, so beam.rotation.z = -lever.angle); .balanced(turning)
//   motionCentre(weights)                the centre of mass { x, y, z, mass } of [{ mass, x, y, z }]
//   motionTopples(x, baseMin, baseMax)   true when a centre of mass is not over its base
// Water
//   motionPressure(depth, density, gravity)   the push of a liquid at a depth: density x gravity x depth
//   motionFloat(mass, volume, density)   the share of a floating thing under the surface (above 1 it sinks)

function motionSteps(step = 1 / 120) {
  let left = 0;
  return {
    step,
    // At most `most` steps a frame: a long pause (the headset taken off) does not freeze the game catching up.
    run(delta, each, most = 12) {
      left += Math.min(Math.max(delta, 0), step * most);
      let count = 0;
      while (left >= step - 1e-9) {
        each(step);
        left -= step;
        count++;
      }
      return count;
    },
  };
}

function motionFollow(now, target, rate, delta) {
  return now + (target - now) * (1 - Math.exp(-rate * delta));
}

function motionFollowTo(vector, target, rate, delta) {
  return vector.lerp(target, 1 - Math.exp(-rate * delta));
}

function motionTurnTo(angle, target, rate, delta) {
  let turn = (target - angle) % (Math.PI * 2);
  if (turn > Math.PI) turn -= Math.PI * 2;
  if (turn < -Math.PI) turn += Math.PI * 2;
  return angle + turn * (1 - Math.exp(-rate * delta));
}

// A speed read from positions is noisy frame by frame, so it is smoothed over about this long.
const MOTION_SMOOTH_S = 0.05;

function motionHand(THREE, hands, side = 'right') {
  const before = new THREE.Vector3();
  const now = new THREE.Vector3();
  let seen = false;
  const hand = {
    velocity: new THREE.Vector3(),
    speed: 0,
    update(delta) {
      const h = hands ? hands[side] : null;
      if (!h || !h.tracked || !(delta > 0)) {
        seen = false;
        return hand;
      }
      if (seen) {
        now.copy(h.tip).sub(before).divideScalar(delta);
        hand.velocity.lerp(now, 1 - Math.exp(-delta / MOTION_SMOOTH_S));
      } else hand.velocity.set(0, 0, 0);
      before.copy(h.tip);
      seen = true;
      hand.speed = hand.velocity.length();
      return hand;
    },
  };
  return hand;
}

function motionHeld(THREE, object, isGrabbed) {
  const before = new THREE.Vector3().copy(object.position);
  const now = new THREE.Vector3();
  let was = false;
  const held = {
    held: false,
    velocity: new THREE.Vector3(),
    update(delta) {
      const is = Boolean(isGrabbed(object));
      let event = null;
      if (is && !was) {
        event = 'taken';
        held.velocity.set(0, 0, 0);
      } else if (is && delta > 0) {
        now.copy(object.position).sub(before).divideScalar(delta);
        held.velocity.lerp(now, 1 - Math.exp(-delta / MOTION_SMOOTH_S));
      } else if (!is && was) event = 'thrown';
      before.copy(object.position);
      was = is;
      held.held = is;
      return event;
    },
  };
  return held;
}

function motionSnap(position, places, radius) {
  let best = -1;
  let nearest = radius;
  for (let i = 0; i < places.length; i++) {
    const place = places[i].position ?? places[i];
    const far = Math.hypot(position.x - place.x, position.y - place.y, position.z - place.z);
    if (far <= nearest) {
      nearest = far;
      best = i;
    }
  }
  return best;
}

function motionBody(THREE, o = {}) {
  let touched = false;
  const body = {
    position: o.position ?? new THREE.Vector3(),
    velocity: o.velocity ?? new THREE.Vector3(),
    radius: o.radius ?? 0.02,
    mass: o.mass ?? 1,
    gravity: o.gravity ?? 9.8,
    drag: o.drag ?? 0, // air: the share of its speed it loses each second
    bounce: o.bounce ?? 0.5, // the share of its speed a bounce keeps (0 a thud, 1 for ever)
    friction: o.friction ?? 1.5, // the floor: the share of its speed it loses each second while it rolls
    floor: o.floor ?? null, // the height of the ground under it; null for none
    walls: o.walls ?? null, // [min, max], the corners of the box it stays inside; null for none
    grounded: false,
    landed: false,
    resting: false,
    launch(velocity) {
      body.velocity.copy(velocity);
      body.grounded = false;
      body.landed = false;
      body.resting = false;
      touched = false;
      return body;
    },
    step(dt) {
      body.landed = false;
      if (body.resting) return body;
      const p = body.position;
      const v = body.velocity;
      v.y -= body.gravity * dt;
      if (body.drag > 0) v.multiplyScalar(Math.exp(-body.drag * dt));
      p.addScaledVector(v, dt);
      body.grounded = false;
      if (body.floor !== null && p.y - body.radius <= body.floor) {
        p.y = body.floor + body.radius;
        body.grounded = true;
        if (!touched) {
          touched = true;
          body.landed = true;
        }
        if (v.y < 0) v.y = -v.y * body.bounce;
        // A bounce smaller than what gravity adds in two steps is no bounce: it lies on the floor.
        if (v.y < body.gravity * dt * 2) v.y = 0;
        const slow = Math.exp(-body.friction * dt);
        v.x *= slow;
        v.z *= slow;
        const still = o.still ?? Math.max(1e-4, body.gravity * 0.01);
        if (v.y === 0 && Math.hypot(v.x, v.z) < still) {
          v.set(0, 0, 0);
          body.resting = true;
        }
      }
      if (body.walls) {
        const min = body.walls[0];
        const max = body.walls[1];
        for (const axis of ['x', 'y', 'z']) {
          if (p[axis] - body.radius < min[axis]) {
            p[axis] = min[axis] + body.radius;
            if (v[axis] < 0) v[axis] = -v[axis] * body.bounce;
          } else if (p[axis] + body.radius > max[axis]) {
            p[axis] = max[axis] - body.radius;
            if (v[axis] > 0) v[axis] = -v[axis] * body.bounce;
          }
        }
      }
      return body;
    },
  };
  return body;
}

function motionCollide(a, b) {
  const dx = b.position.x - a.position.x;
  const dy = b.position.y - a.position.y;
  const dz = b.position.z - a.position.z;
  const reach = a.radius + b.radius;
  const far = Math.hypot(dx, dy, dz);
  if (far >= reach || far === 0) return false;
  const nx = dx / far;
  const ny = dy / far;
  const nz = dz / far;
  // Apart again, the lighter one giving way more.
  const total = a.mass + b.mass;
  const overlap = reach - far;
  a.position.x -= nx * overlap * (b.mass / total);
  a.position.y -= ny * overlap * (b.mass / total);
  a.position.z -= nz * overlap * (b.mass / total);
  b.position.x += nx * overlap * (a.mass / total);
  b.position.y += ny * overlap * (a.mass / total);
  b.position.z += nz * overlap * (a.mass / total);
  const closing = (a.velocity.x - b.velocity.x) * nx + (a.velocity.y - b.velocity.y) * ny + (a.velocity.z - b.velocity.z) * nz;
  if (closing > 0) {
    const push = ((1 + Math.min(a.bounce, b.bounce)) * closing) / (1 / a.mass + 1 / b.mass);
    a.velocity.x -= (nx * push) / a.mass;
    a.velocity.y -= (ny * push) / a.mass;
    a.velocity.z -= (nz * push) / a.mass;
    b.velocity.x += (nx * push) / b.mass;
    b.velocity.y += (ny * push) / b.mass;
    b.velocity.z += (nz * push) / b.mass;
  }
  a.resting = false;
  b.resting = false;
  return true;
}

function motionBlock(body, min, max) {
  const p = body.position;
  const v = body.velocity;
  // The point of the box nearest the body's centre.
  const cx = Math.max(min.x, Math.min(max.x, p.x));
  const cy = Math.max(min.y, Math.min(max.y, p.y));
  const cz = Math.max(min.z, Math.min(max.z, p.z));
  let nx = p.x - cx;
  let ny = p.y - cy;
  let nz = p.z - cz;
  let far = Math.hypot(nx, ny, nz);
  if (far >= body.radius) return false;
  let out = body.radius - far;
  if (far === 0) {
    // The centre is inside the box: out through the nearest face.
    const faces = [[p.x - min.x, -1, 0, 0], [max.x - p.x, 1, 0, 0], [p.y - min.y, 0, -1, 0], [max.y - p.y, 0, 1, 0], [p.z - min.z, 0, 0, -1], [max.z - p.z, 0, 0, 1]];
    let face = faces[0];
    for (const f of faces) if (f[0] < face[0]) face = f;
    nx = face[1];
    ny = face[2];
    nz = face[3];
    out = face[0] + body.radius;
    far = 1;
  }
  nx /= far;
  ny /= far;
  nz /= far;
  p.x += nx * out;
  p.y += ny * out;
  p.z += nz * out;
  const into = v.x * nx + v.y * ny + v.z * nz;
  if (into < 0) {
    const back = (1 + body.bounce) * into;
    v.x -= nx * back;
    v.y -= ny * back;
    v.z -= nz * back;
  }
  body.resting = false;
  return true;
}

function motionGlide(body, o, dt) {
  const v = body.velocity;
  const speed = Math.hypot(v.x, v.y, v.z);
  if (speed < 1e-9) return body;
  // Up, with its part along the flight taken out: lift pushes across the way the wing flies.
  const along = v.y / speed;
  const ux = (-along * v.x) / speed;
  const uy = 1 - along * along;
  const uz = (-along * v.z) / speed;
  const across = Math.hypot(ux, uy, uz);
  const slow = Math.min(0.9, (o.drag ?? 0) * speed * dt);
  v.x -= v.x * slow;
  v.y -= v.y * slow;
  v.z -= v.z * slow;
  if (across > 1e-9) {
    const lift = ((o.lift ?? 0) * speed * speed * dt) / across;
    v.x += ux * lift;
    v.y += uy * lift;
    v.z += uz * lift;
  }
  return body;
}

function motionDrift(body, flow, rate, dt) {
  const share = 1 - Math.exp(-rate * dt);
  const v = body.velocity;
  v.x += (flow.x - v.x) * share;
  v.y += (flow.y - v.y) * share;
  v.z += (flow.z - v.z) * share;
  return body;
}

function motionPendulum(o = {}) {
  const pendulum = {
    length: o.length ?? 0.2,
    angle: o.angle ?? 0, // from straight down, radians
    speed: o.speed ?? 0,
    gravity: o.gravity ?? 9.8,
    damping: o.damping ?? 0,
    step(dt) {
      pendulum.speed += (-(pendulum.gravity / pendulum.length) * Math.sin(pendulum.angle) - pendulum.damping * pendulum.speed) * dt;
      pendulum.angle += pendulum.speed * dt;
      return pendulum;
    },
  };
  return pendulum;
}

function motionSpring(o = {}) {
  const spring = {
    value: o.value ?? 0,
    speed: o.speed ?? 0,
    stiffness: o.stiffness ?? 120,
    damping: o.damping ?? null, // null: just enough not to overshoot
    step(dt, target) {
      const damping = spring.damping ?? 2 * Math.sqrt(spring.stiffness);
      spring.speed += ((target - spring.value) * spring.stiffness - damping * spring.speed) * dt;
      spring.value += spring.speed * dt;
      return spring.value;
    },
  };
  return spring;
}

function motionRope(THREE, o = {}) {
  const segments = Math.max(2, o.segments ?? 12);
  const points = [];
  const before = [];
  for (let i = 0; i <= segments; i++) {
    points.push(new THREE.Vector3());
    before.push(new THREE.Vector3());
  }
  const rope = {
    points,
    length: o.length ?? 0.3,
    gravity: o.gravity ?? 9.8,
    lay(from, to) {
      for (let i = 0; i <= segments; i++) {
        points[i].lerpVectors(from, to, i / segments);
        before[i].copy(points[i]);
      }
      return rope;
    },
    step(dt, from, to) {
      const part = rope.length / segments;
      const keep = 1 - (o.damping ?? 0.02);
      for (let i = 0; i <= segments; i++) {
        const p = points[i];
        const b = before[i];
        const vx = (p.x - b.x) * keep;
        const vy = (p.y - b.y) * keep;
        const vz = (p.z - b.z) * keep;
        b.copy(p);
        p.x += vx;
        p.y += vy - rope.gravity * dt * dt;
        p.z += vz;
      }
      // A rope pulls and never pushes: a part longer than it should be is drawn back in, a slack one is left.
      for (let pass = 0; pass < 12; pass++) {
        points[0].copy(from);
        if (to) points[segments].copy(to);
        for (let i = 0; i < segments; i++) {
          const a = points[i];
          const c = points[i + 1];
          const dx = c.x - a.x;
          const dy = c.y - a.y;
          const dz = c.z - a.z;
          const far = Math.hypot(dx, dy, dz);
          if (far <= part) continue;
          const pull = ((far - part) / far) * 0.5;
          a.x += dx * pull;
          a.y += dy * pull;
          a.z += dz * pull;
          c.x -= dx * pull;
          c.y -= dy * pull;
          c.z -= dz * pull;
        }
      }
      points[0].copy(from);
      if (to) points[segments].copy(to);
      return rope;
    },
  };
  return rope;
}

function motionTurning(weights, pivot = 0) {
  let turning = 0;
  for (const w of weights) turning += w.mass * (w.x - pivot);
  return turning;
}

function motionLever(o = {}) {
  const spring = motionSpring({ stiffness: o.stiffness ?? 40 });
  const lever = {
    angle: 0,
    limit: o.limit ?? 0.35, // how far it tips, radians
    give: o.give ?? 1, // the turning that tips it all the way
    step(dt, turning) {
      lever.angle = spring.step(dt, Math.max(-1, Math.min(1, turning / lever.give)) * lever.limit);
      return lever;
    },
    balanced(turning, share = 0.05) {
      return Math.abs(turning) <= share * lever.give;
    },
  };
  return lever;
}

function motionCentre(weights) {
  let mass = 0;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const w of weights) {
    mass += w.mass;
    x += w.mass * (w.x ?? 0);
    y += w.mass * (w.y ?? 0);
    z += w.mass * (w.z ?? 0);
  }
  return mass > 0 ? { x: x / mass, y: y / mass, z: z / mass, mass } : { x: 0, y: 0, z: 0, mass: 0 };
}

function motionTopples(x, baseMin, baseMax) {
  return x < baseMin || x > baseMax;
}

function motionPressure(depth, density = 1000, gravity = 9.8) {
  return depth > 0 ? density * gravity * depth : 0;
}

function motionFloat(mass, volume, density = 1000) {
  return volume > 0 ? mass / (volume * density) : Infinity;
}
