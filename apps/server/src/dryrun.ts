import vm from 'node:vm';
import * as THREE from 'three';
import { parse as parseUIKitML } from '@drawcall/uikitml';

export type SceneStats = {
  meshes: number;
  drawCalls: number;
  triangles: number;
  panels: number;
  grabbables: number;
  /** Grabbable pairs closer than MIN_GRAB_GAP_M; the host switches those objects to ray grab. */
  crowdedGrabPairs: number;
  pressables: number;
  size: [number, number, number];
};

export type DryRunResult =
  | { ok: true; stats: SceneStats; warnings: string[] }
  | { ok: false; error: string };

// Initial Quest budgets for one generated scene; tune on device in Phase 4.
const MAX_TRIANGLES = 150_000;
const MAX_DRAW_CALLS = 150;
const COMFORT_SIZE_M = 1.0;
const TIMEOUT_MS = 2000;
// A near-hand pinch grabs everything within a few centimetres; closer grabbables are "crowded".
const MIN_GRAB_GAP_M = 0.04;
const MAX_PANEL_YAW = 0.4; // ~23°: at 40° judges already saw text as steeply angled
// Smallest text height in the headset; ~1.2 cm reads comfortably at seated distance (~0.55 m).
const MIN_TEXT_CM = 1.1;

/**
 * Execute a validated, transformed module in a VM context with real Three.js and stub host APIs,
 * so crashes, infinite loops, bad UI markup and over-budget scenes are caught before the code ever
 * reaches the headset. Node's vm is NOT a security boundary: only call this inside the sandbox
 * process (sandbox.ts); everywhere else use `dryRun` from sandbox.ts.
 */
export function dryRunUnsafe(transformed: string, assets: Record<string, AssetStub> = {}): DryRunResult {
  const traitTargets: { object: unknown; grab: boolean; press: boolean }[] = [];
  const panels: { markup: string; options: any; holder: THREE.Group }[] = [];

  const api = {
    THREE,
    traits(object: unknown, options: any = {}) {
      traitTargets.push({ object, grab: Boolean(options.grab), press: typeof options.onPress === 'function' });
      return object;
    },
    ui(markup: unknown, options: any = {}) {
      // Place the holder exactly like the browser host does, so placement checks see the same panel.
      const holder = new THREE.Group();
      const [x = 0, y = 0, z = 0] = Array.isArray(options?.position) ? options.position : [];
      holder.position.set(x, y, z);
      holder.rotation.y = typeof options?.rotationY === 'number' ? options.rotationY : 0;
      panels.push({ markup: String(markup), options, holder });
      return { object3D: holder, on() {}, set() {} };
    },
    assets: {
      get(id: string) {
        const entry = assets[id];
        if (!entry) throw new Error(`Unknown library asset '${id}'. Available: ${Object.keys(assets).join(', ') || 'none'}.`);
        return stubAsset(entry, api.ui);
      },
    },
    isGrabbed() {
      return false;
    },
  };

  const context = vm.createContext({ __exports: {}, __api: api, console: { log() {}, warn() {}, error() {} } });
  let result: any;
  try {
    // Browsers load the module as an ES module, which is always strict: an assignment to an
    // undeclared name throws there, so it must throw here too. Same line, so line numbers match.
    vm.runInContext(`'use strict'; ${transformed}`, context, { filename: 'component.js', timeout: TIMEOUT_MS });
    vm.runInContext(
      `__result = __exports.default(__api);
       if (__result && typeof __result.update === 'function') {
         for (let i = 0; i < 10; i++) __result.update(i * 0.1, 0.1);
       }`,
      context,
      { filename: 'host-call.js', timeout: TIMEOUT_MS },
    );
    result = (context as any).__result;
  } catch (err) {
    return { ok: false, error: describeRuntimeError(err) };
  }

  if (typeof (context as any).__exports.default !== 'function') {
    return { ok: false, error: 'The default export must be a function `build(api)`.' };
  }
  const root = result?.root;
  if (!(root instanceof THREE.Object3D)) {
    return { ok: false, error: 'build(api) must return `{ root, update? }` where `root` is a THREE.Object3D.' };
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  const descendants = new Set<unknown>();
  root.traverse((o) => descendants.add(o));
  for (const t of traitTargets) {
    if (!descendants.has(t.object)) errors.push('traits() was called on an object that is not inside `root`. Add it to root.');
  }

  panels.forEach((p, i) => {
    if (!descendants.has(p.holder)) errors.push(`Panel ${i + 1}: add \`handle.object3D\` returned by ui() to root.`);
    // Text stays readable only on upright panels turned no more than ~40° from the user.
    const tilt = Math.max(Math.abs(p.holder.rotation.x), Math.abs(p.holder.rotation.z));
    if (tilt > 0.05) errors.push(`Panel ${i + 1} is tilted (rotation.x/z); keep panels upright and only turn them with rotationY.`);
    if (Math.abs(p.holder.rotation.y) > MAX_PANEL_YAW) {
      errors.push(`Panel ${i + 1} is turned ${Math.round((Math.abs(p.holder.rotation.y) * 180) / Math.PI)}° away from the user; keep rotationY within -0.4..0.4 rad (23°) so its text stays readable.`);
    }
    const width = p.options?.width;
    if (typeof width !== 'number' || !(width >= 0.05 && width <= 1.5)) {
      errors.push(`Panel ${i + 1}: ui(markup, { width }) needs a width in meters between 0.05 and 1.5.`);
    }
    if (typeof width === 'number' && width > 0) {
      const size = panelTextSize(p.markup, width);
      if (size === 'no-root-width') {
        errors.push(`Panel ${i + 1}: give its root element an explicit width in px (400-600px) so text wraps instead of stretching and shrinking the panel.`);
      } else if (size && size.minTextCm < MIN_TEXT_CM) {
        const needPx = Math.ceil((MIN_TEXT_CM * 1.1 * size.rootPx) / (width * 100));
        const needWidth = Math.min(1.5, (MIN_TEXT_CM * 1.1 * size.rootPx) / (size.minFontPx * 100));
        errors.push(`Panel ${i + 1}: its smallest text would be ${size.minTextCm.toFixed(1)} cm tall in the headset (font-size ${size.minFontPx}px in a ${size.rootPx}px-wide panel shown ${width} m wide); make it at least 1.2 cm: raise that font-size to ${needPx}px or the ui() width to ${needWidth.toFixed(2)} m.`);
      }
    }
    const parsed = parseUIKitML(p.markup, {});
    if (!parsed.success) {
      const details = parsed.errors
        .map((e: any) => `${e.message}${e.range ? ` (markup line ${e.range.start.line + 1}, col ${e.range.start.column + 1})` : ''}`)
        .join('; ');
      errors.push(`Panel ${i + 1} UIKitML error: ${details}`);
    }
  });

  let meshes = 0;
  let drawCalls = 0;
  let triangles = 0;
  root.updateMatrixWorld(true);
  root.traverse((o: any) => {
    if (!o.isMesh && !o.isLine && !o.isPoints) return;
    meshes++;
    drawCalls++;
    // A library part's stand-in counts as the real mesh it replaces.
    if (o.userData?.stubTriangles) {
      triangles += o.userData.stubTriangles;
      return;
    }
    const geometry = o.geometry as THREE.BufferGeometry | undefined;
    if (!o.isMesh || !geometry) return;
    const count = geometry.index ? geometry.index.count : geometry.attributes.position?.count ?? 0;
    triangles += Math.floor(count / 3) * (o.isInstancedMesh ? o.count : 1);
  });

  const crowdedPairs = findCrowdedPairs(traitTargets.filter((t) => t.grab).map((t) => t.object as THREE.Object3D));
  if (meshes === 0 && panels.length === 0) errors.push('The scene is empty: root contains no meshes and no panels.');
  if (triangles > MAX_TRIANGLES) errors.push(`Too many triangles (${triangles} > ${MAX_TRIANGLES}). Lower geometry segment counts or use InstancedMesh.`);
  if (drawCalls > MAX_DRAW_CALLS) errors.push(`Too many draw calls (${drawCalls} > ${MAX_DRAW_CALLS}). Merge or instance repeated meshes.`);

  const box = new THREE.Box3().setFromObject(root);
  const size = box.isEmpty() ? new THREE.Vector3() : box.getSize(new THREE.Vector3());
  if (![size.x, size.y, size.z].every(Number.isFinite)) {
    errors.push('Scene bounds are not finite (NaN or Infinity in positions or scales).');
  } else if (Math.max(size.x, size.y, size.z) > COMFORT_SIZE_M) {
    warnings.push(`Scene is ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} m; the host will scale it down to fit the seated reach zone.`);
  }

  if (errors.length > 0) return { ok: false, error: errors.join('\n') };
  return {
    ok: true,
    warnings,
    stats: {
      meshes,
      drawCalls,
      triangles,
      panels: panels.length,
      grabbables: traitTargets.filter((t) => t.grab).length,
      crowdedGrabPairs: crowdedPairs.length,
      pressables: traitTargets.filter((t) => t.press).length,
      size: [round(size.x), round(size.y), round(size.z)],
    },
  };
}

/** Pairs of grabbable objects whose bounding spheres are too close for a single-object pinch. */
function findCrowdedPairs(grabbables: THREE.Object3D[]): [string, string][] {
  // Half the largest precise-box dimension: exact for spheres, and rotation doesn't inflate it.
  const spheres = grabbables.map((object, i) => {
    const box = new THREE.Box3().setFromObject(object, true);
    const size = box.getSize(new THREE.Vector3());
    return {
      label: object.name || `grabbable #${i + 1}`,
      sphere: new THREE.Sphere(box.getCenter(new THREE.Vector3()), Math.max(size.x, size.y, size.z) / 2),
    };
  });
  const pairs: [string, string][] = [];
  for (let i = 0; i < spheres.length; i++) {
    for (let j = i + 1; j < spheres.length; j++) {
      const a = spheres[i];
      const b = spheres[j];
      const gap = a.sphere.center.distanceTo(b.sphere.center) - a.sphere.radius - b.sphere.radius;
      if (gap < MIN_GRAB_GAP_M) pairs.push([a.label, b.label]);
    }
  }
  return pairs;
}

/**
 * Smallest text height (cm) a panel shows in the headset. The host scales the panel so its root
 * width maps to the requested ui() width, so text height = width_m * font_px / root_px.
 */
function panelTextSize(markup: string, widthM: number): { minTextCm: number; minFontPx: number; rootPx: number } | 'no-root-width' | null {
  const style = markup.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  const rules = new Map<string, string>();
  for (const m of style.matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) rules.set(m[1], (rules.get(m[1]) ?? '') + ';' + m[2]);
  const body = markup.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<!--[\s\S]*?-->/g, '');
  const root = body.match(/<\w+([^>]*)>/)?.[1] ?? '';
  const rootDecls = [
    ...(root.match(/class="([^"]+)"/)?.[1]?.split(/\s+/) ?? []).map((c) => rules.get(c) ?? ''),
    root.match(/style="([^"]+)"/)?.[1] ?? '',
  ].join(';');
  const rootPx = Number(rootDecls.match(/(?:^|[;\s])width:\s*(\d+(?:\.\d+)?)px/)?.[1]);
  // Only font sizes that reach an element: rules for classes used in the body, plus inline styles.
  const usedClasses = new Set([...body.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)));
  const usedDecls = [
    ...[...rules].filter(([cls]) => usedClasses.has(cls)).map(([, decls]) => decls),
    ...[...body.matchAll(/style="([^"]+)"/g)].map((m) => m[1]),
  ].join(';');
  const fonts = [...usedDecls.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
  if (!fonts.length) return null;
  if (!rootPx) return 'no-root-width';
  const minFontPx = Math.min(...fonts);
  return { minTextCm: (widthM * minFontPx * 100) / rootPx, minFontPx, rootPx };
}

/** What the dry run needs from a library asset (see library.ts): its parts, without the meshes. */
export type AssetStub = {
  id: string;
  creditShort?: string;
  parts: { node: string; name: string; group?: string | null; centroid: number[]; labelAnchor: number[]; explodeDir: number[]; triangles: number; motion?: { type: string } }[];
};

// Same markup as the browser rig's labels (apps/xr/src/genui/rig.ts), so the panel checks see what the headset will show.
const LABEL_WIDTH_M = 0.16;
const labelMarkup = (text: string) => `
  <style>
    .l { width: 320px; padding-left: 14px; padding-right: 14px; padding-top: 7px; padding-bottom: 7px;
         border-radius: 12px; background-color: #15181d; }
    .t { color: #ffffff; font-size: 28px; font-weight: 600; }
  </style>
  <div class="l"><span class="t" id="text">${text.replace(/[<>&]/g, ' ')}</span></div>`;

type StubUi = (markup: unknown, options?: any) => { object3D: THREE.Object3D; on(): void; set(): void };

/** Same handle as the browser host's assets.get(), with a small box standing in for each part. */
function stubAsset(entry: AssetStub, ui: StubUi) {
  const group = new THREE.Group();
  group.name = entry.id;
  const parts = entry.parts.map((p) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), new THREE.MeshStandardMaterial());
    mesh.name = p.node;
    mesh.position.set(p.centroid[0], p.centroid[1], p.centroid[2]);
    mesh.userData.stubTriangles = p.triangles;
    group.add(mesh);
    return {
      id: p.node, name: p.name, group: p.group ?? null, object3D: mesh,
      labelAnchor: new THREE.Vector3(...(p.labelAnchor as [number, number, number])),
      explodeDir: new THREE.Vector3(...(p.explodeDir as [number, number, number])),
    };
  });
  const find = (id: string) => {
    const part = parts.find((p) => p.id === id);
    if (!part) throw new Error(`Asset '${entry.id}' has no part '${id}'. Parts: ${parts.map((p) => p.id).join(', ')}.`);
    return part;
  };
  const labelled = new Map<string, ReturnType<StubUi>>();
  const label = (id: string, text?: string) => {
    if (!group.parent) throw new Error('Add the model to root (root.add(model.object3D)) before labelling it.');
    const part = find(id);
    let panel = labelled.get(id);
    if (!panel) {
      panel = ui(labelMarkup(text ?? part.name.charAt(0).toUpperCase() + part.name.slice(1)), { width: LABEL_WIDTH_M, position: [0, 0, 0] });
      group.parent.add(panel.object3D);
      labelled.set(id, panel);
    }
    const holder = panel.object3D;
    return { object3D: holder, set(_text: string) {}, setVisible(visible: boolean) { holder.visible = Boolean(visible); } };
  };
  const checkIds = (ids: unknown) => {
    if (!Array.isArray(ids)) throw new Error('Pass part ids as an array, e.g. ["left_ventricle"].');
    ids.forEach((id) => find(String(id)));
  };
  return {
    object3D: group, parts, credit: entry.creditShort ?? '',
    part: (id: string) => find(id).object3D,
    anchor(id: string) {
      group.updateMatrix();
      return find(id).labelAnchor.clone().applyMatrix4(group.matrix);
    },
    // Teaching rig: same signatures as the browser; the geometry effects only exist there.
    label,
    labelParts: (ids: string[]) => (checkIds(ids), ids.map((id) => label(id))),
    explode(amount: number) {
      if (typeof amount !== 'number' || !Number.isFinite(amount)) throw new Error('explode(amount) takes a number from 0 (assembled) to 1 (apart).');
    },
    cutaway(_on?: boolean) {},
    xray(_on?: boolean, keep: string[] = []) { checkIds(keep); },
    highlight(id: string | null) { if (id !== null) find(id); },
    reset() {},
    move(id: string, t: number) {
      // Same errors as the browser rig, so the agent learns which parts move before the headset does.
      const part = entry.parts.find((p) => p.node === find(id).id)!;
      if (!part.motion) {
        const moving = entry.parts.filter((p) => p.motion).map((p) => p.node);
        throw new Error(`Part '${id}' doesn't move. Moving parts: ${moving.join(', ') || 'none'}.`);
      }
      if (typeof t !== 'number' || !Number.isFinite(t)) throw new Error('move(id, t) takes a number: 0 to 1 sweeps the part\'s motion (rotating parts keep turning past 1).');
    },
  };
}

function describeRuntimeError(err: unknown): string {
  const e = err as Error & { code?: string };
  if (e?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
    return `Execution timed out after ${TIMEOUT_MS} ms (infinite loop, or far too much work in build/update).`;
  }
  const line = e?.stack?.match(/component\.js:(\d+):(\d+)/);
  return `Runtime error: ${e?.message ?? String(err)}${line ? ` (line ${line[1]}, col ${line[2]})` : ''}`;
}

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}
