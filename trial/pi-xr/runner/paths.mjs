// Where the trial keeps things, and its limits. The code is in the repo (trial/pi-xr); the template, the games and
// the run logs are outside git, so results stay out of the repo and pi does not load the repo's CLAUDE.md (it reads
// context files from every parent folder of the folder it works in).
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TRIAL = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ARCHIVE = process.env.PI_XR_ARCHIVE || join(homedir(), 'Desktop', 'meta-AR-local-archive', 'pi-xr-trial');
export const TEMPLATE = join(ARCHIVE, 'template');
export const GAMES = join(ARCHIVE, 'games');
export const RUNS = join(ARCHIVE, 'runs');
export const PI_HOME = join(ARCHIVE, 'pi-home');
export const RESULTS = join(ARCHIVE, 'results.jsonl');
export const PI = join(TRIAL, 'node_modules', '.bin', 'pi');

export const IWSDK_VERSION = '1.1.0-rc.2'; // the headset app's (headset/package.json)
// The trial's own port: 8081 is the Quest preview and 8787 the app; Vite fails when its port is taken.
export const PORT = Number(process.env.PI_XR_PORT) || 8091;
// The app's model. PI_XR_MODEL=openai/gpt-6.2-astra builds a game with another provider's model, for a comparison.
export const MODEL = process.env.PI_XR_MODEL || 'meta/muse-ember-1.0';
export const THINKING = process.env.PI_XR_THINKING || 'max'; // as the app runs Ember (LLM_REASONING_EFFORT=max)

// A game's budget is time and dollars, not a small step count. The turn limit is only a safety net.
export const LIMITS = {
  minutes: Number(process.env.PI_XR_MINUTES) || 45,
  usd: Number(process.env.PI_XR_USD) || 2,
  turns: Number(process.env.PI_XR_TURNS) || 400,
  idleS: Number(process.env.PI_XR_IDLE_S) || 240, // no event from pi for this long: the run is stuck
  followUps: 2, // repairs continue the same session
  requestTokens: 190000, // Ember costs three times as much above 200K input tokens
};

/** What a game may spend on art: pictures (Muse Image, $0.01 each; OpenAI's cost many times that) and 3D models
 * (TRELLIS.2, about 10 to 20 cents). */
export const MEDIA = {
  images: Number(process.env.PI_XR_IMAGES) || 8,
  models: Number(process.env.PI_XR_MODELS) || 3,
  usd: Number(process.env.PI_XR_MEDIA_USD) || 1,
};

/** The studio skills (skills/, adapted from OhMyGame's web-game-studio plugin), copied into every game. */
export const STUDIO_SKILLS = ['xr-game-studio', 'xr-game-foundations', 'xr-game-playtest', 'xr-game-ui', 'xr-3d-asset-pipeline'];

/** IWSDK's skills the agent is told about (the starter ships more: hosting, packaging, native and glasses tests). */
export const IWSDK_SKILLS = ['iwsdk-dev', 'iwsdk-grab', 'iwsdk-ray', 'iwsdk-ui', 'iwsdk-physics', 'iwsdk-debug', 'iwsdk-compose-scene', 'iwsdk-build-model'];

/** Who draws the pictures. Nothing set: Meta's Muse Image, the app's own. PI_XR_IMAGE_PROVIDER=openai: OpenAI's image
 * model (PI_XR_IMAGE_MODEL, PI_XR_IMAGE_QUALITY, PI_XR_IMAGE_LARGE=1 for big pictures), as a quality reference.
 * { provider, key, model, quality, large } or null. */
export function imageMaker() {
  if (process.env.PI_XR_IMAGE_PROVIDER !== 'openai') return null;
  return { provider: 'openai', key: openaiKey(), model: process.env.PI_XR_IMAGE_MODEL || 'gpt-image-2.6-sunburst', quality: process.env.PI_XR_IMAGE_QUALITY || 'high', large: process.env.PI_XR_IMAGE_LARGE === '1' };
}

/** An OpenAI key from the environment or from openai-temp.key in the archive (outside git, outside the sandbox). */
function openaiKey() {
  const file = join(ARCHIVE, 'openai-temp.key');
  const value = process.env.OPENAI_API_KEY || (existsSync(file) ? readFileSync(file, 'utf8').trim() : '');
  if (!value) throw new Error('OPENAI_API_KEY is not set and the archive has no openai-temp.key.');
  return value;
}

/** The key of the agent model's provider, as pi wants it: { name: the environment variable, value }. Never printed.
 */
export function agentKey() {
  if (!MODEL.startsWith('openai/')) return { name: 'META_API_KEY', value: metaKey() };
  return { name: 'OPENAI_API_KEY', value: openaiKey() };
}

/** META_API_KEY from the environment, or from the nearest .env above the trial (the main checkout's). Never printed. */
export function metaKey() {
  if (process.env.META_API_KEY) return process.env.META_API_KEY;
  for (let dir = TRIAL; dir !== dirname(dir); dir = dirname(dir)) {
    const file = join(dir, '.env');
    if (!existsSync(file)) continue;
    const line = readFileSync(file, 'utf8').split('\n').find((l) => /^\s*META_API_KEY\s*=/.test(l));
    if (line) return line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
  }
  throw new Error('META_API_KEY is not set and no .env above the trial has it.');
}
