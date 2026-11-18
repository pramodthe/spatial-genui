import { parse, tokenizer, tokTypes as tt } from 'acorn';
import { extractCode } from './validate.js';

/**
 * Live preview: the part of a module that is still being written which can already run. The code is cut after
 * the last complete statement inside build(), the blocks still open there are closed, and build() returns its
 * root group so far. The result goes through the same gate as a finished module before the headset sees it.
 */

/** The code block of a reply that may still be streaming (its closing fence not written yet). */
export function partialCode(reply: string): string | null {
  const done = extractCode(reply);
  if (done && /```[\s\S]*```/.test(reply)) return done;
  const open = reply.match(/```(?:js|javascript|ts|typescript)?\s*\n([\s\S]*)$/);
  if (open) return open[1];
  return /export\s+default/.test(reply) ? reply : null;
}

type Cut = { at: number; open: number };

/** Places after a `;` or `}` where only `{` blocks are open (no call, array or template mid-way), inside build(). */
function cutPoints(code: string): Cut[] {
  const cuts: Cut[] = [];
  const stack: string[] = [];
  let sawExport = false;
  let bodyDepth = -1;
  try {
    for (const token of tokenizer(code, { ecmaVersion: 'latest', sourceType: 'module' })) {
      const type = token.type;
      if (type === tt._export) sawExport = true;
      if (type === tt.parenL || type === tt.bracketL || type === tt.braceL || type === tt.dollarBraceL) {
        const kind = type === tt.parenL ? '(' : type === tt.bracketL ? '[' : type === tt.dollarBraceL ? '${' : '{';
        if (kind === '{' && sawExport && bodyDepth < 0 && stack.length === 0) bodyDepth = 1;
        stack.push(kind);
      } else if (type === tt.backQuote) {
        if (stack[stack.length - 1] === '`') stack.pop();
        else stack.push('`');
      } else if (type === tt.parenR || type === tt.bracketR || type === tt.braceR) {
        stack.pop();
        if (bodyDepth > 0 && stack.length === 0) break; // build() is complete: nothing to cut
      }
      const ends = type === tt.semi || type === tt.braceR;
      if (ends && bodyDepth > 0 && stack.length >= bodyDepth && stack.every((kind) => kind === '{')) {
        cuts.push({ at: token.end, open: stack.length });
      }
    }
  } catch {
    // The text stops mid-token (a string or comment not closed yet): the cuts found so far stand.
  }
  return cuts;
}

const ROOT = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+THREE\.Group\(\s*\)/;

/**
 * The longest runnable prefix of a module being written, or null when there is none yet. `tries` caps how many
 * cut points are tested from the end (a cut can still fail to parse, e.g. after `}` of an if with an else coming).
 */
export function runnablePrefix(reply: string, tries = 8): string | null {
  const code = partialCode(reply);
  if (!code) return null;
  try {
    parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
    return code; // already a whole module
  } catch {
    // still being written
  }
  const cuts = cutPoints(code);
  for (const cut of cuts.slice(-tries).reverse()) {
    const head = code.slice(0, cut.at);
    const root = head.slice(head.search(/export\s+default/)).match(ROOT)?.[1];
    if (!root) return null; // nothing can show before the root group exists
    const closed = `${head}\n${'}\n'.repeat(cut.open - 1)}return { root: ${root} };\n}\n`;
    try {
      parse(closed, { ecmaVersion: 'latest', sourceType: 'module' });
      return closed;
    } catch {
      // try an earlier cut
    }
  }
  return null;
}
