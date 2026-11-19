// Puts a built game in the emulator window to look at: takes the game that is up down, brings this one up, enters
// XR with hands and saves a picture of the opening view. No agent, no model: free.
// Usage: node runner/show.mjs <name> [picture file]
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { down, enterXR, ready, reload, screenshot, settled, status, up } from './iwsdk.mjs';
import { ARCHIVE, GAMES, PORT, RUNS } from './paths.mjs';

const [name, picture] = process.argv.slice(2);
const game = join(GAMES, name ?? '');
if (!name || !existsSync(join(game, 'package.json'))) {
  console.log('Usage: node runner/show.mjs <name of a built game> [picture file]');
  process.exit(2);
}
const RUNNING = join(ARCHIVE, 'running.json');
if (existsSync(RUNNING)) {
  const last = JSON.parse(readFileSync(RUNNING, 'utf8'));
  if (last.game !== game && existsSync(last.game)) down(last.game); // one game at a time
  if (last.game !== game) rmSync(RUNNING, { force: true });
}
if (!ready(game) && !(await up(game, { window: true }))) throw new Error('The dev runtime did not come up (iwsdk dev status).');
writeFileSync(RUNNING, JSON.stringify({ game, run: null }));
await reload(game);
await settled(game);
const xr = await enterXR(game);
const file = picture ?? join(RUNS, `${name}-opening-view.png`);
const shot = xr.ok ? screenshot(game, file) : null;
const urls = status(game)?.data?.runtimeUrls ?? {};
console.log(`[${name}] ${xr.ok ? 'in XR with hands' : `did not enter XR: ${xr.error}`}${shot ? `; opening view: ${shot}` : ''}`);
console.log(`[${name}] ${urls.local ?? `https://localhost:${PORT}/`} (on the Quest: ${(urls.network ?? [])[0] ?? 'see iwsdk dev status'}, or adb reverse tcp:${PORT} tcp:${PORT})`);
