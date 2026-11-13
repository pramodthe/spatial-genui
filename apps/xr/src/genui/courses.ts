/**
 * Saved courses (the server's courses.ts): a course is planned at once and its lessons are written in the
 * background, so a learner can ask, leave, and come back to a ready course on the picker's shelf.
 */

export type CourseLessonSummary = { title: string; objective: string; status: 'pending' | 'generating' | 'ready' | 'failed'; error?: string; seconds?: number };
export type CourseSummary = {
  id: string;
  title: string;
  subtitle: string;
  status: 'planning' | 'building' | 'ready' | 'failed';
  error?: string;
  lessons: CourseLessonSummary[];
};
export type CourseLesson = CourseLessonSummary & { prompt: string; code?: string };

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

/** A lesson with its code when it is ready. Asking for one that isn't written yet starts it. */
export async function fetchCourseLesson(courseId: string, index: number): Promise<CourseLesson> {
  const res = await fetch(`/api/courses/${courseId}/lessons/${index}`);
  if (!res.ok) throw new Error(res.statusText || `HTTP ${res.status}`);
  return (await res.json()) as CourseLesson;
}

/** One line on what a course is doing, for its row on the shelf. */
export function courseProgress(course: CourseSummary): string {
  if (course.status === 'planning') return 'Planning...';
  if (course.status === 'failed') return 'Could not be planned';
  const ready = course.lessons.filter((l) => l.status === 'ready').length;
  const writing = course.lessons.findIndex((l) => l.status === 'generating');
  if (writing >= 0) return `Writing lesson ${writing + 1} of ${course.lessons.length}...`;
  return `${ready} of ${course.lessons.length} lessons ready`;
}
