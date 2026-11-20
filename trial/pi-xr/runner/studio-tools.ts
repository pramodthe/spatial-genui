// The studio tools the agent has beside its file tools and IWSDK's: the ones OhMyGame gives its agent
// (github.com/WhiteTowerAI/ohmygame, src/daemon/agent-tools.ts), for this headless runner. Each is a thin call to
// the run's studio service (studio-server.mjs), which does the work outside the agent's sandbox:
//   update_plan            a short plan for multi-step work
//   canvas_initialize      the canvas file contract and an empty board
//   canvas_check           validate the canvas files, references and media paths
//   generate_canvas_media  generate saved image and model-3d nodes of a board
//   generate_image         one picture from a prompt (Meta's Muse Image, or the run's reference maker)
//   generate_3d_asset      one 3D model from a generated picture (TRELLIS.2)
//   playtest_record        run one hand sequence and, when it worked, write it into playtest.json
//   playtest_replay        replay playtest.json from a fresh reload, as the independent check does
//   playtest_view          the first view only, from a fresh reload: the quick layout check
import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const URL_BASE = process.env.PI_XR_STUDIO_URL ?? '';
const TOKEN = process.env.PI_XR_STUDIO_TOKEN ?? '';
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
type Update = ((partial: { content: { type: 'text'; text: string }[]; details: object }) => void) | undefined;

/** Start a job on the studio service and wait for it: a 3D model can take minutes. */
async function studio(path: string, body: object, signal: AbortSignal | undefined, onUpdate: Update, what: string) {
  if (!URL_BASE) throw new Error('The studio service is not running for this session.');
  const headers = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
  const started = await fetch(`${URL_BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!started.ok) throw new Error(`The studio service refused ${path} (${started.status}).`);
  const { id } = (await started.json()) as { id: string };
  const began = Date.now();
  for (;;) {
    await sleep(Date.now() - began < 20000 ? 1000 : 5000);
    signal?.throwIfAborted();
    const reply = await fetch(`${URL_BASE}/job/${id}`, { headers, signal });
    if (!reply.ok) throw new Error(`The studio service lost the job (${reply.status}); ask for it again.`);
    const job = (await reply.json()) as { state: string; result?: { text: string }; error?: string };
    if (job.state === 'done') return { content: [{ type: 'text' as const, text: job.result?.text ?? 'done' }], details: job.result ?? {} };
    if (job.state === 'failed') throw new Error(job.error ?? `${what} failed`);
    const seconds = Math.round((Date.now() - began) / 1000);
    if (seconds >= 10) onUpdate?.({ content: [{ type: 'text', text: `${what}: ${seconds} s ...` }], details: {} });
  }
}

export default function studioTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'update_plan',
    label: 'Update Plan',
    description: 'Create or update a concise plan for multi-step work. Use at most one in_progress step.',
    promptSnippet: 'Keep a short plan of the steps of a multi-step task',
    promptGuidelines: ['For work with several meaningful steps, keep a concise plan with update_plan: at most one step in_progress, updated as steps start or finish.'],
    parameters: Type.Object({
      explanation: Type.Optional(Type.String({ maxLength: 2000, description: 'Optional explanation for this plan update' })),
      plan: Type.Array(Type.Object({
        step: Type.String({ minLength: 1, maxLength: 500, description: 'Task step' }),
        status: Type.Union([Type.Literal('pending'), Type.Literal('in_progress'), Type.Literal('completed')]),
      }), { minItems: 1, maxItems: 12, description: 'The complete list of plan steps' }),
    }),
    execute: (_id, input, signal, onUpdate) => studio('/plan', input, signal, onUpdate, 'plan'),
  });

  pi.registerTool({
    name: 'canvas_initialize',
    label: 'Initialize Canvas',
    description: 'Initialize the canvas file contract and an empty board when design or asset work needs a canvas. Preserves existing boards, documents and assets. Read canvas/AGENTS.md and canvas/index.json afterwards.',
    promptSnippet: 'Create the canvas (design board files) when the project has none',
    parameters: Type.Object({}),
    execute: (_id, input, signal, onUpdate) => studio('/canvas/initialize', input, signal, onUpdate, 'canvas'),
  });

  pi.registerTool({
    name: 'canvas_check',
    label: 'Check Canvas',
    description: 'Validate the canvas files, node and document references and local media paths. Run after canvas edits and fix what it reports. This tool only reads files.',
    promptSnippet: 'Validate the canvas files after editing them',
    promptGuidelines: ['Canvas is ordinary project JSON, Markdown and local media: use read, edit and write on it, and run canvas_check after canvas changes.'],
    parameters: Type.Object({}),
    execute: (_id, input, signal, onUpdate) => studio('/canvas/check', input, signal, onUpdate, 'canvas check'),
  });

  pi.registerTool({
    name: 'generate_canvas_media',
    label: 'Generate Canvas Media',
    description: 'Generate saved image and model-3d nodes of a canvas board, using their current prompt, settings and references. List nodes together; a node that uses another listed node\'s output starts after it. Saves the output into the project, records it in canvas/assets.json and sets the node\'s assetId. A node whose current output came from the same settings is returned without generating again unless regenerate is true. Each picture and each 3D model costs money and counts against this game\'s media budget.',
    promptSnippet: 'Generate the pictures and 3D models of saved canvas nodes',
    promptGuidelines: [
      'Use generate_canvas_media for the mockups and production art recorded as nodes on the canvas board; editing a prompt alone generates nothing.',
      'Start production art early with generate_canvas_media background: true and build the playable slice while it is made: a first 3D model can take five minutes.',
      'After generate_canvas_media or generate_image, read the picture file before relying on it: a prompt is not proof of what was drawn.',
    ],
    parameters: Type.Object({
      boardId: Type.String({ minLength: 1, maxLength: 100 }),
      nodeIds: Type.Array(Type.String({ minLength: 1, maxLength: 120 }), { minItems: 1, maxItems: 8, uniqueItems: true }),
      regenerate: Type.Optional(Type.Boolean({ description: 'Start a new paid generation even when a node\'s current output came from the same settings.' })),
      background: Type.Optional(Type.Boolean({ description: 'Start the generation and return at once, to go on with other work. Collect the results by calling again with the same nodeIds and no background: that call waits for them.' })),
    }),
    execute: (_id, input, signal, onUpdate) => studio('/canvas/generate', input, signal, onUpdate, 'generating'),
  });

  pi.registerTool({
    name: 'playtest_record',
    label: 'Record Playtest Step',
    description: 'Run one hand sequence in the running game and, when it did what it should, write it into playtest.json as a step. It reads GameState before and after: the step is recorded only when the sequence completed, GameState changed, and every "expect" value is met; otherwise it says what happened and records nothing. The page must be in XR with hand input. Recording a step whose id exists replaces that step.',
    promptSnippet: 'Run one hand sequence and record it as a step of playtest.json when it worked',
    promptGuidelines: [
      'Write playtest.json only through playtest_record, one step per move in order, then Start and the round: the tool keeps the file in the format the independent check replays.',
      'Check the layout with playtest_view after placing or moving things (about 15 s). Run playtest_replay once the game is complete (about 40 s): it reloads the page and replays playtest.json exactly as the independent check will; run it again only after fixing what it reported.',
    ],
    parameters: Type.Object({
      id: Type.String({ minLength: 1, maxLength: 40, description: 'The step\'s id: lower-case letters, digits and dashes, such as "move-1", "start", "round".' }),
      sequence: Type.Object({
        device: Type.Union([Type.Literal('hand-right'), Type.Literal('hand-left')]),
        steps: Type.Array(Type.Record(Type.String(), Type.Any()), { minItems: 1, maxItems: 40, description: 'The steps of xr_run_sequence.' }),
      }, { additionalProperties: true, description: 'Exactly the input of xr_run_sequence.' }),
      expect: Type.Record(Type.String(), Type.Any(), { description: 'GameState values after the step: a plain value, or { "gte": n }, { "lte": n }, { "ne": v }. For example { "movesDone": 1 }.' }),
      waitMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 10000, description: 'Milliseconds to wait after the sequence before reading GameState (default 500).' })),
      waitFor: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: 'Wait until GameState has these values, e.g. { "phase": "result", "timeoutMs": 30000 }, for something the game takes time over.' })),
      clear: Type.Optional(Type.Boolean({ description: 'Start playtest.json anew with this step as its first.' })),
    }),
    execute: (_id, input, signal, onUpdate) => studio('/playtest/record', input, signal, onUpdate, 'playing the step'),
  });

  pi.registerTool({
    name: 'playtest_replay',
    label: 'Replay Playtest',
    description: 'Reload the page, enter XR with hands and replay playtest.json from its first step, exactly as the independent check does. Reports each step, the first view (each panel\'s size, distance and angle from the player) and every failure. The page is left reloaded.',
    promptSnippet: 'Replay playtest.json from a fresh reload, as the independent check does',
    parameters: Type.Object({}),
    execute: (_id, input, signal, onUpdate) => studio('/playtest/replay', input, signal, onUpdate, 'replaying the game'),
  });

  pi.registerTool({
    name: 'playtest_view',
    label: 'Check First View',
    description: 'Reload the page, enter XR with hands and measure only the first view, without playing: each panel\'s size, distance and angle, where each thing to touch is, and whether every control has words beside it, with the same limits as the independent check. About 15 seconds. The page is left reloaded.',
    promptSnippet: 'Measure the first view (layout only) from a fresh reload, in about 15 seconds',
    parameters: Type.Object({}),
    execute: (_id, input, signal, onUpdate) => studio('/playtest/view', input, signal, onUpdate, 'measuring the first view'),
  });

  pi.registerTool({
    name: 'generate_image',
    label: 'Generate Image',
    description: 'Make one picture from a prompt, outside the canvas: a texture, a sign, a reference. Saves it under assets/generated/ at up to 1024 pixels and returns the path. Write one specific prompt and generate once.',
    promptSnippet: 'Make one picture from a prompt (texture, sign, reference)',
    promptGuidelines: ['A file under assets/generated/ is not part of the game until a copy is under public/ and src/assets.ts registers it.'],
    parameters: Type.Object({
      prompt: Type.String({ minLength: 10, maxLength: 4000, description: 'What the picture shows: subject, view, style, colours, background.' }),
      aspectRatio: Type.Optional(Type.Union([Type.Literal('1:1'), Type.Literal('16:9'), Type.Literal('9:16'), Type.Literal('4:3'), Type.Literal('3:4')], { description: 'Default 1:1.' })),
      name: Type.Optional(Type.String({ maxLength: 60, description: 'A short name for the file and the asset ID, such as "river-bed-texture".' })),
      purpose: Type.Optional(Type.String({ maxLength: 300, description: 'What the game uses it for.' })),
    }),
    execute: (_id, input, signal, onUpdate) => studio('/image', input, signal, onUpdate, 'drawing'),
  });

  pi.registerTool({
    name: 'generate_3d_asset',
    label: 'Generate 3D Asset',
    description: 'Make one textured 3D model (GLB) from a generated picture of a single object. The picture must show one whole object on a plain white background. Takes one to five minutes. Saves the GLB under assets/generated/ and returns its path, triangle count and size.',
    promptSnippet: 'Make a 3D model (GLB) from a generated picture of one object',
    promptGuidelines: [
      'For a 3D model, generate a picture first (one whole object, three-quarter view, plain white background, even light), then generate_3d_asset from it.',
      'Use generate_3d_asset for the few things that carry the game (the hero and one or two props); build simple geometry in code.',
    ],
    parameters: Type.Object({
      imagePath: Type.String({ minLength: 1, maxLength: 300, description: 'The generated picture, relative to the project root, e.g. assets/generated/beaver.png.' }),
      name: Type.Optional(Type.String({ maxLength: 60, description: 'A short name for the file and the asset ID.' })),
      targetPolycount: Type.Optional(Type.Integer({ minimum: 500, maximum: 100000, description: 'Triangles. About 20000 for a thing held or seen close in VR, 8000 for scenery.' })),
      texture: Type.Optional(Type.Boolean({ description: 'A 1024-pixel texture (default) or a smaller one.' })),
    }),
    execute: (_id, input, signal, onUpdate) => studio('/model3d', input, signal, onUpdate, 'building the 3D model'),
  });
}
