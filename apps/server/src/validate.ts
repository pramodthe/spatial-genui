import { parse, type Node } from 'acorn';
import { full } from 'acorn-walk';
import { unsupportedGlyphs } from './glyphs.js';

export type ValidationResult =
  | { ok: true; transformed: string }
  | { ok: false; error: string };

// Globals generated code may not reference: network, DOM, timers, dynamic code, host escape hatches.
const BANNED_GLOBALS = new Set([
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'navigator', 'location',
  'eval', 'Function', 'Reflect', 'Proxy',
  'document', 'window', 'globalThis', 'self', 'parent', 'top', 'frames',
  'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'cookieStore',
  'setTimeout', 'setInterval', 'requestAnimationFrame', 'queueMicrotask',
  'Worker', 'SharedWorker', 'importScripts', 'postMessage',
  'process', 'require', 'module',
]);
const BANNED_PROPERTIES = new Set(['constructor', '__proto__', '__defineGetter__', '__defineSetter__']);

/** Extract the module source from the model's reply (first fenced code block, or the raw text). */
export function extractCode(reply: string): string | null {
  const fence = reply.match(/```(?:js|javascript|ts|typescript)?\s*\n([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  return /export\s+default/.test(reply) ? reply.trim() : null;
}

/**
 * Static safety check for an agent-written module, then a transform that turns
 * `export default …` into an assignment so the dry run can execute it as a script.
 */
export function validateModule(code: string): ValidationResult {
  let ast: Node;
  try {
    ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  } catch (err) {
    return { ok: false, error: `Syntax error: ${(err as Error).message}` };
  }

  const problems: string[] = [];
  const declared = new Set<string>();
  const references: { name: string; line?: number }[] = [];
  let exportDefault: (Node & { declaration: Node }) | null = null;
  // Text the panel font can't draw shows up as empty boxes; collect it from every string in the module.
  const badGlyphs = new Map<string, { replacement: string; lines: Set<number> }>();
  const noteGlyphs = (text: string, line?: number) => {
    for (const [ch, replacement] of unsupportedGlyphs(text)) {
      const entry = badGlyphs.get(ch) ?? { replacement, lines: new Set<number>() };
      if (line) entry.lines.add(line);
      badGlyphs.set(ch, entry);
    }
  };

  full(ast, (node: any, _state, walkType) => {
    const where = node.loc ? ` (line ${node.loc.start.line})` : '';
    if (node.type === 'Identifier') {
      // Bindings (`const parent`, params) arrive as VariablePattern; everything else is a reference.
      if (walkType === 'VariablePattern') declared.add(node.name);
      else references.push({ name: node.name, line: node.loc?.start.line });
      return;
    }
    if (node.type === 'Literal' && typeof node.value === 'string') noteGlyphs(node.value, node.loc?.start.line);
    if (node.type === 'TemplateElement') noteGlyphs(node.value.cooked ?? node.value.raw, node.loc?.start.line);
    switch (node.type) {
      case 'ImportDeclaration':
      case 'ImportExpression':
      case 'ExportNamedDeclaration':
      case 'ExportAllDeclaration':
        problems.push(`${node.type} is not allowed; the module must have no imports and only a default export${where}`);
        break;
      case 'MetaProperty':
        problems.push(`import.meta / new.target is not allowed${where}`);
        break;
      case 'ExportDefaultDeclaration':
        if (exportDefault) problems.push(`Only one default export is allowed${where}`);
        exportDefault = node;
        break;
      case 'MemberExpression': {
        const name = node.computed
          ? node.property.type === 'Literal' ? String(node.property.value) : null
          : node.property.name;
        if (name && BANNED_PROPERTIES.has(name)) problems.push(`Accessing \`.${name}\` is not allowed${where}`);
        break;
      }
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        if (node.async || node.generator) problems.push(`async functions and generators are not allowed${where}`);
        break;
    }
  });

  for (const ref of references) {
    if (BANNED_GLOBALS.has(ref.name) && !declared.has(ref.name)) {
      problems.push(`\`${ref.name}\` is not available${ref.line ? ` (line ${ref.line})` : ''}`);
    }
  }
  if (badGlyphs.size > 0) {
    const list = [...badGlyphs].slice(0, 12).map(([ch, { replacement, lines }]) => {
      const code = `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;
      const at = lines.size ? ` (line ${[...lines].slice(0, 3).join(', ')})` : '';
      return `"${ch}" ${code}${at} → ${replacement ? `"${replacement}"` : 'remove it (draw icons as 3D shapes instead)'}`;
    });
    problems.push(
      `Panel text can only use plain ASCII plus ° § ä ö ü Ä Ö Ü ß; other characters render as empty boxes. Replace: ${list.join('; ')}` +
        `${badGlyphs.size > 12 ? ` and ${badGlyphs.size - 12} more` : ''}.`,
    );
  }
  if (!exportDefault) problems.push('The module must `export default function build(api) { … }`.');
  if (problems.length > 0) {
    return { ok: false, error: [...new Set(problems)].join('\n') };
  }

  const decl = exportDefault as unknown as { start: number; declaration: { start: number } };
  const transformed =
    code.slice(0, decl.start) + '__exports.default = ' + code.slice(decl.declaration.start);
  return { ok: true, transformed };
}
