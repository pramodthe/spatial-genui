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

/**
 * Execute a validated, transformed module in an isolated VM context with real Three.js
 * and stub host APIs, so crashes, infinite loops, bad UI markup and over-budget scenes
 * are caught before the code ever reaches the headset.
 */
export function dryRun(transformed: string): DryRunResult {
  const traitTargets: { object: unknown; grab: boolean; press: boolean }[] = [];
  const panels: { markup: string; options: any; holder: THREE.Group }[] = [];

  const api = {
    THREE,
    traits(object: unknown, options: any = {}) {
      traitTargets.push({ object, grab: Boolean(options.grab), press: typeof options.onPress === 'function' });
      return object;
    },
    ui(markup: unknown, options: any = {}) {
      const holder = new THREE.Group();
      panels.push({ markup: String(markup), options, holder });
      return { object3D: holder, on() {}, set() {} };
    },
    isGrabbed() {
      return false;
    },
  };

  const context = vm.createContext({ __exports: {}, __api: api, console: { log() {}, warn() {}, error() {} } });
  let result: any;
  try {
    vm.runInContext(transformed, context, { filename: 'component.js', timeout: TIMEOUT_MS });
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
    const width = p.options?.width;
    if (typeof width !== 'number' || !(width >= 0.05 && width <= 1.5)) {
      errors.push(`Panel ${i + 1}: ui(markup, { width }) needs a width in meters between 0.05 and 1.5.`);
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
