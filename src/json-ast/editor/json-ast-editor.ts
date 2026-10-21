/**
 * Path based access to the lossless JSON AST and formatting-preserving edits.
 *
 * `JsonAstEditor` works on a tree produced by `JsonAst.parse` and reads or changes one
 * value addressed by a path; `JsonAst.unparse` then renders the document. Reads decode the
 * addressed subtree into plain JavaScript values, edits touch only the affected node and
 * the separators around it, so the rest of the document stays byte for byte identical.
 *
 * Operations: `node`, `has` and `get` read, `set`, `push` and `delete` edit the tree in
 * place.
 *
 * - `set` writes a value and creates the address when it is missing: an object receives a
 *   new key appended after its members, an array receives a new element at
 *   `index === length` (a larger index is an error, use `push` to append);
 * - `push` appends a value to the end of an existing array;
 * - `delete` removes an object member or an array element and keeps the surrounding
 *   separators and whitespace consistent.
 *
 * Path semantics: an object accepts a string key and coerces a number with
 * `String(number)`, an array accepts a number or a canonical decimal string
 * (`/^(0|[1-9][0-9]*)$/`). With duplicate object keys the last occurrence wins, exactly as
 * in `JSON.parse`. An empty path addresses the document root for reads and is rejected by
 * every mutation except `push`, which accepts it when the root itself is an array.
 *
 * Node positions are never recalculated: `pos()` keeps the offsets of the original parse,
 * and nodes built by the editor carry the position of their anchor (the replaced node or
 * the receiving container). `JsonAst.unparse` does not use positions, so the text stays
 * exact.
 */
import { removeChild, replaceChild } from '../node';
import type { JsonAstNode } from '../types';
import { buildValue, createMember, scalarText, scalarType } from './build';
import { JsonAstPathError } from './errors';
import {
  appendChild,
  attribute,
  buildStyleFor,
  containerStyle,
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
 * An editor is created over a tree produced by `JsonAst.parse` and keeps it in a private
 * field; every method reads or changes that tree in place, so the instance holds no other
 * state and `JsonAst.unparse` renders the result after each change. The operations are
 * `node`, `has` and `get` for reads and `set`, `push` and `delete` for edits.
 */
export class JsonAstEditor {


  /**
   * Create an editor over an existing tree.
   *
   * @param ast - root node produced by `JsonAst.parse`; the editor reads and edits this
   * tree in place
   */
  constructor(private _ast: JsonAstNode) {}

  /**
   * Get the node addressed by a path.
   *
   * @param path - object keys and array indexes; an empty path addresses the root
   * @returns the addressed node: the value node of an object member, the element of an
   * array or the root node itself
   * @throws {JsonAstPathError} when the path is not an array, a segment is invalid, a key
   * or an index does not exist, or the path runs through a scalar value
   */
  node(path: JsonAstPath): JsonAstNode {
    return resolveSlot(this._ast, path).node;
  }

  /**
   * Check whether a path addresses an existing value.
   *
   * Segments are validated first, so a segment that is not a string or a non-negative
   * integer number is rejected instead of reporting a missing value. Everything else is a
   * boolean view of {@link node}: a missing key, a missing index, an index beyond the array
   * bounds, an index string that is not canonical and a path running through a scalar value
   * mean "no such path" and yield `false`.
   *
   * @param path - object keys and array indexes; an empty path always exists
   * @returns `true` when the whole path exists, `false` otherwise
   * @throws {JsonAstPathError} when the path is not an array or a segment is not a valid path segment
   */
  has(path: JsonAstPath): boolean {
    validatePath(path);
    try {
      this.node(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Decode the value addressed by a path.
   *
   * Objects become plain objects (document order, the last duplicate key wins), arrays
   * become arrays and scalars become their decoded `value`; raw `prolog`/`body`/`epilog`
   * text is never exposed.
   *
   * @param path - object keys and array indexes; an empty path returns the whole document
   * @returns the decoded JavaScript value
   * @throws {JsonAstPathError} when the path is not an array, a segment is invalid, a key
   * or an index does not exist, or the path runs through a scalar value
   */
  get(path: JsonAstPath): unknown {
    return decodeValue(resolveSlot(this._ast, path).node);
  }

  /**
   * Write a value at a path, replacing an existing value or creating a missing one.
   *
   * A missing address is created inside the existing parent: an object receives a new key
   * appended after its members, an array receives a new element at `index === length` (a
   * larger index is an error, use `push` to append). Intermediate segments are never
   * created: the parent (`path` without the last segment) must exist and be an object or
   * an array.
   *
   * An existing value is replaced in one of two ways. A scalar replaced by another scalar
   * of the same type only gets a new `body` and `value`, so the rest of the document stays
   * byte for byte identical and the node keeps its parsed type. Any other pair (a scalar of
   * another type, a scalar into a container, a container into a scalar, a container into
   * another container) rebuilds the node and splices it into the parent, so `type()`
   * reports the new value; the `prolog`/`epilog` of the replaced node are kept and the new
   * text follows the style of the parent container. Node positions are not recalculated: a
   * built node carries the position of the replaced node or of the receiving container.
   *
   * @param path - path of the value to write, never empty; the last segment may be new
   * @param value - JSON value to store: string, finite number, boolean, `null`, an array or
   * a plain object
   * @throws {JsonAstPathError} when the path is empty, invalid, its parent does not exist
   * or is a scalar, or an array index is greater than the array length
   * @throws {Error} when the value is not a JSON value (`undefined`, a function, a symbol, a
   * bigint, `NaN`, `Infinity`, a non-plain object) or contains a circular reference
   */
  set(path: JsonAstPath, value: unknown): void {
    const segments = validatePath(path);
    assertMutationPath(segments, path);
    assertJsonValue(value);
    const parent = resolveSegments(this._ast, segments.slice(0, -1), path).node;
    const segmentIndex = segments.length - 1;
    const segment = segments[segmentIndex];
    const type = parent.type();

    // The addressed value and the slot that holds it: an object member keeps the value in
    // its second child, so the replacement happens inside the member, while an array
    // element sits directly in the array.
    let holder: JsonAstNode;
    let slotIndex: number;
    let target: JsonAstNode;

    if (type === 'object') {
      const key = segmentKey(segment);
      const memberIndex = findMemberIndex(parent, key);
      if (memberIndex === -1) {
        const style = prepareContainerForInsert(parent);
        const member = createMember(key, value, buildStyleFor(parent, style), keySeparator(parent), parent.pos());
        appendChild(parent, member, style);
        return;
      }
      const member = parent.child(memberIndex);
      if (member === null) {
        throw new JsonAstPathError(`the object member ${JSON.stringify(key)} has no node`, path, segmentIndex);
      }
      const memberValue = member.child(1);
      if (memberValue === null) {
        throw new JsonAstPathError(`the object member ${JSON.stringify(key)} has no value node`, path, segmentIndex);
      }
      holder = member;
      slotIndex = 1;
      target = memberValue;
    } else if (type === 'array') {
      const index = arrayIndex(segment, segmentIndex, path);
      const length = parent.childs().length;
      if (index === length) {
        const style = prepareContainerForInsert(parent);
        const element = buildValue(value, buildStyleFor(parent, style), parent.pos());
        appendChild(parent, element, style);
        return;
      }
      if (index > length) {
        throw new JsonAstPathError(
          `index ${index} is out of range for an array of length ${length} (use push to append)`,
          path,
          segmentIndex,
        );
      }
      const element = parent.child(index);
      if (element === null) {
        throw new JsonAstPathError(`index ${index} has no value node`, path, segmentIndex);
      }
      holder = parent;
      slotIndex = index;
      target = element;
    } else {
      throw new JsonAstPathError(
        `the parent path addresses a ${type} value (only an object or an array can receive a new element)`,
        path,
        segmentIndex,
      );
    }

    if (!isContainerValue(value) && target.type() === scalarType(value as string | number | boolean | null)) {
      target.set('body', scalarText(value as string | number | boolean | null));
      target.set('value', value);
      return;
    }

    // The replacement is built from scratch, so keep the text that surrounds the old node:
    // the separator (scalars) or the trailing whitespace after the closing bracket
    // (containers). The leading part of a container prolog is its own opening bracket.
    const replacement = buildValue(value, buildStyleFor(parent, containerStyle(parent)), target.pos());
    const prefix = outsidePrefix(target);
    if (prefix !== '') {
      replacement.set('prolog', prefix + attribute(replacement, 'prolog'));
    }
    const suffix = outsideSuffix(target);
    if (suffix !== '') {
      replacement.set('epilog', attribute(replacement, 'epilog') + suffix);
    }
    replaceChild(holder, slotIndex, replacement);
  }

  /**
   * Append a value to the end of an existing array.
   *
   * The path addresses the receiving array itself (for example `['tags']`), or it is empty
   * when the root of the document is an array. The array must exist and intermediate
   * segments are never created: a missing path, a scalar and an object are errors. The new
   * element follows the formatting of the array: the indentation and the separators of a
   * multiline array, `, ` in a single-line one, compact in an empty one and `\r\n` when the
   * document uses CRLF. Node positions are not recalculated: the new node carries the
   * position of the receiving array.
   *
   * @param path - path of the existing array to append to; empty only for an array root
   * @param value - JSON value to append: string, finite number, boolean, `null`, an array or
   * a plain object, nested values included
   * @throws {JsonAstPathError} when the path is invalid or does not exist, or addresses a
   * scalar or an object instead of an array
   * @throws {Error} when the value is not a JSON value or contains a circular reference
   */
  push(path: JsonAstPath, value: unknown): void {
    const segments = validatePath(path);
    assertJsonValue(value);
    let array: JsonAstNode;
    if (segments.length === 0) {
      const type = this._ast.type();
      if (type !== 'array') {
        throw new JsonAstPathError(`the document root is a value of type ${type} (push requires an array)`, path, null);
      }
      array = this._ast;
    } else {
      const node = resolveSegments(this._ast, segments, path).node;
      const type = node.type();
      if (type !== 'array') {
        throw new JsonAstPathError(`the path addresses a value of type ${type} (push requires an array)`, path, segments.length - 1);
      }
      array = node;
    }
    const style = prepareContainerForInsert(array);
    const element = buildValue(value, buildStyleFor(array, style), array.pos());
    appendChild(array, element, style);
  }

  /**
   * Remove the existing value addressed by a path.
   *
   * An object key removes the whole member, an array index removes the element. Removing
   * the last member or element also removes the separator of the preceding one; a container
   * that becomes empty is normalised to `{}` or `[]` (its inner whitespace is dropped, the
   * whitespace around it is kept). Node positions of the remaining nodes stay as parsed.
   *
   * @param path - path of an existing value, never empty
   * @throws {JsonAstPathError} when the path is empty or invalid, does not exist, or runs
   * through a scalar value
   */
  delete(path: JsonAstPath): void {
    const segments = validatePath(path);
    assertMutationPath(segments, path);
    const slot = resolveSegments(this._ast, segments, path);
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
