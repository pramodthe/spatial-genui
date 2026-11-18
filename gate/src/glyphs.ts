// Characters IWSDK panels can display: UIKit's default font (Inter, @pmndrs/msdfonts) ships a
// 104-glyph atlas, the same in every weight. Anything else renders as an empty box.
const EXTRA = '§°ÄÖÜßäöü';
const SUPPORTED = new Set([...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)), ...EXTRA, '\n', '\r', '\t']);

/** Plain-text stand-ins for characters models commonly use in UI copy. */
export const REPLACEMENTS: Record<string, string> = {
  '–': '-', '—': '-', '−': '-', '‐': '-', '‑': '-',
  '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...', '·': '-', '•': '-', '×': 'x', '÷': '/',
  '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '≈': '~', '≤': '<=', '≥': '>=', '±': '+/-', '≠': '!=',
  '²': '^2', '³': '^3', '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6',
  'µ': 'u', 'é': 'e', 'è': 'e', 'á': 'a', 'í': 'i', 'ó': 'o', 'ñ': 'n', 'ç': 'c', '€': 'EUR ', '£': 'GBP ',
  ' ': ' ', ' ': ' ', ' ': ' ',
};

/** Unsupported characters in `text`, each with a suggested replacement ('' means remove it). */
export function unsupportedGlyphs(text: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const ch of text) {
    if (!SUPPORTED.has(ch) && !found.has(ch)) found.set(ch, REPLACEMENTS[ch] ?? '');
  }
  return found;
}
