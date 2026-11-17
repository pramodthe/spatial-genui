import * as IWSDK from '@iwsdk/core';
import { World as EcsWorld, ComponentRegistry, createComponent, createSystem as createEcsSystem, Types as EcsTypes } from 'elics';
import {
  Box3,
  createSystem,
  DistanceGrabbable,
  Grabbed,
  MovementMode,
  Group,
  Object3D,
  PanelDocument,
  PanelUI,
  PokeInteractable,
  Pressed,
  Quaternion,
  RayInteractable,
  TwoHandsGrabbable,
  Vector3,
  VisibilityState,
  XRAnchor,
  XRPlane as XRPlaneComponent,
  type Entity,
  type InstancedMesh,
  type Mesh,
  type UIKitDocument,
  type World,
} from '@iwsdk/core';
import { captureLesson, expandByMesh, type CaptureOptions } from './capture';
import { boxAround, setFloorHeight, type MoveHandle } from './handle';
import { createLessonBounds, type LessonBounds } from './bounds';
import { createGameHands, updateGameHands, type GameHands } from './game-hands';
import { createModuleSound } from './sound';
import { makeCardGrabbable, pinchAtFingertips, setGrabFilter, type CardGrab } from './grab';
import { createGlow, glowOnHover, tickGlows, type Glow } from './hover';
import { initTitleCard, initViewPill, setPill, showTitle } from './hud';
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
type ElementProps = { text?: string; color?: string; backgroundColor?: string; display?: string; onValueChange?: (value: unknown) => void };

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
  /** Elements given a value handler (sliders), for tests that drag them. */
  valueIds: string[];
};

type Mounted = {
  /** World mode's sky and ground (enterWorld), removed with the game. */
  worldScene?: { dispose(): void } | null;
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
  /** The lesson's cards, held by their frames (set up once the cards have laid out). */
  cards: CardGrab[];
  /** The box drawn around the 3D: a side push slides it, a corner pinch scales it. */
  bounds: LessonBounds | null;
  /** The player's hands in root's coordinates, refreshed before each update() (the module's `hands`). */
  hands: GameHands;
  /** The module's `sound`: synthesized effects, tones and hums, stopped when the lesson closes. */
  sound: ReturnType<typeof createModuleSound>;
  /** Play: a game, and how far the player has zoomed it from its fitted size. */
  game: boolean;
  gameZoom: number;
  /** Hover glows of the lesson's grabbable and pressable objects and parts, by target. */
  glows: Map<Object3D, Glow>;
  /** The fitted view: the 3D's box as built (root's frame, before fitting) and the scale that fits it in the box. */
  built: { box: Box3; size: number; rootScale: number; origin: Vector3 } | null;
  fitScale: number;
  /** The subject's real largest dimension in metres (declared by the lesson, or from the size agent), or null. */
  realSizeM: number | null;
  view: 'fit' | 'real';
  /** The fitted view's root transform and rig label sizes, kept while the real-size view is shown. */
  fitPose: { position: Vector3; scale: Vector3; labelScales: number[] } | null;
  handleRest: { offset: Vector3; root: Vector3 } | null;
  /** The lesson's card and annotation layers, beside root under the anchor (see splitLayers). */
  layers: { cards: Group; annotations: Group } | null;
  /** The cards and name tags moved out of the 3D into those layers. */
  layered: Layered[];
};

/** A card or name tag moved out of the lesson's 3D into its layer (see splitLayers). */
type Layered = {
  object: Object3D;
  kind: 'card' | 'tag';
  /** An empty object left where the lesson put it: hidden with the lesson's group, carried with its part. */
  pin: Object3D;
  /** The group holding the object in its layer: it shows while the pin's groups do, so the object's own visible
   * flag stays the lesson's (as it would nested in its group). */
  slot: Group;
  /** The card's panel (null for a tag drawn in 3D). */
  panel: PanelRecord | null;
  /** Its size as built (in the lesson's frame, before fitting): the size it keeps in every view. */
  size: number;
  /** Where the lesson put it, in root's frame as built. */
  at: Vector3;
  shown: boolean;
};

/** The paintbox for generated lessons, served by the agent server (apps/gate/src/kit/kit.js). */
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

/** `superseded`: another lesson was asked for while this one loaded; it was dropped and nothing changed. */
export type MountReport = { ok: true; warnings: string[]; credits: string[] } | { ok: false; error: string; superseded?: boolean };

// Mounting waits on the network (library models, the kit, the module). When a second lesson is asked for
// meanwhile, only the latest one may reach the scene: an earlier one finishing later would add a lesson that
// nothing removes, its panels never scaled to the desk.
let mountTicket = 0;
const SUPERSEDED: MountReport = { ok: false, error: 'Another lesson was opened while this one loaded.', superseded: true };

// The panel font (Inter atlas in @pmndrs/msdfonts) has plain ASCII plus these; anything else renders
// as an empty box. Keep in sync with apps/gate/src/glyphs.ts, which makes the agent fix its text.
const PANEL_GLYPHS = new Set([...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)), ...'§°ÄÖÜßäöü\n\r\t']);
// Copied from REPLACEMENTS in apps/gate/src/glyphs.ts.
const GLYPH_FALLBACKS: Record<string, string> = {
  '–': '-', '—': '-', '−': '-', '‐': '-', '‑': '-',
  '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...', '·': '-', '•': '-', '×': 'x', '÷': '/',
  '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '≈': '~', '≤': '<=', '≥': '>=', '±': '+/-', '≠': '!=',
  '²': '^2', '³': '^3', '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6',
  'µ': 'u', 'é': 'e', 'è': 'e', 'á': 'a', 'í': 'i', 'ó': 'o', 'ñ': 'n', 'ç': 'c', '€': 'EUR ', '£': 'GBP ',
  ' ': ' ', ' ': ' ', ' ': ' ',
};

/**
 * A lesson panel whose root is the theme's `<div class="panel">` becomes the Horizon kit's `<Panel>`, so it
 * is drawn with the Meta Horizon OS panel background (a grey gradient) like the rest of the app. Saved
 * lessons get it too: the markup is rewritten here, when the lesson opens. Anything else is left alone.
 */
function asHorizonPanel(markup: string): string {
  const body = markup.lastIndexOf('</style>');
  const start = body < 0 ? 0 : body + '</style>'.length;
  const open = /^(\s*)<div(\s[^>]*\bclass="(?:[^"]*\s)?panel(?:\s[^"]*)?"[^>]*)>/.exec(markup.slice(start));
  const end = markup.trimEnd();
  if (!open || !end.endsWith('</div>')) return markup;
  const rest = markup.slice(start + open[0].length, end.length - '</div>'.length);
  return `${markup.slice(0, start)}${open[1]}<Panel${open[2]}>${rest}</Panel>`;
}

/**
 * Play: a game's panel is its scoreboard. Instead of the Horizon panel it gets an arcade look: a dark board
 * with a neon edge, a bright title in capitals and big score digits. Saved games get it too.
 */
// Added to the end of the kit's own rules (a second rule for a class would replace the first, layout and all).
const ARCADE_RULES: Record<string, string> = {
  '.panel': 'background-color: #0c0e1c; border-radius: 28px; border-width: 4px; border-color: #7c5cff;',
  '.kp-eyebrow': 'color: #4de3ff; font-weight: 700; letter-spacing: 1.5px;',
  '.kp-title': 'color: #ffd23f; font-size: 30px; line-height: 1.15; font-weight: 800; letter-spacing: 1px;',
  '.kp-subtitle': 'color: #4de3ff;',
  '.kp-stat-value': 'color: #ffffff; font-size: 60px; line-height: 1.05; font-weight: 800; letter-spacing: 0px;',
  '.kp-status': 'background-color: rgba(124, 92, 255, 0.2);',
  '.kp-list': 'background-color: rgba(124, 92, 255, 0.12);',
  '.kp-seg': 'background-color: rgba(124, 92, 255, 0.2);',
};

function asArcadePanel(markup: string): string {
  let styled = markup;
  for (const [selector, rules] of Object.entries(ARCADE_RULES)) {
    const at = styled.indexOf(`${selector} {`);
    const close = at < 0 ? -1 : styled.indexOf('}', at);
    if (close >= 0) styled = `${styled.slice(0, close)} ${rules} ${styled.slice(close)}`;
  }
  return styled.replace(/(<span id="title" class="kp-title">)([^<]*)(<\/span>)/, (_, open: string, text: string, close: string) => `${open}${text.toUpperCase()}${close}`);
}

/** Safety net for text that slipped past the server checks: swap or drop characters the font lacks. */
function toPanelText(text: string): string {
  let out = '';
  for (const ch of text) out += PANEL_GLYPHS.has(ch) ? ch : GLYPH_FALLBACKS[ch] ?? '';
  return out;
}

// Seated placement: content sits this far in front of and below the viewer's eyes.
const REACH_DISTANCE_M = 0.55;
const BELOW_EYES_M = 0.35;
// The fitted view: a lesson's 3D is scaled so its largest side is this long (a house shrinks, a bacterium grows),
// within these limits on the scale.
const FIT_BOX_M = 0.5;
const FIT_SCALE_RANGE = [0.2, 5] as const;
// Play: a game is fitted bigger than a lesson (a playfield, not a model on a stand), and the player can zoom it
// with the game bar's - and + by this step, within this range of the fitted size.
const GAME_FIT_BOX_M = 0.9;
const GAME_ZOOM_STEP = 1.25;
const GAME_ZOOM_RANGE = [0.5, 2.5] as const;
// A game's move and turn handles stand this far outside its playfield.
const GAME_HANDLE_OUTSET_M = 0.04;
// A lesson's handles stand this far outside its box: beyond the 3 cm a fingertip pinch reaches for a part (a
// model's base sits on the bottom edge) and out of the line of a ray aimed at the model.
const LESSON_HANDLE_OUTSET_M = 0.035;
// A pinch counts as play over the playfield and the space around it where the player's hand is (in front of the
// board, above it). A pinch out at the picker or the far side of the room does not.
const PLAY_PINCH_MARGIN_XZ_M = 0.25;
const PLAY_PINCH_MARGIN_Y_M = 0.6;
// The real-size view is offered for subjects between these sizes (a grain of rice to a tall building); outside them
// the pill only tells the scale. At real size the subject stands on the floor. A small one stays at arm's length.
// A person, a house, or a rocket comes in close enough that its base is on the floor in front of the learner,
// not a long way off where the base only lines up if they look down.
const REAL_SIZE_RANGE_M = [0.005, 150] as const;
const REAL_VIEW_GAP_M = 1.2;
const REAL_NEAR_M = 2.4;
// Nothing in a lesson starts nearer the eyes than this (measured along the floor): a lesson with cards or
// parts laid out in front of its model is set further back to make room.
const MIN_FRONT_GAP_M = 0.3;
const MAX_SET_BACK_M = 0.45;
// Lessons keep opening at the saved spot while the learner stays this near it.
const KEEP_SPOT_WITHIN_M = 1.5;
// ...and while it is within this angle of where they face.
const KEEP_SPOT_AHEAD_COS = Math.cos((60 * Math.PI) / 180);
// A floating lesson's lowest part stays this far above the floor.
const FLOOR_CLEARANCE_M = 0.05;
// An unlabelled horizontal surface at least this far below the eyes counts as floor.
const FLOOR_DROP_M = 1.0;
// At real size, a subject this tall (a person, a door, a house) is brought in close. The demo view stays the 0.5 m box.
const FLOOR_SUBJECT_M = 1.7;
const SPOT_STORAGE_KEY = 'genui.lessonSpot.v1';
// A card stays at least this far from the eyes (along the floor), and starts at this share of the size the lesson
// drew it (a card half a metre from the eyes filled the view).
const CARD_MIN_DISTANCE_M = 0.45;
const CARD_START_SCALE = 0.8;
// A card that covers the model is shifted this far past the model's side, and kept this far above the floor.
const CARD_MODEL_GAP_M = 0.04;
const CARD_FLOOR_GAP_M = 0.02;
// A panel's top edge stays within this slope above the eye line (10 degrees): no reading upwards.
const PANEL_TOP_RISE = Math.tan((10 * Math.PI) / 180);
// A near-hand pinch grabs everything within a few centimetres of the pinch point.
const MIN_GRAB_GAP_M = 0.04;

let world: World | null = null;
let current: Mounted | null = null;
let onRuntimeError: ((message: string) => void) | null = null;
/**
 * Where lessons stand, so they don't land wherever the learner happens to be looking when each one opens:
 * found for the first lesson, moved when the learner drags a lesson by its handle. It is kept in the room's
 * frame and saved, so the next session opens lessons at the same place in the room.
 */
let lessonSpot: { position: Vector3; surface: string | null } | null = null;
/**
 * The room: a frame IWSDK keeps on a WebXR anchor (restored across sessions), so lessons stay where they are
 * in the room when the headset recentres or re-localises. Outside XR, or without anchors, it is the world.
 */
let room: { group: Group; entity: Entity } | null = null;
const tmpHead = new Vector3();
const tmpForward = new Vector3();
const playTip = new Vector3();

export function initGenUIHost(w: World, handlers: { onRuntimeError: (message: string) => void }) {
  world = w;
  onRuntimeError = handlers.onRuntimeError;
  // Library models' cut-away view uses per-material clipping planes.
  w.renderer.localClippingEnabled = true;
  // Nothing the learner drags goes below the floor.
  setFloorHeight(() => floorHeight(w.camera.getWorldPosition(new Vector3())));
  initViewPill(w, () => current && setLessonView(current.view === 'real' ? 'fit' : 'real'));
  initTitleCard(w);
  w.registerSystem(GenUISystem);
}

/** Find a fresh spot for the next lesson (a test that moved the viewpoint, or a learner starting over). */
export function forgetLessonSpot() {
  setLessonSpot(null);
}

function setLessonSpot(spot: { position: Vector3; surface: string | null } | null) {
  lessonSpot = spot;
  try {
    if (spot) localStorage.setItem(SPOT_STORAGE_KEY, JSON.stringify({ position: spot.position.toArray(), surface: spot.surface }));
    else localStorage.removeItem(SPOT_STORAGE_KEY);
  } catch {
    // No storage (private window): the spot lasts for this page only.
  }
}

function loadLessonSpot(): { position: Vector3; surface: string | null } | null {
  try {
    const saved = JSON.parse(localStorage.getItem(SPOT_STORAGE_KEY) ?? 'null') as { position?: number[]; surface?: string | null } | null;
    if (saved?.position?.length !== 3 || !saved.position.every(Number.isFinite)) return null;
    if (SEAT_LABELS.test(saved.surface ?? '')) return null; // saved before seats stopped counting as desks
    return { position: new Vector3(...saved.position), surface: saved.surface ?? null };
  } catch {
    return null;
  }
}

/** The room's frame (see `room`), made on first use. The picker stands in it too, so it stays beside the lesson. */
export function roomFrame(): { group: Group; entity: Entity } {
  if (!room) {
    const group = new Group();
    group.name = 'GenUI Room';
    const entity = world!.createTransformEntity(group, { persistent: true });
    entity.addComponent(XRAnchor);
    room = { group, entity };
  }
  return room;
}

/** Where the mounted lesson stands, in world space, or null when there is none. */
export function lessonPosition(out: Vector3): Vector3 | null {
  return current?.root?.parent?.getWorldPosition(out) ?? null;
}

/** The box of the lesson's visible model in the world, or null with no lesson. */
export function lessonModelBox(out: Box3): Box3 | null {
  const root = current?.root;
  if (!root) return null;
  visibleModelBox(root, out);
  return out.isEmpty() ? null : out;
}

/** The centre of the lesson's cards (its panels) in the world, or null when it has none. */
export function lessonCardsCentre(out: Vector3): Vector3 | null {
  const cards = current?.layers?.cards;
  if (!cards || cards.children.length === 0) return null;
  const box = boxAround(cards);
  return box.isEmpty() ? null : box.getCenter(out);
}

export function unmountGenerated() {
  if (!current) return;
  current.sound.dispose();
  current.bounds?.dispose();
  current.kit?.dispose();
  current.handle?.dispose();
  for (const card of current.cards) card.dispose();
  for (const glow of current.glows.values()) glow.dispose();
  for (const panel of current.panels.values()) {
    URL.revokeObjectURL(panel.url);
    disposePanelElements(panel.document);
  }
  const released = current.entities.map((entity) => ({ index: entity.index, components: entity.getComponents() }));
  // Children before parents so each entity releases its own resources.
  for (const entity of [...current.entities].reverse()) entity.dispose();
  forgetComponentData(released);
  forgetLessonComponents();
  current.worldScene?.dispose();
  current = null;
  updatePill();
}

/**
 * A uikit element's dispose() stops only that element, and IWSDK disposes only a panel's root. Every other element
 * kept its layout node, whose text-measuring callback Yoga holds in a global table, and through it (its parents, and
 * the click handlers the host gave them) the whole lesson or game: the main reason each game opened stayed in memory.
 * Disposes every element of the panel, children first; IWSDK then disposes the root with the entity.
 */
function disposePanelElements(document: UIKitDocument | null) {
  const root = document?.rootElement;
  if (!root) return;
  const elements: { dispose(): void }[] = [];
  root.traverse((object) => {
    if (object !== root && 'abortController' in object && typeof (object as { dispose?: unknown }).dispose === 'function') {
      elements.push(object as unknown as { dispose(): void });
    }
  });
  for (const element of elements.reverse()) element.dispose();
}

/**
 * The ECS keeps each component's fields in arrays indexed by entity and does not clear a destroyed entity's slots. A
 * slot holding an object (a panel's document, an Object3D) kept the whole previous lesson or game alive, its panels,
 * meshes and geometry, until another entity happened to reuse the slot: about 13 MB a game on Quest 3, until the
 * headset ran out of memory. Called after the entities are destroyed, since their cleanup still reads these slots.
 */
function forgetComponentData(released: { index: number; components: ReturnType<Entity['getComponents']> }[]) {
  for (const { index, components } of released) {
    for (const component of components) {
      for (const values of Object.values(component.data as Record<string, unknown>)) {
        if (Array.isArray(values) && index < values.length) values[index] = null;
      }
    }
  }
}

export type MountedInspection = {
  /** Shown as a world around the player (enterWorld), not on the desk. */
  world: boolean;
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
  /** Panel elements with a value handler (sliders). */
  sliders: { id: string; center: [number, number, number]; size: [number, number, number] }[];
  /** Each teaching rig: its parts' names and how far apart they are (mean distance from their centre, m). */
  rigs: { parts: number; names: string[]; spread: number }[];
  /** Names of the objects and parts glowing because a pointer is over them. */
  glowing: string[];
  /** What the host moved out of the 3D: cards and name tags (see splitLayers), by name. */
  layers: { cards: string[]; annotations: string[] };
};

/** A picture of the mounted lesson from a virtual camera (JPEG data URL), or null when there is none. */
export function capture(options: CaptureOptions = {}): string | null {
  if (!world || !current?.root) return null;
  const { root, layers } = current;
  return captureLesson(world, root, layers ? [layers.annotations, layers.cards] : [], new Set([...current.panels.values()].map((p) => p.holder)), options);
}

/** Test-only: the mounted lesson's root, for scripts that inspect what was built. */
export function debugRoot(): Object3D | null {
  return current?.root ?? null;
}

/** Test-only: the lesson frame's handles, what is being dragged, and where the lesson stands and faces. */
export function inspectFrame() {
  const mounted = current;
  const anchor = mounted?.root?.parent;
  if (!mounted?.bounds || !anchor) return null;
  const at = anchor.getWorldPosition(new Vector3());
  return { ...mounted.bounds.inspect(), anchor: [at.x, at.y, at.z].map((n) => Math.round(n * 1000) / 1000), yaw: Math.round(anchor.rotation.y * 1000) / 1000, scale: Math.round((mounted.root?.scale.x ?? 1) * 1000) / 1000 };
}

/** Test-only: the hands the current module sees (root's coordinates, rounded to mm). */
export function debugHands() {
  if (!current) return null;
  const round = (v: Vector3) => [v.x, v.y, v.z].map((n) => Math.round(n * 1000) / 1000);
  const hand = (h: GameHands['left']) => ({ tracked: h.tracked, tip: round(h.tip), palm: round(h.palm), pinching: h.pinching });
  return { left: hand(current.hands.left), right: hand(current.hands.right) };
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
 * For tests: a point on grabbable (or, with kind 'press', pressable) `index` that a ray from `from` reaches
 * before anything else, the way a learner aims at a part they can see. Tries the centre first, then points on
 * the object's surface nearest the centre (the centre of a ring or a hollow organ is not on the object). Null if none.
 */
export function aimPoint(index: number, from: [number, number, number], kind: 'grab' | 'press' = 'grab'): [number, number, number] | null {
  const object = current && (kind === 'press' ? current.pressTargets : [...current.grabModes.keys()])[index];
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
    const first = ray.intersectObject(world.scene, true).find((hit) => shown(hit.object));
    if (first && owns(first.object)) return first.point.toArray() as [number, number, number];
  }
  return null;
}

/** Whether `object` is drawn: it and every ancestor visible (a ray ignores a mesh inside a hidden group). */
function shown(object: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

// Three.js raycasts a mesh even when it is not drawn. A mesh the lesson hid, or one under a group the lesson
// hid, keeps its real raycast here while a no-op stands in, and gets it back when it is shown. UIKit sets
// `visible` false on elements it still draws in batches and still hits with its own raycast; that flag is not
// a lesson hide, and neither is an empty raycast a glow copy or a leader line already installed.
const savedRaycast = new WeakMap<Object3D, Object3D['raycast']>();
const silencedRaycast: Object3D['raycast'] = () => {};

function raycastInUse(object: Object3D): Object3D['raycast'] {
  return savedRaycast.get(object) ?? object.raycast;
}

/** A raycast the object installed itself, rather than the one its class came with. */
function ownRaycast(object: Object3D): boolean {
  const inherited = (Object.getPrototypeOf(object) as { raycast?: Object3D['raycast'] }).raycast;
  const raycast = raycastInUse(object);
  return raycast !== inherited && raycast !== silencedRaycast;
}

/**
 * Hidden by the lesson (or by a card slot the lesson closed), not by UIKit's own visibility flag.
 * Once a UIKit element is in the chain, its `visible` and its descendants' `visible` no longer count,
 * until a plain object above that element is hidden: a closed card slot still stops rays.
 * Worked out from the root down in one pass (it runs twice a frame), each object from its parent's answer.
 */
function syncRaycastVisibility(object: Object3D, parentHidden = false, parentUnderOwnRaycast = false) {
  const underOwnRaycast = parentUnderOwnRaycast || ownRaycast(object);
  const hidden = parentHidden || (!object.visible && !underOwnRaycast);
  const saved = savedRaycast.get(object);
  if (!hidden && saved) {
    object.raycast = saved;
    savedRaycast.delete(object);
  } else if (hidden && !saved && object.raycast.length > 0) {
    savedRaycast.set(object, object.raycast);
    object.raycast = silencedRaycast;
  }
  for (const child of object.children) syncRaycastVisibility(child, hidden, underOwnRaycast);
}

/** Whether `object` is `ancestor` or sits inside it. */
function isWithin(ancestor: Object3D, object: Object3D | undefined): boolean {
  for (let node: Object3D | null = object ?? null; node; node = node.parent) if (node === ancestor) return true;
  return false;
}

/** What the host wired up for the current generation, for tests and the benchmark. */
export function inspectMounted(): MountedInspection | null {
  const mounted = current;
  if (!mounted) return null;
  const center = (object: Object3D) =>
    new Box3().setFromObject(object).getCenter(new Vector3()).toArray() as [number, number, number];
  return {
    world: Boolean(mounted.worldScene),
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
    sliders: [...mounted.panels.values()].flatMap((p) =>
      p.valueIds.flatMap((id) => {
        const element = p.document?.getElementById(id) as unknown as Object3D | undefined;
        if (!element || !isPressableNow(element)) return [];
        element.updateWorldMatrix(true, false);
        const box = new Box3().setFromObject(element);
        return [{ id, center: box.getCenter(new Vector3()).toArray() as [number, number, number], size: box.getSize(new Vector3()).toArray() as [number, number, number] }];
      }),
    ),
    glowing: [...mounted.glows].filter(([, glow]) => glow.on).map(([target]) => target.name),
    layers: {
      cards: mounted.layered.filter((item) => item.kind === 'card').map((item) => item.object.name),
      annotations: mounted.layered.filter((item) => item.kind === 'tag').map((item) => item.object.name),
    },
    rigs: mounted.rigs.map((rig) => {
      const parts = rig.partObjects();
      const centers = parts.map(center).map((c) => new Vector3(...c));
      const mid = centers.reduce((sum, c) => sum.add(c), new Vector3()).divideScalar(centers.length || 1);
      return { parts: parts.length, names: parts.map((part) => part.name), spread: centers.reduce((sum, c) => sum + c.distanceTo(mid), 0) / (centers.length || 1) };
    }),
  };
}

function isPressableNow(element: Object3D): boolean {
  const ui = element as unknown as { isVisible?: { peek(): boolean }; isClipped?: { peek(): boolean } };
  return (ui.isVisible?.peek() ?? true) && !(ui.isClipped?.peek() ?? false);
}

/** Load an agent-written module and mount what it builds. Throws nothing; failures come back as a report. */
/**
 * `preview`: a scene still being written (the live preview's gate-checked snapshots, overlay.ts watchLive). It is
 * never enlarged to fit, so it keeps its size as parts arrive, and the parts that were not in the last snapshot
 * grow in.
 */
const ECS = Object.freeze({
  World: EcsWorld,
  createComponent: ((...args: Parameters<typeof createComponent>) => {
    const component = createComponent(...args);
    lessonComponents.push(component);
    return component;
  }) as typeof createComponent,
  createSystem: createEcsSystem,
  Types: EcsTypes,
});

/** The ECS components the mounted lesson or game made (the ECS kit makes a fresh set each time it opens). */
let lessonComponents: ReturnType<typeof createComponent>[] = [];

/**
 * EliCS records every component in a global registry and never lets go, and a game's components hold its 3D
 * objects in their data (the ECS kit's Thing.object): every game opened stayed in memory, its objects, panels and
 * geometry, about 13 MB a game on Quest 3 until the headset ran out of memory. The registry has no way to remove
 * one component, so its map is reached directly.
 */
function forgetLessonComponents() {
  const registry = (ComponentRegistry as unknown as { components?: Map<string, unknown> }).components;
  for (const component of lessonComponents) {
    if (registry?.get(component.id) === component) registry.delete(component.id);
    for (const values of Object.values(component.data as Record<string, unknown>)) {
      if (Array.isArray(values)) values.fill(null);
    }
  }
  lessonComponents = [];
}

/** Where a game plays: on the desk (mixed reality, toy size, the default) or as a world around the player. */
export type PlayMode = 'desk' | 'world';

export async function mountGenerated(code: string, options: { kind?: 'lesson' | 'game'; preview?: boolean; mode?: PlayMode } = {}): Promise<MountReport> {
  // Play: a game has a scoreboard instead of a lesson panel, and no box around it.
  const game = options.kind === 'game';
  if (!world) return { ok: false, error: 'GenUI host is not initialised.' };
  const ticket = ++mountTicket;
  unmountGenerated();

  // Library models the module names in assets.get('…') load first, so build() can use them synchronously.
  const assetIds = assetIdsIn(code);
  let library: Awaited<ReturnType<typeof preloadAssets>> | null = null;
  if (assetIds.length > 0) {
    try {
      library = await preloadAssets(assetIds);
    } catch (err) {
      return ticket === mountTicket ? { ok: false, error: `Library asset failed to load: ${(err as Error).message}` } : SUPERSEDED;
    }
  }
  if (ticket !== mountTicket) return SUPERSEDED;

  const moduleUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  let build: unknown;
  try {
    build = (await import(/* @vite-ignore */ moduleUrl)).default;
  } catch (err) {
    return ticket === mountTicket ? { ok: false, error: `Module failed to load: ${(err as Error).message}` } : SUPERSEDED;
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
  if (ticket !== mountTicket) return SUPERSEDED;
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
    cards: [],
    bounds: null,
    hands: createGameHands(),
    sound: createModuleSound(),
    game,
    gameZoom: 1,
    glows: new Map(),
    built: null,
    fitScale: 1,
    realSizeM: null,
    view: 'fit',
    fitPose: null,
    handleRest: null,
    layers: null,
    layered: [],
  };
  // The last wait: from here to the end, nothing else can run before this lesson is in the scene.
  if (ticket !== mountTicket) {
    mounted.kit?.dispose();
    return SUPERSEDED;
  }

  const api = {
    THREE: IWSDK,
    kit: mounted.kit,
    traits(object: Object3D, options: { grab?: boolean; onPress?: () => void } = {}) {
      traitRequests.push({ object, grab: Boolean(options.grab), onPress: options.onPress });
      return object;
    },
    ui(markup: string, options: PanelOptions = {}) {
      const text = toPanelText(String(markup));
      // A panel with the game's own skin (kit.panel skin, class kp-skin) keeps its look; others get the app's.
      const skinned = /class="panel kp-skin"/.test(text);
      const record = createPanelRecord(skinned ? text : game ? asArcadePanel(text) : asHorizonPanel(text), options);
      panels.push(record);
      return {
        object3D: record.holder,
        on(id: string, event: string, fn: () => void) {
          const handler = { id, event, fn: guard(mounted, fn) };
          record.handlers.push(handler);
          if (record.document) bindHandler(record, handler);
        },
        set(id: string, props: ElementProps) {
          const onValueChange = props.onValueChange;
          if (typeof onValueChange === 'function') {
            // Guarded and counted like a click handler, so tests can tell a slider drag landed.
            props = { ...props, onValueChange: guard(mounted, onValueChange) };
            if (!record.valueIds.includes(id)) record.valueIds.push(id);
          }
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
    hands: mounted.hands,
    sound: mounted.sound,
    // EliCS, the ECS IWSDK is built on, for the module's own world of entities, components and systems
    // (skills/common/ecs). The module runs that world from its update(); the host's world stays the host's.
    ecs: ECS,
  };

  let result: { root?: unknown; update?: unknown; real?: { size?: unknown }; mode?: unknown; sky?: unknown; ground?: unknown; title?: unknown };
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
  // Where it plays: the opener's choice, else the module's own ({ mode: 'world' } from build()). A game designed as
  // a world is built at walking scale around its origin (where the player stands): it is not fitted to the desk.
  const designedAsWorld = result.mode === 'world';
  const inWorld = !options.preview && (options.mode ?? (designedAsWorld ? 'world' : 'desk')) === 'world';
  // Measure the lesson as it first appears. A part that update() sizes or places (a light beam drawn by
  // stretching a unit cylinder) would otherwise count at its unplaced size and shrink the whole lesson.
  if (typeof result.update === 'function') {
    try {
      (result.update as NonNullable<Mounted['update']>)(0, 1 / 72);
    } catch {
      // A broken update() is reported when the lesson runs.
    }
  }
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
  const layers = splitLayers(mounted, anchor, root, panels, new Set(traitRequests.map((r) => r.object)));
  // Hidden pieces don't count toward the size: a pool of enemies waiting off the board, or effects kept hidden at
  // their build size until they play (a lesson's splash rings, 2 m across until scaled to a few centimetres,
  // shrank its whole scene to a fifth). The frame measures what is visible too.
  if (!(inWorld && designedAsWorld)) fitToBox(mounted, root, panels, { ...(game ? { boxM: GAME_FIT_BOX_M } : {}), skipHidden: true, shrinkOnly: options.preview });
  fitCards(mounted);
  syncLayers(mounted);
  const declared = Number(result.real?.size);
  mounted.realSizeM = Number.isFinite(declared) && declared > 0 ? declared : null;
  const extent = contentBox(root, panelHolders, true);
  for (const panel of panels) extent.expandByPoint(panel.holder.getWorldPosition(new Vector3()));
  for (const item of mounted.layered) extent.expandByPoint(item.object.getWorldPosition(new Vector3()));
  const front = extent.isEmpty() ? 0 : Math.max(0, extent.max.z);
  const bottom = extent.isEmpty() ? 0 : extent.min.y;
  mounted.onSurface = placeInSeatedReach(anchor, front, bottom);
  const anchorEntity = track(mounted, world.createTransformEntity(anchor, { parent: roomFrame().entity }), anchor);
  anchor.updateMatrixWorld(true);
  dropAboveEyes(anchor, root);
  // A lesson is moved, turned and scaled by the handles on its frame. A game gets the move and turn handles only,
  // a little outside its playfield (no lines, no corners: its size is the game bar's - and +).
  mounted.bounds = createLessonBounds(world, anchor, anchorEntity, root, {
    onMoved: () => setLessonSpot({ position: anchor.position.clone(), surface: null }),
    ...(game ? { frame: false, outset: GAME_HANDLE_OUTSET_M, pointing: false } : { outset: LESSON_HANDLE_OUTSET_M }),
  });
  track(mounted, world.createTransformEntity(root, { parent: anchorEntity }), root);
  for (const layer of [layers.cards, layers.annotations]) track(mounted, world.createTransformEntity(layer, { parent: anchorEntity }), layer);

  // Each object the lesson made interactive keeps its place in the lesson's own hierarchy: a planet stays in
  // the orbit group that turns it, a part in the model that carries it. IWSDK wants an entity's object to be a
  // direct child of its parent entity's, so the objects in between get plain transform entities.
  const entityFor = (object: Object3D): Entity => {
    const existing = mounted.objectEntities.get(object);
    if (existing) return existing;
    let inLesson = false;
    for (let o = object.parent; o && !inLesson; o = o.parent) inLesson = o === root || o === layers.cards || o === layers.annotations;
    if (!inLesson) root.attach(object); // built but never added to the lesson: hang it on the root where it stands
    return track(mounted, world!.createTransformEntity(object, { parent: entityFor(object.parent!) }), object);
  };

  const grabObjects = new Set(traitRequests.filter((r) => r.grab).map((r) => r.object));
  const grabbableAncestor = (object: Object3D) => {
    for (let o = object.parent; o && o !== root; o = o.parent) if (grabObjects.has(o)) return o;
    return null;
  };
  // Pressable parts of a model the learner can pick up, by model. A part with an interactable entity of its own
  // would stop the pinch that picks the model up (IWSDK ends a pointer event at the first interactable it
  // reaches), so the model takes the event and presses the part that was hit.
  const partPresses = new Map<Object3D, Map<Object3D, () => void>>();
  const crowded = findCrowdedGrabbables([...grabObjects]);
  for (const request of traitRequests) {
    const model = request.grab ? null : grabbableAncestor(request.object);
    if (model && request.onPress) {
      const parts = partPresses.get(model) ?? new Map<Object3D, () => void>();
      parts.set(request.object, guard(mounted, request.onPress));
      partPresses.set(model, parts);
      mounted.pressTargets.push(request.object);
      continue;
    }
    const entity = entityFor(request.object);
    if (request.grab && crowded.has(request.object)) {
      // A near-hand pinch would take neighbours too; a ray picks exactly the object it hits.
      if (!entity.hasComponent(RayInteractable)) entity.addComponent(RayInteractable, {});
      entity.addComponent(DistanceGrabbable, { movementMode: MovementMode.MoveAtSource });
      mounted.grabModes.set(request.object, 'ray');
    } else if (request.grab) {
      // One hand picks it up and carries it; both hands turn it. Objects don't change size by hand: the view
      // pill sizes the whole lesson, the same way in every lesson.
      entity.addComponent(TwoHandsGrabbable, { scale: false });
      mounted.grabModes.set(request.object, 'touch');
    }
    if (request.onPress) {
      if (!entity.hasComponent(RayInteractable)) entity.addComponent(RayInteractable, {});
      if (!entity.hasComponent(PokeInteractable)) entity.addComponent(PokeInteractable, {});
      mounted.pressHandlers.set(entity, guard(mounted, request.onPress));
      mounted.pressTargets.push(request.object);
    }
  }
  for (const [model, parts] of partPresses) {
    const entity = entityFor(model);
    if (!entity.hasComponent(RayInteractable)) entity.addComponent(RayInteractable, {});
    if (!entity.hasComponent(PokeInteractable)) entity.addComponent(PokeInteractable, {});
    // The model's own press, if it has one, runs when the pinch or poke lands on none of the parts.
    const own = mounted.pressHandlers.get(entity);
    mounted.pressHandlers.delete(entity);
    entity.object3D!.addEventListener('pointerdown', (event) => {
      for (let o: Object3D | null = event.object; o && o !== model; o = o.parent) {
        const press = parts.get(o);
        if (press) return press();
      }
      own?.();
    });
  }
  for (const [object, mode] of mounted.grabModes) {
    const entity = mounted.objectEntities.get(object);
    if (!entity) continue;
    if (mode === 'touch') {
      pinchOnlyGrab(entity);
      // IWSDK's near grab turns the hand ray away from the object ({ deny: 'ray' }), so a learner pointing and
      // pinching could never press it or its parts. Let the ray in: a pointed pinch presses, and moving the hand
      // then drags the object, as with crowded objects.
      if (partPresses.has(object) || mounted.pressHandlers.has(entity)) object.pointerEventsType = 'all';
    }
    // A pinch on a grabbable part must not bind the model that contains it. The part keeps its own grab; the
    // model accepts the pinch only when the hit is outside every grabbable part.
    const parts = [...grabObjects].filter((part) => part !== object && isWithin(object, part));
    if (parts.length > 0) setGrabFilter(entity, (event) => !parts.some((part) => isWithin(part, event.object)));
  }

  // What a pinch or poke will take glows while a pointer is over it: a part of a model, else the object.
  for (const object of new Set(traitRequests.map((r) => r.object))) {
    if (partPresses.has(object) || !mounted.objectEntities.has(object) || !(grabObjects.has(object) || mounted.pressTargets.includes(object))) continue;
    const glow = createGlow(object, world.scene);
    mounted.glows.set(object, glow);
    glowOnHover(object, () => object, new Map([[object, glow]]));
  }
  for (const [model, parts] of partPresses) {
    const glows = new Map<Object3D, Glow>([...parts.keys()].map((part) => [part, createGlow(part, world!.scene)]));
    if (grabObjects.has(model)) glows.set(model, createGlow(model, world!.scene));
    for (const [target, glow] of glows) mounted.glows.set(target, glow);
    glowOnHover(model, (hit) => {
      for (let o: Object3D | null = hit; o && o !== model; o = o.parent) if (parts.has(o)) return o;
      return glows.has(model) ? model : null;
    }, glows);
  }

  // Panels with nothing to press (library labels, name tags, captions) are read-only: without interactables they
  // can't catch a hand ray meant for a button behind them (labels move when a model explodes). Cards with nothing
  // to press get the ray later, for their frames (setUpCards).
  const labelHolders = new Set(mounted.rigs.flatMap((rig) => rig.labelHolders()));
  for (const panel of panels) {
    const entity = entityFor(panel.holder);
    entity.addComponent(PanelUI, { config: panel.url });
    if (!labelHolders.has(panel.holder) && (panel.handlers.length > 0 || panel.valueIds.length > 0)) {
      entity.addComponent(RayInteractable, {});
      entity.addComponent(PokeInteractable, {});
    }
    mounted.panels.set(entity, panel);
  }

  mounted.update = typeof result.update === 'function' ? (result.update as Mounted['update']) : undefined;
  // The land and paths a world marks walkable (world-kit.js: userData.walkable): the player walks over them.
  const walkable: Entity[] = [];
  if (inWorld) root.traverse((object) => { if (object.userData?.walkable && (object as Mesh).isMesh) walkable.push(entityFor(object)); });
  if (inWorld) enterWorld(mounted, anchor, panels, { scale: !designedAsWorld, sky: String(result.sky ?? ''), ground: String(result.ground ?? ''), walkable });
  if (options.preview) growNewParts(mounted, root);
  else previewParts = new Set();
  current = mounted;
  if (world) syncRaycastVisibility(world.scene);
  updatePill();
  // A game opens with its name, shown by the app and gone after a few seconds (the game builds no title of its own).
  if (game && !options.preview) {
    const name = typeof result.title === 'string' ? result.title : gameTitle(code);
    if (name) showTitle(name);
  }
  return { ok: true, warnings, credits: library ? creditsFor(library, assetIds) : [] };
}

/** A learning game's name, from its IDENTITY part (the learning-game skill), for the opening title card. */
function gameTitle(code: string): string | null {
  const identity = code.match(/const\s+IDENTITY\s*=\s*\{([\s\S]{0,800}?)\n\s*\};/)?.[1] ?? '';
  return identity.match(/\btitle:\s*(['"`])((?:(?!\1).){1,60})\1/)?.[2]?.trim() || null;
}

/** World mode: a desk game opened as a world is scaled so its play area spans this many metres. */
const WORLD_SPAN_M = 7;
/**
 * World mode: a game designed as a world is built in desk units, like every game, around the player's spot, and
 * shown this many times bigger: a 15 cm tree stands 1.8 m tall, a ledge 5 cm up is at the player's waist.
 */
export const WORLD_SCALE = 12;
/** World mode: the game's panel stands this far ahead of the player, a little to the left and below the eyes. */
const WORLD_PANEL_AHEAD_M = 0.9;
const WORLD_PANEL_LEFT_M = 0.45;
const WORLD_PANEL_BELOW_EYE_M = 0.25;

/**
 * World mode: the game as a place around the player instead of a toy on the desk, under its own sky, on a ground
 * the player can walk on (IWSDK locomotion: slide, teleport, turn). A game designed as a world (build() returns
 * { mode: 'world' }) is shown WORLD_SCALE times bigger with its origin where the player stands, -Z ahead. A desk
 * game opened as a world is scaled up so its play area spans WORLD_SPAN_M and stands on the floor ahead. Either way the
 * panel stands beside the player at reading size, and the desk's grips and move handle do not apply. Closing the
 * game pauses walking and puts the player back where they were, so the room lines up with the passthrough again.
 */
function enterWorld(mounted: Mounted, anchor: Group, panels: PanelRecord[], o: { scale: boolean; sky?: string; ground?: string; walkable?: Entity[] }): void {
  if (!world || !mounted.root) return;
  mounted.handle?.dispose();
  mounted.handle = null;
  mounted.bounds?.dispose();
  mounted.bounds = null;
  const head = world.camera.getWorldPosition(new Vector3());
  const forward = new Vector3(0, 0, -1).applyQuaternion(world.camera.getWorldQuaternion(new Quaternion())).setY(0);
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
  forward.normalize();
  const floor = floorHeight(head);
  const setWorldPose = (position: Vector3, yaw: Quaternion | null) => {
    anchor.position.copy(anchor.parent ? anchor.parent.worldToLocal(position.clone()) : position);
    if (yaw) {
      const parentTurn = anchor.parent ? anchor.parent.getWorldQuaternion(new Quaternion()) : new Quaternion();
      anchor.quaternion.copy(parentTurn.invert().multiply(yaw));
    }
    anchor.updateMatrixWorld(true);
  };
  if (o.scale) {
    anchor.updateMatrixWorld(true);
    const box = new Box3().setFromObject(mounted.root);
    const span = Math.max(box.max.x - box.min.x, box.max.z - box.min.z, 0.05);
    anchor.scale.multiplyScalar(WORLD_SPAN_M / span);
    anchor.updateMatrixWorld(true);
    box.setFromObject(mounted.root);
    const centre = box.getCenter(new Vector3());
    const target = head.clone().addScaledVector(forward, WORLD_SPAN_M / 2 + 1.2);
    setWorldPose(anchor.getWorldPosition(new Vector3()).add(new Vector3(target.x - centre.x, floor - box.min.y, target.z - centre.z)), null);
  } else {
    // Designed as a world: its origin is the player's spot on the floor, its -Z the way they face.
    anchor.scale.setScalar(WORLD_SCALE);
    mounted.root.scale.setScalar(1);
    mounted.fitScale = 1;
    const yaw = new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), forward);
    setWorldPose(new Vector3(head.x, floor, head.z), yaw);
  }
  // The panel beside the player at reading size, facing them, whatever the game's scale.
  const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize();
  panels.forEach((panel, i) => {
    const holder = panel.holder;
    const at = head.clone().addScaledVector(forward, WORLD_PANEL_AHEAD_M).addScaledVector(right, -WORLD_PANEL_LEFT_M - i * 0.5);
    at.y = head.y - WORLD_PANEL_BELOW_EYE_M;
    holder.parent?.updateMatrixWorld(true);
    holder.position.copy(holder.parent ? holder.parent.worldToLocal(at.clone()) : at);
    const facing = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(head.x - at.x, 0, head.z - at.z).normalize());
    const parentTurn = holder.parent ? holder.parent.getWorldQuaternion(new Quaternion()) : new Quaternion();
    holder.quaternion.copy(parentTurn.invert().multiply(facing));
    // Its authored size in metres, whatever the game's scale.
    holder.scale.setScalar(1 / ((holder.parent ? holder.parent.getWorldScale(new Vector3()).x : 1) || 1));
  });
  anchor.updateMatrixWorld(true);
  for (const entity of o.walkable ?? []) entity.addComponent(IWSDK.LocomotionEnvironment, { type: 'static' });
  mounted.worldScene = createWorldScene(floor, o.sky, o.ground);
}

/** World mode's skies (zenith, horizon) and grounds, by the names a game returns from build() (references/world.md). */
const WORLD_SKIES: Record<string, { top: string; horizon: string; stars?: boolean }> = {
  day: { top: '#4f93e8', horizon: '#e3f1ff' },
  dawn: { top: '#6c9bd6', horizon: '#ffd7b0' },
  dusk: { top: '#2c2f6e', horizon: '#ffae78' },
  night: { top: '#040817', horizon: '#1b2750', stars: true },
  overcast: { top: '#8a97a4', horizon: '#dde2e7' },
};
const WORLD_GROUNDS: Record<string, string> = { grass: '#8dbb72', sand: '#e2cd96', snow: '#f1f4f7', rock: '#878176' };

/**
 * The world's sky (horizon to zenith) and a ground to walk on: they hide the room. While it is open, IWSDK's
 * locomotion moves the player over the ground; dispose() pauses it and puts the player back.
 */
function createWorldScene(floor: number, skyName = 'day', groundName = 'grass'): { dispose(): void } {
  const w = world!;
  const skyLook = WORLD_SKIES[skyName] ?? WORLD_SKIES.day!;
  const sky = new IWSDK.Mesh(
    new IWSDK.SphereGeometry(90, 32, 16),
    new IWSDK.ShaderMaterial({
      side: IWSDK.BackSide,
      depthWrite: false,
      uniforms: { top: { value: new IWSDK.Color(skyLook.top) }, horizon: { value: new IWSDK.Color(skyLook.horizon) } },
      vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vDir; void main() { gl_FragColor = vec4(mix(horizon, top, clamp(vDir.y * 1.8, 0.0, 1.0)), 1.0); }',
    }),
  );
  sky.name = 'GenUI World Sky';
  sky.position.y = floor;
  sky.raycast = () => {}; // the hands point at the game, never at the sky
  w.scene.add(sky);
  // A night sky gets stars: points on the upper half of a sphere inside the sky.
  let stars: InstanceType<typeof IWSDK.Points> | null = null;
  if (skyLook.stars) {
    const at: number[] = [];
    for (let i = 0; i < 700; i++) {
      const y = 0.08 + Math.random() * 0.92;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - y * y);
      at.push(Math.cos(a) * r * 85, y * 85, Math.sin(a) * r * 85);
    }
    const geometry = new IWSDK.BufferGeometry();
    geometry.setAttribute('position', new IWSDK.Float32BufferAttribute(at, 3));
    stars = new IWSDK.Points(geometry, new IWSDK.PointsMaterial({ color: '#ffffff', size: 0.35, sizeAttenuation: true, depthWrite: false, fog: false }));
    stars.position.y = floor;
    stars.raycast = () => {};
    w.scene.add(stars);
  }
  const ground = new IWSDK.Mesh(new IWSDK.CircleGeometry(80, 64), new IWSDK.MeshStandardMaterial({ color: WORLD_GROUNDS[groundName] ?? WORLD_GROUNDS.grass, roughness: 1 }));
  ground.name = 'GenUI World Ground';
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = floor - 0.003;
  const groundEntity = w.createTransformEntity(ground);
  groundEntity.addComponent(IWSDK.LocomotionEnvironment, { type: 'static' });
  // Fog in the horizon's colour fades the far land and mountains into the sky: the world has no hard edge.
  const fogBefore = w.scene.fog;
  w.scene.fog = new IWSDK.Fog(skyLook.horizon, 30, 88);
  const player = { position: w.player.position.clone(), quaternion: w.player.quaternion.clone() };
  let walking = w.getSystem(IWSDK.LocomotionSystem);
  if (!walking) {
    w.registerSystem(IWSDK.LocomotionSystem, { priority: -5 });
    walking = w.getSystem(IWSDK.LocomotionSystem);
  }
  walking?.play();
  // Walking starts where the player stands now, on this world's floor: the locomotor keeps its own position
  // between worlds, so without this a second world would put the player back where they left the first one.
  walking?.setPlayerPosition(new Vector3(player.position.x, floor, player.position.z));
  return {
    dispose() {
      w.scene.fog = fogBefore;
      walking?.stop();
      w.player.position.copy(player.position);
      w.player.quaternion.copy(player.quaternion);
      groundEntity.destroy();
      sky.removeFromParent();
      if (stars) {
        stars.removeFromParent();
        stars.geometry.dispose();
        (stars.material as { dispose(): void }).dispose();
      }
      for (const mesh of [sky, ground]) {
        mesh.geometry.dispose();
        (mesh.material as { dispose(): void }).dispose();
      }
    },
  };
}

class GenUISystem extends createSystem({
  pressed: { required: [Pressed] },
  panelDocuments: { required: [PanelUI, PanelDocument] },
  planes: { required: [XRPlaneComponent] },
}) {
  private readonly eye = new Vector3();

  init(): void {
    planeEntities = () => this.queries.planes.entities;
    let immersive = false;
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((visibility) => {
        // Entering XR: lessons open at the spot saved in the room (or find one, if the learner is elsewhere).
        // Leaving XR: the flat page has no room to keep a spot in.
        const now = visibility !== VisibilityState.NonImmersive;
        if (now !== immersive) lessonSpot = now ? loadLessonSpot() : null;
        immersive = now;
      }),
    );
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

  private fingertips = false;

  update(delta: number): void {
    // Once the hands' pointers exist: a near pinch takes only what is at the fingertips.
    if (!this.fingertips) this.fingertips = pinchAtFingertips(this.world.input);
    // Before this frame's later rays, and again after the lesson shows or hides parts.
    syncRaycastVisibility(this.world.scene);
    const mounted = current;
    if (!mounted) return;
    // Textures are painted a few milliseconds per frame, so a lesson never stalls the headset.
    mounted.kit?.pump(5);
    tickGlows();
    if (mounted.cards.length > 0) {
      const head = this.world.camera.getWorldPosition(new Vector3());
      const floor = floorHeight(head);
      for (const card of mounted.cards) card.tick(head, floor);
    }
    const held = [...mounted.grabModes.keys()].some((object) => mounted.objectEntities.get(object)?.hasComponent(Grabbed) ?? false);
    if (mounted.bounds) mounted.bounds.tick(this.world.input, held, floorHeight(this.world.camera.getWorldPosition(this.eye)));
    if (mounted.declutterIn !== null && [...mounted.panels.values()].every((p) => p.document)) {
      // UIKit lays panels out over a few frames; measure once their sizes are real.
      if (mounted.declutterIn-- <= 0) {
        mounted.declutterIn = null;
        if (mounted.rigs.length > 0) layoutLessonPanels(mounted);
        else if (!mounted.worldScene) {
          fitCards(mounted);
          keepPanelsInView(mounted);
        }
        setUpCards(mounted);
        updatePill();
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
    if (mounted.update) {
      try {
        if (mounted.root) updateGameHands(mounted.hands, this.world.input, mounted.root);
        // A pinch beside the playfield is not a move in the game. The hand can still hover over it.
        if (mounted.game && mounted.bounds && mounted.root) {
          for (const side of ['left', 'right'] as const) {
            const hand = mounted.hands[side];
            if (!hand.pinching) continue;
            if (mounted.bounds.inside(mounted.root.localToWorld(playTip.copy(hand.tip)), PLAY_PINCH_MARGIN_XZ_M, PLAY_PINCH_MARGIN_Y_M)) continue;
            hand.pinching = false;
            hand.pinched = false;
          }
        }
        // A hand moving or turning the game by its handles is not playing it.
        const dragging = mounted.bounds?.dragging();
        if (dragging) Object.assign(mounted.hands[dragging], { pinching: false, pinched: false });
        mounted.update(performance.now() / 1000 - mounted.startTime, delta);
      } catch (err) {
        // Stop calling a broken update; the scene stays, the error goes to the repair loop.
        mounted.update = undefined;
        onRuntimeError?.(`update() threw: ${describe(err)}`);
      }
    }
    // After the lesson has moved its parts: tags stand on them this frame, not the next.
    syncLayers(mounted);
    syncRaycastVisibility(this.world.scene);
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
    valueIds: [],
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

/**
 * Only a pinch picks up a near-grabbable object: a hand's pinch, or a pointed pinch where the ray is let in for
 * presses (a small part in motion, an orbiting planet, is easier to take from a distance). IWSDK's grab handle
 * would also let a fingertip touch drag it: a hand reaching in to pinch touches the model with its fingertip
 * first, so the model followed the finger and was dropped instead of being held.
 */
function pinchOnlyGrab(entity: Entity) {
  setGrabFilter(entity, (event) => event.pointerType !== 'touch');
}

function track(mounted: Mounted, entity: Entity, object: Object3D): Entity {
  mounted.entities.push(entity);
  mounted.objectEntities.set(object, entity);
  return entity;
}

/**
 * A saved spot is kept only while it is roughly ahead of the learner. A learner who had sat on the bed, then turned to
 * the desk, got every lesson beside them over the bed, its frame reaching back to their hand.
 */
function spotAhead(position: Vector3, frame: Object3D): boolean {
  const world = frame.localToWorld(position.clone());
  const toSpot = new Vector3(world.x - tmpHead.x, 0, world.z - tmpHead.z);
  if (toSpot.lengthSq() < 1e-6) return true;
  return toSpot.normalize().dot(tmpForward) >= KEEP_SPOT_AHEAD_COS;
}

/**
 * Put the lesson at the session's spot. The first lesson finds it: the learner's desk (a detected
 * horizontal surface below the eyes, in front and within reach; docs/spec.md, Phase 4) or, without one, floating
 * at seated desk height in front. Later lessons open there too, and a lesson the learner drags moves it.
 * `front` is how far this lesson reaches toward the learner from its centre: it is set back far enough
 * that nothing starts in their face. Returns the surface's label, or null when floating.
 */
function placeInSeatedReach(anchor: Group, front: number, bottom: number): string | null {
  const frame = roomFrame().group;
  frame.updateMatrixWorld(true);
  const camera = world!.camera;
  camera.getWorldPosition(tmpHead);
  const head = frame.worldToLocal(tmpHead.clone());
  camera.getWorldDirection(tmpForward);
  tmpForward.y = 0;
  if (tmpForward.lengthSq() < 1e-6) tmpForward.set(0, 0, -1);
  tmpForward.normalize();
  if (!lessonSpot || lessonSpot.position.distanceTo(head) > KEEP_SPOT_WITHIN_M || !spotAhead(lessonSpot.position, frame)) {
    const desk = findDesk(tmpHead, tmpForward);
    const spot = desk ? desk.point.clone() : tmpHead.clone().addScaledVector(tmpForward, REACH_DISTANCE_M).setY(tmpHead.y - BELOW_EYES_M);
    setLessonSpot({ position: frame.worldToLocal(spot), surface: desk?.label ?? null });
  }
  const spot = lessonSpot!;
  anchor.position.copy(spot.position);
  // The lowest point of the model rests on the desk, or on the floor when the seated spot is below it.
  // A mesh built above its own origin used to stay up at eye height.
  const floorY = frame.worldToLocal(new Vector3(tmpHead.x, floorHeight(tmpHead), tmpHead.z)).y;
  const support = spot.surface ? spot.position.y : Math.max(spot.position.y, floorY + FLOOR_CLEARANCE_M);
  anchor.position.y = support - bottom;
  const away = new Vector3(anchor.position.x - head.x, 0, anchor.position.z - head.z);
  const gap = away.length() - front;
  if (gap < MIN_FRONT_GAP_M && away.lengthSq() > 1e-6) anchor.position.addScaledVector(away.normalize(), Math.min(MIN_FRONT_GAP_M - gap, MAX_SET_BACK_M));
  // root's +Z must face the viewer, so yaw toward the head.
  anchor.rotation.y = Math.atan2(head.x - anchor.position.x, head.z - anchor.position.z);
  return spot.surface;
}

/**
 * The floor's height in the world: the lowest surface the headset labels floor, or failing that the lowest
 * horizontal one well below the eyes; without scene data, y = 0 of the floor-level reference space.
 */
export function floorHeight(head: Vector3): number {
  let floor: number | null = null;
  for (const entity of planeEntities?.() ?? []) {
    const plane = entity.getValue(XRPlaneComponent, '_plane') as { orientation?: string; semanticLabel?: string } | undefined;
    const mesh = entity.object3D;
    if (!plane || !mesh || plane.orientation !== 'horizontal') continue;
    const y = mesh.getWorldPosition(new Vector3()).y;
    if (/floor/i.test(plane.semanticLabel ?? '') || head.y - y > FLOOR_DROP_M) floor = floor === null ? y : Math.min(floor, y);
  }
  return floor ?? 0;
}

/** The floor's height in `frame` (a lesson's root), for steps that move a placed lesson down. */
function floorIn(frame: Object3D): number {
  const eye = world ? world.camera.getWorldPosition(new Vector3()) : new Vector3();
  return frame.worldToLocal(new Vector3(eye.x, floorHeight(eye), eye.z)).y;
}

/**
 * Sit `root`'s lowest point on the scanned floor, then slide it along the learner's facing so the nearest
 * point of the model is `gap` metres ahead. Uses the box after the model has been scaled, in world space.
 */
function placeOnFloorInFront(root: Object3D, gap: number) {
  if (!world || !root.parent) return;
  root.parent.updateMatrixWorld(true);
  const box = visibleModelBox(root);
  if (box.isEmpty()) return;
  const head = world.camera.getWorldPosition(tmpHead);
  shiftWorld(root, tmpForward.set(0, floorHeight(head) - box.min.y, 0));
  root.parent.updateMatrixWorld(true);
  const stood = visibleModelBox(root);
  world.camera.getWorldDirection(tmpForward);
  tmpForward.y = 0;
  if (tmpForward.lengthSq() < 1e-6) tmpForward.set(0, 0, -1);
  tmpForward.normalize();
  const center = stood.getCenter(tmpShiftA);
  const half = stood.getSize(tmpShiftB).multiplyScalar(0.5);
  const extent = Math.abs(tmpForward.x) * half.x + Math.abs(tmpForward.z) * half.z;
  const dist = tmpShiftC.copy(center).sub(head).setY(0).dot(tmpForward) - extent;
  const delta = gap - dist;
  if (Math.abs(delta) > 0.02) shiftWorld(root, tmpForward.multiplyScalar(delta));
}

const tmpShiftA = new Vector3();
const tmpShiftB = new Vector3();
const tmpShiftC = new Vector3();

/** Move `object` by a world-space delta, through its parent. */
function shiftWorld(object: Object3D, delta: Vector3) {
  const parent = object.parent;
  if (!parent) return;
  object.getWorldPosition(tmpShiftA);
  tmpShiftB.copy(tmpShiftA).add(delta);
  parent.worldToLocal(tmpShiftA);
  parent.worldToLocal(tmpShiftB);
  object.position.add(tmpShiftC.copy(tmpShiftB).sub(tmpShiftA));
}

/**
 * A model whose ground is above the learner's eyes is sitting in the wrong place: put that ground on the floor.
 * Runs once the anchor is in the room, so the box is in world space.
 */
function dropAboveEyes(anchor: Object3D, root: Object3D) {
  if (!world) return;
  anchor.updateMatrixWorld(true);
  const box = visibleModelBox(root);
  if (box.isEmpty()) return;
  const head = world.camera.getWorldPosition(tmpHead);
  if (box.min.y <= head.y - 0.15) return;
  shiftWorld(anchor, tmpForward.set(0, floorHeight(head) + FLOOR_CLEARANCE_M - box.min.y, 0));
}

// A desk or table: 15-90 cm below the eyes (not a shelf), big enough for a lesson, ahead, and not the floor (for a
// learner sitting low the floor is less than 90 cm below the eyes too).
const DESK_DROP_M = [0.15, 0.9] as const;
const DESK_ABOVE_FLOOR_M = 0.15;
const DESK_REACH_M = [0.3, 0.9] as const;
const DESK_MARGIN_M = 0.12;
const DESK_AHEAD_COS = Math.cos((50 * Math.PI) / 180);
// Surfaces people sit or lie on, never a desk for a lesson.
const SEAT_LABELS = /bed|couch|sofa|seat|chair|bench/i;

/** The point on a detected surface nearest to "REACH_DISTANCE_M straight ahead", or null. */
function findDesk(head: Vector3, forward: Vector3): { point: Vector3; label: string } | null {
  let best: { point: Vector3; label: string } | null = null;
  let bestCost = Infinity;
  const floor = floorHeight(head);
  for (const entity of planeEntities?.() ?? []) {
    const plane = entity.getValue(XRPlaneComponent, '_plane') as { orientation?: string; semanticLabel?: string } | undefined;
    const mesh = entity.object3D as IWSDK.Mesh | undefined;
    if (!plane || !mesh?.isMesh || plane.orientation !== 'horizontal' || /floor/i.test(plane.semanticLabel ?? '')) continue;
    // A learner sitting on a bed or sofa had every lesson put in their lap: it is low, ahead and within reach.
    if (SEAT_LABELS.test(plane.semanticLabel ?? '')) continue;
    mesh.updateWorldMatrix(true, false);
    const height = mesh.getWorldPosition(new Vector3()).y;
    const drop = head.y - height;
    if (drop < DESK_DROP_M[0] || drop > DESK_DROP_M[1] || height - floor < DESK_ABOVE_FLOOR_M) continue;
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

/** A name tag drawn in 3D by the kit (kit.card); older kits only named them "card: …". */
function isNameTag(object: Object3D): boolean {
  return object.userData?.nameTag === true || object.name.startsWith('card: ');
}

/**
 * The lesson's three layers. build() returns one root with everything in it; the host splits it, so the views
 * scale the 3D and nothing else:
 * - root keeps the 3D, and the teaching rigs' labels (the rig sizes and places those itself);
 * - the cards layer takes the cards: panels with something to press, wherever the lesson attached them, and every
 *   panel it put straight in root. They are placed beside the 3D once, then they are the learner's to move;
 * - the annotations layer takes the name tags: the kit's tags, and panels with nothing to press that the lesson hung
 *   on a part. Each follows its spot on the 3D every frame at its own size (syncLayers).
 * Both layers stand where root stands, unscaled. Each card and tag leaves a pin where the lesson put it and stands in
 * a slot of its own, shown while the pin's groups are, so hiding a group of the lesson still hides its cards and tags
 * and their own visible flags stay the lesson's. What the lesson made grabbable or pressable stays in the 3D,
 * tag or not: a label the learner drags onto a landscape is a piece of the model.
 */
function splitLayers(mounted: Mounted, anchor: Group, root: Object3D, panels: PanelRecord[], interactive: Set<Object3D>): { cards: Group; annotations: Group } {
  const layers = { cards: new Group(), annotations: new Group() };
  layers.cards.name = 'GenUI Cards';
  layers.annotations.name = 'GenUI Annotations';
  for (const layer of [layers.cards, layers.annotations]) {
    layer.position.copy(root.position);
    layer.quaternion.copy(root.quaternion);
    anchor.add(layer);
  }
  anchor.updateMatrixWorld(true);
  const rigLabels = new Set(mounted.rigs.flatMap((rig) => rig.labelHolders()));
  const panelOf = new Map<Object3D, PanelRecord>(panels.map((p) => [p.holder, p]));
  const moving: { object: Object3D; kind: Layered['kind'] }[] = [];
  const visit = (object: Object3D) => {
    for (const child of object.children) {
      const panel = panelOf.get(child);
      if (interactive.has(child)) visit(child);
      else if (panel && !rigLabels.has(child)) {
        const pressable = panel.handlers.length > 0 || panel.valueIds.length > 0;
        moving.push({ object: child, kind: pressable || object === root ? 'card' : 'tag' });
      } else if (!panel && isNameTag(child)) moving.push({ object: child, kind: 'tag' });
      else if (!panel) visit(child);
    }
  };
  visit(root);
  for (const { object, kind } of moving) {
    const pin = new Object3D();
    pin.name = 'GenUI Pin';
    pin.position.copy(object.position);
    pin.quaternion.copy(object.quaternion);
    pin.scale.copy(object.scale);
    object.parent!.add(pin);
    pin.updateWorldMatrix(true, false);
    // The anchor is not placed yet: world is the lesson's own frame.
    const size = object.getWorldScale(new Vector3()).x;
    const at = root.worldToLocal(pin.getWorldPosition(new Vector3()));
    const slot = new Group();
    slot.name = 'GenUI Slot';
    (kind === 'card' ? layers.cards : layers.annotations).add(slot);
    slot.attach(object);
    object.scale.setScalar(size);
    const shown = pinShown(pin, root);
    slot.visible = shown;
    mounted.layered.push({ object, kind, pin, slot, panel: panelOf.get(object) ?? null, size, at, shown });
  }
  mounted.layers = layers;
  return layers;
}

/** Whether the lesson shows what `pin` stands for: the pin is still in the lesson, and every group above it is visible. */
function pinShown(pin: Object3D, root: Object3D): boolean {
  for (let o: Object3D | null = pin; o; o = o.parent) {
    if (!o.visible) return false;
    if (o === root) return true;
  }
  return false;
}

const tmpPinPosition = new Vector3();
const tmpPinQuaternion = new Quaternion();
const tmpPinScale = new Vector3();
const tmpLayerTurn = new Quaternion();

/** Per frame: cards and tags show while the lesson shows their pins; tags stand at their pins, at their own size. */
function syncLayers(mounted: Mounted) {
  const { layers, root } = mounted;
  if (!layers || !root) return;
  const tags = layers.annotations;
  tags.updateWorldMatrix(true, false);
  tags.getWorldQuaternion(tmpLayerTurn).invert();
  for (const item of mounted.layered) {
    const now = pinShown(item.pin, root);
    if (now !== item.shown) item.slot.visible = item.shown = now;
    if (item.kind !== 'tag' || !now) continue;
    item.pin.updateWorldMatrix(true, false);
    item.pin.matrixWorld.decompose(tmpPinPosition, tmpPinQuaternion, tmpPinScale);
    item.object.position.copy(tags.worldToLocal(tmpPinPosition));
    item.object.quaternion.copy(tmpLayerTurn).multiply(tmpPinQuaternion);
  }
}

/**
 * The fitted view: scale the lesson's 3D so its largest side is FIT_BOX_M (up or down). Only root is scaled: the
 * cards and tags are in their own layers. Only meshes count: the rigs' labels and leader lines are left out.
 */
// The meshes of the last preview, by their place in the scene tree (child indices from the root). A snapshot only
// adds code after the last one, so a part already shown keeps its place and only new parts grow in.
let previewParts = new Set<string>();
const PREVIEW_GROW_S = 0.35;

function growNewParts(mounted: Mounted, root: Object3D) {
  const growing: { object: Object3D; scale: Vector3 }[] = [];
  const seen = new Set<string>();
  const walk = (object: Object3D, path: string) => {
    object.children.forEach((child, i) => {
      const at = `${path}/${i}`;
      if ((child as Mesh).isMesh || (child as InstancedMesh).isInstancedMesh) {
        seen.add(at);
        if (previewParts.size > 0 && !previewParts.has(at)) growing.push({ object: child, scale: child.scale.clone() });
      }
      walk(child, at);
    });
  };
  walk(root, '');
  previewParts = seen;
  if (growing.length === 0) return;
  for (const part of growing) part.object.scale.setScalar(1e-3);
  const update = mounted.update;
  const began = performance.now() / 1000;
  mounted.update = (time, delta) => {
    const t = Math.min(1, (performance.now() / 1000 - began) / PREVIEW_GROW_S);
    const eased = 1 - (1 - t) ** 3;
    for (const part of growing) part.object.scale.copy(part.scale).multiplyScalar(Math.max(1e-3, eased));
    if (t >= 1) mounted.update = update;
    update?.(time, delta);
  };
}

function fitToBox(mounted: Mounted, root: Object3D, panels: PanelRecord[], options: { boxM?: number; skipHidden?: boolean; shrinkOnly?: boolean } = {}) {
  const box = contentBox(root, new Set(panels.map((p) => p.holder)), options.skipHidden);
  if (box.isEmpty()) return;
  const size = box.getSize(new Vector3());
  const largest = Math.max(size.x, size.y, size.z);
  mounted.built = { box: box.clone(), size: largest, rootScale: root.scale.x || 1, origin: root.position.clone() };
  const scale = Math.min(FIT_SCALE_RANGE[1], Math.max(FIT_SCALE_RANGE[0], (options.boxM ?? FIT_BOX_M) / largest));
  if (Math.abs(scale - 1) < 0.02 || (options.shrinkOnly && scale > 1)) return;
  mounted.fitScale = scale;
  root.scale.multiplyScalar(scale);
  for (const rig of mounted.rigs) rig.setLabelScale(1 / scale);
}

/**
 * Cards go where the lesson put them beside the 3D, moved with the fitted 3D: each card's inner edge stays where
 * the model's edge now is, while the card keeps its size. Heights are known once a card has laid out.
 */
function fitCards(mounted: Mounted) {
  const { root, layers } = mounted;
  if (!root || !layers) return;
  const scale = mounted.fitScale;
  root.updateWorldMatrix(true, false);
  layers.cards.updateWorldMatrix(true, false);
  for (const item of mounted.layered) {
    if (item.kind !== 'card') continue;
    const position = item.object.position.copy(layers.cards.worldToLocal(root.localToWorld(item.at.clone())));
    if (Math.abs(scale - 1) < 0.02) continue;
    const box = boxAround(item.object);
    const width = (item.panel?.width ?? 0) * item.size;
    const height = box.isEmpty() ? 0 : box.max.y - box.min.y;
    if (Math.abs(item.at.x) > width / 4) position.x += Math.sign(item.at.x) * (width / 2) * (1 - scale);
    if (item.at.y > 0) position.y += (height / 2) * (1 - scale);
  }
}

function canShowRealSize(mounted: Mounted): boolean {
  return mounted.built !== null && mounted.realSizeM !== null && mounted.realSizeM >= REAL_SIZE_RANGE_M[0] && mounted.realSizeM <= REAL_SIZE_RANGE_M[1];
}

/**
 * Show the lesson's subject fitted in the box on the desk, or at its real size: standing on the floor, its near side
 * a short way ahead. Only the 3D moves and changes size: the cards stay where they are, so the learner can still
 * read and use them, and the tags go with their parts at their own size. The teaching rig sizes its own labels.
 */
export function setLessonView(view: 'fit' | 'real') {
  const mounted = current;
  const root = mounted?.root;
  const anchor = root?.parent;
  if (!mounted || !root || !anchor || !world || view === mounted.view) return;
  // Not before the one-time layout has placed the cards beside the fitted 3D.
  if (view === 'real' && (!canShowRealSize(mounted) || !mounted.built || mounted.declutterIn !== null)) return;
  if (view === 'real') {
    const built = mounted.built!;
    mounted.fitPose = { position: root.position.clone(), scale: root.scale.clone(), labelScales: mounted.rigs.map((rig) => rig.labelScaleNow()) };
    // World metres per metre as built, and how much bigger than the fitted view.
    const k = mounted.realSizeM! / built.size;
    const grow = (built.rootScale * k) / (root.scale.x || 1);
    root.scale.setScalar(built.rootScale * k);
    // Measure the scaled model and slide that box. The old offset used the model's own +Z, so a rocket
    // whose length was not along that axis ended up a long way down the floor.
    const gap = mounted.realSizeM! >= FLOOR_SUBJECT_M ? REAL_NEAR_M : REAL_VIEW_GAP_M;
    placeOnFloorInFront(root, gap);
    mounted.rigs.forEach((rig, i) => rig.setLabelScale(mounted.fitPose!.labelScales[i] / grow));
  } else if (mounted.fitPose) {
    root.position.copy(mounted.fitPose.position);
    root.scale.copy(mounted.fitPose.scale);
    mounted.rigs.forEach((rig, i) => rig.setLabelScale(mounted.fitPose!.labelScales[i]));
    mounted.fitPose = null;
  }
  syncLayers(mounted);
  mounted.view = view;
  updatePill();
}

/** The real size of the lesson open now (from the size agent, when the lesson didn't declare it). */
export function setLessonRealSize(sizeM: number | null) {
  if (!current || current.realSizeM !== null) return;
  current.realSizeM = typeof sizeM === 'number' && Number.isFinite(sizeM) && sizeM > 0 ? sizeM : null;
  updatePill();
}

/**
 * Play: make the game on the desk bigger (+1) or smaller (-1) by one step, about its base, with its scoreboard
 * kept beside it. Returns the zoom (1 = fitted), or null when no game is open.
 */
export function zoomGame(direction: 1 | -1): number | null {
  const mounted = current;
  const root = mounted?.root;
  if (!mounted?.game || !root) return null;
  const zoom = Math.min(GAME_ZOOM_RANGE[1], Math.max(GAME_ZOOM_RANGE[0], mounted.gameZoom * (direction > 0 ? GAME_ZOOM_STEP : 1 / GAME_ZOOM_STEP)));
  const factor = zoom / mounted.gameZoom;
  if (Math.abs(factor - 1) < 1e-3) return zoom;
  mounted.gameZoom = zoom;
  // Grow away from the player: the playfield's near edge stays where it is.
  const nearBefore = nearEdge(root);
  root.scale.multiplyScalar(factor);
  if (nearBefore !== null) root.position.z -= (nearEdge(root) ?? nearBefore) - nearBefore;
  mounted.fitScale *= factor;
  fitCards(mounted);
  syncLayers(mounted);
  return zoom;
}

/** How far toward the player (+Z of root's parent) the visible 3D reaches, in the parent's frame. */
function nearEdge(root: Object3D): number | null {
  const parent = root.parent;
  if (!parent) return null;
  const box = contentBox(root, new Set(), true);
  if (box.isEmpty()) return null;
  parent.updateWorldMatrix(true, false);
  let near = -Infinity;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    near = Math.max(near, parent.worldToLocal(new Vector3(x, y, z)).z);
  }
  return near;
}

/** Play: a game has no real-size view (no view pill), even if its code declared a size. */
export function dropLessonRealSize() {
  if (!current) return;
  current.realSizeM = null;
  updatePill();
}

/** Whether the lesson open now declared its real size (no need to ask the size agent). */
export function lessonDeclaresRealSize(): boolean {
  return current?.realSizeM != null;
}

/** "1:16" for a subject shown smaller than it is, "x250,000" for one shown larger. */
function scaleText(ratio: number): string {
  const round = (n: number) => (n >= 100 ? Number(n.toPrecision(2)) : Math.round(n * 10) / 10).toLocaleString('en-US');
  return ratio >= 1 ? `1:${round(ratio)}` : `x${round(1 / ratio)}`;
}

function updatePill() {
  const mounted = current;
  if (!mounted?.built || mounted.realSizeM === null) return setPill({ shown: false, label: '', detail: '', enabled: false });
  if (mounted.view === 'real') return setPill({ shown: true, label: 'Fit', detail: '1:1', enabled: true });
  const rootScale = mounted.root?.scale.x || 1;
  const shown = mounted.built.size * (rootScale / (mounted.built.rootScale || 1));
  const ratio = mounted.realSizeM / shown;
  if (canShowRealSize(mounted)) return setPill({ shown: true, label: 'Real size', detail: scaleText(ratio), enabled: mounted.declutterIn === null });
  setPill({ shown: true, label: 'Scale', detail: scaleText(ratio), enabled: false });
}

/** The box around a lesson's meshes (no panels, labels or leader lines), in world space. */
function contentBox(root: Object3D, panelHolders: Set<Object3D>, skipHidden = false): Box3 {
  root.updateMatrixWorld(true);
  const box = new Box3();
  const visit = (object: Object3D) => {
    if (panelHolders.has(object) || (object as { isLine?: boolean }).isLine || (skipHidden && !object.visible)) return;
    if ((object as { isMesh?: boolean }).isMesh) expandByMesh(box, object);
    for (const child of object.children) visit(child);
  };
  visit(root);
  return box;
}

function guard<A extends unknown[]>(mounted: Mounted, fn: (...args: A) => void): (...args: A) => void {
  return (...args) => {
    mounted.handlerCalls++;
    try {
      fn(...args);
    } catch (err) {
      onRuntimeError?.(`Interaction handler threw: ${describe(err)}`);
    }
  };
}

/**
 * Lesson layout for library models that show their labels (SceneCraft's split: the agent says what panels
 * exist, code says where). Runs once, after every panel has laid out and has its real size, in root's frame:
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
  // With no labels showing there are no label columns to clear: the panels stay where
  // the agent put them, beside the model as in every drawn lesson.
  if (![...labels].some((label) => label.visible)) return keepPanelsInView(mounted);
  const model = new Box3();
  for (const rig of mounted.rigs) for (const part of rig.partObjects()) model.union(boxIn(part));
  if (model.isEmpty()) return;
  const occupied = model.clone();
  for (const label of labels) if (label.visible) occupied.union(boxIn(label));

  const panels = mounted.layered
    .filter((item) => item.kind === 'card')
    .map((item) => ({ holder: item.object, box: boxIn(item.object) }))
    .filter((p) => !p.box.isEmpty());
  if (panels.length === 0) return;
  const gap = 0.025;
  const modelCenterX = (model.min.x + model.max.x) / 2;
  // Panels stand forward of the model's front face: a hand ray from chest height up to a button
  // behind that plane would pass through the model (and a grabbable model catches it).
  const frontZ = model.max.z + gap;
  // Cards stand in their own layer, unscaled: a move worked out in root's frame is converted to the card's.
  const moveTo = (panel: { holder: Object3D; box: Box3 }, minX: number, minY: number, z: number) => {
    const parent = panel.holder.parent!;
    const from = parent.worldToLocal(root.localToWorld(panel.box.min.clone()));
    panel.holder.position.add(parent.worldToLocal(root.localToWorld(new Vector3(minX, minY, z))).sub(from));
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
    // A lesson standing on a desk can't move down (into the desk), only back; a floating one stops above the floor.
    const maxDown = mounted.onSurface ? 0 : Math.max(0, Math.min(0.4001, (model.min.y - floorIn(root)) / metre - FLOOR_CLEARANCE_M));
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
      const before = root.position.clone();
      root.position.copy(root.parent ? root.parent.worldToLocal(target) : target);
      // The cards move with the lesson (the tags follow their parts by themselves).
      mounted.layers?.cards.position.add(root.position).sub(before);
      root.parent?.updateMatrixWorld(true);
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
  root.parent?.updateMatrixWorld(true);

  // Labels keep the angular size they were designed for (1.4 cm text read from 55 cm) wherever the
  // framing put the lesson; if that changes their size, lay everything out again around them.
  if (eye && !again) {
    const labelScale = Math.min(1.8, Math.max(1, eye.distanceTo(model.getCenter(new Vector3())) / 0.55));
    mounted.layout.labelScale = labelScale;
    if (labelScale > 1.05) {
      for (const rig of mounted.rigs) rig.setLabelScale(labelScale / mounted.fitScale);
      layoutLessonPanels(mounted, { main: main.holder });
      if (mounted.layout) mounted.layout.labelScale = labelScale;
    }
  }
}

/**
 * Drawn lessons place their own panels. One that stands taller than the learner's eye line (a long panel,
 * or a lesson on a high desk) would have them reading upwards: lower it until its top is just above eye
 * level, but never into the surface the lesson stands on.
 */
function keepPanelsInView(mounted: Mounted) {
  const root = mounted.root;
  if (!root || !world) return;
  root.parent?.updateMatrixWorld(true);
  const eye = world.camera.getWorldPosition(new Vector3());
  const base = root.parent ? root.parent.getWorldPosition(new Vector3()).y : -Infinity;
  const centre = new Vector3();
  for (const item of mounted.layered) {
    const holder = item.object;
    const parent = holder.parent;
    const box = boxAround(holder);
    if (item.kind !== 'card' || !parent || box.isEmpty()) continue;
    box.getCenter(centre);
    const limit = eye.y + PANEL_TOP_RISE * Math.hypot(centre.x - eye.x, centre.z - eye.z);
    const drop = Math.min(box.max.y - limit, box.min.y - (base + 0.02));
    if (drop > 0.005) holder.position.y -= drop / (parent.getWorldScale(new Vector3()).y || 1);
    // Nor nearer the eyes than a comfortable reading distance: a learner sitting low (on a bed, on the floor)
    // otherwise had the card right in front of their face.
    const flat = new Vector3(centre.x - eye.x, 0, centre.z - eye.z);
    const distance = flat.length();
    if (distance > 1e-3 && distance < CARD_MIN_DISTANCE_M) {
      const away = centre.clone().addScaledVector(flat.normalize(), CARD_MIN_DISTANCE_M - distance);
      holder.position.add(parent.worldToLocal(away).sub(parent.worldToLocal(centre.clone())));
    }
  }
}

/**
 * A lesson's cards (the panels in its cards layer) start a little smaller than the lesson drew them, and the learner
 * holds them by their frames: one hand moves a card, two hands make it bigger or smaller.
 */
function setUpCards(mounted: Mounted) {
  if (!world || !mounted.root) return;
  const cards = new Set(mounted.layered.filter((item) => item.kind === 'card').map((item) => item.object));
  const ready: [Entity, PanelRecord][] = [];
  for (const [entity, panel] of mounted.panels) {
    if (!cards.has(panel.holder)) continue;
    // A card with nothing to press (an info card) still takes the hand ray, for its frame.
    if (!entity.hasComponent(RayInteractable)) entity.addComponent(RayInteractable, {});
    panel.holder.scale.multiplyScalar(CARD_START_SCALE);
    panel.holder.updateWorldMatrix(true, true);
    ready.push([entity, panel]);
  }
  // After the start scale, so the gap is the one the learner sees, and before the frame can be grabbed.
  separateCardsFromModel(mounted);
  for (const [entity, panel] of ready) mounted.cards.push(makeCardGrabbable(panel.holder, entity));
}

/**
 * A card whose box covers the model in x and z moves to the side it is already closer to, clear of the model,
 * and stays above the floor. Cards the lesson already placed beside the model stay put.
 */
function separateCardsFromModel(mounted: Mounted) {
  const root = mounted.root;
  if (!root || !world) return;
  root.updateMatrixWorld(true);
  const model = visibleModelBox(root);
  if (model.isEmpty()) return;
  const floor = floorHeight(world.camera.getWorldPosition(new Vector3()));
  for (const item of mounted.layered) {
    if (item.kind !== 'card') continue;
    const holder = item.object;
    const parent = holder.parent;
    if (!parent) continue;
    holder.updateWorldMatrix(true, false);
    let card = boxAround(holder);
    if (card.isEmpty()) continue;
    const overlapsX = card.min.x < model.max.x && card.max.x > model.min.x;
    const overlapsZ = card.min.z < model.max.z && card.max.z > model.min.z;
    if (!overlapsX || !overlapsZ) continue;
    const cardCenterX = (card.min.x + card.max.x) / 2;
    const modelCenterX = (model.min.x + model.max.x) / 2;
    const width = card.max.x - card.min.x;
    const targetMinX = cardCenterX >= modelCenterX ? model.max.x + CARD_MODEL_GAP_M : model.min.x - CARD_MODEL_GAP_M - width;
    const origin = holder.getWorldPosition(new Vector3());
    const shifted = origin.clone();
    shifted.x += targetMinX - card.min.x;
    holder.position.add(parent.worldToLocal(shifted).sub(parent.worldToLocal(origin.clone())));
    holder.updateWorldMatrix(true, false);
    card = boxAround(holder);
    if (card.isEmpty() || card.min.y >= floor + CARD_FLOOR_GAP_M) continue;
    const lifted = holder.getWorldPosition(new Vector3());
    const raised = lifted.clone();
    raised.y += floor + CARD_FLOOR_GAP_M - card.min.y;
    holder.position.add(parent.worldToLocal(raised).sub(parent.worldToLocal(lifted.clone())));
  }
}

/** The box around a lesson's visible meshes, in world space. Hidden meshes and lines are left out. */
function visibleModelBox(root: Object3D, target = new Box3()): Box3 {
  target.makeEmpty();
  const visit = (object: Object3D) => {
    if (!shown(object) || (object as { isLine?: boolean }).isLine) return;
    if ((object as { isMesh?: boolean }).isMesh) expandByMesh(target, object);
    for (const child of object.children) visit(child);
  };
  visit(root);
  return target;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
