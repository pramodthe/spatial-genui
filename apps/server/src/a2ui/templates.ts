// Version D of the GenUI comparison (RQ1): controlled GenUI. The agent picks one hand-built lesson
// component and fills in its data; it decides no layout and no interactions. Each template expands into
// the spatial A2UI catalog (catalog.ts), so it renders with the same code as version C.
import { SPATIAL_CATALOG_ID, type A2UIComponent, type Surface } from './catalog.js';

type Quiz = { question: string; options: string[]; answer: number; explanation: string };
type ShapeSpec = { shape?: string; radius?: number; size?: number[]; height?: number; color?: string };

export const TEMPLATE_DOCS = `- ExplorableObject: one object made of named parts (a cell, a flower, an engine, a volcano). The learner
  presses a part to read about it.
  { title, intro, parts: [{ name, fact, shape: sphere|box|cylinder|cone|torus|capsule, radius?, size?
  [x,y,z], height?, color, position: [x,y,z] relative to the object's centre (within 0.15 m) }] (2-10),
  quiz? }
- OrbitSystem: bodies circling a centre (planets, moons, electrons). Bodies can be picked up.
  { title, intro, center: { name, fact, radius, color }, bodies: [{ name, fact, radius, color, distance
  (any unit, used for order and spacing), periodSec? }] (1-8), quiz? }
- ProcessCycle: stages of a process in order, as a loop or a line (water cycle, blood flow, photosynthesis
  steps). A step-by-step tour lights up each stage.
  { title, intro, cyclic: true|false, stages: [{ name, description, color, shape? }] (3-8), quiz? }
- BarChart: compare quantities (populations, distances, speeds). The learner presses a bar for its value.
  { title, intro, unit, items: [{ label, value (number), color? }] (2-8), insight, quiz? }
- SortingGame: put each item in its bin by hand (classify animals, recycling, states of matter).
  { title, instructions, bins: [{ name, color }] (2-4), items: [{ name, bin (a bin name), color,
  shape? }] (3-8), quiz? }
A quiz is { question, options: [2-4 strings], answer: index (0-based), explanation }.`;

export const EXAMPLE_TEMPLATE = {
  template: 'OrbitSystem',
  data: {
    title: 'Earth and the Sun',
    intro: 'Pinch Earth to pick it up, or press the Sun.',
    center: { name: 'Sun', fact: 'The Sun holds 99.8% of the Solar System mass.', radius: 0.06, color: '#ffc23d' },
    bodies: [{ name: 'Earth', fact: 'Earth is about 150 million km from the Sun.', radius: 0.025, color: '#2f6fdb', distance: 1, periodSec: 25 }],
    quiz: { question: 'How long does one orbit of Earth take?', options: ['About 30 days', 'About 365 days', 'About 24 hours'], answer: 1, explanation: 'One orbit takes about 365.25 days.' },
  },
};

const TEMPLATES = ['ExplorableObject', 'OrbitSystem', 'ProcessCycle', 'BarChart', 'SortingGame'] as const;
const PALETTE = ['#e6194b', '#3cb44b', '#4363d8', '#ffe119', '#f58231', '#911eb4', '#42d4f4', '#f032e6'];
const PANEL_RIGHT = [0.34, 0.16, 0] as const;
const PANEL_LEFT = [-0.34, 0.16, 0] as const;

/** Expand the agent's {template, data} into a spatial A2UI surface, or say what is wrong with it. */
export function expandTemplate(spec: unknown): { surface?: Surface; problems: string[] } {
  const problems: string[] = [];
  const s = spec as { template?: string; data?: Record<string, any> };
  if (!s || typeof s !== 'object' || typeof s.template !== 'string') return { problems: ['Reply with {"template": "<name>", "data": {...}}.'] };
  if (!(TEMPLATES as readonly string[]).includes(s.template)) return { problems: [`Unknown template "${s.template}". Use one of: ${TEMPLATES.join(', ')}.`] };
  const data = s.data;
  if (!data || typeof data !== 'object') return { problems: ['"data" must be an object.'] };
  const need = (key: string, test: (v: any) => boolean, what: string) => {
    if (!test(data[key])) problems.push(`data.${key} ${what}.`);
  };
  const str = (v: any) => typeof v === 'string' && v.trim().length > 0;
  const list = (min: number, max: number) => (v: any) => Array.isArray(v) && v.length >= min && v.length <= max;
  need('title', str, 'must be a short text');
  if (data.quiz !== undefined) problems.push(...checkQuiz(data.quiz));

  const components: A2UIComponent[] = [];
  const scene: string[] = [];
  const add = (c: A2UIComponent, top = false) => {
    components.push(c);
    if (top) scene.push(c.id);
  };
  const dataModel: Record<string, unknown> = {};

  switch (s.template) {
    case 'ExplorableObject': {
      need('parts', list(2, 10), 'must list 2-10 parts');
      if (problems.length) break;
      dataModel.info = `${data.intro ?? ''} Press a part to learn about it.`.trim();
      data.parts.forEach((part: Record<string, any>, i: number) => {
        if (!str(part?.name) || !str(part?.fact)) problems.push(`parts[${i}] needs name and fact.`);
        const p = vec(part?.position, [0, 0, 0]).map((v) => clamp(v, -0.15, 0.15));
        add({ id: `part_${i}`, component: 'Shape', ...shapeOf(part, i), position: [p[0], 0.15 + p[1], p[2]], name: part?.name,
          action: setInfo(`${part?.name}: ${part?.fact}`, `part_${i}`) }, true);
      });
      add(infoPanel(data.title, [resetHighlightButton(data.parts.length, 'part')]), true);
      break;
    }
    case 'OrbitSystem': {
      need('center', (v) => v && str(v.name), 'needs a name, fact, radius and color');
      need('bodies', list(1, 8), 'must list 1-8 bodies');
      if (problems.length) break;
      dataModel.info = data.intro ?? 'Pinch a body to pick it up, or press one to learn about it.';
      const center = data.center;
      const centerR = clamp(num(center.radius, 0.05), 0.03, 0.07);
      add({ id: 'center', component: 'Shape', shape: 'sphere', radius: centerR, color: color(center.color, 0), emissive: color(center.color, 0),
        position: [0, 0.16, 0], name: center.name, action: setInfo(`${center.name}: ${center.fact ?? ''}`, 'center') }, true);
      // Order by distance; spread the orbits evenly between the centre and 0.3 m.
      const order = data.bodies.map((b: any, i: number) => ({ b, i })).sort((a: any, z: any) => num(a.b.distance, a.i) - num(z.b.distance, z.i));
      const inner = centerR + 0.05;
      const step = order.length > 1 ? (0.3 - inner) / (order.length - 1) : 0;
      order.forEach(({ b, i }: { b: Record<string, any>; i: number }, rank: number) => {
        if (!str(b?.name)) problems.push(`bodies[${i}] needs a name.`);
        add({ id: `body_${i}`, component: 'Shape', shape: 'sphere', radius: clamp(num(b.radius, 0.02), 0.015, 0.04), color: color(b.color, i + 1),
          name: b.name, grab: true, action: setInfo(`${b.name}: ${b.fact ?? ''}`, `body_${i}`) }, true);
        add({ id: `orbit_${i}`, component: 'Orbit', target: `body_${i}`, center: [0, 0.16, 0], radius: inner + step * rank,
          periodSec: clamp(num(b.periodSec, 15 + rank * 10), 10, 120), startDeg: rank * 47 }, true);
      });
      add(infoPanel(data.title, [{ id: 'pause', label: 'Pause or play', action: { functionCall: { '@call': 'run', args: { calls: data.bodies.map((_: unknown, i: number) => ({ '@call': 'toggleMotion', args: { target: `orbit_${i}` } })) } } } }]), true);
      break;
    }
    case 'ProcessCycle': {
      need('stages', list(3, 8), 'must list 3-8 stages');
      if (problems.length) break;
      const n = data.stages.length;
      const cyclic = data.cyclic !== false;
      const at = (i: number): [number, number, number] => cyclic
        ? [Math.sin((i / n) * Math.PI * 2) * 0.17, 0.17 + Math.cos((i / n) * Math.PI * 2) * 0.12, 0]
        : [-0.22 + (0.44 * i) / (n - 1), 0.15, 0];
      data.stages.forEach((stage: Record<string, any>, i: number) => {
        if (!str(stage?.name) || !str(stage?.description)) problems.push(`stages[${i}] needs name and description.`);
        add({ id: `stage_${i}`, component: 'Shape', ...shapeOf({ shape: stage?.shape, radius: 0.032, color: stage?.color }, i), position: at(i), name: stage?.name,
          action: { functionCall: { '@call': 'highlight', args: { target: `stage_${i}`, only: true } } } }, true);
      });
      for (let i = 0; i < (cyclic ? n : n - 1); i++) {
        const a = at(i);
        const b = at((i + 1) % n);
        const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const len = Math.hypot(d[0], d[1], d[2]) || 1;
        const off = 0.045 / len; // start and end outside the stage shapes
        add({ id: `arrow_${i}`, component: 'Arrow', from: [a[0] + d[0] * off, a[1] + d[1] * off, 0.01], to: [b[0] - d[0] * off, b[1] - d[1] * off, 0.01], color: '#e8eaed' }, true);
      }
      add({ id: 'tour', component: 'StepTour', position: [...PANEL_RIGHT], width: 0.3, rotationDeg: [0, -15, 0], title: data.title,
        steps: [{ title: 'Overview', body: String(data.intro ?? 'Press Next to go through each stage.') },
          ...data.stages.map((stage: any, i: number) => ({ title: `${i + 1}. ${stage?.name}`, body: stage?.description, highlight: [`stage_${i}`] }))] }, true);
      break;
    }
    case 'BarChart': {
      need('items', list(2, 8), 'must list 2-8 items');
      if (problems.length) break;
      const values = data.items.map((item: any, i: number) => {
        if (!str(item?.label) || typeof item?.value !== 'number' || !Number.isFinite(item.value) || item.value < 0) problems.push(`items[${i}] needs a label and a value >= 0.`);
        return num(item?.value, 0);
      });
      const max = Math.max(...values, 1e-9);
      const n = data.items.length;
      const unit = typeof data.unit === 'string' ? ` ${data.unit}` : '';
      dataModel.info = `${data.intro ?? ''} Bars from left: ${data.items.map((item: any) => item?.label).join(', ')}. Press a bar for its value.`.trim();
      data.items.forEach((item: Record<string, any>, i: number) => {
        const h = Math.max(0.01, (values[i] / max) * 0.28);
        const width = Math.min(0.05, 0.4 / n - 0.012);
        add({ id: `bar_${i}`, component: 'Shape', shape: 'box', size: [width, h, 0.04], color: color(item?.color, i), position: [-0.2 + (0.4 * (i + 0.5)) / n, h / 2 + 0.02, 0], name: item?.label,
          action: setInfo(`${item?.label}: ${fmt(values[i])}${unit}`, `bar_${i}`) }, true);
      });
      add({ id: 'base', component: 'Shape', shape: 'box', size: [0.44, 0.01, 0.07], color: '#5b616b', position: [0, 0.015, 0] }, true);
      add(infoPanel(data.title, [], data.insight), true);
      break;
    }
    case 'SortingGame': {
      need('bins', list(2, 4), 'must list 2-4 bins');
      need('items', list(3, 8), 'must list 3-8 items');
      if (problems.length) break;
      const binIds = new Map<string, string>();
      const nb = data.bins.length;
      data.bins.forEach((bin: Record<string, any>, i: number) => {
        if (!str(bin?.name)) problems.push(`bins[${i}] needs a name.`);
        binIds.set(String(bin?.name).toLowerCase(), `bin_${i}`);
        add({ id: `bin_${i}`, component: 'Shape', shape: 'box', size: [0.13, 0.012, 0.11], color: color(bin?.color, i), position: [-0.2 + (0.4 * (i + 0.5)) / nb, 0.006, 0.08], name: bin?.name }, true);
      });
      const ni = data.items.length;
      const sortItems: { id: string; bin: string }[] = [];
      data.items.forEach((item: Record<string, any>, i: number) => {
        const bin = binIds.get(String(item?.bin).toLowerCase());
        if (!str(item?.name)) problems.push(`items[${i}] needs a name.`);
        if (!bin) problems.push(`items[${i}].bin "${item?.bin}" is not one of the bin names.`);
        else sortItems.push({ id: `item_${i}`, bin });
        add({ id: `item_${i}`, component: 'Shape', ...shapeOf({ shape: item?.shape, radius: 0.022, color: item?.color }, i + nb), position: [-0.24 + (0.48 * (i + 0.5)) / ni, 0.05, -0.1], name: item?.name, grab: true }, true);
      });
      const legend = data.items.map((item: any) => `${item?.name} (${colorName(item?.color)})`).join(', ');
      const bins = data.bins.map((bin: any) => `${bin?.name} (${colorName(bin?.color)})`).join(', ');
      dataModel.info = `${data.instructions ?? 'Pinch each item and put it on its bin.'} Bins, front: ${bins}. Items: ${legend}.`;
      add(infoPanel(data.title, [
        { id: 'check', label: 'Check', action: { functionCall: { '@call': 'checkSort', args: { items: sortItems, resultPath: '/info', allRight: 'All sorted correctly. Well done!' } } } },
        { id: 'reset', label: 'Start over', action: { functionCall: { '@call': 'resetPositions', args: {} } }, secondary: true },
      ]), true);
      break;
    }
  }
  if (problems.length) return { problems };

  if (data.quiz) {
    const q = data.quiz as Quiz;
    add({ id: 'quiz', component: 'QuizCard', position: [...PANEL_LEFT], width: 0.28, rotationDeg: [0, 15, 0], question: q.question, options: q.options, answer: q.answer, explanation: q.explanation }, true);
  }
  components.unshift({ id: 'root', component: 'Scene', children: scene });
  return { surface: { surfaceId: 'lesson', catalogId: SPATIAL_CATALOG_ID, components, dataModel }, problems: [] };

  // An info panel (title, the /info text, optional insight, buttons) on the right.
  function infoPanel(title: string, buttons: { id: string; label: string; action: unknown; secondary?: boolean }[], insight?: string): A2UIComponent {
    const content = ['info_title', 'info_text'];
    add({ id: 'info_title', component: 'Text', variant: 'h1', text: title });
    add({ id: 'info_text', component: 'Text', text: { '@path': '/info' } });
    if (typeof insight === 'string' && insight) {
      add({ id: 'info_insight', component: 'Text', variant: 'caption', text: insight });
      content.push('info_insight');
    }
    if (buttons.length) {
      add({ id: 'info_buttons', component: 'Row', children: buttons.map((b) => b.id) });
      for (const b of buttons) {
        add({ id: b.id, component: 'Button', child: `${b.id}_label`, action: b.action, variant: b.secondary ? 'secondary' : 'primary' });
        add({ id: `${b.id}_label`, component: 'Text', text: b.label });
      }
      content.push('info_buttons');
    }
    add({ id: 'info_column', component: 'Column', children: content });
    return { id: 'info', component: 'Panel', position: [...PANEL_RIGHT], width: 0.3, rotationDeg: [0, -15, 0], child: 'info_column' };
  }
}

function checkQuiz(quiz: any): string[] {
  if (!quiz || typeof quiz !== 'object') return ['quiz must be an object.'];
  const problems: string[] = [];
  if (typeof quiz.question !== 'string') problems.push('quiz.question must be text.');
  if (!Array.isArray(quiz.options) || quiz.options.length < 2 || quiz.options.length > 4) problems.push('quiz.options must list 2-4 answers.');
  else if (typeof quiz.answer !== 'number' || quiz.answer < 0 || quiz.answer >= quiz.options.length) problems.push('quiz.answer is the 0-based index of the right option.');
  return problems;
}

function setInfo(text: string, target: string) {
  return { functionCall: { '@call': 'run', args: { calls: [
    { '@call': 'setData', args: { path: '/info', value: text } },
    { '@call': 'highlight', args: { target, only: true } },
  ] } } };
}

function resetHighlightButton(count: number, prefix: string) {
  return { id: 'clear', label: 'Clear glow', secondary: true, action: { functionCall: { '@call': 'run', args: { calls: Array.from({ length: count }, (_, i) => ({ '@call': 'highlight', args: { target: `${prefix}_${i}`, on: false } })) } } } };
}

function shapeOf(part: ShapeSpec, i: number) {
  const shapes = new Set(['sphere', 'box', 'cylinder', 'cone', 'torus', 'capsule']);
  const shape = shapes.has(String(part?.shape)) ? String(part.shape) : 'sphere';
  const out: Record<string, unknown> = { shape, color: color(part?.color, i), radius: clamp(num(part?.radius, 0.03), 0.01, 0.06) };
  if (Array.isArray(part?.size)) out.size = vec(part.size, [0.05, 0.05, 0.05]).map((v) => clamp(v, 0.01, 0.12));
  if (typeof part?.height === 'number') out.height = clamp(part.height, 0.01, 0.15);
  return out;
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const vec = (v: unknown, fallback: number[]) => (Array.isArray(v) && v.length === 3 ? v.map((x, i) => num(x, fallback[i])) : fallback);
const color = (v: unknown, i: number) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : PALETTE[i % PALETTE.length]);
const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString('en-US') : String(Math.round(v * 100) / 100));

/** A rough colour name, so text can refer to a shape by its colour. */
function colorName(hex: unknown): string {
  if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) return 'coloured';
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < 60) return 'black';
  if (min > 200) return 'white';
  if (max - min < 30) return 'grey';
  if (r === max) return g > 160 ? (b > 120 ? 'pink' : 'yellow') : g > 90 ? 'orange' : 'red';
  if (g === max) return b > 160 ? 'teal' : 'green';
  return r > 120 ? 'purple' : g > 160 ? 'light blue' : 'blue';
}
