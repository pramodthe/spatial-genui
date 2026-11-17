"""Panel-font glyphs. Same set and replacements as apps/gate/src/glyphs.ts."""

from __future__ import annotations

EXTRA = "§°ÄÖÜßäöü"
SUPPORTED = {chr(32 + i) for i in range(95)} | set(EXTRA) | {"\n", "\r", "\t"}

REPLACEMENTS: dict[str, str] = {
    "–": "-", "—": "-", "−": "-", "‐": "-", "‑": "-",
    "‘": "'", "’": "'", "“": '"', "”": '"', "…": "...", "·": "-", "•": "-", "×": "x", "÷": "/",
    "→": "->", "←": "<-", "↔": "<->", "⇒": "=>", "≈": "~", "≤": "<=", "≥": ">=", "±": "+/-", "≠": "!=",
    "²": "^2", "³": "^3", "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6",
    "µ": "u", "é": "e", "è": "e", "á": "a", "í": "i", "ó": "o", "ñ": "n", "ç": "c", "€": "EUR ", "£": "GBP ",
    "\u00a0": " ", "\u2009": " ", "\u202f": " ",
}


def unsupported_glyphs(text: str) -> dict[str, str]:
    found: dict[str, str] = {}
    for ch in text:
        if ch not in SUPPORTED and ch not in found:
            found[ch] = REPLACEMENTS.get(ch, "")
    return found
