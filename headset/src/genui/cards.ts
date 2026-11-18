import type { CourseSummary, LiveSummary } from './courses';
import { EXAMPLE_GAMES, type GameSummary } from './games';
import { EXAMPLE_LESSONS } from './lessons';

/**
 * The cards the start page and the headset dashboard both show: one card per thing to play. The player's own
 * games and courses (those being made first; a course is a folder holding its levels), and the ready-made games and
 * lessons. A card names what it opens (`source`); each screen opens it its own way.
 */

export type CardState = 'ready' | 'making' | 'todo' | 'failed';
/** A card being made: how full its picture is (0 to 1), what its tag says, and which of the four steps it is on. */
export type Making = { fill: number; left: string; step: number };
export type CardSource =
  | { kind: 'game'; id: string }
  | { kind: 'level'; courseId: string; index: number }
  | { kind: 'course'; id: string }
  | { kind: 'example-game'; index: number }
  | { kind: 'example-lesson'; index: number };
export type Card = {
  key: string;
  title: string;
  /** One line under the name: what it teaches, or what is happening to it. */
  sub: string;
  state: CardState;
  /** A picture of the game as it opens, when there is one. */
  picture?: string;
  /** Shown on a colour when there is no picture: the name's first letter, or a level's number. */
  mark: string;
  /** While it is being made. */
  making?: Making;
  source: CardSource;
};

const first = (title: string) => title.trim().charAt(0).toUpperCase() || '?';

// A game or a level takes about 15 minutes (the start page tells the player so). Its picture fills with the card's
// colour by the time so far, kept within its step's share, so the fill and the step agree; a full picture is the
// finished card. The steps follow services/live.py: plan, build, try it out, check.
const EXPECTED_S = 15 * 60;
const STEP_FILL = [[0.04, 0.12], [0.12, 0.8], [0.3, 0.9], [0.85, 0.97]] as const;
const STEP_TEXT = ['planning it', 'building it', 'trying it out', 'checking it'] as const;

/** How far along a card being made is, from what the server says (or, with nothing yet, from when it was asked for). */
export function makingOf(live: LiveSummary | undefined, askedAt?: string, now = Date.now()): Making {
  const seconds = live?.seconds ?? (askedAt ? Math.max(0, (now - Date.parse(askedAt)) / 1000) : 0);
  const step = Math.min(3, Math.max(0, Math.round(live?.step ?? 0)));
  const [low, high] = STEP_FILL[step];
  const remaining = EXPECTED_S - seconds;
  const left = live?.stage === 'fixing' ? 'Fixing a problem'
    : remaining < -60 ? 'Taking a bit longer'
    : step === 3 || remaining < 90 ? 'Almost ready'
    : `About ${Math.round(remaining / 60)} min left`;
  return { fill: Math.min(high, Math.max(low, seconds / EXPECTED_S)), left, step };
}

/** The line under a card being made: its step, in words. */
const stepLine = (making: Making, live?: LiveSummary) =>
  `Step ${making.step + 1} of 4: ${live?.stage === 'fixing' ? 'fixing a problem' : STEP_TEXT[making.step]}`;

/**
 * The player's own games and courses. A course is one card, a folder: `folder` (a course's id) lists that course's
 * levels instead (each screen shows its own way back). `verb` is how this screen picks a card: 'Tap' or 'Pinch'.
 */
export function myCards(games: GameSummary[], courses: CourseSummary[], verb: 'Tap' | 'Pinch', folder: string | null = null): Card[] {
  const again = `Didn't work: ${verb.toLowerCase()} to try again`;
  const open = folder === null ? undefined : courses.find((course) => course.id === folder && course.lessons.length > 0);
  if (open) return levelCards(open, verb, again);
  const cards: Card[] = games.map((game) => {
    const making = game.status === 'writing' ? makingOf(game.live, game.createdAt) : undefined;
    return {
      key: `game-${game.id}`,
      title: game.title,
      sub: making ? stepLine(making, game.live) : game.status === 'failed' ? again : `${verb} to play`,
      state: making ? 'making' : game.status === 'failed' ? 'failed' : 'ready',
      picture: game.status === 'ready' && game.picture ? `/api/games/${game.id}/picture` : undefined,
      mark: first(game.title),
      making,
      source: { kind: 'game', id: game.id },
    };
  });
  for (const course of courses) {
    if (course.status === 'planning' || course.status === 'failed' || course.lessons.length === 0) {
      const making = course.status === 'planning' ? makingOf(undefined) : undefined;
      cards.push({
        key: `course-${course.id}`, title: course.title, mark: first(course.title), source: { kind: 'course', id: course.id },
        sub: making ? 'Planning its levels' : "Couldn't plan it",
        state: making ? 'making' : 'failed',
        making,
      });
      continue;
    }
    // The folder: its first level's picture, how many levels are ready, and the level being made, if one is.
    const levels = course.lessons;
    const ready = levels.filter((lesson) => lesson.status === 'ready').length;
    const busy = levels.findIndex((lesson) => lesson.status === 'generating');
    const making = busy >= 0 ? makingOf(levels[busy]!.live) : undefined;
    cards.push({
      key: `course-${course.id}`,
      title: course.title,
      sub: making ? `Making level ${busy + 1}: ${levels[busy]!.live?.stage === 'fixing' ? 'fixing a problem' : STEP_TEXT[making.step]}`
        : `${levels.length} levels${ready < levels.length ? `, ${ready} ready` : ''}`,
      state: making ? 'making' : ready > 0 ? 'ready' : levels.some((lesson) => lesson.status === 'failed') ? 'failed' : 'todo',
      mark: first(course.title),
      making,
      source: { kind: 'course', id: course.id },
    });
  }
  return [...cards.filter((c) => c.state === 'making'), ...cards.filter((c) => c.state !== 'making')];
}

/** The levels of one course, one card each, in order. */
function levelCards(course: CourseSummary, verb: 'Tap' | 'Pinch', again: string): Card[] {
  return course.lessons.map((lesson, index) => {
    const making = lesson.status === 'generating' ? makingOf(lesson.live) : undefined;
    return {
      key: `course-${course.id}-${index}`,
      title: lesson.title,
      sub: lesson.status === 'ready' ? `Level ${index + 1} of ${course.lessons.length}: ${course.title}`
        : making ? stepLine(making, lesson.live)
        : lesson.status === 'failed' ? again : `Not made yet: ${verb.toLowerCase()} to make it`,
      state: lesson.status === 'ready' ? 'ready' : lesson.status === 'generating' ? 'making' : lesson.status === 'failed' ? 'failed' : 'todo',
      picture: lesson.status === 'ready' && lesson.picture ? `/api/courses/${course.id}/lessons/${index}/picture` : undefined,
      mark: String(index + 1),
      making,
      source: { kind: 'level', courseId: course.id, index },
    };
  });
}

/** Is this card a course folder (drawn as a pile of cards)? */
export const isFolder = (card: Card) => card.source.kind === 'course';

/** The ready-made games and lessons: they open at once. `base` is where the app's own files are served from. */
export function readyCards(base: string): Card[] {
  return [
    ...EXAMPLE_GAMES.map((game, index): Card => ({
      key: `example-game-${game.saved}`, title: game.title, sub: game.sub, state: 'ready', mark: first(game.title),
      picture: `${base}games/${game.saved}.jpg`, source: { kind: 'example-game', index },
    })),
    ...EXAMPLE_LESSONS.map((lesson, index): Card => ({
      key: `example-lesson-${lesson.saved}`, title: lesson.title, sub: lesson.sub, state: 'ready', mark: first(lesson.title),
      picture: `${base}lessons/${lesson.saved}.jpg`, source: { kind: 'example-lesson', index },
    })),
  ];
}
