// Version C of the GenUI comparison (RQ1, SPEC.md Phase 1): declarative GenUI with A2UI v1.0
// (https://a2ui.org/specification/v1.0-a2ui/). The agent writes A2UI messages against a spatial catalog;
// this file parses and checks them, and compiles the surface into a host module (runtime.js inside), so
// the host, the safety checks, the emulator tests and the judge are the same for every version.
import { readFileSync } from 'node:fs';
import { unsupportedGlyphs } from '../glyphs.js';

export const SPATIAL_CATALOG_ID = 'urn:spatial-genui:catalog:spatial:1.0';

export type A2UIComponent = { id: string; component: string; [prop: string]: unknown };
export type Surface = { surfaceId: string; catalogId?: string; components: A2UIComponent[]; dataModel: Record<string, unknown> };

type Kind = 'scene' | 'object' | 'motion' | 'panel' | 'content';
// What each component is and which properties it must have. `content` components live inside a Panel
// (A2UI's basic catalog); the rest are spatial.
const COMPONENTS: Record<string, { kind: Kind; required: string[]; refs: string[] }> = {
  Scene: { kind: 'scene', required: ['children'], refs: ['children'] },
  Shape: { kind: 'object', required: ['shape'], refs: ['children'] },
  Group: { kind: 'object', required: ['children'], refs: ['children'] },
  Arrow: { kind: 'object', required: ['from', 'to'], refs: [] },
  Orbit: { kind: 'motion', required: ['target', 'radius'], refs: [] },
  Spin: { kind: 'motion', required: ['target'], refs: [] },
  Panel: { kind: 'panel', required: ['child'], refs: ['child'] },
  QuizCard: { kind: 'panel', required: ['question', 'options', 'answer'], refs: [] },
  StepTour: { kind: 'panel', required: ['steps'], refs: [] },
  Column: { kind: 'content', required: ['children'], refs: ['children'] },
  Row: { kind: 'content', required: ['children'], refs: ['children'] },
  Card: { kind: 'content', required: ['child'], refs: ['child'] },
  Text: { kind: 'content', required: ['text'], refs: [] },
  Button: { kind: 'content', required: ['action'], refs: ['child'] },
  Divider: { kind: 'content', required: [], refs: [] },
};
const SHAPES = new Set(['sphere', 'box', 'cylinder', 'cone', 'torus', 'capsule', 'ring']);
const FUNCTIONS: Record<string, string[]> = {
  setData: ['path'],
  highlight: ['target'],
  toggleVisible: ['target'],
  setVisible: ['target'],
  toggleMotion: ['target'],
  resetPositions: [],
  checkSort: ['items'],
  run: ['calls'],
  formatString: ['value'],
};
const ID = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The JSON the agent wrote: the first ```json block (or the whole reply), as an array of messages. */
export function extractJson(reply: string): unknown | null {
  const fence = reply.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  const text = (fence ? fence[1] : reply).trim();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Fold A2UI messages (createSurface, then any updateComponents / updateDataModel) into one surface. */
export function surfaceFrom(messages: unknown): { surface?: Surface; error?: string } {
  const list = Array.isArray(messages) ? messages : [messages];
  let surface: Surface | undefined;
  for (const message of list as Record<string, any>[]) {
    if (!message || typeof message !== 'object') return { error: 'Each A2UI message must be a JSON object.' };
    if (message.version !== '1.0') return { error: 'Each A2UI message needs "version": "1.0".' };
    if (message.createSurface) {
      const c = message.createSurface;
      surface = { surfaceId: c.surfaceId, catalogId: c.catalogId, components: [...(c.components ?? [])], dataModel: c.dataModel ?? {} };
    } else if (message.updateComponents) {
      if (!surface) return { error: 'updateComponents came before createSurface.' };
      for (const component of message.updateComponents.components ?? []) {
        const at = surface.components.findIndex((c) => c.id === component.id);
        if (at >= 0) surface.components[at] = component;
        else surface.components.push(component);
      }
    } else if (message.updateDataModel) {
      if (!surface) return { error: 'updateDataModel came before createSurface.' };
      const { path = '/', value } = message.updateDataModel;
      if (path === '/') surface.dataModel = value ?? {};
      else setPointer(surface.dataModel, path, value);
    } else {
      return { error: `Unknown A2UI message: ${Object.keys(message).filter((k) => k !== 'version').join(', ') || 'empty'}. Use createSurface, updateComponents or updateDataModel.` };
    }
  }
  if (!surface) return { error: 'No createSurface message.' };
  return { surface };
}

function setPointer(target: Record<string, any>, path: string, value: unknown) {
  const keys = path.split('/').slice(1);
  let at = target;
  for (const key of keys.slice(0, -1)) at = at[key] ??= {};
  if (value === null) delete at[keys[keys.length - 1]];
  else at[keys[keys.length - 1]] = value;
}

/** Problems a renderer would hit, phrased for the agent (empty = fine). */
export function checkSurface(surface: Surface): string[] {
  const problems: string[] = [];
  if (surface.catalogId !== SPATIAL_CATALOG_ID) problems.push(`createSurface needs "catalogId": "${SPATIAL_CATALOG_ID}".`);
  const byId = new Map<string, A2UIComponent>();
  for (const c of surface.components) {
    if (!c || typeof c.id !== 'string' || !ID.test(c.id)) problems.push(`Component id ${JSON.stringify(c?.id)} is not valid: use letters, digits and underscores (no hyphens).`);
    else if (byId.has(c.id)) problems.push(`Two components have the id "${c.id}".`);
    else byId.set(c.id, c);
  }
  const root = byId.get('root');
  if (!root || root.component !== 'Scene') problems.push('The component with id "root" must be a Scene.');

  const refsOf = (c: A2UIComponent): string[] =>
    (COMPONENTS[c.component]?.refs ?? []).flatMap((key) => (Array.isArray(c[key]) ? (c[key] as string[]) : typeof c[key] === 'string' ? [c[key] as string] : []));
  const usedBy = new Map<string, string>();
  for (const c of surface.components) {
    const type = COMPONENTS[c.component];
    if (!type) {
      problems.push(`"${c.id}": unknown component "${c.component}". Use: ${Object.keys(COMPONENTS).join(', ')}.`);
      continue;
    }
    for (const key of type.required) if (c[key] === undefined) problems.push(`"${c.id}" (${c.component}) needs "${key}".`);
    for (const ref of refsOf(c)) {
      const child = byId.get(ref);
      if (!child) problems.push(`"${c.id}" refers to "${ref}", which doesn't exist.`);
      else if (usedBy.has(ref)) problems.push(`"${ref}" is used twice (by "${usedBy.get(ref)}" and "${c.id}"); each component has one place.`);
      else usedBy.set(ref, c.id);
      if (!child) continue;
      const childKind = COMPONENTS[child.component]?.kind;
      const kind = type.kind;
      if (kind === 'scene' && childKind === 'content') problems.push(`"${ref}" (${child.component}) can't sit in the Scene directly: put panel content inside a Panel.`);
      if ((kind === 'panel' || kind === 'content') && childKind !== 'content') problems.push(`"${ref}" (${child.component}) can't be inside "${c.id}": panels hold only Column, Row, Card, Text, Button, Divider.`);
      if (kind === 'object' && childKind !== 'object') problems.push(`"${ref}" (${child.component}) can't be a child of 3D object "${c.id}".`);
    }
    if (c.component === 'Shape' && !SHAPES.has(String(c.shape))) problems.push(`"${c.id}": shape must be one of ${[...SHAPES].join(', ')}.`);
    if ((c.component === 'Orbit' || c.component === 'Spin') && typeof c.target === 'string') {
      const target = byId.get(c.target);
      if (!target || COMPONENTS[target.component]?.kind !== 'object') problems.push(`"${c.id}": target "${c.target}" must be a Shape or Group.`);
      else if (!(root?.children as string[] | undefined)?.includes(c.target)) problems.push(`"${c.id}": target "${c.target}" must be listed directly in the Scene's children.`);
    }
    if (c.component === 'QuizCard') {
      const options = c.options as unknown[];
      if (!Array.isArray(options) || options.length < 2 || options.length > 4) problems.push(`"${c.id}": options must list 2-4 answers.`);
      else if (typeof c.answer !== 'number' || c.answer < 0 || c.answer >= options.length) problems.push(`"${c.id}": answer is the index (0-based) of the right option.`);
    }
    if (c.component === 'StepTour' && (!Array.isArray(c.steps) || c.steps.length === 0)) problems.push(`"${c.id}": steps must be a non-empty list.`);
    // rotationDeg may also be a single number (a turn around y).
    if (typeof c.rotationDeg === 'number' && !Number.isFinite(c.rotationDeg)) problems.push(`"${c.id}": rotationDeg must be a number or [x, y, z].`);
    for (const key of ['position', 'rotationDeg', 'from', 'to', 'center']) {
      const v = c[key];
      if (key === 'rotationDeg' && typeof v === 'number') continue;
      if (v !== undefined && !(Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n)))) problems.push(`"${c.id}": ${key} must be [x, y, z] numbers.`);
    }
    // Hand traits only work on direct children of the scene.
    if ((c.grab || c.action) && c.component !== 'Button' && root && !(root.children as string[] | undefined)?.includes(c.id)) {
      problems.push(`"${c.id}": grab and action only work on objects listed directly in the Scene's children.`);
    }
    for (const action of actionsIn(c)) problems.push(...checkAction(c.id, action, byId));
  }
  // Every component should be reachable from root (a stray one is likely a mistake).
  const reachable = new Set<string>();
  const walk = (id: string) => {
    if (reachable.has(id)) return;
    reachable.add(id);
    const c = byId.get(id);
    if (c) for (const ref of refsOf(c)) walk(ref);
  };
  walk('root');
  for (const id of byId.keys()) if (!reachable.has(id)) problems.push(`"${id}" is not reachable from "root" (add it to a children list or remove it).`);

  // The panel font has ASCII plus a few letters; other characters render as empty boxes.
  const bad = new Map<string, string>();
  const scan = (value: unknown) => {
    if (typeof value === 'string') for (const [ch, replacement] of unsupportedGlyphs(value)) bad.set(ch, replacement);
    else if (Array.isArray(value)) value.forEach(scan);
    else if (value && typeof value === 'object') Object.values(value).forEach(scan);
  };
  scan(surface.components);
  scan(surface.dataModel);
  if (bad.size) {
    problems.push(`Text can only use plain ASCII plus ° § ä ö ü Ä Ö Ü ß. Replace: ${[...bad].slice(0, 12).map(([ch, r]) => `"${ch}" -> ${r ? `"${r}"` : 'remove it'}`).join('; ')}.`);
  }
  return problems.slice(0, 25);
}

function actionsIn(c: A2UIComponent): Record<string, any>[] {
  const out: Record<string, any>[] = [];
  if (c.action && typeof c.action === 'object') out.push(c.action as Record<string, any>);
  if (c.component === 'StepTour' && Array.isArray(c.steps)) for (const step of c.steps as Record<string, any>[]) if (step?.action) out.push(step.action);
  return out;
}

function checkAction(owner: string, action: Record<string, any>, byId: Map<string, A2UIComponent>): string[] {
  if (!action.functionCall && !action.event) return [`"${owner}": an action needs "functionCall" (or "event").`];
  const problems: string[] = [];
  const visit = (fn: Record<string, any>) => {
    const name = fn?.['@call'];
    if (typeof name !== 'string' || !(name in FUNCTIONS)) {
      // Say what was written next to the expected shape: the usual mistake is the shape, not the name.
      const wrote = JSON.stringify(fn)?.slice(0, 120);
      problems.push(typeof name === 'string'
        ? `"${owner}": unknown function "${name}". Use: ${Object.keys(FUNCTIONS).join(', ')}.`
        : `"${owner}": a function call is {"@call": "<name>", "args": {...}}, e.g. {"functionCall": {"@call": "highlight", "args": {"target": "some_id"}}}; you wrote ${wrote}.`);
      return;
    }
    const args = fn.args ?? {};
    for (const key of FUNCTIONS[name]) if (args[key] === undefined) problems.push(`"${owner}": ${name} needs args.${key}.`);
    if (typeof args.target === 'string' && !byId.has(args.target)) problems.push(`"${owner}": ${name} targets "${args.target}", which doesn't exist.`);
    if (name === 'run') for (const step of args.calls ?? []) visit(step);
  };
  if (action.functionCall) visit(action.functionCall);
  return problems;
}

const RUNTIME = readFileSync(new URL('./runtime.js', import.meta.url), 'utf8');

/** A host module that renders this surface (the shared renderer plus the surface as data). */
export function compileSurface(surface: Surface): string {
  const data = { components: surface.components, dataModel: surface.dataModel };
  return `// Compiled from A2UI (${SPATIAL_CATALOG_ID}) by the spatial renderer.\nconst SURFACE = ${JSON.stringify(data)};\n\n${RUNTIME}\nexport default function build(api) {\n  return renderSpatialA2UI(api, SURFACE);\n}\n`;
}
