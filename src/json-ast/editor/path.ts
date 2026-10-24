/**
 * Validation and resolution of editor paths.
 *
 * A path is validated once (`validatePath`) and then walked (`resolveSegments`), so every
 * public operation shares the same segment rules and the same errors.
 */
import type { JsonAstNode } from '../types';
import { JsonAstPathError } from './errors';
import type { JsonAstPath, JsonAstPathSegment, Slot } from './types';

/** Canonical non-negative decimal integer, accepted as an array index. */
const CANONICAL_INDEX = /^(0|[1-9][0-9]*)$/;

/**
 * Validate the path argument and every segment.
 *
 * @param path - path passed to the editor
 * @returns the same path, narrowed to validated segments
 * @throws {JsonAstPathError} when the path is not an array or a segment is neither a string
 * nor a non-negative integer number
 */
export function validatePath(path: JsonAstPath): JsonAstPathSegment[] {
  if (!Array.isArray(path)) {
    throw new JsonAstPathError('invalid path (expected an array of string and number segments)', path, null);
  }
  for (let index = 0; index < path.length; index += 1) {
    validateSegment(path[index], index, path);
  }
  return path;
}

/**
 * Validate one path segment: a string key or a non-negative integer number.
 *
 * @param segment - segment to validate
 * @param segmentIndex - position of the segment inside the path, used in the error
 * @param path - whole path, used in the error
 * @throws {JsonAstPathError} when the segment is not a string and not a non-negative
 * integer number (`NaN`, `Infinity`, fractional and negative numbers, `null`, objects)
 */
export function validateSegment(segment: JsonAstPathSegment, segmentIndex: number, path: JsonAstPath): void {
  if (typeof segment === 'string') {
    return;
  }
  if (typeof segment === 'number' && Number.isInteger(segment) && segment >= 0) {
    return;
  }
  throw new JsonAstPathError(
    `invalid segment ${String(segment)} (expected a string or a non-negative integer number)`,
    path,
    segmentIndex,
  );
}

/**
 * Reject mutations of the document root.
 *
 * @param segments - validated path
 * @param path - whole path, used in the error
 * @throws {JsonAstPathError} for an empty path
 */
export function assertMutationPath(segments: JsonAstPathSegment[], path: JsonAstPath): void {
  if (segments.length === 0) {
    throw rootPathError(path);
  }
}

/**
 * Build the error for a mutation of the document root.
 *
 * @param path - whole path of the failed operation
 * @returns the error to throw
 */
export function rootPathError(path: JsonAstPath): JsonAstPathError {
  return new JsonAstPathError('the document root cannot be replaced, added or removed (parse a new document instead)', path, null);
}

/**
 * Resolve a validated path to the node and the slot that holds it.
 *
 * @param ast - root node
 * @param path - path passed to the editor, used as is in the errors
 * @returns the addressed slot; for an empty path the root node with `container: null`
 * @throws {JsonAstPathError} when a key or an index is missing or the path runs through a
 * scalar value
 */
export function resolveSlot(ast: JsonAstNode, path: JsonAstPath): Slot {
  return resolveSegments(ast, validatePath(path), path);
}

/**
 * Resolve validated segments to the node and the slot that holds it.
 *
 * @param ast - root node
 * @param segments - validated segments to walk, a prefix of `path` for `set`
 * @param path - path of the operation, used as is in the errors
 * @returns the addressed slot; for an empty segment list the root node with `container: null`
 * @throws {JsonAstPathError} when a key or an index is missing or the path runs through a
 * scalar value
 */
export function resolveSegments(ast: JsonAstNode, segments: JsonAstPathSegment[], path: JsonAstPath): Slot {
  let node = ast;
  let container: JsonAstNode | null = null;
  let slotIndex = -1;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const type = node.type();
    if (type === 'object') {
      const key = segmentKey(segment);
      const memberIndex = findMemberIndex(node, key);
      if (memberIndex === -1) {
        throw new JsonAstPathError(`key ${JSON.stringify(key)} not found in the object`, path, index);
      }
      const member = node.child(memberIndex);
      const value = member === null ? null : member.child(1);
      if (value === null) {
        throw new JsonAstPathError(`member ${JSON.stringify(key)} has no value node`, path, index);
      }
      container = node;
      slotIndex = memberIndex;
      node = value;
      continue;
    }
    if (type === 'array') {
      const target = arrayIndex(segment, index, path);
      const length = node.childs().length;
      if (target >= length) {
        throw new JsonAstPathError(`index ${target} is out of range for an array of length ${length}`, path, index);
      }
      const child = node.child(target);
      if (child === null) {
        throw new JsonAstPathError(`index ${target} has no value node`, path, index);
      }
      container = node;
      slotIndex = target;
      node = child;
      continue;
    }
    throw new JsonAstPathError(
      `cannot traverse into a ${type} value (only objects have keys and only arrays have elements)`,
      path,
      index,
    );
  }
  return { node, container, slotIndex };
}

/**
 * Find the member of an object by key, starting from the end so duplicate keys resolve to
 * the last occurrence, as in `JSON.parse`.
 *
 * @param object - object node
 * @param key - decoded key to look for
 * @returns index of the member among the object children, `-1` when it is absent
 */
export function findMemberIndex(object: JsonAstNode, key: string): number {
  const members = object.childs();
  for (let index = members.length - 1; index >= 0; index -= 1) {
    const member = members[index];
    if (member.child(0)?.get('value') === key) {
      return index;
    }
  }
  return -1;
}

/**
 * Coerce a validated path segment to an object key: a string as is, a number through
 * `String(number)`.
 */
export function segmentKey(segment: JsonAstPathSegment): string {
  return typeof segment === 'string' ? segment : String(segment);
}

/**
 * Coerce a validated path segment to an array index.
 *
 * @param segment - string key or number segment
 * @param segmentIndex - position of the segment inside the path, used in the error
 * @param path - whole path, used in the error
 * @returns the index
 * @throws {JsonAstPathError} when a string segment is not a canonical decimal integer
 */
export function arrayIndex(segment: JsonAstPathSegment, segmentIndex: number, path: JsonAstPath): number {
  if (typeof segment === 'number') {
    return segment;
  }
  if (CANONICAL_INDEX.test(segment)) {
    return Number.parseInt(segment, 10);
  }
  throw new JsonAstPathError(
    `invalid array index ${String(segment)} (expected a number or a canonical decimal string)`,
    path,
    segmentIndex,
  );
}
