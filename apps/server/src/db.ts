import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type { Course, CourseLesson, CourseModel } from './courses.js';

/**
 * The app's database: saved courses, their lessons, and an index of the 3D models made for them. One
 * SQLite file (data/app.db, or APP_DB), so there is no service to run; the model files themselves stay
 * in the asset library (library.ts), which this indexes by the name a course asked for.
 */

const DB_PATH = process.env.APP_DB || fileURLToPath(new URL('../../../data/app.db', import.meta.url));

const SCHEMA = `
CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  request TEXT NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  model TEXT                       -- the course's own 3D model and its build state (JSON), or NULL
);
CREATE TABLE IF NOT EXISTS lessons (
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  title TEXT NOT NULL,
  kind TEXT,                       -- unused: there was a time lessons had kinds (kept so existing databases load)
  objective TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  code TEXT,
  model TEXT,                      -- the language model that wrote it
  seconds INTEGER,
  generated_at TEXT,
  polish TEXT,
  first_code TEXT,
  critique TEXT,
  PRIMARY KEY (course_id, idx)
);
CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,             -- the asset's id in the library
  name TEXT NOT NULL,              -- the name a course asked for, lower case
  describe TEXT NOT NULL DEFAULT '',
  parts TEXT NOT NULL DEFAULT '[]',
  seconds INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS models_name ON models(name);
`;

let db: DatabaseSync | null = null;

function open(): DatabaseSync {
  if (db) return db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

type CourseRow = { id: string; request: string; title: string; subtitle: string; status: Course['status']; error: string | null; created_at: string; model: string | null };
type LessonRow = {
  course_id: string; idx: number; title: string; objective: string; prompt: string; status: CourseLesson['status']; error: string | null;
  code: string | null; model: string | null; seconds: number | null; generated_at: string | null; polish: CourseLesson['polish'] | null; first_code: string | null; critique: string | null;
};

/** Leave out what is not set, so a course read back looks like the one that was saved. */
function set<T extends object>(values: { [K in keyof T]?: T[K] | null }): Partial<T> {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null && v !== undefined)) as Partial<T>;
}

export function loadCourses(): Course[] {
  const d = open();
  const lessons = new Map<string, CourseLesson[]>();
  for (const row of d.prepare('SELECT * FROM lessons ORDER BY course_id, idx').all() as LessonRow[]) {
    const list = lessons.get(row.course_id) ?? [];
    lessons.set(row.course_id, list);
    list.push({
      title: row.title, objective: row.objective, prompt: row.prompt, status: row.status,
      ...set<CourseLesson>({ error: row.error, code: row.code, model: row.model, seconds: row.seconds, generatedAt: row.generated_at, polish: row.polish, firstCode: row.first_code, critique: row.critique }),
    });
  }
  return (d.prepare('SELECT * FROM courses').all() as CourseRow[]).map((row) => ({
    id: row.id, request: row.request, title: row.title, subtitle: row.subtitle, status: row.status, createdAt: row.created_at,
    ...set<Course>({ error: row.error, model: row.model ? (JSON.parse(row.model) as CourseModel) : null }),
    lessons: lessons.get(row.id) ?? [],
  }));
}

/** Write a course and its lessons as they are now (all or nothing). */
export function saveCourse(course: Course) {
  const d = open();
  d.exec('BEGIN');
  try {
    d.prepare(`INSERT INTO courses (id, request, title, subtitle, status, error, created_at, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET request = excluded.request, title = excluded.title, subtitle = excluded.subtitle, status = excluded.status, error = excluded.error, model = excluded.model`)
      .run(course.id, course.request, course.title, course.subtitle, course.status, course.error ?? null, course.createdAt, course.model ? JSON.stringify(course.model) : null);
    d.prepare('DELETE FROM lessons WHERE course_id = ?').run(course.id);
    const insert = d.prepare(`INSERT INTO lessons (course_id, idx, title, kind, objective, prompt, status, error, code, model, seconds, generated_at, polish, first_code, critique)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    course.lessons.forEach((l, i) => insert.run(course.id, i, l.title, null, l.objective, l.prompt, l.status, l.error ?? null, l.code ?? null, l.model ?? null,
      l.seconds ?? null, l.generatedAt ?? null, l.polish ?? null, l.firstCode ?? null, l.critique ?? null));
    d.exec('COMMIT');
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
}

export function countCourses(): number {
  return (open().prepare('SELECT COUNT(*) AS n FROM courses').get() as { n: number }).n;
}

export type SavedModel = { id: string; name: string; describe: string; parts: string[]; seconds: number | null; createdAt: string };

/** Record a model made for a course, so the next course about the same thing uses it instead of making another. */
export function saveModel(model: { id: string; name: string; describe: string; parts: string[]; seconds?: number }) {
  open().prepare(`INSERT INTO models (id, name, describe, parts, seconds, created_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, describe = excluded.describe, parts = excluded.parts, seconds = COALESCE(excluded.seconds, seconds)`)
    .run(model.id, model.name.toLowerCase(), model.describe, JSON.stringify(model.parts), model.seconds ?? null, new Date().toISOString());
}

type ModelRow = { id: string; name: string; describe: string; parts: string; seconds: number | null; created_at: string };
const toModel = (row: ModelRow): SavedModel => ({ id: row.id, name: row.name, describe: row.describe, parts: JSON.parse(row.parts) as string[], seconds: row.seconds, createdAt: row.created_at });

export function savedModels(): SavedModel[] {
  return (open().prepare('SELECT * FROM models ORDER BY created_at').all() as ModelRow[]).map(toModel);
}
