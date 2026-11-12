// Prompts for the Phase 3 3D pipelines. Every pipeline gets the same asset contract (size, axes,
// named parts, Quest budget) in its own tool's terms, so only the way of building differs.

export type AssetRequest = { id: string; category: string; prompt: string; parts: string[] };
/** p4-tripo is imported from outside (Tripo's website), not run by the harness. */
export type Pipeline = 'p1-threejs' | 'p2-cadquery' | 'p3-blender' | 'p4-tripo';

/** The pipelines the harness can run itself. */
export const PIPELINES: Pipeline[] = ['p1-threejs', 'p2-cadquery', 'p3-blender'];

const CONTRACT = `The model is a learning object that sits on a desk in mixed reality: people pick it up, look at it from every side, and the app labels and highlights its parts. So:
- Scale: the real thing shrunk to desk size. Its largest dimension is between 0.20 and 0.35 m.
- Placement: it stands upright with its bottom at height 0, centred on the origin, front facing the viewer.
- Named parts: every listed part is its own separately named object, named exactly as listed (lowercase with underscores). Repeated parts get a number: leg_1, leg_2... Give every other piece a descriptive name too, never a default like "Cube.001" or "mesh_3".
- Accuracy matters more than decoration: the right parts in the right places with believable proportions and colors, as a good teaching model would show them.
- Like a classroom model, it need not be to scale: shrink distances and enlarge small parts so that every listed part is clearly visible within the size range (a moon sits near its planet, not at its true distance).
- Budget (it runs on a Quest headset): at most 50,000 triangles and at most 60 separate meshes in total. Use smooth curves where the real object is curved, but no more segments than needed.
- Materials: plain colors only (base color, plus metalness/roughness if useful). No image textures, no text.`;

const P1_SYSTEM = `You are an expert Three.js modeller. You write one JavaScript module that builds a 3D model from Three.js geometry.

${CONTRACT}

Three.js specifics: metres, +Y is up, the front faces +Z. Use built-in geometries (Box, Sphere, Cylinder, Cone, Torus, TorusKnot, Capsule, Lathe, Extrude with Shape, Tube with curves) and BufferGeometry when needed; MeshStandardMaterial or MeshPhysicalMaterial. Name parts with mesh.name = "left_ventricle" (or group.name for a part made of several meshes).

Module contract (exactly this shape, no imports, THREE is passed in):
\`\`\`js
export default function build({ THREE }) {
  const root = new THREE.Group();
  // ... build and name the parts, add them to root ...
  return { root };
}
\`\`\`
No DOM, no fetch, no timers, no textures, no external files. Reply with one \`\`\`js code block containing the whole module.`;

const P2_SYSTEM = `You are an expert CadQuery (Python CAD) modeller. You write one Python script that builds a 3D model as a CadQuery assembly.

${CONTRACT}

CadQuery specifics: millimetres (so 0.20-0.35 m is 200-350 mm), +Z is up, the front faces -Y, the bottom sits at z = 0. Build each part as a solid (box, cylinder, sphere, revolve, extrude, loft, sweep, shell, union/cut) and add it to the assembly with its name and color:
\`\`\`python
import cadquery as cq

def build():
    assy = cq.Assembly(name="model")
    body = cq.Workplane("XY").cylinder(40, 30)
    assy.add(body, name="body", color=cq.Color(0.8, 0.2, 0.2))
    # ... more parts ...
    return assy
\`\`\`
The runner calls build() and exports the assembly. Only import cadquery and math. Fillets and chamfers fail on complex edges: keep radii small and apply them to simple solids before boolean operations. Reply with one \`\`\`python code block containing the whole script.`;

const P3_SYSTEM = `You are an expert Blender modeller with tools that run Python (bpy) code in a live Blender scene. The scene starts empty.

${CONTRACT}

Blender specifics: metres, +Z is up, the front faces -Y, the bottom sits at z = 0. Build with bpy.ops primitives, bmesh, curves converted to meshes, and modifiers (bevel, subdivision, solidify, boolean, mirror, array); the export applies modifiers, so keep subdivision levels low for the triangle budget. Name objects with obj.name = "left_ventricle". Materials: a Principled BSDF with base color, metallic and roughness only; other shader nodes are lost on export. No file or network access.

Work in steps: build part of the model with execute_blender_code, read the scene summary it returns (names, sizes, triangle counts), and fix what's wrong. Variables persist between calls. When the model is complete, reply with a one-line summary and no tool call.`;

export function systemPrompt(pipeline: Pipeline): string {
  return pipeline === 'p1-threejs' ? P1_SYSTEM : pipeline === 'p2-cadquery' ? P2_SYSTEM : P3_SYSTEM;
}

export function requestText(req: AssetRequest, withReference: boolean): string {
  return [
    `Build: ${req.prompt}.`,
    `Required named parts: ${req.parts.join(', ')}.`,
    withReference
      ? 'A reference image is attached for shape, proportions and colors. It may contain mistakes: where it disagrees with the request or with reality, follow the request and reality.'
      : '',
  ].filter(Boolean).join('\n');
}

export function referenceImagePrompt(req: AssetRequest): string {
  return `${req.prompt}. A single physical model shown whole, three-quarter front view, on a plain light grey background, soft even studio lighting, realistic colors, clear shapes. No text, no labels, no arrows, no other objects.`;
}

export const CRITIC_SYSTEM = `You review 3D models made for a mixed-reality learning app. You see renders of one model from four angles (front, side, back, above), the request, the parts it must have, and measurements. Be concrete and strict: a student must recognize the object at a glance and every listed part must be visibly modeled in the right place. It is a classroom model, not a scale model: compressed distances and enlarged small parts are correct when they keep every part visible, so never ask for true scale.

Reply with only a JSON object:
{"score": <1-10>, "problems": ["<specific problem, e.g. 'the aorta is a straight tube; it should arch up and over to the left'>", ...]}
Score 9-10: accurate and well made, nothing important to fix. 7-8: good, minor issues. 4-6: recognizable but with clear errors. 1-3: wrong or broken. List at most 6 problems, most important first, each fixable by changing the model.`;

export function criticText(req: AssetRequest, stats: { namedParts: string[]; triangles: number; meshes: number; size: number[] }, missing: string[]): string {
  return [
    `Request: ${req.prompt}.`,
    `Required parts: ${req.parts.join(', ')}.`,
    `Named parts in the file: ${stats.namedParts.join(', ') || '(none)'}.`,
    missing.length ? `Missing required part names: ${missing.join(', ')}.` : 'All required part names are present.',
    `Size: ${stats.size.map((v) => v.toFixed(2)).join(' x ')} m (x, y up, z). Triangles: ${stats.triangles}. Meshes: ${stats.meshes}.`,
  ].join('\n');
}

export function revisionText(pipeline: Pipeline, problems: string[], missing: string[]): string {
  const issues = [...problems, ...(missing.length ? [`Missing required part names: ${missing.join(', ')}.`] : [])];
  return [
    'A reviewer looked at renders of your model from four angles (attached: front, side, back, above) and found these problems:',
    ...issues.map((p, i) => `${i + 1}. ${p}`),
    pipeline === 'p3-blender'
      ? 'Fix them in the scene with your tools, keeping everything that already works. Reply with a one-line summary and no tool call when done.'
      : `Fix them, keeping everything that already works. Reply with the complete revised ${pipeline === 'p1-threejs' ? 'module in one ```js' : 'script in one ```python'} code block.`,
  ].join('\n');
}

export function repairText(error: string): string {
  return `That failed:\n${error}\nFix the problem and reply with the complete corrected code in one code block.`;
}

export const JUDGE_SYSTEM = `You are an independent judge of 3D models for a mixed-reality learning app. You see renders of one model from four angles (front, side, back, above), the request, and the parts it must show. Judge only what you can see. Use the full 1-5 scale; 5 means a teacher would happily use it as is.

Reply with only a JSON object:
{"recognizable": <1-5>, "accuracy": <1-5>, "craft": <1-5>, "overall": <1-5>, "partsVisible": ["<required parts you can actually see modeled>"], "comment": "<one or two sentences>"}
- recognizable: a student identifies the requested object at a glance.
- accuracy: the right parts, in the right places, with believable proportions and colors.
- craft: clean geometry, smooth where it should be, no floating, clipping or broken pieces, pleasing colors.
- overall: how good it is as a learning model.`;

export function judgeText(req: AssetRequest): string {
  return `Request: ${req.prompt}.\nRequired parts: ${req.parts.join(', ')}.`;
}

/**
 * Required parts present by name: exact, or numbered/suffixed copies (leg_1, leg_front). Three's
 * GLTFLoader strips dots from node names, so Blender's "leg.001" arrives as "leg001".
 */
export function missingParts(req: AssetRequest, nodeNames: string[]): string[] {
  const names = nodeNames.map((n) => n.toLowerCase().trim().replace(/[\s-]+/g, '_'));
  // Also accept the part's words inside a longer anatomical name: left_frontal_lobe is a frontal lobe,
  // ascending_aorta is aorta, right_pulmonary_artery is a pulmonary artery.
  const words = (n: string) => new Set(n.replace(/\d+/g, ' ').split(/[_.\s]+/).filter(Boolean));
  const matches = (n: string, part: string) =>
    n === part || n.startsWith(`${part}_`) || n.startsWith(`${part}.`) || (n.startsWith(part) && /^\d+$/.test(n.slice(part.length))) ||
    [...words(part)].every((w) => words(n).has(w));
  return req.parts.filter((part) => !names.some((n) => matches(n, part)));
}
