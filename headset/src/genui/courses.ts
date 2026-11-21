/**
 * Saved courses (the server's courses.ts): a course is planned at once and its lessons are written in the
 * background, so a learner can ask, leave, and come back to a ready course on the picker's shelf.
 */

/** A lesson or game being written right now: its live preview (GET /api/live/<key>) and one line on it. */
/** While it is being made: one line on it, and (from services/live.py) its stage, its step (0-3: plan, build, try it out, check) and the seconds so far. */
export type LiveSummary = { key: string; line: string; seq: number; stage?: string; step?: number; seconds?: number };
/**
 * A level the pi runner built (`builder: 'pi'`, with the server's GAME_MODE=pi) is a page of its own at `url`, opened as a
 * pi game is; `fixing` while Muse fixes what a player said is wrong on it, and `note` what Muse said it changed.
 */
export type CourseLessonSummary = {
  title: string; objective: string; status: 'pending' | 'generating' | 'ready' | 'failed'; error?: string; seconds?: number; live?: LiveSummary;
  picture?: boolean; builder?: 'pi'; url?: string; fixing?: string; fixes?: number; note?: string;
};
export type CourseSummary = {
  id: string;
  /** Its levels are built by the pi runner. */
  builder?: 'pi';
  title: string;
  subtitle: string;
  status: 'planning' | 'building' | 'ready' | 'failed';
  error?: string;
  lessons: CourseLessonSummary[];
};
export type CourseLesson = CourseLessonSummary & { prompt: string; code?: string; polish?: 'running' | 'done' | 'kept' | 'failed' };

export async function listCourses(): Promise<CourseSummary[]> {
  const res = await fetch('/api/courses');
  if (!res.ok) throw new Error(res.statusText || `HTTP ${res.status}`);
  return ((await res.json()) as { courses: CourseSummary[] }).courses;
}

export async function createCourse(prompt: string): Promise<CourseSummary> {
  const res = await fetch('/api/courses', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data as CourseSummary;
}

/** One course as the shelf has it (no code; asking starts nothing). */
export async function fetchCourse(id: string): Promise<CourseSummary> {
  const res = await fetch(`/api/courses/${id}`);
  if (!res.ok) throw new Error(res.statusText || `HTTP ${res.status}`);
  return (await res.json()) as CourseSummary;
}

/** A lesson with its code when it is ready. Asking for one that isn't written yet starts it. */
export async function fetchCourseLesson(courseId: string, index: number): Promise<CourseLesson> {
  const res = await fetch(`/api/courses/${courseId}/lessons/${index}`);
  if (!res.ok) throw new Error(res.statusText || `HTTP ${res.status}`);
  return (await res.json()) as CourseLesson;
}

/**
 * Look-and-fix: send pictures of a lesson as it rendered here. The server's agent revises the lesson once
 * from what it sees; the revision is what opens next time.
 */
export async function polishCourseLesson(courseId: string, index: number, pictures: string[]): Promise<void> {
  await fetch(`/api/courses/${courseId}/lessons/${index}/polish`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pictures }) });
}
