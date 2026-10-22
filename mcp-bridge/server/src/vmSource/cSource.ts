/**
 * Reads generated VMMaker C source text: indexes function definitions, finds a
 * primitive's dispatch entry (plugin exports row or core `primitiveTable` slot),
 * lists the helpers and external calls in its body, and reads a plugin's
 * `moduleName` stamp. Pure; works on text only, touches no git or disk.
 */

import { VmSourceError } from './errors.js';

/** One indexed C function definition; `start`/`end` are 1-based line numbers. */
export interface CFunctionEntry {
  start: number;
  end: number;
  source: string;
  generatedFrom?: string;
}

/** Column-0 `name(` line of a definition; capture is the function name. */
const FUNCTION_NAME_LINE = /^([A-Za-z_]\w*)\(/;
/** VMMaker provenance comment, e.g. `\t/* Foo>>#bar: *\/`; capture is the selector. */
const GENERATED_FROM_LINE = /^\t\/\* (\S+>>#\S+) \*\/$/;

/**
 * Indexes generated C function definitions by name. A definition is a
 * column-0 `name(` line whose next line starts with `{`. It starts at the
 * return-type line above, or one line higher when that holds a VMMaker
 * provenance comment (kept as `generatedFrom`), and ends at the next `}` line.
 */
export function indexFunctions(text: string): Map<string, CFunctionEntry> {
  const lines = text.split('\n');
  const index = new Map<string, CFunctionEntry>();
  for (let i = 0; i < lines.length - 1; i++) {
    const name = FUNCTION_NAME_LINE.exec(lines[i])?.[1];
    if (name === undefined || !lines[i + 1].startsWith('{')) continue;
    const generatedFrom = GENERATED_FROM_LINE.exec(lines[i - 2] ?? '')?.[1];
    const startIndex = generatedFrom === undefined ? i - 1 : i - 2;
    const endIndex = lines.indexOf('}', i + 1);
    const entry: CFunctionEntry = {
      start: startIndex + 1,
      end: endIndex + 1,
      source: lines.slice(startIndex, endIndex + 1).join('\n'),
    };
    if (generatedFrom !== undefined) entry.generatedFrom = generatedFrom;
    index.set(name, entry);
  }
  return index;
}

/** One `<module>_exports` row; captures are the exported name and the function. */
const EXPORT_ROW = /^\s*\{\(void\*\)_m, "([^"\\]+)(?:\\\d{3})*", \(void\*\)(\w+)\}/;

/** Finds the exports row for `name`; returns its function and the trimmed row text. */
export function findExport(text: string, name: string): { fn: string; row: string } {
  for (const line of text.split('\n')) {
    const match = EXPORT_ROW.exec(line);
    if (match?.[1] === name) return { fn: match[2], row: line.trim() };
  }
  throw new VmSourceError('symbol_not_found', `no exports row for '${name}'`);
}

/** A `primitiveTable` slot: the function it dispatches to and the trimmed table row. */
export interface TableSlot {
  fn: string;
  row: string;
  shared?: { reason: 'quick_primitive' | 'external_call'; applies: string };
}

/** One `/* n *\/ value,` primitiveTable row; captures are the index and the value. */
const TABLE_ROW = /^\s*\/\* (\d+) \*\/ ([^,]+),/;
/** A table value naming the function the slot dispatches to. */
const IDENTIFIER = /^[A-Za-z_]\w*$/;

/** The `primitiveTable` slot of `primitiveExternalCall`, shared by every named primitive. */
const EXTERNAL_CALL_SLOT = 117;
/** What the external-call slot dispatches to. */
const EXTERNAL_CALL_APPLIES =
  "the named primitive in the method's first literal (module and function name), looked up and called at run time";

/** A `(void (*)(void))K` table value; capture is K. */
const QUICK_VALUE = /^\(void \(\*\)\(void\)\)(\d+)$/;

/** What quick primitive `k` (256..519) answers without running a method. */
function quickResult(k: number): string {
  if (k === 256) return 'self';
  if (k === 257) return 'true';
  if (k === 258) return 'false';
  if (k === 259) return 'nil';
  if (k <= 263) return `SmallInteger ${k - 261}`;
  return `instance variable ${k - 264}`;
}

/** Finds slot `n` inside the `primitiveTable[` initializer. */
export function findTableSlot(text: string, n: number): TableSlot {
  const lines = text.split('\n');
  const open = lines.findIndex((l) => l.includes('primitiveTable['));
  for (let i = open + 1; i < lines.length && !lines[i].endsWith('};'); i++) {
    const match = TABLE_ROW.exec(lines[i]);
    if (match === null || Number(match[1]) !== n) continue;
    const value = match[2];
    const row = lines[i].trim();
    if (IDENTIFIER.test(value)) {
      const slot: TableSlot = { fn: value, row };
      if (n === EXTERNAL_CALL_SLOT) slot.shared = { reason: 'external_call', applies: EXTERNAL_CALL_APPLIES };
      return slot;
    }
    const quick = QUICK_VALUE.exec(value);
    const k = quick === null ? undefined : Number(quick[1]);
    if (k !== undefined && k >= 256 && k <= 519) {
      return {
        fn: 'externalQuickPrimitiveResponse',
        row,
        shared: { reason: 'quick_primitive', applies: `quick primitive ${k}: return ${quickResult(k)}` },
      };
    }
    if (k === 0) {
      throw new VmSourceError(
        'primitive_slot_empty',
        `primitiveTable slot ${n} holds no function; the method always runs its Smalltalk fallback code`,
      );
    }
  }
  throw new VmSourceError('symbol_not_found', `no primitiveTable slot ${n}`);
}

/** Comments, string literals and char literals (with escapes), in C lexical order. */
const NON_CODE = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g;
/** A preprocessor line: first non-blank char is `#`. */
const DIRECTIVE_LINE = /^\s*#/;
/**
 * An identifier followed by `(`, unless that `(` opens a function-pointer declarator
 * `(*)(…)` / `(*name)(…)` (the identifier is then its return type, e.g.
 * `((void (*)(int)) addr)`); capture is the identifier.
 */
const CALL = /\b([A-Za-z_]\w*)\s*\((?!\s*\*\s*\w*\s*\)\s*\()/g;

/**
 * Names called in the body of function `source` (the lines after its `{`
 * line) other than `self`, in first-appearance order, after dropping `#`
 * lines, comments and string/char literals.
 */
function calledNames(source: string, self: string): string[] {
  const lines = source.split('\n');
  const bodyStart = lines.findIndex((line) => line.startsWith('{')) + 1;
  const code = lines
    .slice(bodyStart)
    .filter((line) => !DIRECTIVE_LINE.test(line))
    .join('\n')
    .replace(NON_CODE, ' ');
  const names = new Set<string>();
  for (const match of code.matchAll(CALL)) {
    if (match[1] !== self) names.add(match[1]);
  }
  return [...names];
}

/** Indexed functions called by `fn` (one level), in first-appearance order, with their source. */
export function helpers(fn: string, index: Map<string, CFunctionEntry>): { name: string; source: string }[] {
  const source = index.get(fn)?.source ?? '';
  return calledNames(source, fn)
    .filter((name) => index.has(name))
    .map((name) => ({ name, source: index.get(name)!.source }));
}

/** A called function with no body in the file, and why its source is not quoted. */
export interface ExternalCall {
  name: string;
  kind: 'vm_interface' | 'platform_code_unavailable';
}

/** C keywords that can be followed by `(` without being a call. */
const C_KEYWORDS = new Set(['if', 'while', 'for', 'switch', 'return', 'sizeof', 'case']);
/** A macro-style ALL_CAPS name. */
const ALL_CAPS = /^[A-Z][A-Z0-9_]*$/;
/** A function-like `#define name(` line, any spacing; capture is the name. */
const FUNCTION_LIKE_DEFINE = /^#\s*define\s+(\w+)\(/gm;

/**
 * Non-indexed functions called by `fn`, in first-appearance order, skipping C
 * keywords, ALL_CAPS names and function-like `#define`s in `text`: `vm_interface`
 * when called through `interpreterProxy->` or declared as a `(*name)(` pointer in
 * `text`, else `platform_code_unavailable`.
 */
export function externalCalls(fn: string, index: Map<string, CFunctionEntry>, text: string): ExternalCall[] {
  const source = index.get(fn)?.source ?? '';
  const macros = new Set([...text.matchAll(FUNCTION_LIKE_DEFINE)].map((m) => m[1]));
  return calledNames(source, fn)
    .filter((name) => !index.has(name) && !C_KEYWORDS.has(name) && !ALL_CAPS.test(name) && !macros.has(name))
    .map((name) => ({
      name,
      kind:
        source.includes(`interpreterProxy->${name}(`) || text.includes(`(*${name})(`)
          ? 'vm_interface'
          : 'platform_code_unavailable',
    }));
}

/**
 * A plugin's `moduleName` stamp declaration; capture is the stamp text. Matches the
 * single-line form (`= "SocketPlugin VMMaker.oscog-eem.3743 " INT_EXT;`) and the older
 * multi-line form, whose first string is the `#ifdef SQUEAK_BUILTIN_PLUGIN` branch
 * (`= \n#ifdef SQUEAK_BUILTIN_PLUGIN\n\t"FT2Plugin Freetype-Plugin-EstebanLorenzano.70 (i)"`).
 */
const MODULE_STAMP = /static const char \*moduleName =\s*(?:#ifdef SQUEAK_BUILTIN_PLUGIN\s*)?"([^"]*)"/;

/** The trimmed `moduleName` stamp of a plugin file, without an `(i)`/`(e)` suffix; undefined when there is none (the core). */
export function moduleStamp(text: string): string | undefined {
  return MODULE_STAMP.exec(text)?.[1].trim().replace(/ \([ie]\)$/, '');
}
