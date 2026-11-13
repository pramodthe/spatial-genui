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
  XRPlane as XRPlaneComponent,
  type Entity,
  type Object3D,
  type UIKitDocument,
  type World,
} from '@iwsdk/core';
import { captureLesson, expandByMesh, type CaptureOptions } from './capture';
import { createMoveHandle, MOVE_HANDLE_RADIUS_M, type MoveHandle } from './handle';
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
  /** What the lesson layout decided and why, for tests (root's frame). */
  layout?: Record<string, unknown>;
  /** The detected surface the lesson stands on (its label, or 'surface'), or null when it floats at seated height. */
  onSurface: string | null;
  /** This lesson's paintbox (textures, materials, shapes); disposed with the lesson. */
  kit: Kit | null;
  /** The bar the learner drags to move the whole lesson, and where the lesson layout found the root. */
  handle: MoveHandle | null;
  handleRest: { offset: Vector3; root: Vector3 } | null;
};

/** The paintbox for generated lessons, served by the agent server (apps/server/src/kit/kit.js). */
type Kit = { finalize(root: Object3D): void; pump(budgetMs?: number): number; dispose(): void };
let kitModule: Promise<{ createKit(three: unknown): Kit } | null> | null = null;
function loadKit() {
  kitModule ??= import(/* @vite-ignore */ `${location.origin}/api/kit.js`).catch((err) => {
    console.warn('[GenUI] paintbox failed to load', err);
    kitModule = null; // try again with the next lesson
    return null;
  });
  return kitModule;
}

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
// Nothing in a lesson starts nearer the eyes than this (measured along the floor): a lesson with cards or
// parts laid out in front of its model is set further back to make room.
const MIN_FRONT_GAP_M = 0.3;
const MAX_SET_BACK_M = 0.45;
// A spot the learner chose by dragging a lesson is used for the next one while they stay near it.
const KEEP_SPOT_WITHIN_M = 1.5;
// A near-hand pinch grabs everything within a few centimetres of the pinch point.
const MIN_GRAB_GAP_M = 0.04;

let world: World | null = null;
let current: Mounted | null = null;
let onRuntimeError: ((message: string) => void) | null = null;
/** Where the learner last put a lesson down with its move handle. */
let chosenSpot: { position: Vector3; yaw: number } | null = null;
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
  current.kit?.dispose();
  current.handle?.dispose();
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
  /** The detected surface the lesson stands on, or null when it floats at seated height. */
  onSurface: string | null;
  layout?: Record<string, unknown>;
  /** Panel elements with a generated click handler, with their world-space centers. */
  panelButtons: { id: string; center: [number, number, number]; size: [number, number, number] }[];
};

/** A picture of the mounted lesson from a virtual camera (JPEG data URL), or null when there is none. */
export function capture(options: CaptureOptions = {}): string | null {
  if (!world || !current?.root) return null;
  return captureLesson(world, current.root, new Set([...current.panels.values()].map((p) => p.holder)), options);
}

/** Test-only: the mounted lesson's root, for scripts that inspect what was built. */
export function debugRoot(): Object3D | null {
  return current?.root ?? null;
}

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

/**
 * For tests: a point on grabbable `index` that a ray from `from` reaches before anything else, the way
 * a learner aims at a part they can see. Tries the centre first, then points on the object's surface
 * nearest the centre (the centre of a ring or a hollow organ is not on the object). Null if none.
 */
export function aimPoint(index: number, from: [number, number, number]): [number, number, number] | null {
  const object = current && [...current.grabModes.keys()][index];
  if (!world || !object) return null;
  const center = new Box3().setFromObject(object).getCenter(new Vector3());
  const candidates = [center];
  const vertex = new Vector3();
  object.traverse((o) => {
    const geometry = (o as { isMesh?: boolean; geometry?: IWSDK.BufferGeometry }).isMesh ? (o as IWSDK.Mesh).geometry : null;
    const position = geometry?.getAttribute('position');
    if (!position) return;
    const step = Math.max(1, Math.floor(position.count / 200));
    for (let i = 0; i < position.count; i += step) candidates.push(vertex.fromBufferAttribute(position, i).applyMatrix4(o.matrixWorld).clone());
  });
  candidates.sort((a, b) => a.distanceTo(center) - b.distanceTo(center));
  const origin = new Vector3(...from);
  const ray = new IWSDK.Raycaster();
  const owns = (o: Object3D | null) => {
    for (; o; o = o.parent) if (o === object) return true;
    return false;
  };
  for (const point of candidates.slice(0, 400)) {
    ray.set(origin, point.clone().sub(origin).normalize());
    const first = ray.intersectObject(world.scene, true).find((hit) => hit.object.visible);
    if (first && owns(first.object)) return first.point.toArray() as [number, number, number];
  }
  return null;
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
    onSurface: mounted.onSurface,
    layout: mounted.layout,
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
    onSurface: null,
    kit: (await loadKit())?.createKit(IWSDK) ?? null,
    handle: null,
    handleRest: null,
  };

  const api = {
    THREE: IWSDK,
    kit: mounted.kit,
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
    mounted.kit?.dispose();
    return { ok: false, error: `build() threw: ${describe(err)}` };
  }
  const root = result.root as Object3D | undefined;
  if (!root || !(root as Object3D).isObject3D) {
    for (const panel of panels) URL.revokeObjectURL(panel.url);
    mounted.kit?.dispose();
    return { ok: false, error: 'build() must return { root } with a THREE.Object3D root.' };
  }

  const warnings: string[] = [];
  mounted.root = root;
  // Kit materials get their real-world texture scale now that every shape exists.
  try {
    mounted.kit?.finalize(root);
  } catch (err) {
    warnings.push(`Texture mapping skipped: ${describe(err)}`);
  }
  const anchor = new Group();
  anchor.name = 'GenUI Anchor';
  anchor.add(root);
  // Measured before the anchor is placed, so the box is in the lesson's own frame (+Z toward the learner).
  const panelHolders = new Set(panels.map((p) => p.holder));
  fitToComfortSize(root, panelHolders, warnings);
  const extent = contentBox(root, panelHolders);
  for (const panel of panels) extent.expandByPoint(panel.holder.getWorldPosition(new Vector3()));
  const front = extent.isEmpty() ? 0 : Math.max(0, extent.max.z);
  mounted.onSurface = placeInSeatedReach(anchor, front);
  anchor.updateMatrixWorld(true);

  const anchorEntity = track(mounted, world.createTransformEntity(anchor), anchor);
  // The handle lies on the desk in front of everything, nearest the learner.
  mounted.handle = createMoveHandle(world, anchor, {
    offset: [0, Math.max(-0.1, Math.min(0, extent.isEmpty() ? 0 : extent.min.y)) + MOVE_HANDLE_RADIUS_M, front + 0.07],
    onMoved: () => (chosenSpot = { position: anchor.position.clone(), yaw: anchor.rotation.y }),
  });
  mounted.handle.setShown(true);
  mounted.handleRest = { offset: mounted.handle.offset.clone(), root: root.position.clone() };
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
  planes: { required: [XRPlaneComponent] },
}) {
  init(): void {
    planeEntities = () => this.queries.planes.entities;
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
    // Textures are painted a few milliseconds per frame, so a lesson never stalls the headset.
    mounted.kit?.pump(5);
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

/**
 * Put the lesson on the learner's desk: a detected horizontal surface below the eyes, in front and within
 * reach (SPEC.md Phase 4). Without one (no plane detection, or nothing suitable), it floats at seated desk
 * height in front. `front` is how far the lesson reaches toward the learner from its centre: it is set back
 * far enough that nothing starts in their face. A spot the learner dragged the last lesson to wins over
 * both. Returns the surface's label, or null when floating.
 */
function placeInSeatedReach(anchor: Group, front: number): string | null {
  const camera = world!.camera;
  camera.getWorldPosition(tmpHead);
  if (chosenSpot && chosenSpot.position.distanceTo(tmpHead) < KEEP_SPOT_WITHIN_M) {
    anchor.position.copy(chosenSpot.position);
    anchor.rotation.y = chosenSpot.yaw;
    return null;
  }
  camera.getWorldDirection(tmpForward);
  tmpForward.y = 0;
  if (tmpForward.lengthSq() < 1e-6) tmpForward.set(0, 0, -1);
  tmpForward.normalize();
  const desk = findDesk(tmpHead, tmpForward);
  if (desk) {
    anchor.position.copy(desk.point);
  } else {
    anchor.position.copy(tmpHead).addScaledVector(tmpForward, REACH_DISTANCE_M);
    anchor.position.y = tmpHead.y - BELOW_EYES_M;
  }
  const away = tmpForward.set(anchor.position.x - tmpHead.x, 0, anchor.position.z - tmpHead.z);
  const gap = away.length() - front;
  if (gap < MIN_FRONT_GAP_M && away.lengthSq() > 1e-6) anchor.position.addScaledVector(away.normalize(), Math.min(MIN_FRONT_GAP_M - gap, MAX_SET_BACK_M));
  // root's +Z must face the viewer, so yaw toward the head.
  anchor.rotation.y = Math.atan2(tmpHead.x - anchor.position.x, tmpHead.z - anchor.position.z);
  return desk?.label ?? null;
}

// A desk or table: 15-90 cm below the eyes (not the floor, not a shelf), big enough for a lesson, ahead.
const DESK_DROP_M = [0.15, 0.9] as const;
const DESK_REACH_M = [0.3, 0.9] as const;
const DESK_MARGIN_M = 0.12;
const DESK_AHEAD_COS = Math.cos((50 * Math.PI) / 180);

/** The point on a detected surface nearest to "REACH_DISTANCE_M straight ahead", or null. */
function findDesk(head: Vector3, forward: Vector3): { point: Vector3; label: string } | null {
  let best: { point: Vector3; label: string } | null = null;
  let bestCost = Infinity;
  for (const entity of planeEntities?.() ?? []) {
    const plane = entity.getValue(XRPlaneComponent, '_plane') as { orientation?: string; semanticLabel?: string } | undefined;
    const mesh = entity.object3D as IWSDK.Mesh | undefined;
    if (!plane || !mesh?.isMesh || plane.orientation !== 'horizontal') continue;
    mesh.updateWorldMatrix(true, false);
    const height = mesh.getWorldPosition(new Vector3()).y;
    const drop = head.y - height;
    if (drop < DESK_DROP_M[0] || drop > DESK_DROP_M[1]) continue;
    // IWSDK builds each plane as a thin box around its origin, sized to the plane's outline.
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!;
    const halfX = (box.max.x - box.min.x) / 2 - DESK_MARGIN_M;
    const halfZ = (box.max.z - box.min.z) / 2 - DESK_MARGIN_M;
    if (halfX < 0.1 || halfZ < 0.08) continue; // too small to hold a lesson
    const aim = head.clone().addScaledVector(forward, REACH_DISTANCE_M);
    aim.y = height;
    const local = mesh.worldToLocal(aim);
    local.set(Math.min(halfX, Math.max(-halfX, local.x)), 0, Math.min(halfZ, Math.max(-halfZ, local.z)));
    const point = mesh.localToWorld(local);
    const toPoint = new Vector3(point.x - head.x, 0, point.z - head.z);
    const reach = toPoint.length();
    if (reach < DESK_REACH_M[0] || reach > DESK_REACH_M[1] || toPoint.normalize().dot(forward) < DESK_AHEAD_COS) continue;
    const label = plane.semanticLabel || 'surface';
    // Closest to the comfortable reach; a surface the headset calls a table or desk wins a close call.
    const cost = Math.abs(reach - REACH_DISTANCE_M) + (/table|desk/i.test(label) ? 0 : 0.15);
    if (cost < bestCost) {
      best = { point, label };
      bestCost = cost;
    }
  }
  return best;
}

/** Detected planes (set by the system; empty without plane detection). */
let planeEntities: (() => Iterable<Entity>) | null = null;

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
  const box = contentBox(root, panelHolders);
  if (box.isEmpty()) return;
  const size = box.getSize(new Vector3());
  const largest = Math.max(size.x, size.y, size.z);
  if (largest > MAX_CONTENT_SIZE_M) {
    root.scale.multiplyScalar(MAX_CONTENT_SIZE_M / largest);
    warnings.push(`Scaled content down from ${largest.toFixed(2)} m to fit the seated reach zone.`);
  }
}

/** The box around a lesson's meshes (no panels, labels or leader lines), in world space. */
function contentBox(root: Object3D, panelHolders: Set<Object3D>): Box3 {
  root.updateMatrixWorld(true);
  const box = new Box3();
  const visit = (object: Object3D) => {
    if (panelHolders.has(object) || (object as { isLine?: boolean }).isLine) return;
    if ((object as { isMesh?: boolean }).isMesh) expandByMesh(box, object);
    for (const child of object.children) visit(child);
  };
  visit(root);
  return box;
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
 * - the model and its labels stay where the rig put them;
 * - the lesson's main panel (the one the agent placed highest, or the only one) goes centred above
 *   them, in front of the model's front face and high enough that it hides nothing from the eye;
 * - the whole lesson moves down (and back, if it is deep) as far as needed to fit that stack in a
 *   comfortable view;
 * - any other panels stack beyond the label columns on the side the agent put them, or beside the
 *   main panel when that would be too far to the side to see.
 * Nothing overlaps by construction, and no hand ray to a button has to cross the model.
 */
function layoutLessonPanels(mounted: Mounted, again?: { main: Object3D }) {
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
  // Panels stand forward of the model's front face: a hand ray from chest height up to a button
  // behind that plane would pass through the model (and a grabbable model catches it).
  const frontZ = model.max.z + gap;
  const moveTo = (panel: { holder: Object3D; box: Box3 }, minX: number, minY: number, z: number) => {
    panel.holder.position.x += minX - panel.box.min.x;
    panel.holder.position.y += minY - panel.box.min.y;
    panel.holder.position.z += z - panel.box.min.z;
  };
  const { min, max } = occupied;
  const corners = [min.x, max.x].flatMap((x) => [min.y, max.y].flatMap((y) => [min.z, max.z].map((z) => new Vector3(x, y, z))));
  /** Lowest bottom edge for a panel standing at depth z that hides no part of the model or labels from the eye. */
  const clearBottom = (eye: Vector3 | null, z: number) => {
    let bottom = occupied.max.y + gap;
    const d = eye ? eye.z - z : 0;
    if (!eye || d <= 0) return bottom;
    for (const c of corners) {
      const dc = eye.z - c.z;
      if (dc > d) bottom = Math.max(bottom, eye.y + ((c.y - eye.y) * d) / dc + gap);
    }
    return bottom;
  };

  // The main panel: the highest one the agent placed (lessons put their main panel on top). A second
  // pass keeps the first pass's choice: panels beside the main one now share its top edge.
  panels.sort((a, b) => b.box.max.y - a.box.max.y);
  if (again) panels.sort((a, b) => Number(b.holder === again.main) - Number(a.holder === again.main));
  const [main, ...others] = panels;
  const mainWidth = main.box.max.x - main.box.min.x;
  const mainHeight = main.box.max.y - main.box.min.y;

  // Framing. The lesson is a stack: the model, its labels, and the main panel above. Where the host
  // first puts it (just below a seated user's eye) there is no room for the stack: the panel would
  // rise out of sight. Lower the whole lesson, and move it back only when it is too deep to fit, by
  // the least that keeps the panel's top within 20 degrees above the eye and the model's near bottom
  // edge within 55 degrees below it. Root's frame may be scaled (and is turned to face the user);
  // angles survive both, distances are converted.
  const UP = Math.tan((20 * Math.PI) / 180);
  const DOWN = Math.tan((55 * Math.PI) / 180);
  const SIDE = Math.tan((35 * Math.PI) / 180); // side panels within 35 degrees of straight ahead
  const metre = 1 / (root.getWorldScale(new Vector3()).x || 1);
  const eyeNow = () => (world ? root.worldToLocal(world.camera.getWorldPosition(new Vector3())) : null);
  const misfit = (eye: Vector3) => {
    const tooHigh = clearBottom(eye, frontZ) + mainHeight - eye.y - UP * (eye.z - frontZ);
    const tooLow = eye.y - model.min.y - DOWN * (eye.z - model.max.z);
    return Math.max(0, tooHigh) + Math.max(0, tooLow);
  };
  const start = eyeNow();
  const move = { dy: 0, dz: 0, misfit: 0 };
  if (start && start.z > frontZ) {
    let best = { cost: Infinity, dy: 0, dz: 0 };
    // A lesson standing on a desk can't move down (into the desk), only back.
    const maxDown = mounted.onSurface ? 0 : 0.4001;
    search: for (let dz = 0; dz <= 0.4001; dz += 0.1) {
      for (let dy = 0; dy <= maxDown; dy += 0.05) {
        const cost = misfit(new Vector3(start.x, start.y + dy * metre, start.z + dz * metre));
        if (cost < best.cost - 1e-9) best = { cost, dy, dz };
        if (cost === 0) break search;
      }
    }
    Object.assign(move, { dy: best.dy, dz: best.dz, misfit: best.cost });
    if (best.dy || best.dz) {
      const target = root.localToWorld(new Vector3(0, -best.dy * metre, -best.dz * metre));
      root.position.copy(root.parent ? root.parent.worldToLocal(target) : target);
      root.updateMatrixWorld(true);
      // The move handle stays in front of the lesson's base.
      if (mounted.handle && mounted.handleRest) mounted.handle.offset.copy(mounted.handleRest.offset).add(root.position).sub(mounted.handleRest.root);
    }
  }
  const eye = eyeNow();
  const mainBottom = clearBottom(eye, frontZ);
  const r3 = (v: Vector3 | null) => v && [v.x, v.y, v.z].map((n) => Math.round(n * 1000) / 1000);
  mounted.layout = { eye: r3(eye), move, model: [r3(model.min), r3(model.max)], mainBottom, mainHeight };

  // The rest beside the label columns, on the side the agent chose, stacked downwards from the top;
  // beside the main panel instead when the label columns would put them out of sight. Then the main
  // panel and the panels beside it are centred together over the model, so none runs off one side.
  const size = (box: Box3) => ({ width: box.max.x - box.min.x, height: box.max.y - box.min.y });
  const besideMain = { left: [] as typeof others, right: [] as typeof others };
  let rightTop = occupied.max.y;
  let leftTop = occupied.max.y;
  for (const panel of others) {
    const { width, height } = size(panel.box);
    const right = (panel.box.min.x + panel.box.max.x) / 2 >= modelCenterX;
    const outerX = right ? occupied.max.x + gap + width : occupied.min.x - gap - width;
    if (eye && Math.abs(outerX - eye.x) > SIDE * (eye.z - frontZ)) {
      besideMain[right ? 'right' : 'left'].push(panel);
    } else if (right) {
      moveTo(panel, occupied.max.x + gap, rightTop - height, frontZ);
      rightTop -= height + gap;
    } else {
      moveTo(panel, occupied.min.x - gap - width, leftTop - height, frontZ);
      leftTop -= height + gap;
    }
  }
  const columnWidth = (panels: typeof others) => (panels.length ? Math.max(...panels.map((p) => size(p.box).width)) + gap : 0);
  const leftWidth = columnWidth(besideMain.left);
  const mainLeft = modelCenterX - (leftWidth + mainWidth + columnWidth(besideMain.right)) / 2 + leftWidth;
  moveTo(main, mainLeft, mainBottom, frontZ);
  for (const [side, panels] of Object.entries(besideMain)) {
    let top = mainBottom + mainHeight;
    for (const panel of panels) {
      const { width, height } = size(panel.box);
      moveTo(panel, side === 'right' ? mainLeft + mainWidth + gap : mainLeft - gap - width, top - height, frontZ);
      top -= height + gap;
    }
  }
  root.updateMatrixWorld(true);

  // Labels keep the angular size they were designed for (1.4 cm text read from 55 cm) wherever the
  // framing put the lesson; if that changes their size, lay everything out again around them.
  if (eye && !again) {
    const labelScale = Math.min(1.8, Math.max(1, eye.distanceTo(model.getCenter(new Vector3())) / 0.55));
    mounted.layout.labelScale = labelScale;
    if (labelScale > 1.05) {
      for (const rig of mounted.rigs) rig.setLabelScale(labelScale);
      layoutLessonPanels(mounted, { main: main.holder });
      if (mounted.layout) mounted.layout.labelScale = labelScale;
    }
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
