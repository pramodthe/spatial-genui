// The paid pre-flight (a few cents): before any game is built, see that pi and Muse work together the way a game
// run needs, in a prepared game folder (run.mjs <name> --prepare-only), with the same flags, sandbox and guard:
// a plain answer at full thinking; a loop of tool calls on Meta's Responses API, with cached input by its later
// turns; an image read; IWSDK's MCP tools; and the guard refusing what it should.
// Usage: node runner/preflight.mjs <prepared game name> [test...]     tests: hello loop image mcp guard studio
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runPi, sandboxProfile, setupPiHome } from './agent.mjs';
import { count, newStats } from './events.mjs';
import { ARCHIVE, GAMES, IWSDK_SKILLS, MODEL, RUNS, STUDIO_SKILLS, THINKING, TRIAL, agentKey, metaKey } from './paths.mjs';
import { startStudio } from './studio-server.mjs';

const [name, ...only] = process.argv.slice(2);
const game = join(GAMES, name ?? '');
if (!name || !existsSync(join(game, 'package.json'))) {
  console.log('Usage: node runner/preflight.mjs <prepared game name> [hello loop image mcp guard]');
  process.exit(2);
}
const run = join(RUNS, `${name}-preflight-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
mkdirSync(run, { recursive: true });
setupPiHome(game);
const sandbox = sandboxProfile(game, run);
const key = metaKey();
// The studio service with no art budget: the canvas and plan tools work, a picture or a model is refused.
const studio = await startStudio({ game, run, key, limits: { images: 0, models: 0, usd: 0 } });
if (existsSync(join(ARCHIVE, 'template-smoke.png'))) copyFileSync(join(ARCHIVE, 'template-smoke.png'), join(game, 'smoke.png'));

const TESTS = {
  hello: { prompt: ['Reply with the single word: ready'], pass: (r) => /ready/i.test(r.answer) },
  loop: {
    prompt: ['Run `ls src` in the shell, then read src/index.ts, then read src/robot.ts, then say in one sentence which systems src/index.ts registers.'],
    pass: (r) => r.stats.toolCalls >= 3 && /Robot/i.test(r.answer) && /Panel/i.test(r.answer),
    note: (r) => (r.stats.cacheRead > 0 ? `cached input by later turns: ${r.stats.cacheRead} tokens` : 'NO cached input: every turn pays for the whole context'),
  },
  image: { prompt: ['Read the image file smoke.png and answer in one short sentence: what is standing on the nearest plinth, and what colour is its body?'], pass: (r) => /robot/i.test(r.answer) && /orange/i.test(r.answer) },
  mcp: {
    prompt: ['Call xr_get_session_status and say whether an XR session is active. Then call ecs_find_entities for entities with the component "Robot" and say the name of the entity it finds.'],
    pass: (r) => Object.keys(r.stats.tools).some((t) => t.includes('xr_get_session_status')) && Object.keys(r.stats.tools).some((t) => t.includes('ecs_find_entities')) && /robot/i.test(r.answer),
  },
  guard: {
    prompt: ['@.agents/skills/xr-game-studio/SKILL.md', 'Two things. First, in one sentence: what is step 1 of "Create a game" in the attached skill? Second, run the shell command `git status` once and tell me exactly what came back.'],
    pass: (r) => /design|canvas/i.test(r.answer) && /harness|no git|refus|block/i.test(r.answer),
  },
  studio: {
    prompt: ['Call canvas_initialize, then canvas_check, then update_plan with two steps. Then try generate_image once with the prompt "a red wooden block on a plain white background" and tell me exactly what each of the four tools answered, one line each.'],
    pass: (r) => ['canvas_initialize', 'canvas_check', 'update_plan', 'generate_image'].every((t) => r.stats.tools[t] >= 1) && /most it may|budget/i.test(r.answer),
  },
};

let failed = 0;
let usd = 0;
for (const [id, test] of Object.entries(TESTS)) {
  if (only.length && !only.includes(id)) continue;
  const stats = newStats();
  const texts = [];
  const errors = [];
  let active = null;
  const ended = await runPi({
    game, run, key: agentKey(), prompt: test.prompt, n: id, sandbox, studio,
    skills: [...STUDIO_SKILLS, ...IWSDK_SKILLS].map((s) => join(game, '.agents', 'skills', s)),
    append: [join(TRIAL, 'instructions', 'APPEND_SYSTEM.md'), join(game, 'src', 'AGENTS.md')],
    extensions: [join(TRIAL, 'runner', 'guard.ts'), join(TRIAL, 'runner', 'studio-tools.ts')],
    onRecord: (record, seconds) => {
      count(stats, record, seconds);
      if (record.type === 'message_end' && record.message?.role === 'assistant') {
        for (const part of record.message.content ?? []) if (part.type === 'text' && part.text?.trim()) texts.push(part.text.trim());
        if (record.message.errorMessage) errors.push(record.message.errorMessage);
        if (active === null) active = { input: record.message.usage?.input ?? 0, cacheRead: record.message.usage?.cacheRead ?? 0 };
      }
      if (record.type === 'tool_execution_end' && record.isError) errors.push(`${record.toolName}: ${JSON.stringify(record.result?.content ?? '').slice(0, 200)}`);
    },
    stopWhen: (seconds) => (seconds > 240 ? 'four minutes' : null),
  });
  const result = { stats, answer: texts.join(' ').replace(/\s+/g, ' ') };
  const ok = !ended.stopped && stats.stopReason !== 'error' && test.pass(result);
  failed += ok ? 0 : 1;
  usd += stats.usd;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${id}: ${Math.round(ended.seconds)} s, ${stats.turns} turn(s), ${stats.toolCalls} tool call(s) ${JSON.stringify(stats.tools)}, first request ${active ? active.input + active.cacheRead : '?'} input tokens, in ${stats.input} / cached ${stats.cacheRead} / out ${stats.output}, $${stats.usd.toFixed(4)}, stop: ${ended.stopped ?? stats.stopReason}`);
  console.log(`     answer: ${result.answer.slice(0, 400) || '(none)'}`);
  if (test.note) console.log(`     ${test.note(result)}`);
  for (const e of errors.slice(0, 3)) console.log(`     error: ${String(e).slice(0, 300)}`);
  const stderr = join(run, `stderr-${id}.log`);
  if (!ok && existsSync(stderr)) console.log(`     stderr: ${readFileSync(stderr, 'utf8').slice(-500)}`);
}
await studio.close();
console.log(`${failed ? `${failed} FAILED` : 'pre-flight ok'}: ${MODEL} at thinking ${THINKING}, $${usd.toFixed(4)} in all; logs in ${run}`);
process.exit(failed ? 1 : 0);
