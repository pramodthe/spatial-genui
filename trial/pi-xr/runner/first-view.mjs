// The first view: what the player sees the moment the game opens, measured in the running game from where the
// headset starts. A panel must be wholly in view, small enough, turned to the player and with no clipped text; the
// things the game asks the hands to touch must be in view and not at the player's feet. Both art games of Nov 19
// passed their play-through with a panel half out of view and props at the bottom edge, which the agent's own look
// at a screenshot did not catch; these are measured, so the agent gets numbers to fix.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { headPose, nodeTransform, panelOf, sceneNodes, targets } from './iwsdk.mjs';

// Degrees from straight ahead. A headset shows about 50 to the side; what is to be read stays nearer the middle.
export const VIEW = {
  panelSide: 45, panelUp: 25, panelDown: 35, // every corner of a panel inside this
  panelWide: 0.7, panelNear: 0.6, panelFar: 2.5, panelTurn: 60, // metres; degrees between its face and the player
  thingSide: 50, thingUp: 20, thingDown: 40, thingFar: 2, // a thing the hands must touch
  labelGap: 0.2, // metres from a control the player presses to the words that say what it does
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const length = (v) => Math.hypot(v[0], v[1], v[2]);
const deg = (radians) => (radians * 180) / Math.PI;
/** A vector turned by a quaternion [x, y, z, w]. */
export function turn(v, q) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
const inverse = (q) => [-q[0], -q[1], -q[2], q[3]];

/** Where a point is from the head: degrees to the side (right is positive), degrees up, and metres away. */
export function seenFrom(head, point) {
  const v = turn(sub(point, head.position), inverse(head.quaternion));
  return { side: deg(Math.atan2(v[0], -v[2])), up: deg(Math.atan2(v[1], Math.hypot(v[0], v[2]))), away: length(v) };
}

/** The asset ids that are UIKitML panels, read from the asset manifest's source. */
export function panelAssets(game) {
  const file = ['src/assets.ts', 'src/assets.js'].map((f) => join(game, f)).find((f) => existsSync(f));
  if (!file) return new Set();
  const source = readFileSync(file, 'utf8');
  const ids = new Set();
  for (const m of source.matchAll(/['"]?([\w-]+)['"]?\s*:\s*(?:uikitml\s*\(|\{[^{}]*?(?:UIKitML|\.uikitml))/g)) ids.add(m[1]);
  return ids;
}

const round = (n) => Math.round(n);

/** Metres from a point to a panel's rectangle (its face is its local XY plane, centred on its position). */
function gapTo(board, point) {
  const local = turn(sub(point, board.position), inverse(board.quaternion));
  return Math.hypot(Math.max(0, Math.abs(local[0]) - board.wide / 2), Math.max(0, Math.abs(local[1]) - board.tall / 2), local[2]);
}

/**
 * Measure the first view. `touched` is the names the play-test's hand sequences target, `pressed` the ones it
 * presses. { failures: [text], panels: [...], things: [...] }
 */
export function firstView(game, touched = [], pressed = []) {
  const failures = [];
  const head = headPose(game);
  const panels = [];
  const boards = []; // each panel's place and whether it shows words, for the controls below
  const assets = panelAssets(game);
  for (const node of sceneNodes(game).filter((n) => n.assetId && assets.has(n.assetId) && n.entityIndex !== null)) {
    const place = nodeTransform(game, node.nodeId);
    const panel = panelOf(game, node.entityIndex);
    if (!place || !panel?.size) continue;
    // UIKit lays a panel out in centimetres; the node's scale takes it to metres.
    const wide = (panel.size.width * place.scale[0]) / 100;
    const tall = (panel.size.height * place.scale[1]) / 100;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => seenFrom(head, add(place.position, turn([(sx * wide) / 2, (sy * tall) / 2, 0], place.quaternion))));
    const centre = seenFrom(head, place.position);
    const facing = deg(Math.acos(Math.max(-1, Math.min(1, (() => {
      const normal = turn([0, 0, 1], place.quaternion);
      const toHead = sub(head.position, place.position);
      const d = length(toHead) || 1;
      return (normal[0] * toHead[0] + normal[1] * toHead[1] + normal[2] * toHead[2]) / d;
    })()))));
    const clipped = panel.elements.filter((e) => e.state?.clipped && e.state?.displayed !== false && String(e.text ?? '').trim()).map((e) => String(e.text).trim().slice(0, 40));
    const name = node.name || node.nodeId;
    const side = Math.max(...corners.map((c) => Math.abs(c.side)));
    const highest = Math.max(...corners.map((c) => c.up));
    const lowest = Math.min(...corners.map((c) => c.up));
    panels.push({ name, wide: +wide.toFixed(2), tall: +tall.toFixed(2), away: +centre.away.toFixed(2), side: round(centre.side), up: round(centre.up), facing: round(facing), clipped });
    boards.push({ name, position: place.position, quaternion: place.quaternion, wide, tall, words: panel.elements.some((e) => e.state?.displayed !== false && String(e.text ?? '').trim()) });
    const where = `the panel "${name}" (${wide.toFixed(2)} m wide, ${centre.away.toFixed(2)} m away, ${Math.abs(round(centre.side))} degrees to the ${centre.side < 0 ? 'left' : 'right'})`;
    if (side > VIEW.panelSide) failures.push(`First view: ${where} reaches ${round(side)} degrees to the side, out of the first view (at most ${VIEW.panelSide}). Move it nearer the middle, beside the main thing, or make it smaller.`);
    if (highest > VIEW.panelUp || lowest < -VIEW.panelDown) failures.push(`First view: ${where} reaches from ${round(lowest)} to ${round(highest)} degrees up, outside the first view (${-VIEW.panelDown} to ${VIEW.panelUp}). Put its centre a little below eye height.`);
    if (wide > VIEW.panelWide) failures.push(`First view: the panel "${name}" is ${wide.toFixed(2)} m wide; a panel is at most ${VIEW.panelWide} m wide (its node's scale sets this: ${panel.size.width} units x scale / 100).`);
    if (centre.away < VIEW.panelNear || centre.away > VIEW.panelFar) failures.push(`First view: the panel "${name}" is ${centre.away.toFixed(2)} m from the player; keep it ${VIEW.panelNear} to ${VIEW.panelFar} m away.`);
    if (facing > VIEW.panelTurn) failures.push(`First view: the panel "${name}" is turned ${round(facing)} degrees away from the player; turn it to face where the player starts.`);
    if (clipped.length) failures.push(`First view: text is cut off in the panel "${name}": ${clipped.map((t) => `"${t}"`).join(', ')}. Shorten it or give it room.`);
  }

  const things = [];
  const wanted = new Set(touched);
  const found = targets(game);
  for (const target of found) {
    if (!wanted.has(target.name)) continue;
    const seen = seenFrom(head, [target.position.x, target.position.y, target.position.z]);
    things.push({ name: target.name, side: round(seen.side), up: round(seen.up), away: +seen.away.toFixed(2) });
    const where = `"${target.name}" is ${Math.abs(round(seen.side))} degrees to the ${seen.side < 0 ? 'left' : 'right'}, ${Math.abs(round(seen.up))} degrees ${seen.up < 0 ? 'down' : 'up'}, ${seen.away.toFixed(2)} m away`;
    if (Math.abs(seen.side) > VIEW.thingSide) failures.push(`First view: ${where}: a thing the hands must touch is within ${VIEW.thingSide} degrees of straight ahead.`);
    else if (seen.up < -VIEW.thingDown || seen.up > VIEW.thingUp) failures.push(`First view: ${where}: a thing the hands must touch is between ${VIEW.thingDown} degrees down and ${VIEW.thingUp} up. The headset starts 1.6 m up: put the work surface about 1.05 m up with the things 0.6 to 0.7 m in front.`);
    else if (seen.away > VIEW.thingFar) failures.push(`First view: ${where}: a thing the hands must touch is within ${VIEW.thingFar} m.`);
  }
  for (const name of wanted) if (!things.some((t) => t.name === name)) things.push({ name, missing: true });

  // A control says what it does. The Nov 20 seesaw's replay pressed four coloured boxes by name and passed; on the
  // headset nobody could tell Start from Test, because none had a word on it.
  for (const name of new Set(pressed)) {
    const target = found.find((t) => t.name === name);
    if (!target) continue;
    const point = [target.position.x, target.position.y, target.position.z];
    const near = boards.filter((b) => b.words).map((b) => ({ name: b.name, gap: gapTo(b, point) })).sort((a, b) => a.gap - b.gap)[0];
    const thing = things.find((t) => t.name === name);
    if (thing) thing.wordsAway = near ? +near.gap.toFixed(2) : null;
    if (!near || near.gap > VIEW.labelGap) failures.push(`Controls: "${name}" is pressed but has no words on it or beside it (the nearest panel text is ${near ? `${near.gap.toFixed(2)} m away, on "${near.name}"` : 'nowhere'}). Every control says what it does in a word or two of UIKitML, on the control or within ${VIEW.labelGap} m of it; show only the controls that apply now.`);
  }
  return { failures, panels, things };
}
