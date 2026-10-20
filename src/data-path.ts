/**
 * Path parsing helpers for JSON/YAML data access.
 *
 * A data path addresses a value inside a nested document. It is a dot-separated
 * sequence of segments, where each segment is either a plain object key or a
 * bracketed array index / escaped key:
 *
 * - `a.b.c`        -> `['a', 'b', 'c']`
 * - `a.0.c`        -> `['a', 0, 'c']`      (bare integer -> array index)
 * - `a.[0].c`      -> `['a', 0, 'c']`      (bracketed integer -> array index)
 * - `a.[b.c].c`    -> `['a', 'b.c', 'c']`  (bracketed key, dots are literal)
 * - `a.["0"].c`    -> `['a', '0', 'c']`    (quoted key, stays a string)
 *
 * Bracketed segments keep everything between `[` and `]` intact, so they can be
 * used to express object keys that contain dots or that look like integers.
 * Quoted content (`["..."]` or `['...']`) is unquoted to the raw key value.
 */

/**
 * One segment of a data path: an object key (string) or an array index (number).
 */
export type PathSegment = string | number;

/**
 * Parsed data path, a sequence of object keys and array indexes.
 */
export type DataPath = readonly PathSegment[];

/**
 * A path is either a path string (`a.b.[0].c`) or an already-parsed list of segments.
 */
export type DataPathInput = string | DataPath;

export class DataPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataPathError';
  }
}

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const INT_RE = /^\d+$/;

/**
 * Parse a data path string into a list of segments (object keys and array indexes).
 *
 * Supports dot-separated plain keys, bare integer indexes and bracketed
 * segments (`[n]`, `["key"]`, `['key']`, `[key]`). Throws a `DataPathError`
 * describing the problem on an empty path, an empty segment or unbalanced
 * brackets.
 *
 * @param path - data path string, e.g. `a.b.c` or `a.[0].c`
 * @returns segments of the path
 * @throws {DataPathError} when the path is empty or has invalid syntax
 */
export function parsePath(path: string): PathSegment[] {
  if (!path) {
    throw new DataPathError('Path is empty');
  }

  const segments: PathSegment[] = [];
  let current = '';
  let bracketDepth = 0;

  for (let i = 0; i < path.length; i++) {
    const ch = path[i];
    if (ch === '[') {
      bracketDepth += 1;
      current += ch;
      continue;
    }
    if (ch === ']') {
      bracketDepth -= 1;
      if (bracketDepth < 0) {
        throw new DataPathError(`Unexpected "]" in path "${path}"`);
      }
      current += ch;
      continue;
    }
    if (ch === '.') {
      if (bracketDepth > 0) {
        current += ch;
        continue;
      }
      if (current === '') {
        throw new DataPathError(`Empty segment in path "${path}"`);
      }
      segments.push(parseSegment(current));
      current = '';
      continue;
    }
    current += ch;
  }

  if (bracketDepth !== 0) {
    throw new DataPathError(`Unbalanced "[" in path "${path}"`);
  }
  if (current === '') {
    throw new DataPathError(`Trailing "." in path "${path}"`);
  }
  segments.push(parseSegment(current));

  return segments;
}

function parseSegment(segment: string): PathSegment {
  if (segment.startsWith('[') && segment.endsWith(']')) {
    const inner = segment.slice(1, -1);
    if (inner === '') {
      throw new DataPathError(`Empty bracket segment "${segment}"`);
    }
    if (INT_RE.test(inner)) {
      return Number(inner);
    }
    return unquoteSegment(inner);
  }
  if (INT_RE.test(segment)) {
    return Number(segment);
  }
  return segment;
}

function unquoteSegment(inner: string): string {
  if (inner.startsWith('"') && inner.endsWith('"')) {
    return parseQuoted(inner);
  }
  if (inner.startsWith("'") && inner.endsWith("'")) {
    return inner.slice(1, -1).replace(/\\(['"])/g, '$1');
  }
  return inner;
}

function parseQuoted(inner: string): string {
  try {
    return JSON.parse(inner) as string;
  } catch {
    throw new DataPathError(`Invalid quoted segment [${inner}]`);
  }
}

/**
 * Build a data path string from a sequence of segments, escaping keys that
 * would otherwise be ambiguous in `parsePath`.
 *
 * Plain identifiers and array indexes are emitted as-is; any other string key
 * (containing dots, spaces, quotes or digits) is wrapped into a quoted
 * bracket segment so `parsePath` recovers it as a string.
 *
 * @param segments - path segments
 * @returns data path string, e.g. `a.b.[0]` or `["a.b"].c`
 */
export function escapePath(segments: DataPath): string {
  return Array.from(segments, (segment) => escapeSegment(segment)).join('.');
}

function escapeSegment(segment: PathSegment): string {
  if (typeof segment === 'number') {
    return `[${segment}]`;
  }
  if (IDENTIFIER_RE.test(segment)) {
    return segment;
  }
  return `[${JSON.stringify(segment)}]`;
}
