// Starts pi for one prompt in a game project and reads its JSON event stream: pi's own folder (settings, IWSDK's
// MCP servers), the sandbox the agent's commands run in, and one pi process per prompt. A session id carries the
// conversation from one prompt to the next, so a follow-up continues where the agent stopped.
import { spawn } from 'node:child_process';
import { appendFileSync, copyFileSync, createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { MODEL, PI, PI_HOME, THINKING, TRIAL } from './paths.mjs';

const HOME = homedir();
const NODE_HOME = dirname(dirname(process.execPath)); // where node and npm live (an nvm folder under the home folder)

// The IWSDK tools declared to the model by name; everything else IWSDK can do stays reachable through its command line.
const RUNTIME_TOOLS = ['xr_run_sequence', 'xr_list_targets', 'xr_accept_session', 'xr_get_session_status', 'xr_set_input_mode',
  'ecs_find_entities', 'ecs_query_entity', 'browser_get_console_logs', 'browser_reload_page', 'browser_screenshot', 'ui_inspect'];
const REFERENCE_TOOLS = ['search_code', 'get_api_reference', 'find_usage_examples'];
const direct = (names) => Object.fromEntries(names.map((n) => [n, 'direct']));

/** pi's settings and the game's two MCP servers, in pi's own folder (not in the project, which the agent can write). */
export function setupPiHome(game) {
  mkdirSync(PI_HOME, { recursive: true });
  for (const file of ['settings.json', 'models.json']) copyFileSync(join(TRIAL, 'pi-home', file), join(PI_HOME, file));
  writeFileSync(join(PI_HOME, 'mcp.json'), `${JSON.stringify({
    mcpServers: {
      'iwsdk-runtime': {
        command: 'node', args: [join(game, 'node_modules', '@iwsdk', 'cli', 'dist', 'cli.js'), 'mcp', 'stdio'], cwd: game, timeout: 120,
        description: 'The running game in the emulated headset: hands, XR session, ECS state, console, screenshots.',
        exposure: 'hidden', toolExposure: direct(RUNTIME_TOOLS),
      },
      'iwsdk-reference': {
        command: 'node', args: [join(game, 'node_modules', '@iwsdk', 'reference', 'dist', 'cli.js')], cwd: game, timeout: 120,
        description: 'IWSDK API lookup: search the SDK source, read an API reference, find usage examples.',
        exposure: 'hidden', toolExposure: direct(REFERENCE_TOOLS),
      },
    },
  }, null, 1)}\n`);
}

/** A sandbox-exec profile: the agent's commands write only in the game and the run folder, read nothing else of the
 * home folder (no .env, no ~/.npmrc, no keys), and cannot signal processes outside the sandbox. */
export function sandboxProfile(game, run) {
  const write = [game, run, PI_HOME, join(HOME, '.npm'), join(HOME, 'Library', 'Caches')];
  const read = [...write, TRIAL, NODE_HOME];
  const paths = (list) => list.map((p) => `(subpath ${JSON.stringify(p)})`).join(' ');
  const file = join(run, 'sandbox.sb');
  writeFileSync(file, [
    '(version 1)', '(allow default)',
    `(deny file-write* (subpath ${JSON.stringify(HOME)}))`, `(allow file-write* ${paths(write)})`,
    `(deny file-read-data (subpath ${JSON.stringify(HOME)}))`, `(allow file-read-data ${paths(read)})`,
    '(deny signal (target others))', '',
  ].join('\n'));
  return file;
}

/** The environment pi runs in: what it needs and nothing else of the user's shell. `key` is the agent model's
 * provider key, { name, value } (paths.mjs agentKey). */
export function piEnv(game, run, key, studio = null) {
  return {
    ...(studio ? { PI_XR_STUDIO_URL: studio.url, PI_XR_STUDIO_TOKEN: studio.token } : {}),
    // The guard's two time nudges and its limit on images read, when a run sets them.
    ...Object.fromEntries(['PI_XR_STEER_MIN', 'PI_XR_MAX_IMAGES'].filter((name) => process.env[name]).map((name) => [name, process.env[name]])),
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin`, HOME, TMPDIR: process.env.TMPDIR ?? '/tmp',
    LANG: 'en_US.UTF-8', TERM: 'dumb', NO_COLOR: '1', [key.name]: key.value, PI_CODING_AGENT_DIR: PI_HOME,
    NPM_CONFIG_USERCONFIG: '/dev/null', NPM_CONFIG_UPDATE_NOTIFIER: 'false', PI_XR_WORKSPACE: game, PI_XR_RUN_DIR: run,
  };
}

/**
 * Run pi for one prompt (`prompt` is its message arguments: `@file`s and text) and resolve when it exits.
 * `onRecord(record, secondsSinceStart)` gets every event; `stopWhen(secondsSinceStart, idleSeconds)` returns a reason
 * to stop the agent, or nothing. { code, signal, stopped, seconds }.
 */
export function runPi({ game, run, key, prompt, n = 0, sessionId = null, skills = [], append = [], extensions = [], sandbox = null, studio = null, extraArgs = [], onRecord = () => {}, stopWhen = () => null }) {
  const piArgs = ['--mode', 'json', '--model', MODEL, '--thinking', THINKING, '--no-approve', '--no-skills',
    ...skills.flatMap((s) => ['--skill', s]), ...append.flatMap((f) => ['--append-system-prompt', f]), ...extensions.flatMap((e) => ['-e', e]),
    ...(sessionId ? ['--session-dir', join(run, 'session'), '--session-id', sessionId] : ['--no-session']), ...extraArgs, '--', ...prompt];
  const [command, argv] = sandbox ? ['/usr/bin/sandbox-exec', ['-f', sandbox, PI, ...piArgs]] : [PI, piArgs];
  const child = spawn(command, argv, { cwd: game, env: piEnv(game, run, key, studio), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const eventsFile = join(run, `events-${n}.jsonl`);
  child.stderr.pipe(createWriteStream(join(run, `stderr-${n}.log`)));
  const began = Date.now();
  let lastEvent = Date.now();
  let stopped = null;
  let buffer = '';
  const stop = (why) => {
    if (stopped) return;
    stopped = why;
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone already */ }
    setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone already */ } }, 30000).unref();
  };
  // pi runs in its own process group (so its shells and MCP servers stop with it); when the runner itself is
  // stopped, the agent must not go on working with nobody keeping its limits.
  const onSignal = (signal) => {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone already */ }
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.once(signal, onSignal);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let at;
    while ((at = buffer.indexOf('\n')) >= 0) { // records end with LF only (pi's docs/json.md)
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      if (!line.trim()) continue;
      appendFileSync(eventsFile, `${line}\n`);
      lastEvent = Date.now();
      try { onRecord(JSON.parse(line), (Date.now() - began) / 1000); } catch { /* kept in the file, not counted */ }
    }
  });
  const watch = setInterval(() => {
    const why = stopWhen((Date.now() - began) / 1000, (Date.now() - lastEvent) / 1000);
    if (why) stop(why);
  }, 5000);
  return new Promise((done) => {
    child.on('close', (code, signal) => {
      clearInterval(watch);
      for (const s of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.removeListener(s, onSignal);
      done({ code, signal, stopped, seconds: (Date.now() - began) / 1000 });
    });
  });
}
