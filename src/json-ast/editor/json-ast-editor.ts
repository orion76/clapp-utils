/**
 * Path based access to the lossless JSON AST and formatting-preserving edits.
 *
 * `JsonAstEditor` works on a tree produced by `JsonAst.parse` and reads or changes one
 * value addressed by a path; `JsonAst.unparse` then renders the document. Reads decode the
 * addressed subtree into plain JavaScript values, edits touch only the affected node and
 * the separators around it, so the rest of the document stays byte for byte identical:
 *
 * - `set` replaces an existing value and never creates one: a missing key or index is an
 *   error, use `add` to create a new element;
 * - `add` creates a new object key or array element and rejects an existing object key
 *   (that is what `set` is for);
 * - `delete` removes an object member or an array element and keeps the surrounding
 *   separators and whitespace consistent.
 *
 * Path semantics: an object accepts a string key and coerces a number with
 * `String(number)`, an array accepts a number or a canonical decimal string
 * (`/^(0|[1-9][0-9]*)$/`). With duplicate object keys the last occurrence wins, exactly as
 * in `JSON.parse`. An empty path addresses the document root for reads and is rejected by
 * every mutation.
 *
 * Node positions are never recalculated: `pos()` keeps the offsets of the original parse,
 * and nodes built by the editor carry the position of their anchor (the replaced node or
 * the receiving container). `JsonAst.unparse` does not use positions, so the text stays
 * exact.
 */
import { insertChild, removeChild, replaceChild } from '../node';
import type { JsonAstNode } from '../types';
import { buildValue, createMember, scalarText, scalarType } from './build';
import { JsonAstPathError } from './errors';
import {
  attribute,
  buildStyleFor,
  containerStyle,
  insertIntoContainer,
  keySeparator,
  normalizeContainer,
  outsidePrefix,
  outsideSuffix,
  prepareContainerForInsert,
} from './format';
import {
  arrayIndex,
  assertMutationPath,
  findMemberIndex,
  resolveSegments,
  resolveSlot,
  rootPathError,
  segmentKey,
  validatePath,
} from './path';
import type { JsonAstPath } from './types';
import { assertJsonValue, decodeValue, isContainerValue } from './value';

/**
 * Reads and formatting-preserving edits of a lossless JSON AST by path.
 *
 * All methods are static: the editor holds no state and works on the tree in place.
 */
export class JsonAstEditor {
  /**
   * Get the node addressed by a path.
   *
   * @param ast - root node produced by `JsonAst.parse`
   * @param path - object keys and array indexes; an empty path addresses the root
   * @returns the addressed node: the value node of an object member, the element of an
   * array or the root node itself
   * @throws {JsonAstPathError} when the path is not an array, a segment is invalid, a key
   * or an index does not exist, or the path runs through a scalar value
   */
  static node(ast: JsonAstNode, path: JsonAstPath): JsonAstNode {
    return resolveSlot(ast, path).node;
  }

  /**
   * Check whether a path addresses an existing value.
   *
   * A missing key, a missing index and a path running through a scalar value all yield
   * `false` instead of an error; only invalid segments throw.
   *
   * @param ast - root node produced by `JsonAst.parse`
   * @param path - object keys and array indexes; an empty path always exists
   * @returns `true` when the whole path exists
   * @throws {JsonAstPathError} when the path is not an array or a segment is invalid
   */
  static has(ast: JsonAstNode, path: JsonAstPath): boolean {
    const segments = validatePath(path);
    let node = ast;
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const type = node.type();
      if (type === 'object') {
        const memberIndex = findMemberIndex(node, segmentKey(segment));
        if (memberIndex === -1) {
          return false;
        }
        const member = node.child(memberIndex);
        const value = member === null ? null : member.child(1);
        if (value === null) {
          return false;
        }
        node = value;
        continue;
      }
      if (type === 'array') {
        const target = arrayIndex(segment, index, path);
        if (target >= node.childs().length) {
          return false;
        }
        const child = node.child(target);
        if (child === null) {
          return false;
        }
        node = child;
        continue;
      }
      return false;
    }
    return true;
  }

  /**
   * Decode the value addressed by a path.
   *
   * Objects become plain objects (document order, the last duplicate key wins), arrays
   * become arrays and scalars become their decoded `value`; raw `prolog`/`body`/`epilog`
   * text is never exposed.
   *
   * @param ast - root node produced by `JsonAst.parse`
   * @param path - object keys and array indexes; an empty path returns the whole document
   * @returns the decoded JavaScript value
   * @throws {JsonAstPathError} when the path is not an array, a segment is invalid, a key
   * or an index does not exist, or the path runs through a scalar value
   */
  static get(ast: JsonAstNode, path: JsonAstPath): unknown {
    return decodeValue(resolveSlot(ast, path).node);
  }

  /**
   * Replace the existing value addressed by a path.
   *
   * A scalar replaced by another scalar of the same type only gets a new `body` and
   * `value`, so the rest of the document stays byte for byte identical and the node keeps
   * its parsed type. Any other pair (a scalar of another type, a scalar into a container, a
   * container into a scalar, a container into another container) rebuilds the node and
   * splices it into the parent, so `type()` reports the new value; the `prolog`/`epilog` of
   * the replaced node are kept and the new text follows the style of the parent container.
   * Node positions are not recalculated: a built node carries the position of the node it
   * replaced.
   *
   * @param ast - root node produced by `JsonAst.parse`
   * @param path - path of an existing value, never empty
   * @param value - JSON value to store: string, finite number, boolean, `null`, an array or
   * a plain object
   * @throws {JsonAstPathError} when the path is empty, invalid or does not exist; when the
   * path runs through a scalar value the target is missing as well
   * @throws {Error} when the value is not a JSON value (`undefined`, a function, a symbol, a
   * bigint, `NaN`, `Infinity`, a non-plain object) or contains a circular reference
   */
  static set(ast: JsonAstNode, path: JsonAstPath, value: unknown): void {
    const segments = validatePath(path);
    assertMutationPath(segments, path);
    assertJsonValue(value);
    const slot = resolveSegments(ast, segments, path);
    const container = slot.container;
    if (container === null) {
      throw rootPathError(path);
    }
    const target = slot.node;
    if (!isContainerValue(value) && target.type() === scalarType(value as string | number | boolean | null)) {
      target.set('body', scalarText(value as string | number | boolean | null));
      target.set('value', value);
      return;
    }

    // The replacement is built from scratch, so keep the text that surrounds the old node:
    // the separator (scalars) or the trailing whitespace after the closing bracket
    // (containers). The leading part of a container prolog is its own opening bracket.
    const replacement = buildValue(value, buildStyleFor(container, containerStyle(container)), target.pos());
    const prefix = outsidePrefix(target);
    if (prefix !== '') {
      replacement.set('prolog', prefix + attribute(replacement, 'prolog'));
    }
    const suffix = outsideSuffix(target);
    if (suffix !== '') {
      replacement.set('epilog', attribute(replacement, 'epilog') + suffix);
    }

    // An object member is a `member` node with the key and the value as children, so the
    // value is replaced inside the member; an array element sits directly in the array.
    if (container.type() === 'object') {
      const member = container.child(slot.slotIndex);
      if (member === null) {
        throw new JsonAstPathError('the object member to replace has no node', path, segments.length - 1);
      }
      replaceChild(member, 1, replacement);
      return;
    }
    replaceChild(container, slot.slotIndex, replacement);
  }

  /**
   * Add a new value that must not exist yet.
   *
   * For an object the last segment is a new key and the member is appended after the
   * existing members; an existing key is rejected because replacing it is `set`. For an
   * array the last segment is an index in `0..length`, where `length` appends. The parent
   * (`path` without the last segment) must exist and be an object or an array. Empty
   * containers receive the value compactly, other containers follow their own indentation
   * and separator style. Node positions are not recalculated: a built node carries the
   * position of the receiving container.
   *
   * @param ast - root node produced by `JsonAst.parse`
   * @param path - path of the new element: keys of the parent plus the new key or index
   * @param value - JSON value to insert: string, finite number, boolean, `null`, an array or
   * a plain object, nested values included
   * @throws {JsonAstPathError} when the path is empty or invalid, the parent is missing or
   * is a scalar, the object key already exists or the array index is out of range
   * @throws {Error} when the value is not a JSON value or contains a circular reference
   */
  static add(ast: JsonAstNode, path: JsonAstPath, value: unknown): void {
    const segments = validatePath(path);
    assertMutationPath(segments, path);
    assertJsonValue(value);
    const parent = resolveSegments(ast, segments.slice(0, -1), path).node;
    const segmentIndex = segments.length - 1;
    const segment = segments[segmentIndex];
    const type = parent.type();

    if (type === 'object') {
      const key = segmentKey(segment);
      if (findMemberIndex(parent, key) !== -1) {
        throw new JsonAstPathError(
          `key ${JSON.stringify(key)} already exists (use JsonAstEditor.set to replace an existing value)`,
          path,
          segmentIndex,
        );
      }
      const style = prepareContainerForInsert(parent);
      const member = createMember(key, value, buildStyleFor(parent, style), keySeparator(parent), parent.pos());
      insertIntoContainer(parent, parent.childs().length, member, style);
      return;
    }

    if (type === 'array') {
      const index = arrayIndex(segment, segmentIndex, path);
      const length = parent.childs().length;
      if (index > length) {
        throw new JsonAstPathError(
          `index ${index} is out of range for an array of length ${length} (allowed 0..${length})`,
          path,
          segmentIndex,
        );
      }
      const style = prepareContainerForInsert(parent);
      const element = buildValue(value, buildStyleFor(parent, style), parent.pos());
      insertIntoContainer(parent, index, element, style);
      return;
    }

    throw new JsonAstPathError(
      `the parent path addresses a ${type} value (only an object or an array can receive a new element)`,
      path,
      segmentIndex,
    );
  }

  /**
   * Remove the existing value addressed by a path.
   *
   * An object key removes the whole member, an array index removes the element. Removing
   * the last member or element also removes the separator of the preceding one; a container
   * that becomes empty is normalised to `{}` or `[]` (its inner whitespace is dropped, the
   * whitespace around it is kept). Node positions of the remaining nodes stay as parsed.
   *
   * @param ast - root node produced by `JsonAst.parse`
   * @param path - path of an existing value, never empty
   * @throws {JsonAstPathError} when the path is empty or invalid, does not exist, or runs
   * through a scalar value
   */
  static delete(ast: JsonAstNode, path: JsonAstPath): void {
    const segments = validatePath(path);
    assertMutationPath(segments, path);
    const slot = resolveSegments(ast, segments, path);
    const container = slot.container;
    if (container === null) {
      throw rootPathError(path);
    }
    const children = container.childs();
    removeChild(container, slot.slotIndex);
    if (children.length === 1) {
      normalizeContainer(container);
      return;
    }
    if (slot.slotIndex === children.length - 1) {
      const previous = container.child(slot.slotIndex - 1);
      if (previous !== null) {
        previous.set('epilog', '');
      }
    }
  }
}
