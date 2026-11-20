// A pi extension that keeps the agent inside its game project. pi runs shell commands with the user's own
// permissions (as OhMyGame's does: "trusted-local"), so the runner adds this and a sandbox-exec profile (run.mjs):
// no stopping processes or the dev runtime, no installs, git or downloads, no paths outside the project, no edits to
// the files the template fixes, and a limit on images read (more than 30 images in one request fails).
// A refused call returns its reason to the agent, which goes on with something else. Refusals are logged.
import { appendFileSync } from 'node:fs';
import { basename, dirname, resolve, sep } from 'node:path';
import { isToolCallEventType, type ExtensionAPI } from '@earendil-works/pi-coding-agent';

const WORKSPACE = resolve(process.env.PI_XR_WORKSPACE ?? process.cwd());
const RUN = process.env.PI_XR_RUN_DIR ? resolve(process.env.PI_XR_RUN_DIR) : null;
const MAX_IMAGES = Number(process.env.PI_XR_MAX_IMAGES ?? 16); // screenshots and generated pictures together
const STEER_MIN = (process.env.PI_XR_STEER_MIN ?? '18,30').split(',').map(Number);
const TEMP = ['/tmp', '/private/tmp', '/var/folders', '/private/var/folders'];
// Where programs live: a command may name these, never write there (the sandbox profile sees to that).
const PROGRAMS = ['/usr', '/bin', '/sbin', '/opt/homebrew', '/dev', dirname(dirname(process.execPath))];
const FIXED = ['package.json', 'package-lock.json', 'vite.config.ts', '.pi-xr-template.json'];

const under = (path: string, root: string) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
const inProject = (path: string) => under(path, WORKSPACE);
const readable = (path: string) => inProject(path) || (RUN !== null && under(path, RUN)) || TEMP.some((t) => under(path, t));

const RULES: [RegExp, string][] = [
  [/\b(kill|pkill|killall)\b/, 'Processes are not yours to stop: the harness owns the dev runtime and everything else running.'],
  [/\bdev\s+(up|down|restart)\b|\bnpm\s+run\s+(dev|dev:runtime|dev:down|preview)\b|\bnpx\s+vite\b(?!\s+build)/, 'The dev runtime is already running and belongs to the harness. Use `npx @iwsdk/cli dev status` to see it; saved files are picked up by themselves.'],
  [/\b(npm|pnpm|yarn|bun)\s+(i|install|add|ci|uninstall|remove|update|upgrade|link)\b/, 'No installs: everything the game needs is already in node_modules.'],
  [/\bnpx\s+(?!(--no-install\s+)?(@iwsdk\/cli|iwsdk|tsc|vite\s+build)\b)/, 'npx may only run @iwsdk/cli, tsc and `vite build` here (anything else would download code).'],
  [/\bgit\b/, 'No git in this project: the harness keeps its own snapshots.'],
  [/\b(curl|wget|ssh|scp|nc)\b/, 'No downloads or network tools: build with what is installed.'],
  [/(^|[\s"'=/])\.env(\.\w+)?($|[\s"'])/, 'No .env files here.'],
  [/\bsudo\b/, 'No sudo.'],
  [/(^|[\s;&|("'=])~(\/|$|[\s"'])|\$HOME\b|\$\{HOME\}/, 'Stay inside the project folder (no ~ or $HOME).'],
  [/(^|[\s"'=(])\.\.(\/|$|[\s"')])/, 'Stay inside the project folder (no `..`); give paths from the project root.'],
];
const ABSOLUTE = /(?:^|[\s"'=(:<>])(\/(?:Users|home|etc|Library|Applications|Volumes|System|opt|usr|bin|sbin|var|private|tmp|dev)\b[^\s"'`)<>;|&]*)/g;

/** Why a shell command is refused, or null when it may run. */
export function refuseBash(command: string): string | null {
  for (const [rule, why] of RULES) if (rule.test(command)) return why;
  for (const match of command.matchAll(ABSOLUTE)) {
    const path = resolve(match[1]);
    if (!readable(path) && !PROGRAMS.some((p) => under(path, p))) return `Stay inside the project folder: ${match[1]} is outside it. Use paths relative to the project root.`;
  }
  return null;
}

function log(line: string): void {
  if (!RUN) return;
  try { appendFileSync(resolve(RUN, 'guard.log'), `${new Date().toISOString()} ${line}\n`); } catch { /* the log is a convenience */ }
}

export default function guard(pi: ExtensionAPI): void {
  let images = 0;
  let turns = 0;
  const began = Date.now();
  const steered = new Set<number>();
  const block = (tool: string, what: string, reason: string) => {
    log(`refused ${tool}: ${what.slice(0, 200).replace(/\s+/g, ' ')} | ${reason}`);
    return { block: true, reason };
  };

  pi.on('tool_call', (event) => {
    if (isToolCallEventType('bash', event)) {
      const why = refuseBash(event.input.command);
      return why ? block('bash', event.input.command, why) : undefined;
    }
    if (isToolCallEventType('write', event) || isToolCallEventType('edit', event)) {
      const path = resolve(WORKSPACE, event.input.path);
      if (!inProject(path)) return block(event.toolName, event.input.path, 'Write only inside the project folder.');
      const inside = path.slice(WORKSPACE.length + 1);
      if (FIXED.includes(inside)) return block(event.toolName, inside, `${basename(path)} is fixed by the harness; the game does not need it changed.`);
      if (/^(node_modules|\.iwsdk|\.agents)\//.test(inside)) return block(event.toolName, inside, 'That folder belongs to the tools, not the game.');
      return undefined;
    }
    if (isToolCallEventType('read', event)) {
      const path = resolve(WORKSPACE, event.input.path);
      if (!readable(path)) return block('read', event.input.path, 'Read only inside the project folder.');
      if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(path)) {
        if (images >= MAX_IMAGES) return block('read', event.input.path, `${images} images are already in this session, the most it can hold. Judge the game from GameState, the console and the target list instead.`);
        images += 1;
      }
    }
    return undefined;
  });

  // One nudge when the planned time is up, one when it is well over: the budget is time, not a step count.
  pi.on('turn_end', () => {
    turns += 1;
    const minutes = (Date.now() - began) / 60000;
    const due = STEER_MIN.find((m) => minutes >= m && !steered.has(m));
    if (due === undefined) return;
    steered.add(due);
    const text = due === STEER_MIN[0]
      ? `${Math.round(minutes)} minutes used. If move 1 does not yet register by hand sequence, make the game smaller until it does; then go on.`
      : `${Math.round(minutes)} minutes used: stop adding. Make what exists pass typecheck, build and the playtest.json replay, then stop and report.`;
    log(`steer at turn ${turns}: ${text}`);
    try { pi.sendUserMessage(text, { deliverAs: 'steer' }); } catch { /* a missed nudge is not an error */ }
  });
}
