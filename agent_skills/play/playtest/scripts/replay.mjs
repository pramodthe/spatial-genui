// Runs inside Meta's managed browser (`iwsdk browser run`, copied into the app's workspace by playtest.mjs --play),
// after mount.mjs has opened the game: plays the game's own play block (learning-game references/play.md) with IWSDK's
// emulated hand in the real app, the way the gate's play-through does with its simulated hand. A browser script may
// run 110 s at most, so each call does one step (REPLAY_STEP, REPLAY_INDEX) and playtest.mjs runs them in order:
//   plan            how many moves the play block has, and the phase the game is in
//   move <i>        the gesture of move i, then whether the move registered
//   start           Start (play.start, else the panel's start button), then whether a round began
//   challenge <i>   gesture i of the round (the challenge's gestures are fixed when the round starts)
//   end             wait for the round to end, then its phase, result and stars
// Each prints JSON.
export default async function run({ frame, page }) {
  const t = frame ?? page;
  await t.waitForFunction(() => Boolean(window.genui && window.IWER_DEVICE), null, { timeout: 30000 });
  const step = process.env.REPLAY_STEP || 'plan';
  const index = Number(process.env.REPLAY_INDEX || 0);
  return t.evaluate(async ({ step, index }) => {
    const MOVE_WAIT_MS = 5000; // a move's answer may come when what it set off has settled (play.ts MOVE_WAIT_S)
    const START_WAIT_MS = 3000;
    const SHOWN_WAIT_MS = 5000; // a hidden thing is waited for (play.ts SHOWN_WAIT_S): a piece back once a move settles
    const ROUND_END_WAIT_MS = 30000; // after the last challenge gesture (play.ts ROUND_END_WAIT_S)
    const UNTIL_MAX_S = 20;
    const STEP_S = 0.3; // a hold follows its place in steps this long

    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const remote = window.IWER_DEVICE.remote;
    const play = window.genui.debugPlay?.();
    const root = window.genui.debugRoot?.();
    if (!root) return { ok: false, error: 'Nothing is open: run the play-test first.' };
    if (!play || typeof play.state !== 'function') return { ok: false, error: 'The game has no play block with state() (references/play.md).' };

    // three.js classes from the game's own objects: the page has no `THREE` of its own.
    const Vec = root.position.constructor;
    let Box = null;
    root.traverse((o) => {
      if (Box || !o.geometry) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      Box = o.geometry.boundingBox?.constructor ?? null;
    });

    const state = () => {
      try {
        return JSON.parse(JSON.stringify(play.state() ?? null));
      } catch (err) {
        return { error: String(err?.message ?? err) };
      }
    };
    const call = (value) => (typeof value === 'function' ? value() : value);
    // run-sequence positions are relative to the XR origin (the player), which a world moves when it opens: room
    // positions are turned into the player's frame. The player holds the head (xr-origin-head).
    let top = root;
    while (top.parent) top = top.parent;
    const head = top.getObjectByName('xr-origin-head');
    const player = head?.parent ?? null;
    const xyz = (v) => {
      const at = player ? player.worldToLocal(v.clone()) : v;
      return { x: +at.x.toFixed(4), y: +at.y.toFixed(4), z: +at.z.toFixed(4) };
    };
    // A place: an object (its centre, wherever it is now), [x, y, z] or a vector in the game's own units, or a function
    // returning one of these.
    // The emulator's XR origin is the room's origin, so a world position is a run-sequence position.
    const where = (place) => {
      const p = call(place);
      if (p && p.isObject3D) {
        if (Box) {
          const box = new Box().setFromObject(p);
          if (!box.isEmpty()) return xyz(box.getCenter(new Vec()));
        }
        return xyz(p.getWorldPosition(new Vec()));
      }
      if (Array.isArray(p) && p.length === 3) return xyz(root.localToWorld(new Vec(p[0], p[1], p[2])));
      // A vector ({ x, y, z }, as the gate's play-through also takes), in the game's own units.
      if (p && [p.x, p.y, p.z].every((n) => typeof n === 'number')) return xyz(root.localToWorld(new Vec(p.x, p.y, p.z)));
      throw new Error(`a place that is not an object, [x, y, z] or a vector (${JSON.stringify(p)})`);
    };
    // A pressable object by its name when no other object in the game has that name (the target resolver finds it
    // and presses its surface), else by its centre.
    const pressAt = (object) => {
      let same = 0;
      if (object?.name) root.traverse((o) => { if (o.name === object.name) same += 1; });
      return same === 1 ? { target: object.name } : { position: where(object) };
    };
    // The hand's pose, as the gate's simulated hand turns it (play.ts): fingers away from the player, tilt tips them
    // down (a jug pours), roll lowers the right side (a bar steers), yaw turns them right. Read again every step.
    const Euler = root.rotation.constructor;
    const LEVEL = { fingers: 'forward', palm: 'down' };
    const orientation = (g) => {
      const angle = (value) => Number(call(value) || 0) * Math.PI / 180;
      const tilt = angle(g.tilt), roll = angle(g.roll), yaw = angle(g.yaw);
      if (!tilt && !roll && !yaw) return LEVEL;
      const turn = new Euler(-tilt, -yaw, -roll, 'YXZ');
      const along = (v) => [v.x, v.y, v.z].map((n) => +n.toFixed(4));
      return { fingers: along(new Vec(0, 0, -1).applyEuler(turn)), palm: along(new Vec(0, -1, 0).applyEuler(turn)) };
    };
    const run = async (device, steps) => {
      const answer = await remote.dispatch('run_sequence', { device, steps, idleHand: 'keep' });
      if (answer && answer.completed === false && !answer.cancelled) throw new Error(`run_sequence did not complete: ${JSON.stringify(answer).slice(0, 200)}`);
      return answer;
    };
    const handlerCalls = () => Number(window.genui.inspect()?.handlerCalls ?? 0);
    // Hold the hand 30 cm from a place on the player's side of it, its ray on the place. Returns where the hand is.
    const pointFrom = async (device, at) => {
      const eye = head ? xyz(head.getWorldPosition(new Vec())) : { x: 0, y: 1.6, z: 0 };
      const toward = new Vec(eye.x - at.x, 0, eye.z - at.z);
      if (toward.lengthSq() < 1e-6) toward.set(0, 0, 1);
      toward.normalize().multiplyScalar(0.3);
      const from = { x: at.x + toward.x, y: at.y + 0.03, z: at.z + toward.z };
      await remote.dispatch('set_transform', { device, position: from });
      await remote.dispatch('look_at', { device, target: at });
      await wait(200);
      return from;
    };
    // Point the hand's ray at a place and pinch once (a press).
    const point = async (device, at) => {
      await pointFrom(device, at);
      await remote.dispatch('select', { device, duration: 0.2 });
      await wait(250);
    };
    // Whether the host takes this piece by its ray (inspect() grabbables, mode 'ray'), not by a near pinch.
    const byRay = (object) => Boolean(object?.isObject3D && (window.genui.inspect()?.grabbables || []).some((e) => e.name === object.name && e.mode === 'ray'));
    const describe = (g) => Object.keys(g ?? {}).filter((k) => !['hand', 'seconds', 'until', 'tilt', 'roll', 'yaw', 'keep'].includes(k)).join('+') || 'nothing';
    const until = async (test, ms) => {
      const started = performance.now();
      while (performance.now() - started < ms) {
        if (test()) return true;
        await wait(100);
      }
      return test();
    };

    const shown = (o) => {
      for (let x = o; x; x = x.parent) if (x.visible === false) return false;
      return true;
    };
    // The hand waits for a hidden object it is sent to, as the gate's simulated hand does.
    const whenShown = async (place) => {
      const p = call(place);
      if (p?.isObject3D && !(await until(() => shown(p), SHOWN_WAIT_MS))) throw new Error(`${p.name || 'what the hand wants'} stayed hidden for ${SHOWN_WAIT_MS / 1000} s`);
    };

    /** One gesture of the play block, as the emulated hand. */
    // Which hands still hold what a gesture with `keep` took, across replay steps: a later pinching gesture of that
    // hand carries on holding instead of pinching again (which would let go first).
    const holding = (window.__playtestHolding ??= {});
    const perform = async (g) => {
      const device = g.hand === 'left' ? 'hand-left' : 'hand-right';
      const pose = orientation(g);
      // A hand about to pinch arrives level and turns once it holds the thing, as play.ts does: the jug is taken
      // upright and then tipped, the knob taken and then turned. A hand that already holds turns at once.
      const reachPose = holding[device] ? pose : LEVEL;
      for (const key of ['grab', 'press', 'hold']) if (key in g) await whenShown(g[key]);
      if ('grab' in g && byRay(call(g.grab))) {
        // Pieces too close together for a near pinch are taken by pointing and pinching, and move with the hand
        // (the host's DistanceGrabbable, MoveAtSource): the hand points from 30 cm, pinches, moves by the carry.
        const at = where(g.grab);
        const end = Array.isArray(g.path) ? g.path[g.path.length - 1] : g.to;
        const to = end === undefined ? at : where(end);
        const from = await pointFrom(device, at);
        await remote.dispatch('set_select_value', { device, value: 1, duration: 0.1 });
        await wait(150);
        const by = { x: to.x - at.x, y: to.y - at.y, z: to.z - at.z };
        await remote.dispatch('animate_to', { device, position: { x: from.x + by.x, y: from.y + by.y, z: from.z + by.z }, duration: Math.max(0.3, Number(g.seconds ?? 0.6)), easing: 'minimum-jerk' });
        await wait(150);
        // A grab with `until` holds the piece where it was carried until that is true, as a near grab does.
        if (typeof g.until === 'function' && !g.throw && !(await until(() => g.until(), UNTIL_MAX_S * 1000))) {
          throw new Error(`what the grab waits for (until) had not happened after ${UNTIL_MAX_S} s`);
        }
        if (!g.keep) await remote.dispatch('set_select_value', { device, value: 0, duration: 0.1 });
        holding[device] = Boolean(g.keep);
        await wait(250);
        return null;
      }
      if ('grab' in g) {
        // anchor 'grasp': the point between thumb and index goes to the place (a position alone places the ray).
        const steps = [{ label: 'grab', position: where(g.grab), anchor: 'grasp', orientation: reachPose, approach: { distance: 0.06 }, pinch: { value: 1, at: 'arrival' } }];
        let last = where(g.grab);
        if (Array.isArray(g.path)) {
          for (const place of g.path) steps.push({ label: 'carry', position: (last = where(place)), orientation: pose, duration: Math.max(0.05, Number(g.seconds ?? 0.6) / g.path.length) });
        } else if ('to' in g) {
          steps.push({ label: 'carry', position: (last = where(g.to)), orientation: pose, ...(g.seconds ? { duration: Number(g.seconds) } : {}) });
        } else if (pose !== LEVEL) steps.push({ label: 'turn', position: last, orientation: pose, duration: 0.3 });
        const waits = typeof g.until === 'function' && !g.throw;
        if (waits) {
          // Held where it was carried until what the gesture waits for has happened (a jug over the bowl, pouring).
          await run(device, steps.splice(0));
          const started = performance.now();
          while (performance.now() - started < UNTIL_MAX_S * 1000 && !g.until()) {
            await run(device, [{ label: 'hold', position: last, orientation: orientation(g), duration: STEP_S }]);
          }
          if (!g.until()) throw new Error(`what the grab waits for (until) had not happened after ${UNTIL_MAX_S} s`);
        }
        if (!g.keep) steps.push({ label: 'let go', pinch: 0, duration: g.throw ? 0.05 : 0.15 });
        holding[device] = Boolean(g.keep);
        return steps.length ? run(device, steps) : null;
      }
      if ('press' in g) {
        // A player pokes a 3D button; when the poke reaches no handler, a pointed pinch (the hand's ray) does.
        const object = call(g.press);
        const calls = handlerCalls();
        await run(device, [{ label: 'press', ...pressAt(object), press: {} }]);
        await wait(250);
        if (handlerCalls() > calls) return null;
        await point(device, where(object));
        if (handlerCalls() === calls) throw new Error(`neither a poke nor a pointed pinch pressed ${object?.name || 'it'}`);
        return null;
      }
      if ('button' in g) {
        // A panel button is pressed by pointing at it and pinching (the hands smoke test's way: a poke did not click).
        const button = (window.genui.inspect()?.panelButtons || []).find((b) => b.id === String(g.button));
        if (!button) throw new Error(`no panel button '${g.button}' can be pressed now`);
        const at = xyz(new Vec(button.center[0], button.center[1], button.center[2]));
        // Out of reach for a player who stands where the game opens (an arm is about 0.8 m): say so, not "missed".
        const away = Math.hypot(at.x, at.z);
        if (away > 1.5) throw new Error(`the panel button '${g.button}' is ${away.toFixed(1)} m from where the player stands: out of reach`);
        const calls = handlerCalls();
        await point(device, at);
        if (handlerCalls() === calls) throw new Error(`pointing at '${g.button}' and pinching did not press it`);
        return null;
      }
      if ('hold' in g) {
        const limit = Number(g.seconds ?? (g.until ? UNTIL_MAX_S : 1)) * 1000;
        const started = performance.now();
        const pinchNow = g.pinch && !holding[device];
        await run(device, [{ label: 'hold', position: where(g.hold), anchor: g.pinch ? 'grasp' : 'index-tip', orientation: pinchNow ? LEVEL : pose, ...(pinchNow ? { pinch: { value: 1, at: 'arrival' } } : {}) }]);
        while (performance.now() - started < limit && !(g.until && g.until())) {
          await run(device, [{ label: 'follow', position: where(g.hold), anchor: g.pinch ? 'grasp' : 'index-tip', orientation: orientation(g), duration: STEP_S }]);
        }
        if (g.until && !g.until()) throw new Error(`what the hold waits for (until) had not happened after ${limit / 1000} s`);
        if (g.pinch && !g.keep) await run(device, [{ label: 'let go', pinch: 0, duration: 0.15 }]);
        holding[device] = Boolean(g.pinch && g.keep);
        return null;
      }
      if ('path' in g) {
        const points = g.path.map(where);
        const each = Math.max(0.05, Number(g.seconds ?? 1) / points.length);
        const steps = points.map((position, i) => ({ label: `path ${i + 1}`, position, orientation: i === 0 && g.pinch ? reachPose : pose, duration: each, ...(i === 0 ? { anchor: 'index-tip', pinch: g.pinch ? 1 : 0 } : {}) }));
        if (g.pinch && !g.keep) steps.push({ label: 'let go', pinch: 0, duration: 0.15 });
        return run(device, steps);
      }
      if ('wait' in g) {
        const limit = Number(g.wait ?? g.seconds ?? (g.until ? UNTIL_MAX_S : 1)) * 1000;
        const started = performance.now();
        while (performance.now() - started < limit && !(g.until && g.until())) await wait(100);
        return null;
      }
      throw new Error(`an unknown gesture (${describe(g)})`);
    };
    const attempt = async (g) => {
      try {
        await perform(g);
        return null;
      } catch (err) {
        return String(err?.message ?? err);
      }
    };
    const errors = () => (window.genui.state?.runtimeErrors || []).slice(-5);

    if (step === 'plan') {
      window.__playtestHolding = {}; // a fresh game: no hand holds anything yet
      return { ok: true, moves: Array.isArray(play.learn) ? play.learn.length : 0, state: state() };
    }
    if (step === 'move') {
      const g = (play.learn || [])[index];
      const before = state();
      if (!g || before.phase !== 'learn') return { ok: false, move: index + 1, skipped: true, state: before };
      const error = await attempt(g);
      const registered = await until(() => { const now = state(); return now.move > before.move || now.phase !== 'learn'; }, MOVE_WAIT_MS);
      return { ok: registered, move: index + 1, gesture: describe(g), registered, ...(error ? { error } : {}), state: state(), runtimeErrors: errors() };
    }
    if (step === 'start') {
      if (state().phase !== 'play') {
        const g = play.start ?? { button: 'start' };
        const error = await attempt(g);
        const began = await until(() => state().phase === 'play', START_WAIT_MS);
        if (!began) return { ok: false, gesture: describe(g), began, ...(error ? { error } : {}), state: state() };
      }
      // The round's gestures are fixed as the round starts (a function may depend on how the round began).
      window.__playtestChallenge = typeof play.challenge === 'function' ? play.challenge() : play.challenge ?? [];
      return { ok: true, began: true, gestures: window.__playtestChallenge.length, state: state() };
    }
    if (step === 'challenge') {
      const g = (window.__playtestChallenge || [])[index];
      if (!g || state().phase === 'done') return { ok: true, skipped: true, state: state() };
      const error = await attempt(g);
      return { ok: !error, gesture: describe(g), ...(error ? { error } : {}), state: state() };
    }
    if (step === 'end') {
      await until(() => state().phase === 'done', ROUND_END_WAIT_MS);
      const round = state();
      return { ok: round.phase === 'done' && typeof round.result === 'number', round, runtimeErrors: errors() };
    }
    return { ok: false, error: `unknown replay step '${step}'` };
  }, { step, index });
}
