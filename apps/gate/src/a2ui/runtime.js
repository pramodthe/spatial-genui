// Spatial A2UI renderer: turns an A2UI v1.0 surface written against the spatial catalog
// (urn:spatial-genui:catalog:spatial:1.0, see catalog.ts) into the host's build() result.
//
// This file is shipped as source inside every compiled module (compile.ts), so it runs under the same
// host checks as agent-written code: plain JavaScript, no imports, no timers, no DOM, no globals the
// validator bans (it must not even use names like `parent` or `top` without declaring them).
// It is the only renderer code; versions C (A2UI) and D (templates) of the GenUI comparison both end here.

function renderSpatialA2UI(api, surface) {
  const THREE = api.THREE;
  const traits = api.traits;
  const ui = api.ui;
  const isGrabbed = api.isGrabbed;

  const specs = new Map();
  for (const c of surface.components) specs.set(c.id, c);
  const data = JSON.parse(JSON.stringify(surface.dataModel || {}));
  const nodes = new Map(); // component id -> Object3D
  const bindings = []; // { path, apply(value) }
  const animators = []; // { update(time, delta) }
  const highlighted = new Set();
  const homes = new Map(); // grabbable id -> starting position, for resetPositions
  const root = new THREE.Group();
  root.name = 'A2UI Scene';

  // --- Data model (JSON Pointer paths) -------------------------------------------------------------
  function pointer(path) {
    return String(path || '/').split('/').slice(1).map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  }
  function readPath(path) {
    let at = data;
    for (const key of pointer(path)) {
      if (at == null) return undefined;
      at = at[key];
    }
    return at;
  }
  function writePath(path, value) {
    const keys = pointer(path);
    if (keys.length === 0) return;
    let at = data;
    for (const key of keys.slice(0, -1)) {
      if (at[key] == null || typeof at[key] !== 'object') at[key] = {};
      at = at[key];
    }
    if (value === null) delete at[keys[keys.length - 1]];
    else at[keys[keys.length - 1]] = value;
    for (const b of bindings) if (b.path === path || b.path.indexOf(path + '/') === 0 || path.indexOf(b.path + '/') === 0) b.apply(readPath(b.path));
  }
  function resolve(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (typeof value['@path'] === 'string') return readPath(value['@path']);
      if (typeof value['@call'] === 'string') return call(value);
    }
    return value;
  }
  function bind(value, apply) {
    if (value && typeof value === 'object' && typeof value['@path'] === 'string') bindings.push({ path: value['@path'], apply });
    apply(resolve(value));
  }

  // --- Functions (local actions) --------------------------------------------------------------------
  function call(fn) {
    const args = fn.args || {};
    switch (fn['@call']) {
      case 'setData':
        writePath(args.path, resolve(args.value));
        return undefined;
      case 'highlight':
        setHighlight(args.target, args.on !== false, args.only === true);
        return undefined;
      case 'toggleVisible': {
        const node = nodes.get(args.target);
        if (node) node.visible = !node.visible;
        return undefined;
      }
      case 'setVisible': {
        const node = nodes.get(args.target);
        if (node) node.visible = args.visible !== false;
        return undefined;
      }
      case 'toggleMotion':
        for (const a of animators) if (a.id === args.target && a.toggle) a.toggle();
        return undefined;
      case 'resetPositions':
        for (const [id, home] of homes) {
          const node = nodes.get(id);
          if (node && !isGrabbed(node)) node.position.copy(home);
        }
        return undefined;
      case 'checkSort':
        writePath(args.resultPath || '/result', checkSort(args));
        return undefined;
      case 'run':
        // Steps may come wrapped as actions ({"functionCall": {...}}); both forms work.
        for (const step of args.calls || []) call(step && step.functionCall ? step.functionCall : step);
        return undefined;
      case 'formatString':
        return String(args.value || '').replace(/\$\{([^}]+)\}/g, (_, p) => {
          const v = readPath(p);
          return v == null ? '' : String(v);
        });
      default:
        return undefined;
    }
  }
  function runAction(action) {
    if (!action) return;
    if (action.functionCall) call(action.functionCall);
    // event actions go to the agent in A2UI; offline, a lesson has nobody to send them to: keep the
    // last one in the data model so a bound Text can show it.
    if (action.event && action.event.name) writePath('/lastEvent', action.event.name);
  }

  // Which grabbable items sit inside the right bin (by position on the desk, x and z).
  function checkSort(args) {
    const items = args.items || [];
    let right = 0;
    const at = new THREE.Vector3();
    for (const item of items) {
      const node = nodes.get(item.id);
      const bin = nodes.get(item.bin);
      if (!node || !bin) continue;
      // Both in world space: the lesson root is placed and turned on the desk.
      const box = new THREE.Box3().setFromObject(bin);
      node.getWorldPosition(at);
      if (at.x >= box.min.x && at.x <= box.max.x && at.z >= box.min.z && at.z <= box.max.z) right++;
    }
    if (right === items.length) return args.allRight || 'All ' + items.length + ' are in the right place!';
    return right + ' of ' + items.length + ' are in the right place. Keep going.';
  }

  // --- Highlight (emissive glow on every mesh of a node) ----------------------------------------------
  const GLOW = new THREE.Color('#ffc23d');
  function setHighlight(id, on, only) {
    if (only) for (const other of [...highlighted]) if (other !== id) setHighlight(other, false, false);
    const node = nodes.get(id);
    if (!node) return;
    node.traverse((o) => {
      if (!o.isMesh || !o.material || !o.material.emissive) return;
      if (!o.userData.baseEmissive) o.userData.baseEmissive = { color: o.material.emissive.clone(), intensity: o.material.emissiveIntensity };
      if (on) {
        o.material.emissive.copy(GLOW);
        o.material.emissiveIntensity = 0.6;
      } else {
        o.material.emissive.copy(o.userData.baseEmissive.color);
        o.material.emissiveIntensity = o.userData.baseEmissive.intensity;
      }
    });
    if (on) highlighted.add(id);
    else highlighted.delete(id);
  }

  // --- 3D components ---------------------------------------------------------------------------------
  const DEG = Math.PI / 180;
  const geometries = new Map();
  function geometry(spec) {
    const r = num(spec.radius, 0.03);
    const s = Array.isArray(spec.size) ? spec.size : [num(spec.size, r * 2), num(spec.size, r * 2), num(spec.size, r * 2)];
    const h = num(spec.height, 0.08);
    const key = [spec.shape, r, s.join(','), h, num(spec.tube, r * 0.3)].join('|');
    if (geometries.has(key)) return geometries.get(key);
    let g;
    switch (spec.shape) {
      case 'box': g = new THREE.BoxGeometry(s[0], s[1], s[2]); break;
      case 'cylinder': g = new THREE.CylinderGeometry(r, r, h, 28); break;
      case 'cone': g = new THREE.ConeGeometry(r, h, 28); break;
      case 'torus': g = new THREE.TorusGeometry(r, num(spec.tube, r * 0.3), 14, 40); break;
      case 'capsule': g = new THREE.CapsuleGeometry(r, h, 6, 16); break;
      case 'ring': g = new THREE.RingGeometry(r * 0.7, r, 40); break;
      default: g = new THREE.SphereGeometry(r, 28, 14);
    }
    geometries.set(key, g);
    return g;
  }
  function num(v, fallback) {
    return typeof v === 'number' && isFinite(v) ? v : fallback;
  }
  function place(object, spec) {
    const p = spec.position;
    if (Array.isArray(p)) object.position.set(num(p[0], 0), num(p[1], 0), num(p[2], 0));
    const r = spec.rotationDeg;
    if (Array.isArray(r)) object.rotation.set(num(r[0], 0) * DEG, num(r[1], 0) * DEG, num(r[2], 0) * DEG);
    else if (typeof r === 'number') object.rotation.y = num(r, 0) * DEG; // a single number turns around y
    if (typeof spec.scale === 'number') object.scale.setScalar(spec.scale);
    if (typeof spec.name === 'string') object.name = spec.name;
  }
  function build3D(id) {
    const spec = specs.get(id);
    let object;
    switch (spec.component) {
      case 'Shape': {
        const material = new THREE.MeshStandardMaterial({
          color: spec.color || '#9aa3ad',
          emissive: spec.emissive || '#000000',
          emissiveIntensity: spec.emissive ? 0.7 : 1,
          roughness: num(spec.roughness, 0.55),
          metalness: num(spec.metalness, 0.05),
          transparent: typeof spec.opacity === 'number' && spec.opacity < 1,
          opacity: num(spec.opacity, 1),
          side: spec.shape === 'ring' ? THREE.DoubleSide : THREE.FrontSide,
        });
        object = new THREE.Mesh(geometry(spec), material);
        break;
      }
      case 'Arrow': {
        object = new THREE.Group();
        const from = new THREE.Vector3().fromArray(spec.from || [0, 0, 0]);
        const to = new THREE.Vector3().fromArray(spec.to || [0.1, 0, 0]);
        const dir = to.clone().sub(from);
        const length = Math.max(dir.length(), 0.01);
        const radius = num(spec.radius, 0.004);
        const material = new THREE.MeshStandardMaterial({ color: spec.color || '#e8eaed', roughness: 0.6 });
        const head = Math.min(length * 0.35, radius * 6);
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length - head, 10), material);
        shaft.position.y = (length - head) / 2;
        const tip = new THREE.Mesh(new THREE.ConeGeometry(radius * 2.4, head, 14), material);
        tip.position.y = length - head / 2;
        object.add(shaft, tip);
        object.position.copy(from);
        object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
        break;
      }
      case 'Orbit':
      case 'Spin':
      case 'Group':
      default:
        object = new THREE.Group();
    }
    if (spec.component !== 'Arrow') place(object, spec);
    nodes.set(id, object);
    for (const childId of spec.children || []) object.add(buildNode(childId));
    // Orbit and Spin draw nothing: they move another top-level object (`target`), which can stay
    // grabbable because it is still a direct child of the scene. They start once every node exists.
    if (spec.component === 'Orbit') motions.push(() => addOrbit(id, spec));
    if (spec.component === 'Spin') motions.push(() => addSpin(id, spec));
    return object;
  }
  const motions = [];
  function addOrbit(id, spec) {
    const body = nodes.get(spec.target);
    if (!body) return;
    const center = Array.isArray(spec.center) ? spec.center : [0, 0, 0];
    const radius = num(spec.radius, 0.15);
    const period = Math.max(num(spec.periodSec, 20), 2);
    const tilt = num(spec.tiltDeg, 0) * DEG;
    let phase = num(spec.startDeg, 0) * DEG;
    let running = spec.running !== false;
    let last = -1;
    const state = {
      id,
      toggle() { running = !running; },
      update(time) {
        const dt = last < 0 ? 0 : time - last;
        last = time;
        if (!running || isGrabbed(body)) return;
        phase += (dt / period) * Math.PI * 2;
        const x = Math.cos(phase) * radius;
        const z = Math.sin(phase) * radius;
        body.position.set(center[0] + x, center[1] + z * Math.sin(tilt), center[2] + z * Math.cos(tilt));
      },
    };
    state.update(0);
    animators.push(state);
  }
  function addSpin(id, spec) {
    const node = nodes.get(spec.target);
    const axis = spec.axis === 'x' || spec.axis === 'z' ? spec.axis : 'y';
    const period = Math.max(num(spec.periodSec, 10), 1);
    let running = spec.running !== false;
    animators.push({
      id,
      toggle() { running = !running; },
      update(_time, delta) {
        if (running && node && !isGrabbed(node)) node.rotation[axis] += (delta / period) * Math.PI * 2;
      },
    });
  }

  // --- Panels: basic-catalog content as UIKitML ------------------------------------------------------
  const PANEL_PX = 500;
  const STYLE = [
    '.panel { width: ' + PANEL_PX + 'px; flex-direction: column; gap: 12px; padding-top: 20px; padding-bottom: 20px; padding-left: 24px; padding-right: 24px; border-radius: 18px; background-color: #1d2026; }',
    '.col { flex-direction: column; gap: 10px; }',
    '.row { flex-direction: row; gap: 10px; align-items: center; }',
    '.card { flex-direction: column; gap: 8px; padding-top: 14px; padding-bottom: 14px; padding-left: 16px; padding-right: 16px; border-radius: 14px; background-color: #2a2e36; }',
    '.h1 { color: #ffffff; font-size: 34px; font-weight: 700; }',
    '.h2 { color: #f2f4f7; font-size: 28px; font-weight: 700; }',
    '.body { color: #d7dbe2; font-size: 24px; }',
    '.caption { color: #aeb4bf; font-size: 20px; }',
    '.btn { padding-top: 12px; padding-bottom: 12px; padding-left: 18px; padding-right: 18px; border-radius: 12px; background-color: #2f6fdb; }',
    '.btn2 { padding-top: 12px; padding-bottom: 12px; padding-left: 18px; padding-right: 18px; border-radius: 12px; background-color: #3a3f48; }',
    '.btn-text { color: #ffffff; font-size: 24px; font-weight: 700; }',
    '.divider { height: 2px; background-color: #3a3f48; }',
  ].join('\n');

  function escapeText(text) {
    return String(text == null ? '' : text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  // Markup for a basic-catalog subtree; `wire` collects what to connect once the panel exists.
  function markup(id, wire) {
    const spec = specs.get(id);
    const kids = (list) => (list || []).map((k) => markup(k, wire)).join('');
    switch (spec.component) {
      case 'Column': return '<div id="' + id + '" class="col">' + kids(spec.children) + '</div>';
      case 'Row': return '<div id="' + id + '" class="row">' + kids(spec.children) + '</div>';
      case 'Card': return '<div id="' + id + '" class="card">' + kids(spec.child ? [spec.child] : spec.children) + '</div>';
      case 'Divider': return '<div id="' + id + '" class="divider"></div>';
      case 'Text': {
        const variant = ['h1', 'h2', 'body', 'caption'].indexOf(spec.variant) >= 0 ? spec.variant : 'body';
        wire.texts.push({ id, value: spec.text });
        const initial = resolve(spec.text);
        return '<span id="' + id + '" class="' + variant + '">' + escapeText(initial) + '</span>';
      }
      case 'Button': {
        wire.buttons.push({ id, action: spec.action });
        // A Text child is the label: keep the button's text style.
        const label = spec.child ? specs.get(spec.child) : null;
        let inner;
        if (label && label.component === 'Text') {
          wire.texts.push({ id: spec.child, value: label.text });
          inner = '<span id="' + spec.child + '" class="btn-text">' + escapeText(resolve(label.text)) + '</span>';
        } else {
          inner = spec.child ? markup(spec.child, wire) : '<span class="btn-text">' + escapeText(resolve(spec.label)) + '</span>';
        }
        return '<button id="' + id + '" class="' + (spec.variant === 'secondary' ? 'btn2' : 'btn') + '">' + inner + '</button>';
      }
      default:
        return '';
    }
  }
  function panel(contentMarkup, spec) {
    const position = Array.isArray(spec.position) ? spec.position : [0, 0.25, 0];
    const handle = ui('<style>\n' + STYLE + '\n</style><div class="panel">' + contentMarkup + '</div>', {
      width: Math.min(Math.max(num(spec.width, 0.32), 0.2), 0.6),
      position,
      // Panels only turn around y: [x, y, z] or a single number both work.
      rotationY: Math.max(-0.4, Math.min(0.4, num(Array.isArray(spec.rotationDeg) ? spec.rotationDeg[1] : spec.rotationDeg, 0) * DEG)),
    });
    return handle;
  }
  function wirePanel(handle, wire) {
    for (const t of wire.texts) {
      // Button labels inside a Text keep the button's text style.
      bind(t.value, (v) => handle.set(t.id, { text: v == null ? '' : String(v) }));
    }
    for (const b of wire.buttons) handle.on(b.id, 'click', () => runAction(b.action));
  }
  function buildPanel(id) {
    const spec = specs.get(id);
    const wire = { texts: [], buttons: [] };
    const handle = panel(markup(spec.child, wire), spec);
    wirePanel(handle, wire);
    nodes.set(id, handle.object3D);
    return handle.object3D;
  }

  function buildQuiz(id) {
    const spec = specs.get(id);
    const options = (spec.options || []).slice(0, 4);
    const answer = num(spec.answer, 0);
    const optionMarkup = options.map((o, i) => '<button id="' + id + '_o' + i + '" class="btn2"><span class="btn-text">' + escapeText(o) + '</span></button>').join('');
    const content =
      '<span class="caption">QUIZ</span>' +
      '<span id="' + id + '_q" class="h2">' + escapeText(spec.question) + '</span>' +
      '<div class="col">' + optionMarkup + '</div>' +
      '<span id="' + id + '_fb" class="body">Pick an answer.</span>';
    const handle = panel(content, spec);
    options.forEach((_, i) => {
      handle.on(id + '_o' + i, 'click', () => {
        const right = i === answer;
        options.forEach((__, j) => handle.set(id + '_o' + j, { backgroundColor: j === answer && right ? '#1f8a4c' : j === i ? '#b3263e' : '#3a3f48' }));
        handle.set(id + '_fb', { text: (right ? 'Correct! ' : 'Not quite. ') + (spec.explanation || '') });
        if (spec.resultPath) writePath(spec.resultPath, right);
      });
    });
    nodes.set(id, handle.object3D);
    return handle.object3D;
  }

  function buildTour(id) {
    const spec = specs.get(id);
    const steps = spec.steps || [];
    let index = 0;
    const content =
      (spec.title ? '<span class="h1">' + escapeText(spec.title) + '</span>' : '') +
      '<span id="' + id + '_n" class="caption">Step 1 of ' + steps.length + '</span>' +
      '<span id="' + id + '_t" class="h2">' + escapeText(steps[0] && steps[0].title) + '</span>' +
      '<span id="' + id + '_b" class="body">' + escapeText(steps[0] && steps[0].body) + '</span>' +
      '<div class="row"><button id="' + id + '_prev" class="btn2"><span class="btn-text">Back</span></button>' +
      '<button id="' + id + '_next" class="btn"><span class="btn-text">Next</span></button></div>';
    const handle = panel(content, spec);
    const show = () => {
      const step = steps[index] || {};
      handle.set(id + '_n', { text: 'Step ' + (index + 1) + ' of ' + steps.length });
      handle.set(id + '_t', { text: step.title || '' });
      handle.set(id + '_b', { text: step.body || '' });
      for (const other of [...highlighted]) setHighlight(other, false, false);
      for (const target of step.highlight || []) setHighlight(target, true, false);
      for (const target of step.show || []) { const n = nodes.get(target); if (n) n.visible = true; }
      for (const target of step.hide || []) { const n = nodes.get(target); if (n) n.visible = false; }
      if (step.action) runAction(step.action);
    };
    handle.on(id + '_next', 'click', () => { index = Math.min(index + 1, steps.length - 1); show(); });
    handle.on(id + '_prev', 'click', () => { index = Math.max(index - 1, 0); show(); });
    nodes.set(id, handle.object3D);
    tours.push(show);
    return handle.object3D;
  }
  const tours = [];

  function buildNode(id) {
    const spec = specs.get(id);
    switch (spec.component) {
      case 'Panel': return buildPanel(id);
      case 'QuizCard': return buildQuiz(id);
      case 'StepTour': return buildTour(id);
      default: return build3D(id);
    }
  }

  // --- The scene --------------------------------------------------------------------------------------
  const scene = specs.get('root');
  for (const id of scene.children || []) {
    const object = buildNode(id);
    root.add(object);
    const spec = specs.get(id);
    // Hand interaction: only direct children of root can carry traits (host rule).
    const press = spec.action ? () => runAction(spec.action) : undefined;
    if (spec.grab || press) {
      traits(object, { grab: spec.grab === true, onPress: press });
      if (spec.grab) homes.set(id, object.position.clone());
    }
  }
  // Motions and tours start once everything exists (a tour's first step may highlight anything).
  for (const start of motions) start();
  for (const show of tours) show();

  return {
    root,
    update(time, delta) {
      for (const a of animators) a.update(time, delta);
    },
  };
}
