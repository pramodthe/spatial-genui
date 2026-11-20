import type { LiveSummary } from './courses';

/**
 * Play: saved games (the server's games.ts). A request becomes one game, written in the background and kept
 * on the Games shelf; the start page and the in-headset picker show it in their Play section.
 */

export type GameSummary = {
  id: string;
  request: string;
  title: string;
  status: 'writing' | 'ready' | 'failed';
  error?: string;
  seconds?: number;
  createdAt: string;
  /** While it is being written: its live preview and one line on it. */
  live?: LiveSummary;
  /** Its card picture exists (GET /api/games/<id>/picture): the game as it opens. */
  picture?: boolean;
  /** Built by the pi runner (the server's GAME_MODE=pi): a page of its own at this address, not a module. */
  url?: string;
  builder?: 'pi';
};
export type Game = GameSummary & { code?: string };

/**
 * Example games, offered as tiles in the Play section: four games written by the app's pipeline (design,
 * planning pictures, the coder, the gate) and played on a Quest 3. `saved` names the ready-made module in
 * public/games/<saved>.json, so a tile opens at once.
 */
export const EXAMPLE_GAMES = [
  { title: 'Paper dart', sub: 'Fold a plane that flies far', saved: 'paper-plane' },
  { title: 'Fernbank Dam', sub: 'Deep water pushes harder', saved: 'river-dam' },
  { title: 'Windwoven Heights', sub: 'Tilt a kite into the wind', saved: 'kite-hill' },
  { title: 'Tiny Rex Run', sub: 'Pinch to jump the cacti', saved: 'dino-runner' },
] as const;

/**
 * Showcase games, offered as tiles after the examples: games built as full pages of their own by the pi runner
 * (trial/pi-xr). Their built files are not in git: the server serves each from its SHOWCASE_DIR at
 * /api/showcase/<page>/ (showcaseUrl), and public/games/<page>.jpg is its tile's picture.
 */
export const SHOWCASE_GAMES = [
  { title: 'Bramble Crossing', sub: 'Build a path home for a fox', page: 'bramble-crossing' },
  { title: 'Atelier Solaire', sub: 'Paint a canvas with your hands', page: 'atelier-solaire' },
  { title: 'Pixie Dust', sub: 'A superpower in your hands', page: 'pixie-dust' },
] as const;

export function showcaseUrl(page: string): string {
  return `/api/showcase/${page}/`;
}

/** A ready-made game file (public/games/<id>.json). */
export type SavedGame = { id: string; title: string; request: string; model: string; generatedAt: string; code: string };

export async function loadExampleGame(saved: string): Promise<SavedGame> {
  const res = await fetch(`${import.meta.env.BASE_URL}games/${saved}.json`);
  if (!res.ok) throw new Error(res.statusText || `HTTP ${res.status}`);
  return (await res.json()) as SavedGame;
}

export async function listGames(): Promise<GameSummary[]> {
  const res = await fetch('/api/games');
  if (!res.ok) throw new Error(res.statusText || `HTTP ${res.status}`);
  return ((await res.json()) as { games: GameSummary[] }).games;
}

export async function createGame(prompt: string): Promise<GameSummary> {
  const res = await fetch('/api/games', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data as GameSummary;
}

/** Leave the Lab for a game that is a page of its own; its page has a way back, and a box to tell Muse what to fix. */
export function openGamePage(url: string): void {
  window.location.assign(url);
}

/** A game with its code when it is ready. Asking for one that failed writes it again (not a pi-built one). */
export async function fetchGame(id: string): Promise<Game> {
  const res = await fetch(`/api/games/${id}`);
  if (!res.ok) throw new Error(res.statusText || `HTTP ${res.status}`);
  return (await res.json()) as Game;
}
