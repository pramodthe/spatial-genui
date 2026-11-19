// The canvas of a game project: its design board as ordinary files, in OhMyGame's layout and field names
// (github.com/WhiteTowerAI/ohmygame, docs/canvas-agent.md), so the same folder opens there. The subset used here:
// the main design document, one board whose nodes are the document, the picture and 3D-model generations and
// their results, and the asset manifest.
//   canvas/index.json            { version, mainDocumentId, boards: [{ id, name }], documents: [{ id, title }] }
//   canvas/boards/<id>.json      { id, version, viewport, nodes: [{ id, type, title, description, data }], edges }
//   canvas/documents/<id>.md     a document's body (the main one is the game's design)
//   canvas/assets.json           { version, assets: { <id>: { name, path, description, prompt, model3d? } } }
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

export const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'];
export const NODE_TYPES = ['document', 'text', 'image', 'model-3d', 'asset', 'group', 'file'];
const ID = /^[a-zA-Z0-9_-]{1,120}$/;

const CANVAS_AGENTS = `# Canvas workspace

The canvas is the game's design board, kept as ordinary files. Use read, edit and write to change it, and run
canvas_check afterwards.

- index.json lists the boards and documents and names the main document. Keep IDs stable.
- documents/<id>.md holds a document's body. The main document is the game's design: implementation follows it, and
  it is kept in step with meaningful implementation decisions.
- boards/<id>.json holds nodes: { "id", "type", "title", "description", "data" }. Give every node a meaningful title
  and say in its description what it is for.
  - document: { "documentId": "<id>" }
  - image (a picture to generate): { "prompt", "resolution": "1K", "aspectRatio": "1:1" | "16:9" | "9:16" | "4:3" |
    "3:4", "images": [] }. After generation the node gains "assetId".
  - model-3d (a 3D model made from one generated picture): { "operation": "image", "images": [{ "type": "node",
    "nodeId": "<an image node>" }], "targetPolycount": 20000, "texture": true, "pbr": false }. After generation the
    node gains "assetId".
  - asset (a file that already exists): { "assetId", "mediaType": "image" | "audio" | "model" }
- assets.json maps asset IDs to { "name", "path", "description", "prompt" }; paths are relative to the project root.
  Use the same ID for the same asset everywhere.
- Say in a node's title or description whether it is a reference mockup or a production asset. Mockups set the
  direction; they do not fulfil the design's asset list.
- Editing a prompt does not generate anything. generate_canvas_media generates the saved nodes you name, with their
  current settings, and a node whose output came from the same settings is not generated again.
- Read the actual image file to judge how a picture looks. A prompt is not proof of what the picture shows.
- A generated file under assets/generated/ is not part of the game until the game's own source uses a copy of it
  (public/ for a fixed URL), registered in src/assets.ts.
`;

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const writeJson = (file, value) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); };
export const canvasDir = (game) => join(game, 'canvas');
export const boardFile = (game, id) => join(game, 'canvas', 'boards', `${id}.json`);
export const readIndex = (game) => readJson(join(game, 'canvas', 'index.json'));
export const readBoard = (game, id) => readJson(boardFile(game, id));
export const writeBoard = (game, board) => writeJson(boardFile(game, board.id), board);
export const readAssets = (game) => (existsSync(join(game, 'canvas', 'assets.json')) ? readJson(join(game, 'canvas', 'assets.json')) : { version: 1, assets: {} });

/** Create the canvas contract and an empty board when there is none; what exists is kept. */
export function initializeCanvas(game) {
  const dir = canvasDir(game);
  for (const sub of ['boards', 'documents']) mkdirSync(join(dir, sub), { recursive: true });
  if (!existsSync(join(dir, 'AGENTS.md'))) writeFileSync(join(dir, 'AGENTS.md'), CANVAS_AGENTS);
  if (!existsSync(join(dir, 'index.json'))) writeJson(join(dir, 'index.json'), { version: 1, boards: [{ id: 'main', name: 'Design' }], documents: [] });
  const index = readIndex(game);
  for (const board of index.boards) {
    if (!existsSync(boardFile(game, board.id))) writeBoard(game, { id: board.id, version: 1, viewport: { width: 1920, height: 1080 }, nodes: [], edges: [] });
  }
  if (!existsSync(join(dir, 'assets.json'))) writeJson(join(dir, 'assets.json'), { version: 1, assets: {} });
  return index;
}

/** Record a file as a canvas asset (or update it), by ID. */
export function registerAsset(game, id, asset) {
  const manifest = readAssets(game);
  manifest.assets[id] = { ...(manifest.assets[id] ?? {}), ...asset };
  writeJson(join(game, 'canvas', 'assets.json'), manifest);
  return manifest.assets[id];
}

/** The main design document's path and text, or null when the index names none. */
export function mainDocument(game) {
  if (!existsSync(join(game, 'canvas', 'index.json'))) return null;
  let index;
  try { index = readIndex(game); } catch { return null; }
  if (!index.mainDocumentId) return null;
  const file = join(game, 'canvas', 'documents', `${index.mainDocumentId}.md`);
  return existsSync(file) ? { id: index.mainDocumentId, file, text: readFileSync(file, 'utf8') } : null;
}

const insideProject = (path) => typeof path === 'string' && path.length > 0 && !path.startsWith('/') && !normalize(path).startsWith('..');

/** What is wrong with the canvas files, their references and their media paths: [{ file, message }]. Reads only. */
export function checkCanvas(game) {
  const issues = [];
  const add = (file, message) => issues.push({ file, message });
  const dir = canvasDir(game);
  if (!existsSync(join(dir, 'index.json'))) return [{ file: 'canvas/index.json', message: 'There is no canvas: call canvas_initialize.' }];
  let index;
  try { index = readIndex(game); } catch (err) { return [{ file: 'canvas/index.json', message: `not valid JSON: ${err.message}` }]; }
  if (index.version !== 1) add('canvas/index.json', '"version" must be 1.');
  if (!Array.isArray(index.boards) || index.boards.length === 0) add('canvas/index.json', '"boards" needs at least one { id, name }.');
  if (!Array.isArray(index.documents)) add('canvas/index.json', '"documents" must be a list of { id, title }.');
  const documents = new Set((index.documents ?? []).map((d) => d.id));
  for (const d of index.documents ?? []) {
    if (!ID.test(String(d.id))) add('canvas/index.json', `document id ${JSON.stringify(d.id)} must be letters, digits, _ or -.`);
    if (!existsSync(join(dir, 'documents', `${d.id}.md`))) add('canvas/index.json', `document "${d.id}" has no canvas/documents/${d.id}.md.`);
  }
  if (!index.mainDocumentId) add('canvas/index.json', 'No "mainDocumentId": register the game\'s design document and name it as the main one.');
  else if (!documents.has(index.mainDocumentId)) add('canvas/index.json', `"mainDocumentId" is "${index.mainDocumentId}", which "documents" does not list.`);

  let manifest = { assets: {} };
  try { manifest = readAssets(game); } catch (err) { add('canvas/assets.json', `not valid JSON: ${err.message}`); }
  for (const [id, asset] of Object.entries(manifest.assets ?? {})) {
    if (!ID.test(id)) add('canvas/assets.json', `asset id ${JSON.stringify(id)} must be letters, digits, _ or -.`);
    if (!asset?.name) add('canvas/assets.json', `asset "${id}" has no "name".`);
    if (!insideProject(asset?.path)) add('canvas/assets.json', `asset "${id}" needs a "path" relative to the project root.`);
    else if (!existsSync(join(game, asset.path))) add('canvas/assets.json', `asset "${id}" points at ${asset.path}, which does not exist.`);
  }

  for (const entry of index.boards ?? []) {
    const file = `canvas/boards/${entry.id}.json`;
    if (!existsSync(join(game, file))) { add(file, 'The index lists this board but the file is missing.'); continue; }
    let board;
    try { board = readBoard(game, entry.id); } catch (err) { add(file, `not valid JSON: ${err.message}`); continue; }
    if (board.id !== entry.id) add(file, `"id" must be "${entry.id}".`);
    if (!Array.isArray(board.nodes)) { add(file, '"nodes" must be a list.'); continue; }
    const ids = new Set();
    const byId = new Map(board.nodes.map((n) => [n?.id, n]));
    for (const node of board.nodes) {
      const where = `node "${node?.id}"`;
      if (!ID.test(String(node?.id))) add(file, `a node has the id ${JSON.stringify(node?.id)}; ids are letters, digits, _ or -.`);
      if (ids.has(node?.id)) add(file, `${where} appears twice.`);
      ids.add(node?.id);
      if (!NODE_TYPES.includes(node?.type)) { add(file, `${where} has the type ${JSON.stringify(node?.type)}; types are ${NODE_TYPES.join(', ')}.`); continue; }
      const data = node.data ?? {};
      if (!node.title) add(file, `${where} has no "title".`);
      if (node.type === 'document' && !documents.has(data.documentId)) add(file, `${where}: documentId "${data.documentId}" is not in the index.`);
      if (node.type === 'image') {
        if (typeof data.prompt !== 'string' || !data.prompt.trim()) add(file, `${where}: an image node needs a "prompt".`);
        if (!ASPECT_RATIOS.includes(data.aspectRatio)) add(file, `${where}: "aspectRatio" is one of ${ASPECT_RATIOS.join(', ')}.`);
        if (!Array.isArray(data.images)) add(file, `${where}: "images" must be a list (empty when there is no reference).`);
      }
      if (node.type === 'model-3d') {
        const source = (data.images ?? [])[0];
        if (data.operation !== 'image') add(file, `${where}: "operation" must be "image" (a model is made from one generated picture).`);
        if (!source || source.type !== 'node' || byId.get(source.nodeId)?.type !== 'image') add(file, `${where}: "images" must name one image node of this board, [{ "type": "node", "nodeId": "..." }].`);
        if (!(Number.isInteger(data.targetPolycount) && data.targetPolycount >= 500 && data.targetPolycount <= 100000)) add(file, `${where}: "targetPolycount" is a whole number from 500 to 100000 (about 20000 for a thing held in VR).`);
      }
      if (node.type === 'asset' && !manifest.assets?.[data.assetId]) add(file, `${where}: assetId "${data.assetId}" is not in canvas/assets.json.`);
      if (data.assetId && !manifest.assets?.[data.assetId]) add(file, `${where}: its assetId "${data.assetId}" is not in canvas/assets.json.`);
    }
  }
  return issues;
}
