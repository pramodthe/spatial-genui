import type { CourseSummary } from './courses';
import { EXAMPLE_GAMES, type GameSummary } from './games';
import { EXAMPLE_LESSONS } from './lessons';

/**
 * The cards the start page and the headset dashboard both show: one card per thing to play. The player's own
 * games (those being made first), each level of their courses as a card of its own, and the ready-made games and
 * lessons. A card names what it opens (`source`); each screen opens it its own way.
 */

export type CardState = 'ready' | 'making' | 'todo' | 'failed';
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
  source: CardSource;
};

const first = (title: string) => title.trim().charAt(0).toUpperCase() || '?';

/** The player's own games and course levels. `verb` is how this screen picks a card: 'Tap' or 'Pinch'. */
export function myCards(games: GameSummary[], courses: CourseSummary[], verb: 'Tap' | 'Pinch'): Card[] {
  const again = `Didn't work: ${verb.toLowerCase()} to try again`;
  const cards: Card[] = games.map((game) => ({
    key: `game-${game.id}`,
    title: game.title,
    sub: game.status === 'writing' ? (game.live?.line ?? 'Making your game...') : game.status === 'failed' ? again : `${verb} to play`,
    state: game.status === 'writing' ? 'making' : game.status === 'failed' ? 'failed' : 'ready',
    picture: game.status === 'ready' && game.picture ? `/api/games/${game.id}/picture` : undefined,
    mark: first(game.title),
    source: { kind: 'game', id: game.id },
  }));
  for (const course of courses) {
    if (course.status === 'planning' || course.status === 'failed') {
      cards.push({
        key: `course-${course.id}`, title: course.title, mark: first(course.title), source: { kind: 'course', id: course.id },
        sub: course.status === 'planning' ? 'Planning its levels...' : "Couldn't plan it",
        state: course.status === 'planning' ? 'making' : 'failed',
      });
      continue;
    }
    course.lessons.forEach((lesson, index) => {
      cards.push({
        key: `course-${course.id}-${index}`,
        title: lesson.title,
        sub: lesson.status === 'ready' ? `Level ${index + 1} of ${course.lessons.length}: ${course.title}`
          : lesson.status === 'generating' ? (lesson.live?.line ?? 'Making this level...')
          : lesson.status === 'failed' ? again : `Not made yet: ${verb.toLowerCase()} to make it`,
        state: lesson.status === 'ready' ? 'ready' : lesson.status === 'generating' ? 'making' : lesson.status === 'failed' ? 'failed' : 'todo',
        picture: lesson.status === 'ready' && lesson.picture ? `/api/courses/${course.id}/lessons/${index}/picture` : undefined,
        mark: String(index + 1),
        source: { kind: 'level', courseId: course.id, index },
      });
    });
  }
  return [...cards.filter((c) => c.state === 'making'), ...cards.filter((c) => c.state !== 'making')];
}

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
