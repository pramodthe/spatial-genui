/**
 * Example lessons, offered as cards in the headset picker and as one-tap buttons in the desktop prompt box.
 * `saved` names a ready-made version in public/lessons/<saved>.json (generated and checked in advance), so a
 * card opens at once; "Make a new one" then writes a fresh version live.
 */
export const EXAMPLE_LESSONS = [
  { title: 'Heart', sub: 'How blood flows, step by step', prompt: 'Show me how blood flows through the heart, step by step.', saved: 'heart' },
  { title: 'Microscope', sub: 'Its parts and what they do', prompt: 'Teach me the parts of a microscope and what each part does.', saved: 'microscope' },
  { title: 'Gears', sub: 'Speed and turning force', prompt: 'Teach me how two gears change speed and turning force.', saved: 'gears' },
  { title: 'Flower', sub: 'Its parts and what they do', prompt: 'Teach me the parts of a flower and what each part does.', saved: 'flower' },
] as const;

/** A ready-made lesson file (public/lessons/<id>.json). */
export type SavedLesson = { id: string; prompt: string; model: string; generatedAt: string; code: string };
