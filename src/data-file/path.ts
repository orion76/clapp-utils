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

import { TDataPath, TPathSegment } from './types';

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;


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
export function escapePath(segments: TDataPath): string {
  return Array.from(segments, (segment) => escapeSegment(segment)).join('.');
}

function escapeSegment(segment: TPathSegment): string {
  if (typeof segment === 'number') {
    return `[${segment}]`;
  }
  if (IDENTIFIER_RE.test(segment)) {
    return segment;
  }
  return `[${JSON.stringify(segment)}]`;
}
