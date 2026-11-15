import { randomUUID } from 'node:crypto';
import { generate } from './agent.js';
import { loadGames, saveGame } from './db.js';
import { recordSpend } from './guard.js';

/**
 * Play: saved games. A player asks for a game; the agent writes it in the background with the game prompt
 * (one module, no course plan) and it is kept in the database (db.ts), so the player can leave and come back
 * to it on the Games shelf. One game is written at a time, apart from the course lessons' queue.
 */

export type Game = {
  id: string;
  /** What the player asked for. */
  request: string;
  /** The game's own name, from the title on its panel once written. */
  title: string;
  status: 'writing' | 'ready' | 'failed';
  error?: string;
  code?: string;
  model?: string;
  seconds?: number;
  createdAt: string;
};

const MAX_GAMES = 200;
const games = new Map<string, Game>();
let loaded = false;

function load() {
  if (loaded) return;
  loaded = true;
  for (const game of loadGames()) {
    games.set(game.id, game);
    // A restart interrupted it: write it again.
    if (game.status === 'writing') queue(game);
  }
}

/** A game without its code, for lists and status polling. */
export function gameSummary({ code: _code, ...rest }: Game) {
  return rest;
}

export function listGames() {
  load();
  return [...games.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(gameSummary);
}

export function getGame(id: string): Game | undefined {
  load();
  return games.get(id);
}

/** Start a game: returns at once with status 'writing'; the code follows in the background. */
export function startGame(request: string): Game {
  load();
  if (games.size >= MAX_GAMES) throw new Error('The games shelf is full.');
  const game: Game = {
    id: randomUUID().slice(0, 8), request, title: request.length > 40 ? `${request.slice(0, 37)}...` : request,
    status: 'writing', createdAt: new Date().toISOString(),
  };
  games.set(game.id, game);
  saveGame(game);
  queue(game);
  return game;
}

/** Ask again for a game that failed. */
export function retryGame(game: Game): boolean {
  if (game.status !== 'failed') return false;
  Object.assign(game, { status: 'writing' });
  delete game.error;
  saveGame(game);
  queue(game);
  return true;
}

let working: Promise<void> = Promise.resolve();

function queue(game: Game) {
  working = working.then(() => write(game)).catch((err) => console.error(err));
}

async function write(game: Game) {
  const started = Date.now();
  try {
    const result = await generate(game.request, { kind: 'game' });
    await recordSpend(result.attempts.map((a) => ({ model: result.model, promptTokens: a.promptTokens, completionTokens: a.completionTokens })));
    if (!result.ok || !result.code) throw new Error(result.error ?? 'The game could not be written.');
    Object.assign(game, { status: 'ready', code: result.code, model: result.model, title: panelTitle(result.code) ?? game.title });
  } catch (err) {
    Object.assign(game, { status: 'failed', error: (err as Error).message.slice(0, 300) });
  }
  game.seconds = Math.round((Date.now() - started) / 1000);
  saveGame(game);
}

/** The title the agent gave the game's panel (kit.panel(ui, { ..., title: 'Voxel Siege' })), if it is plain. */
function panelTitle(code: string): string | undefined {
  const title = code.match(/kit\.panel\(\s*ui\s*,\s*\{[\s\S]{0,600}?\btitle:\s*(['"`])([^'"`\n]{2,40})\1/)?.[2]?.trim();
  return title && /^[\x20-\x7e]+$/.test(title) ? title : undefined;
}
