# Gate

Every generated module passes this checker before the headset loads it: on the server after each write, and in
the coder's sandbox whenever the agent runs its check. It runs the headset's own three.js and kit, so what passes
here builds the same way in the headset.

| File | What it does |
|---|---|
| `gate.ts` | The check: JSON `{ code, knownAssets? }` on stdin, `{ ok, stage, stats, warnings, error }` on stdout. |
| `snapshot.ts` | The same check on a module still being written, for the live preview: its runnable prefix. |
| `src/validate.ts` | Static safety: no network, DOM, timers, dynamic code or host globals; library ids must exist. |
| `src/sandbox.ts`, `src/sandbox-child.ts` | Runs the module in a separate, locked-down Node process (Node's `vm` is not a security boundary). |
| `src/dryrun.ts` | Builds the scene and runs ten frames with a simulated hand; counts meshes, triangles, grab and press targets. |
| `src/layout.ts` | Layout checks from where the player stands: targets hidden, out of reach, or too big up close. |
| `src/play.ts` | The play-through: a simulated hand plays the game as its `play` block says, at 72 and 30 frames a second and with no hand; every move must register and the round must end with a result. |
| `src/kit/kit.js` | The kit every module draws with (materials, shapes, cards, panels), shared with the headset app. |
| `src/library.ts`, `src/glyphs.ts` | The model library's catalogue, and the characters panels can show. |
| `src/example-module.js` | The worked example in the lesson prompt. |

```bash
npm install
npm test             # test-gate.ts: passing and failing modules, the layout rules; test-play.ts: the play-through
npm run typecheck
# check one module: an empty scene fails, a box passes
echo '{"code": "export default function build({ THREE }) { const root = new THREE.Group(); root.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshStandardMaterial())); return { root }; }"}' | npx tsx gate.ts
```
