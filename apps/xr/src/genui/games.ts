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
};
export type Game = GameSummary & { code?: string };

/**
 * Example games, offered as tiles in the Play section: four learning games written by the app's pipeline (design,
 * planning pictures, the coder, the gate) and played on a Quest 3. `saved` names the ready-made module in
 * public/games/<saved>.json, so a tile opens at once.
 */
export const EXAMPLE_GAMES = [
  { title: 'Doodle Distance', sub: 'Fold a plane that flies far', saved: 'paper-plane' },
  { title: 'Fernbank Dam', sub: 'Deep water pushes harder', saved: 'river-dam' },
  { title: 'Windwoven Heights', sub: 'Tilt a kite into the wind', saved: 'kite-hill' },
  { title: 'Grain by Grain', sub: 'Water and grit carve rock', saved: 'desert-canyon' },
] as const;

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

/** A game with its code when it is ready. Asking for one that failed writes it again. */
export async function fetchGame(id: string): Promise<Game> {
  const res = await fetch(`/api/games/${id}`);
  if (!res.ok) throw new Error(res.statusText || `HTTP ${res.status}`);
  return (await res.json()) as Game;
}

/** One line on a game's state, for its row on the shelf. */
export function gameProgress(game: GameSummary): string {
  if (game.status === 'writing') return game.live ? `${game.live.line}: pinch to watch` : 'Writing the game...';
  if (game.status === 'failed') return 'Failed: tap to try again';
  return 'Ready: tap to play';
}

/** The section the learner is in: Learn (courses) or Play (games). Shared by the start page and the picker. */
export type Section = 'learn' | 'play';
const SECTION_KEY = 'genui.section.v1';
let section: Section = readSection();
const sectionListeners = new Set<(section: Section) => void>();

function readSection(): Section {
  try {
    return localStorage.getItem(SECTION_KEY) === 'play' ? 'play' : 'learn';
  } catch {
    return 'learn';
  }
}

export function currentSection(): Section {
  return section;
}

export function setSection(next: Section) {
  if (next === section) return;
  section = next;
  try {
    localStorage.setItem(SECTION_KEY, next);
  } catch {
    // Not remembered (private window): it still switches.
  }
  for (const listener of sectionListeners) listener(next);
}

/** Follow the section; the listener gets the current one at once. Returns an unsubscribe. */
export function onSection(listener: (section: Section) => void): () => void {
  sectionListeners.add(listener);
  listener(section);
  return () => sectionListeners.delete(listener);
}
