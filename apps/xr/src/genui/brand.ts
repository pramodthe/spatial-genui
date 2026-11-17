/**
 * The app's name, its mascot and its colours, in one place: the start page, the headset dashboard and the title
 * card all read them here. Muse, the mascot, is also the voice tutor (voice-agent.ts).
 */
export const APP_NAME = "Muse's Lab";
export const MASCOT_NAME = 'Muse';
export const TAGLINE = 'Ask Muse anything. Learn it with your hands.';

/**
 * For players about 9 to 12: a light sky-blue ground. What sits right on it (Muse, the logo's name) is white with
 * an ink outline, and text on it is ink, so nothing is blue on blue. White cards with ink outlines, yellow buttons.
 * In the headset there is no ground at all: the room shows through.
 */
export const COLORS = {
  sky: '#b5e2ff',
  muse: '#ffffff',
  museShade: '#cfe4f6',
  ink: '#12063b',
  paper: '#ffffff',
  sun: '#ffd60a',
  green: '#19e36b',
  pink: '#ff4fa3',
  orange: '#ff8a00',
  aqua: '#14d9f5',
} as const;

/** The colours cards take in turn (a card's frame and its picture's stand-in). */
export const CARD_COLORS = [COLORS.green, COLORS.pink, COLORS.orange, COLORS.aqua] as const;
