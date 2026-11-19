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

/**
 * Measure the first view. `touched` is the names the play-test's hand sequences target.
 * { failures: [text], panels: [...], things: [...] }
 */
export function firstView(game, touched = []) {
  const failures = [];
  const head = headPose(game);
  const panels = [];
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
  for (const target of targets(game)) {
    if (!wanted.has(target.name)) continue;
    const seen = seenFrom(head, [target.position.x, target.position.y, target.position.z]);
    things.push({ name: target.name, side: round(seen.side), up: round(seen.up), away: +seen.away.toFixed(2) });
    const where = `"${target.name}" is ${Math.abs(round(seen.side))} degrees to the ${seen.side < 0 ? 'left' : 'right'}, ${Math.abs(round(seen.up))} degrees ${seen.up < 0 ? 'down' : 'up'}, ${seen.away.toFixed(2)} m away`;
    if (Math.abs(seen.side) > VIEW.thingSide) failures.push(`First view: ${where}: a thing the hands must touch is within ${VIEW.thingSide} degrees of straight ahead.`);
    else if (seen.up < -VIEW.thingDown || seen.up > VIEW.thingUp) failures.push(`First view: ${where}: a thing the hands must touch is between ${VIEW.thingDown} degrees down and ${VIEW.thingUp} up. The headset starts 1.6 m up: put the work surface about 1.05 m up with the things 0.6 to 0.7 m in front.`);
    else if (seen.away > VIEW.thingFar) failures.push(`First view: ${where}: a thing the hands must touch is within ${VIEW.thingFar} m.`);
  }
  for (const name of wanted) if (!things.some((t) => t.name === name)) things.push({ name, missing: true });
  return { failures, panels, things };
}
