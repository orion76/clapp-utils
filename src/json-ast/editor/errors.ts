/**
 * Errors raised by the path based AST editor (`JsonAstEditor`).
 *
 * The class carries the path the caller passed and the index of the segment that made the
 * operation fail, so a caller can point at the exact level instead of parsing the message.
 */
import type { JsonAstPath } from './types';

/**
 * Failure of a path based read or edit of a JSON AST.
 *
 * The message always names the reason, the failing segment (or the whole path when the
 * failure is not tied to one segment) and the complete path in its JSON notation.
 */
export class JsonAstPathError extends Error {
  /** Path the failed operation was called with (a copy, safe to keep). */
  readonly path: JsonAstPath;

  /**
   * Index of the failing segment inside {@link path}; `null` when the path itself is
   * invalid or the failure concerns the document as a whole.
   */
  readonly segmentIndex: number | null;

  /**
   * @param reason - human readable reason, for example `key "name" not found in the object`
   * @param path - path of the failed operation
   * @param segmentIndex - index of the failing segment, `null` for a path-wide failure
   */
  constructor(reason: string, path: JsonAstPath, segmentIndex: number | null = null) {
    super(formatMessage(reason, path, segmentIndex));
    this.name = 'JsonAstPathError';
    this.path = Array.isArray(path) ? [...path] : path;
    this.segmentIndex = segmentIndex;
  }
}

/**
 * Compose the error message: the reason, the failing location and the whole path.
 *
 * @param reason - human readable reason
 * @param path - path of the failed operation
 * @param segmentIndex - index of the failing segment, `null` for a path-wide failure
 * @returns one-line message
 */
function formatMessage(reason: string, path: JsonAstPath, segmentIndex: number | null): string {
  const location =
    segmentIndex === null || !Array.isArray(path)
      ? `path ${formatPath(path)}`
      : `segment ${describeSegment(path[segmentIndex])} at index ${segmentIndex} in path ${formatPath(path)}`;
  return `json-ast path error: ${reason} (${location})`;
}

/**
 * Render a path as JSON notation; a non-array argument (possible at runtime) is rendered
 * as a single value.
 */
function formatPath(path: JsonAstPath): string {
  if (!Array.isArray(path)) {
    return describeSegment(path);
  }
  return `[${path.map((segment) => describeSegment(segment)).join(', ')}]`;
}

/** Render one segment the way it should read inside an error message. */
function describeSegment(segment: unknown): string {
  if (typeof segment === 'string') {
    return JSON.stringify(segment);
  }
  if (typeof segment === 'number') {
    return Object.is(segment, -0) ? '-0' : String(segment);
  }
  if (segment === null) {
    return 'null';
  }
  if (segment === undefined) {
    return 'undefined';
  }
  return String(segment);
}
