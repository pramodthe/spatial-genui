import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from './agent.js';
import { extractJson } from './a2ui/catalog.js';
import { recordSpend } from './guard.js';
import { complete, defaultTarget, type LlmTarget } from './llm.js';
import { loadModel } from './models.js';

/**
 * Saved courses. A learner asks for a subject; a fast model plans a short course, and the lessons are then
 * written in the background and kept on disk, so the learner can leave and come back to a ready course.
 * Lessons are written just in time: the first at once, each next one when the one before it is opened
 * (COURSE_BUILD_ALL=1 writes the whole course straight away). One lesson is written at a time.
 */

export type LessonState = 'pending' | 'generating' | 'ready' | 'failed';

export type CourseLesson = {
  title: string;
  /** 'quiz': a grab-and-drop check of the lessons before it. */
  kind?: 'explore' | 'quiz';
  /** What the learner can do after it, one sentence. */
  objective: string;
  /** The request the lesson agent gets. */
  prompt: string;
  status: LessonState;
  error?: string;
  code?: string;
  model?: string;
  seconds?: number;
  generatedAt?: string;
};

export type Course = {
  id: string;
  /** What the learner asked for. */
  request: string;
  title: string;
  subtitle: string;
  status: 'planning' | 'building' | 'ready' | 'failed';
  error?: string;
  createdAt: string;
  lessons: CourseLesson[];
};

const COURSES_DIR = process.env.COURSES_DIR || fileURLToPath(new URL('../../../data/courses/', import.meta.url));
const BUILD_ALL = process.env.COURSE_BUILD_ALL === '1';
const MAX_COURSES = 200;

const PLANNER_PROMPT = `You plan a short hands-on course for a mixed-reality headset. Each lesson is one interactive 3D scene on the learner's desk: a detailed model they can pick up, turn and take apart, with one small panel of text and buttons. A lesson has no video, no long reading and no typing.

Plan 3 to 4 lessons for the learner's request:
- One idea or mechanism per lesson, ordered so each builds on the one before. The first lesson shows the whole thing and names its main parts.
- Every lesson must be something to SEE and HANDLE in 3D: a structure with parts, a process shown step by step, a cause and its effect the learner can change with a button or by moving something. No lesson that is only facts on a panel.
- The LAST lesson is a hands-on check of the lessons before it: the learner picks up name cards and drops each one on the part of the model it names (4 to 6 cards). Give it "kind": "quiz"; every other lesson has "kind": "explore". Its prompt names the model to show and the parts to match.
- "prompt" is the full request for the agent that builds that lesson. It knows nothing else, so name the subject, what the 3D model must show, and what the learner does with it (2 to 3 sentences).

Reply with only this JSON:
{"title": "2 to 5 words", "subtitle": "one short line", "lessons": [{"title": "2 to 4 words", "objective": "After this you can ...", "kind": "explore", "prompt": "..."}]}`;

const QUIZ_NOTE = 'Build this lesson as a grab-and-drop matching quiz with kit.matchQuiz: the detailed model stands still on its stand, the name cards wait in a row in front of it, and one panel shows the score, the last result and a "Start over" button.';

const courses = new Map<string, Course>();
let loaded = false;

function load() {
  if (loaded) return;
  loaded = true;
  mkdirSync(COURSES_DIR, { recursive: true });
  for (const file of readdirSync(COURSES_DIR)) {
    if (!file.endsWith('.json')) continue;
    try {
      const course = JSON.parse(readFileSync(join(COURSES_DIR, file), 'utf8')) as Course;
      // Work a restart interrupted goes back in the queue (lessons) or is given up (a plan that never arrived).
      for (const lesson of course.lessons) if (lesson.status === 'generating') lesson.status = 'pending';
      if (course.status === 'planning') Object.assign(course, { status: 'failed', error: 'The server restarted while planning.' });
      courses.set(course.id, course);
    } catch (err) {
      console.warn(`Skipping unreadable course file ${file}: ${(err as Error).message}`);
    }
  }
}

function save(course: Course) {
  return writeFile(join(COURSES_DIR, `${course.id}.json`), JSON.stringify(course, null, 1));
}

/** A course without its lessons' code, for lists and status polling. */
export function summary(course: Course) {
  return { ...course, lessons: course.lessons.map(({ code: _code, prompt: _prompt, ...rest }) => rest) };
}

export function listCourses() {
  load();
  return [...courses.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(summary);
}

export function getCourse(id: string): Course | undefined {
  load();
  return courses.get(id);
}

let planner: Promise<LlmTarget> | null = null;
function plannerTarget(): Promise<LlmTarget> {
  planner ??= loadModel(process.env.COURSE_PLANNER || 'claude-haiku-5-5').catch((err) => {
    console.warn(`Course planner unavailable (${(err as Error).message}); the main model plans.`);
    return defaultTarget;
  });
  return planner;
}

/** Start a course: returns at once with status 'planning'; the plan and the first lesson follow in the background. */
export function startCourse(request: string): Course {
  load();
  if (courses.size >= MAX_COURSES) throw new Error('The course shelf is full.');
  const course: Course = {
    id: randomUUID().slice(0, 8), request, title: request.length > 40 ? `${request.slice(0, 37)}...` : request, subtitle: 'Planning the course...',
    status: 'planning', createdAt: new Date().toISOString(), lessons: [],
  };
  courses.set(course.id, course);
  void plan(course);
  return course;
}

async function plan(course: Course) {
  try {
    const target = await plannerTarget();
    const reply = await complete([{ role: 'system', content: PLANNER_PROMPT }, { role: 'user', content: course.request }], target);
    await recordSpend([{ model: target.id, promptTokens: reply.promptTokens, completionTokens: reply.completionTokens }]);
    const outline = extractJson(reply.text) as { title?: unknown; subtitle?: unknown; lessons?: unknown } | null;
    const lessons = (Array.isArray(outline?.lessons) ? outline.lessons : [])
      .filter((l): l is { title: string; objective?: unknown; kind?: unknown; prompt: string } => typeof l?.title === 'string' && typeof l?.prompt === 'string' && l.prompt.trim().length > 0)
      .slice(0, 5);
    if (lessons.length < 2) throw new Error('The planner returned no usable outline.');
    course.title = typeof outline?.title === 'string' && outline.title.trim() ? outline.title.trim().slice(0, 60) : course.title;
    course.subtitle = typeof outline?.subtitle === 'string' ? outline.subtitle.trim().slice(0, 120) : '';
    course.lessons = lessons.map((l, i) => ({
      title: l.title.trim().slice(0, 60),
      objective: typeof l.objective === 'string' ? l.objective.trim().slice(0, 200) : '',
      // The builder sees one lesson at a time: tell it where the lesson sits, so lessons don't repeat each other.
      kind: l.kind === 'quiz' ? 'quiz' as const : 'explore' as const,
      prompt: `${l.prompt.trim().slice(0, 1200)}${l.kind === 'quiz' ? `\n${QUIZ_NOTE}` : ''}\n(This is lesson ${i + 1} of ${lessons.length} in the course "${course.title}": ${lessons.map((x) => x.title).join(', ')}. Cover only this lesson's idea.)`,
      status: 'pending',
    }));
    course.status = 'building';
    await save(course);
    queue(course, 0);
    if (BUILD_ALL) for (let i = 1; i < course.lessons.length; i++) queue(course, i);
  } catch (err) {
    Object.assign(course, { status: 'failed', error: (err as Error).message, subtitle: '' });
    await save(course);
  }
}

// One lesson is written at a time, whatever the number of courses: lessons are long, costly model calls.
let working: Promise<void> = Promise.resolve();

/** Put a lesson in the build queue (no effect unless it is pending, or failed and asked for again). */
export function queue(course: Course, index: number, retry = false) {
  const lesson = course.lessons[index];
  if (!lesson || !(lesson.status === 'pending' || (retry && lesson.status === 'failed'))) return;
  lesson.status = 'generating';
  delete lesson.error;
  working = working.then(() => build(course, lesson)).catch((err) => console.error(err));
}

async function build(course: Course, lesson: CourseLesson) {
  const started = Date.now();
  try {
    const result = await generate(lesson.prompt, { onDemand: false });
    await recordSpend(result.attempts.map((a) => ({ model: result.model, promptTokens: a.promptTokens, completionTokens: a.completionTokens })));
    if (!result.ok || !result.code) throw new Error(result.error ?? 'The lesson could not be written.');
    Object.assign(lesson, { status: 'ready', code: result.code, model: result.model, generatedAt: new Date().toISOString() });
  } catch (err) {
    Object.assign(lesson, { status: 'failed', error: (err as Error).message.slice(0, 300) });
  }
  lesson.seconds = Math.round((Date.now() - started) / 1000);
  if (course.lessons.every((l) => l.status === 'ready')) course.status = 'ready';
  await save(course);
}

/**
 * A lesson as the headset opens it. Opening a ready lesson starts the next one, so it is there when the
 * learner gets to it; opening one that isn't written yet starts it.
 */
export function openLesson(course: Course, index: number): CourseLesson | undefined {
  const lesson = course.lessons[index];
  if (!lesson) return undefined;
  queue(course, index, true);
  if (lesson.status === 'ready') queue(course, index + 1);
  return lesson;
}
