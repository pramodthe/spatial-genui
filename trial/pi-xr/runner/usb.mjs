// Keeps the shelf reachable from a Quest over USB. `adb reverse` forwards the headset's localhost:<port> to this
// Mac, but every reconnect of the cable drops the forward (seen Nov 19: the page stopped loading in the headset);
// this sets it and sets it again whenever it is gone. Other forwards are left alone.
// Usage: node runner/usb.mjs [port, default 8092]
import { spawnSync } from 'node:child_process';

const PORT = Number(process.argv[2]) || 8092;
const adb = (...argv) => spawnSync('adb', argv, { encoding: 'utf8', timeout: 10000 });
let was = null;
for (;;) {
  const listed = adb('reverse', '--list');
  const connected = listed.status === 0;
  const forwarded = connected && listed.stdout.includes(`tcp:${PORT} tcp:${PORT}`);
  if (connected && !forwarded) adb('reverse', `tcp:${PORT}`, `tcp:${PORT}`);
  const now = !connected ? 'no headset on USB' : forwarded ? 'forward in place' : `forward set again: the headset's http://localhost:${PORT}/ reaches this Mac`;
  if (now !== was && !(was?.startsWith('forward set') && now === 'forward in place')) console.log(`[usb ${new Date().toLocaleTimeString()}] ${now}`);
  was = now;
  await new Promise((done) => setTimeout(done, 2000));
}
