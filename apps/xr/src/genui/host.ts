import * as IWSDK from '@iwsdk/core';
import {
  Box3,
  createSystem,
  DistanceGrabbable,
  Grabbed,
  MovementMode,
  Group,
  OneHandGrabbable,
  PanelDocument,
  PanelUI,
  PokeInteractable,
  Pressed,
  RayInteractable,
  Vector3,
  type Entity,
  type Object3D,
  type UIKitDocument,
  type World,
} from '@iwsdk/core';
import { assetHandle, assetIdsIn, creditsFor, preloadAssets } from './library';
import type { TeachingRig } from './rig';

/**
 * GenUI host: runs agent-written component modules in the live scene.
 *
 * It holds no components of its own. It loads the module, gives it the
 * build API (THREE, traits, ui, isGrabbed, assets), turns trait requests into IWSDK
 * hand-interaction components, places the result in seated reach, and
 * isolates runtime errors so a broken generation can't take the app down.
 */

type PanelOptions = { width?: number; position?: [number, number, number]; rotationY?: number };
type ElementProps = { text?: string; color?: string; backgroundColor?: string; display?: string };

type PanelRecord = {
  holder: Group;
  markup: string;
  width: number;
  handlers: { id: string; event: string; fn: () => void }[];
  pendingProps: { id: string; props: ElementProps }[];
  document: UIKitDocument | null;
  url: string;
  /** Elements that got a generated click handler, for tests that press panel buttons. */
  boundElements: { id: string; element: Object3D }[];
};

type Mounted = {
  entities: Entity[];
  objectEntities: Map<Object3D, Entity>;
  pressHandlers: Map<Entity, () => void>;
  grabModes: Map<Object3D, 'touch' | 'ray'>;
  pressTargets: Object3D[];
  /** Times any generated press/click handler ran; lets tests prove an interaction landed. */
  handlerCalls: number;
  panels: Map<Entity, PanelRecord>;
  update?: (time: number, delta: number) => void;
  startTime: number;
  /** Teaching rigs of library models in the scene; ticked every frame. */
  rigs: TeachingRig[];
  /** Frames until the one-time lesson layout runs, once every panel has loaded (null = done). */
  declutterIn: number | null;
  /** The module's root, once mounted. */
  root: Object3D | null;
};

export type MountReport = { ok: true; warnings: string[]; credits: string[] } | { ok: false; error: string };

// The panel font (Inter atlas in @pmndrs/msdfonts) has plain ASCII plus these; anything else renders
// as an empty box. Keep in sync with apps/server/src/glyphs.ts, which makes the agent fix its text.
const PANEL_GLYPHS = new Set([...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)), ...'§°ÄÖÜßäöü\n\r\t']);
// Copied from REPLACEMENTS in apps/server/src/glyphs.ts.
const GLYPH_FALLBACKS: Record<string, string> = {
  '–': '-', '—': '-', '−': '-', '‐': '-', '‑': '-',
  '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...', '·': '-', '•': '-', '×': 'x', '÷': '/',
  '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '≈': '~', '≤': '<=', '≥': '>=', '±': '+/-', '≠': '!=',
  '²': '^2', '³': '^3', '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6',
  'µ': 'u', 'é': 'e', 'è': 'e', 'á': 'a', 'í': 'i', 'ó': 'o', 'ñ': 'n', 'ç': 'c', '€': 'EUR ', '£': 'GBP ',
  ' ': ' ', ' ': ' ', ' ': ' ',
};

/** Safety net for text that slipped past the server checks: swap or drop characters the font lacks. */
function toPanelText(text: string): string {
  let out = '';
  for (const ch of text) out += PANEL_GLYPHS.has(ch) ? ch : GLYPH_FALLBACKS[ch] ?? '';
  return out;
}

// Seated placement: content sits this far in front of and below the viewer's eyes.
const REACH_DISTANCE_M = 0.55;
const BELOW_EYES_M = 0.35;
const MAX_CONTENT_SIZE_M = 0.8;
// A near-hand pinch grabs everything within a few centimetres of the pinch point.
const MIN_GRAB_GAP_M = 0.04;

let world: World | null = null;
let current: Mounted | null = null;
let onRuntimeError: ((message: string) => void) | null = null;
const tmpHead = new Vector3();
const tmpForward = new Vector3();

export function initGenUIHost(w: World, handlers: { onRuntimeError: (message: string) => void }) {
  world = w;
  onRuntimeError = handlers.onRuntimeError;
  // Library models' cut-away view uses per-material clipping planes.
  w.renderer.localClippingEnabled = true;
  w.registerSystem(GenUISystem);
}

export function unmountGenerated() {
  if (!current) return;
  for (const panel of current.panels.values()) URL.revokeObjectURL(panel.url);
  // Children before parents so each entity releases its own resources.
  for (const entity of [...current.entities].reverse()) entity.dispose();
  current = null;
}

export type MountedInspection = {
  grabbables: { name: string; mode: 'touch' | 'ray'; center: [number, number, number]; held: boolean }[];
  pressables: { name: string; center: [number, number, number] }[];
  panels: number;
  panelsLoaded: number;
  handlerCalls: number;
  /** False until the host's one-time lesson layout has moved the panels (library lessons only). */
  layoutSettled: boolean;
  /** Panel elements with a generated click handler, with their world-space centers. */
  panelButtons: { id: string; center: [number, number, number]; size: [number, number, number] }[];
};

/** Test-only: what a ray from `from` toward `to` passes through, nearest first (debugging blocked presses). */
export function debugRay(from: [number, number, number], to: [number, number, number]) {
  if (!world) return [];
  const origin = new Vector3(...from);
  const direction = new Vector3(...to).sub(origin).normalize();
  const ray = new IWSDK.Raycaster(origin, direction);
  return ray.intersectObject(world.scene, true).slice(0, 8).map((hit) => {
    const chain: string[] = [];
    for (let o: Object3D | null = hit.object; o && chain.length < 5; o = o.parent) chain.push(`${o.name || o.type}${o.visible ? '' : '(hidden)'}`);
    const at = hit.object.getWorldPosition(new Vector3());
    return { distance: Math.round(hit.distance * 1000) / 1000, chain: chain.join(' < '), type: hit.object.constructor.name,
      instance: hit.instanceId ?? null, objectAt: [at.x, at.y, at.z].map((v) => Math.round(v * 1000) / 1000) };
  });
}

/** What the host wired up for the current generation, for tests and the benchmark. */
export function inspectMounted(): MountedInspection | null {
  const mounted = current;
  if (!mounted) return null;
  const center = (object: Object3D) =>
    new Box3().setFromObject(object).getCenter(new Vector3()).toArray() as [number, number, number];
  return {
    grabbables: [...mounted.grabModes].map(([object, mode]) => ({
      name: object.name,
      mode,
      center: center(object),
      held: mounted.objectEntities.get(object)?.hasComponent(Grabbed) ?? false,
    })),
    pressables: mounted.pressTargets.map((object) => ({ name: object.name, center: center(object) })),
    panels: mounted.panels.size,
    panelsLoaded: [...mounted.panels.values()].filter((p) => p.document).length,
    layoutSettled: mounted.rigs.length === 0 || mounted.declutterIn === null,
    handlerCalls: mounted.handlerCalls,
    panelButtons: [...mounted.panels.values()].flatMap((p) =>
      // uikit draws in batches, so the element mesh's own .visible says nothing; ask uikit whether
      // the element is shown (display, ancestors) and not clipped, i.e. whether a user could press it.
      p.boundElements
        .filter((b) => isPressableNow(b.element))
        .map((b) => {
          // Force uikit to recompute this element's world matrix before measuring it.
          b.element.updateWorldMatrix(true, false);
          const box = new Box3().setFromObject(b.element);
          return { id: b.id, center: box.getCenter(new Vector3()).toArray() as [number, number, number], size: box.getSize(new Vector3()).toArray() as [number, number, number] };
        }),
    ),
  };
}

function isPressableNow(element: Object3D): boolean {
  const ui = element as unknown as { isVisible?: { peek(): boolean }; isClipped?: { peek(): boolean } };
  return (ui.isVisible?.peek() ?? true) && !(ui.isClipped?.peek() ?? false);
}

/** Load an agent-written module and mount what it builds. Throws nothing; failures come back as a report. */
export async function mountGenerated(code: string): Promise<MountReport> {
  if (!world) return { ok: false, error: 'GenUI host is not initialised.' };
  unmountGenerated();

  // Library models the module names in assets.get('…') load first, so build() can use them synchronously.
  const assetIds = assetIdsIn(code);
  let library: Awaited<ReturnType<typeof preloadAssets>> | null = null;
  if (assetIds.length > 0) {
    try {
      library = await preloadAssets(assetIds);
    } catch (err) {
      return { ok: false, error: `Library asset failed to load: ${(err as Error).message}` };
    }
  }

  const moduleUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  let build: unknown;
  try {
    build = (await import(/* @vite-ignore */ moduleUrl)).default;
  } catch (err) {
    return { ok: false, error: `Module failed to load: ${(err as Error).message}` };
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
  if (typeof build !== 'function') return { ok: false, error: 'The module has no default build function.' };

  const traitRequests: { object: Object3D; grab: boolean; onPress?: () => void }[] = [];
  const panels: PanelRecord[] = [];
  const mounted: Mounted = {
    entities: [],
    objectEntities: new Map(),
    pressHandlers: new Map(),
    grabModes: new Map(),
    pressTargets: [],
    handlerCalls: 0,
    panels: new Map(),
    startTime: performance.now() / 1000,
    rigs: [],
    declutterIn: 3,
    root: null,
  };

  const api = {
    THREE: IWSDK,
    traits(object: Object3D, options: { grab?: boolean; onPress?: () => void } = {}) {
      traitRequests.push({ object, grab: Boolean(options.grab), onPress: options.onPress });
      return object;
    },
    ui(markup: string, options: PanelOptions = {}) {
      const record = createPanelRecord(toPanelText(String(markup)), options);
      panels.push(record);
      return {
        object3D: record.holder,
        on(id: string, event: string, fn: () => void) {
          const handler = { id, event, fn: guard(mounted, fn) };
          record.handlers.push(handler);
          if (record.document) bindHandler(record, handler);
        },
        set(id: string, props: ElementProps) {
          if (record.document) applyProps(record.document, id, props);
          else record.pendingProps.push({ id, props });
        },
      };
    },
    assets: {
      get(id: string) {
        if (!library) throw new Error(`assets.get('${id}'): write the id as a plain string so the host can load it first.`);
        return assetHandle(library, id, { ui: api.ui, isGrabbed: (o) => api.isGrabbed(o), onRig: (rig) => mounted.rigs.push(rig) });
      },
    },
    isGrabbed(object: Object3D) {
      return mounted.objectEntities.get(object)?.hasComponent(Grabbed) ?? false;
    },
  };

  let result: { root?: unknown; update?: unknown };
  try {
    result = (build as (a: typeof api) => typeof result)(api) ?? {};
  } catch (err) {
    for (const panel of panels) URL.revokeObjectURL(panel.url);
    return { ok: false, error: `build() threw: ${describe(err)}` };
  }
  const root = result.root as Object3D | undefined;
  if (!root || !(root as Object3D).isObject3D) {
    for (const panel of panels) URL.revokeObjectURL(panel.url);
    return { ok: false, error: 'build() must return { root } with a THREE.Object3D root.' };
  }

  const warnings: string[] = [];
  mounted.root = root;
  const anchor = new Group();
  anchor.name = 'GenUI Anchor';
  placeInSeatedReach(anchor);
  anchor.add(root);
  fitToComfortSize(root, new Set(panels.map((p) => p.holder)), warnings);
  anchor.updateMatrixWorld(true);

  const anchorEntity = track(mounted, world.createTransformEntity(anchor), anchor);
  const rootEntity = track(mounted, world.createTransformEntity(root, { parent: anchorEntity }), root);

  const crowded = findCrowdedGrabbables(traitRequests.filter((r) => r.grab).map((r) => r.object));
  for (const request of traitRequests) {
    const entity = adoptIntoRoot(mounted, request.object, root, rootEntity);
    if (request.grab && crowded.has(request.object)) {
      // A near-hand pinch would take neighbours too; a ray picks exactly the object it hits.
      if (!entity.hasComponent(RayInteractable)) entity.addComponent(RayInteractable, {});
      entity.addComponent(DistanceGrabbable, { movementMode: MovementMode.MoveAtSource });
      mounted.grabModes.set(request.object, 'ray');
    } else if (request.grab) {
      entity.addComponent(OneHandGrabbable, {});
      mounted.grabModes.set(request.object, 'touch');
    }
    if (request.onPress) {
      if (!entity.hasComponent(RayInteractable)) entity.addComponent(RayInteractable, {});
      if (!entity.hasComponent(PokeInteractable)) entity.addComponent(PokeInteractable, {});
      mounted.pressHandlers.set(entity, guard(mounted, request.onPress));
      mounted.pressTargets.push(request.object);
    }
  }

  // Library labels are read-only: without interactables they can't catch a hand ray meant for a
  // button behind them (labels move when a model explodes).
  const labelHolders = new Set(mounted.rigs.flatMap((rig) => rig.labelHolders()));
  for (const panel of panels) {
    const entity = adoptIntoRoot(mounted, panel.holder, root, rootEntity);
    entity.addComponent(PanelUI, { config: panel.url });
    if (!labelHolders.has(panel.holder)) {
      entity.addComponent(RayInteractable, {});
      entity.addComponent(PokeInteractable, {});
    }
    mounted.panels.set(entity, panel);
  }

  mounted.update = typeof result.update === 'function' ? (result.update as Mounted['update']) : undefined;
  current = mounted;
  return { ok: true, warnings, credits: library ? creditsFor(library, assetIds) : [] };
}

class GenUISystem extends createSystem({
  pressed: { required: [Pressed] },
  panelDocuments: { required: [PanelUI, PanelDocument] },
}) {
  init(): void {
    this.queries.pressed.subscribe('qualify', (entity) => {
      current?.pressHandlers.get(entity)?.();
    });
    this.queries.panelDocuments.subscribe('qualify', (entity) => {
      const panel = current?.panels.get(entity);
      if (!panel) return;
      const document = entity.getValue(PanelDocument, 'document') as UIKitDocument | undefined;
      if (!document) return;
      panel.document = document;
      URL.revokeObjectURL(panel.url);
      // Height is deliberately generous so the requested width is what constrains the scale.
      document.setTargetDimensions(panel.width, panel.width * 4);
      for (const handler of panel.handlers) bindHandler(panel, handler);
      for (const { id, props } of panel.pendingProps) applyProps(document, id, props);
      panel.pendingProps.length = 0;
    });
  }

  update(delta: number): void {
    const mounted = current;
    if (!mounted) return;
    if (mounted.declutterIn !== null && mounted.rigs.length > 0 && [...mounted.panels.values()].every((p) => p.document)) {
      // UIKit lays panels out over a few frames; measure once their sizes are real.
      if (mounted.declutterIn-- <= 0) {
        mounted.declutterIn = null;
        layoutLessonPanels(mounted);
      }
    }
    for (const rig of mounted.rigs) {
      try {
        rig.tick();
      } catch (err) {
        mounted.rigs = mounted.rigs.filter((r) => r !== rig); // drop a broken rig, keep the scene
        onRuntimeError?.(`Teaching rig failed: ${describe(err)}`);
      }
    }
    if (!mounted.update) return;
    try {
      mounted.update(performance.now() / 1000 - mounted.startTime, delta);
    } catch (err) {
      // Stop calling a broken update; the scene stays, the error goes to the repair loop.
      mounted.update = undefined;
      onRuntimeError?.(`update() threw: ${describe(err)}`);
    }
  }
}

function createPanelRecord(markup: string, options: PanelOptions): PanelRecord {
  const holder = new Group();
  holder.name = 'GenUI Panel';
  const [x = 0, y = 0, z = 0] = Array.isArray(options.position) ? options.position : [];
  holder.position.set(x, y, z);
  holder.rotation.y = typeof options.rotationY === 'number' ? options.rotationY : 0;
  const width = typeof options.width === 'number' && options.width > 0 ? Math.min(options.width, 1.5) : 0.3;
  return {
    holder,
    markup,
    width,
    handlers: [],
    pendingProps: [],
    document: null,
    url: URL.createObjectURL(new Blob([markup], { type: 'text/plain' })),
    boundElements: [],
  };
}

function bindHandler(panel: PanelRecord, handler: PanelRecord['handlers'][number]) {
  const element = panel.document?.getElementById(handler.id);
  if (!element) {
    onRuntimeError?.(`Panel handler: no element with id "${handler.id}".`);
    return;
  }
  element.addEventListener(handler.event as 'click', handler.fn);
  if (handler.event === 'click') panel.boundElements.push({ id: handler.id, element: element as unknown as Object3D });
}

function applyProps(document: UIKitDocument, id: string, props: ElementProps) {
  if (typeof props.text === 'string') props = { ...props, text: toPanelText(props.text) };
  const element = document.getElementById(id);
  if (!element) {
    onRuntimeError?.(`Panel set(): no element with id "${id}".`);
    return;
  }
  element.setProperties(props as Record<string, unknown>);
}

/** Make `object` a direct child of root (keeping its world transform) and give it an entity. */
function adoptIntoRoot(mounted: Mounted, object: Object3D, root: Object3D, rootEntity: Entity): Entity {
  const existing = mounted.objectEntities.get(object);
  if (existing) return existing;
  if (object.parent !== root) root.attach(object);
  return track(mounted, world!.createTransformEntity(object, { parent: rootEntity }), object);
}

function track(mounted: Mounted, entity: Entity, object: Object3D): Entity {
  mounted.entities.push(entity);
  mounted.objectEntities.set(object, entity);
  return entity;
}

function placeInSeatedReach(anchor: Group) {
  const camera = world!.camera;
  camera.getWorldPosition(tmpHead);
  camera.getWorldDirection(tmpForward);
  tmpForward.y = 0;
  if (tmpForward.lengthSq() < 1e-6) tmpForward.set(0, 0, -1);
  tmpForward.normalize();
  anchor.position.copy(tmpHead).addScaledVector(tmpForward, REACH_DISTANCE_M);
  anchor.position.y = tmpHead.y - BELOW_EYES_M;
  // root's +Z must face the viewer, so yaw toward the head.
  anchor.rotation.y = Math.atan2(tmpHead.x - anchor.position.x, tmpHead.z - anchor.position.z);
}

/** Grabbables with a neighbour closer than MIN_GRAB_GAP_M (bounding-sphere gap, precise bounds). */
function findCrowdedGrabbables(objects: Object3D[]): Set<Object3D> {
  const spheres = objects.map((object) => {
    const box = new Box3().setFromObject(object, true);
    const size = box.getSize(new Vector3());
    return { object, center: box.getCenter(new Vector3()), radius: Math.max(size.x, size.y, size.z) / 2 };
  });
  const crowded = new Set<Object3D>();
  for (let i = 0; i < spheres.length; i++) {
    for (let j = i + 1; j < spheres.length; j++) {
      const a = spheres[i];
      const b = spheres[j];
      if (a.center.distanceTo(b.center) - a.radius - b.radius < MIN_GRAB_GAP_M) {
        crowded.add(a.object);
        crowded.add(b.object);
      }
    }
  }
  return crowded;
}

/**
 * Shrink oversized 3D content into the seated reach zone. Only meshes count: panels, labels and
 * leader lines are excluded, because shrinking them would push text below the readable size the
 * server checked. (Scaling root still scales panels, so this only triggers for genuinely huge models.)
 */
function fitToComfortSize(root: Object3D, panelHolders: Set<Object3D>, warnings: string[]) {
  root.updateMatrixWorld(true);
  const box = new Box3();
  const visit = (object: Object3D) => {
    if (panelHolders.has(object) || (object as { isLine?: boolean }).isLine) return;
    if ((object as { isMesh?: boolean }).isMesh) box.expandByObject(object, false);
    for (const child of object.children) visit(child);
  };
  visit(root);
  if (box.isEmpty()) return;
  const size = box.getSize(new Vector3());
  const largest = Math.max(size.x, size.y, size.z);
  if (largest > MAX_CONTENT_SIZE_M) {
    root.scale.multiplyScalar(MAX_CONTENT_SIZE_M / largest);
    warnings.push(`Scaled content down from ${largest.toFixed(2)} m to fit the seated reach zone.`);
  }
}

function guard(mounted: Mounted, fn: () => void): () => void {
  return () => {
    mounted.handlerCalls++;
    try {
      fn();
    } catch (err) {
      onRuntimeError?.(`Interaction handler threw: ${describe(err)}`);
    }
  };
}

/**
 * Lesson layout for library models (SceneCraft's split: the agent says what panels exist, code says
 * where). Runs once, after every panel has laid out and has its real size, in root's frame:
 * - the model and its label columns stay where the rig put them;
 * - the lesson's main panel (the one the agent placed highest, or the only one) goes centred above
 *   them, its bottom edge clear of the model and labels;
 * - any other panels stack beyond the label column on the side the agent put them.
 * Panels sit in front of the model's front face. Nothing overlaps by construction, and no hand ray
 * to a button has to cross the model.
 */
function layoutLessonPanels(mounted: Mounted) {
  const root = mounted.root;
  if (!root || mounted.rigs.length === 0) return;
  root.updateMatrixWorld(true);
  const boxIn = (object: Object3D) => {
    const world = new Box3().setFromObject(object);
    const local = new Box3();
    if (world.isEmpty()) return local;
    const { min, max } = world;
    for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) local.expandByPoint(root.worldToLocal(new Vector3(x, y, z)));
    return local;
  };
  const labels = new Set(mounted.rigs.flatMap((rig) => rig.labelHolders()));
  const model = new Box3();
  for (const rig of mounted.rigs) for (const part of rig.partObjects()) model.union(boxIn(part));
  if (model.isEmpty()) return;
  const occupied = model.clone();
  for (const label of labels) if (label.visible) occupied.union(boxIn(label));

  const panels = [...mounted.panels.values()]
    .filter((p) => !labels.has(p.holder) && p.holder.parent === root)
    .map((p) => ({ holder: p.holder, box: boxIn(p.holder) }))
    .filter((p) => !p.box.isEmpty());
  if (panels.length === 0) return;
  const gap = 0.025;
  const modelCenterX = (model.min.x + model.max.x) / 2;
  // Panels also come forward of the model's front face: a hand ray from chest height up to a
  // button behind that plane would pass through the model (and a grabbable model catches it).
  const frontZ = model.max.z + gap;
  const moveTo = (panel: { holder: Object3D; box: Box3 }, minX: number, minY: number) => {
    panel.holder.position.x += minX - panel.box.min.x;
    panel.holder.position.y += minY - panel.box.min.y;
    if (panel.box.min.z < frontZ) panel.holder.position.z += frontZ - panel.box.min.z;
  };

  // The main panel: the highest one the agent placed (lessons put their main panel on top).
  panels.sort((a, b) => b.box.max.y - a.box.max.y);
  const [main, ...others] = panels;
  const mainWidth = main.box.max.x - main.box.min.x;
  moveTo(main, modelCenterX - mainWidth / 2, occupied.max.y + gap);

  // The rest beside the label columns, on the side the agent chose, stacked downwards from the top.
  let rightTop = occupied.max.y;
  let leftTop = occupied.max.y;
  for (const panel of others) {
    const width = panel.box.max.x - panel.box.min.x;
    const height = panel.box.max.y - panel.box.min.y;
    const right = (panel.box.min.x + panel.box.max.x) / 2 >= modelCenterX;
    if (right) {
      moveTo(panel, occupied.max.x + gap, rightTop - height);
      rightTop -= height + gap;
    } else {
      moveTo(panel, occupied.min.x - gap - width, leftTop - height);
      leftTop -= height + gap;
    }
  }
  root.updateMatrixWorld(true);
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
