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
import { JsonAstPathError } from './errors';
import { createNode, insertChild, removeChild, replaceChild } from './node';
import type { AstNodePos, JsonAstNode, JsonAstNodeType, JsonAstPath, JsonAstPathSegment } from './types';

/** Canonical non-negative decimal integer, accepted as an array index. */
const CANONICAL_INDEX = /^(0|[1-9][0-9]*)$/;

/** Key/value separator used when a container has no member to copy the separator from. */
const KEY_SEPARATOR = ': ';

/** Indentation step used for a nested container when the host container is single-line. */
const DEFAULT_INDENT_STEP = '  ';

/** Formatting of a container, taken from its own `prolog`/`epilog`. */
interface ContainerStyle {
  /** Whether the container spreads its children over several lines. */
  readonly multiline: boolean;
  /** Indentation of the children of a multiline container (`''` when single-line). */
  readonly indent: string;
  /** Text that separates two children (`,` plus whitespace). */
  readonly separator: string;
  /** Line break of the document (`'\n'` or `'\r\n'`), used for every inserted line. */
  readonly newline: string;
}

/** Formatting context for a value the editor is about to build. */
interface BuildStyle {
  /** Whether containers are laid out over several lines. */
  readonly multiline: boolean;
  /** Indentation of the bracket lines of the value itself. */
  readonly indent: string;
  /** Indentation added per nesting level. */
  readonly step: string;
  /** Line break of the document (`'\n'` or `'\r\n'`), used for every built line. */
  readonly newline: string;
}

/** Location of a value inside the tree: the node plus the slot that holds it. */
interface Slot {
  /** Addressed node: an object member value, an array element or the document root. */
  readonly node: JsonAstNode;
  /** Object or array that holds the node, `null` for the document root. */
  readonly container: JsonAstNode | null;
  /** Position of the member or element inside {@link container}. */
  readonly slotIndex: number;
}

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

/**
 * Validate the path argument and every segment.
 *
 * @param path - path passed to the editor
 * @returns the same path, narrowed to validated segments
 * @throws {JsonAstPathError} when the path is not an array or a segment is neither a string
 * nor a non-negative integer number
 */
function validatePath(path: JsonAstPath): JsonAstPathSegment[] {
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
function validateSegment(segment: JsonAstPathSegment, segmentIndex: number, path: JsonAstPath): void {
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
function assertMutationPath(segments: JsonAstPathSegment[], path: JsonAstPath): void {
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
function rootPathError(path: JsonAstPath): JsonAstPathError {
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
function resolveSlot(ast: JsonAstNode, path: JsonAstPath): Slot {
  return resolveSegments(ast, validatePath(path), path);
}

/**
 * Resolve validated segments to the node and the slot that holds it.
 *
 * @param ast - root node
 * @param segments - validated segments to walk, a prefix of `path` for `add`
 * @param path - path of the operation, used as is in the errors
 * @returns the addressed slot; for an empty segment list the root node with `container: null`
 * @throws {JsonAstPathError} when a key or an index is missing or the path runs through a
 * scalar value
 */
function resolveSegments(ast: JsonAstNode, segments: JsonAstPathSegment[], path: JsonAstPath): Slot {
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
function findMemberIndex(object: JsonAstNode, key: string): number {
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
function segmentKey(segment: JsonAstPathSegment): string {
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
function arrayIndex(segment: JsonAstPathSegment, segmentIndex: number, path: JsonAstPath): number {
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

/**
 * Decode a node into a plain JavaScript value, dropping all raw text.
 *
 * @param node - node to decode
 * @returns a plain object (document order, last duplicate key wins), an array, or the
 * decoded scalar value
 */
function decodeValue(node: JsonAstNode): unknown {
  const type = node.type();
  if (type === 'object') {
    const result: Record<string, unknown> = {};
    for (const member of node.childs()) {
      const name = member.child(0);
      const value = member.child(1);
      if (name === null || value === null) {
        continue;
      }
      const key = name.get('value');
      result[typeof key === 'string' ? key : String(key)] = decodeValue(value);
    }
    return result;
  }
  if (type === 'array') {
    return node.childs().map((child) => decodeValue(child));
  }
  return node.get('value');
}

/**
 * Check that a value can be stored as JSON, recursing into arrays and plain objects.
 *
 * @param value - value passed to `set` or `add`
 * @throws {Error} for `undefined`, a function, a symbol, a bigint, `NaN`, `Infinity`, a
 * non-plain object (a class instance, `Date`, `Map`, ...) or a circular reference; the
 * message names the offending location inside the value
 */
function assertJsonValue(value: unknown): void {
  assertJsonValueAt(value, '$', new Set<object>());
}

/**
 * Recursive part of {@link assertJsonValue}.
 *
 * @param value - value to check
 * @param where - location of the value inside the argument, used in the error
 * @param ancestors - objects on the current recursion path, used to detect cycles
 */
function assertJsonValueAt(value: unknown, where: string, ancestors: Set<object>): void {
  if (value === null) {
    return;
  }
  const type = typeof value;
  if (type === 'string' || type === 'boolean') {
    return;
  }
  if (type === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`invalid JSON value at ${where}: ${String(value)} is not a finite number`);
    }
    return;
  }
  if (type === 'undefined') {
    throw new Error(`invalid JSON value at ${where}: undefined is not a JSON value`);
  }
  if (type === 'function' || type === 'symbol' || type === 'bigint') {
    throw new Error(`invalid JSON value at ${where}: a ${type} is not a JSON value`);
  }

  const object = value as object;
  if (ancestors.has(object)) {
    throw new Error(`invalid JSON value at ${where}: circular reference is not allowed`);
  }
  ancestors.add(object);
  if (Array.isArray(object)) {
    for (let index = 0; index < object.length; index += 1) {
      assertJsonValueAt(object[index], `${where}[${index}]`, ancestors);
    }
  } else {
    const prototype = Object.getPrototypeOf(object);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`invalid JSON value at ${where}: ${describeObject(object)} is not a plain object or an array`);
    }
    for (const key of Object.keys(object)) {
      assertJsonValueAt((object as Record<string, unknown>)[key], `${where}.${key}`, ancestors);
    }
  }
  ancestors.delete(object);
}

/**
 * Name a rejected object for an error message: its constructor name when it has one,
 * otherwise the `Object.prototype.toString` tag.
 */
function describeObject(object: object): string {
  const prototype: unknown = Object.getPrototypeOf(object);
  if (typeof prototype === 'object' && prototype !== null) {
    const constructor: unknown = (prototype as { constructor?: unknown }).constructor;
    if (typeof constructor === 'function' && constructor.name !== '') {
      return constructor.name;
    }
  }
  return Object.prototype.toString.call(object);
}

/**
 * Check whether a validated value has to be built as a container node.
 */
function isContainerValue(value: unknown): boolean {
  return Array.isArray(value) || (value !== null && typeof value === 'object');
}

/** Check whether a node is an object or an array. */
function isContainer(node: JsonAstNode): boolean {
  const type = node.type();
  return type === 'object' || type === 'array';
}

/**
 * Read a string attribute of a node.
 *
 * @returns the attribute value, `''` when it is absent or not a string
 */
function attribute(node: JsonAstNode, name: string): string {
  const value = node.get(name);
  return typeof value === 'string' ? value : '';
}

/** Opening and closing bracket of a container node. */
function brackets(container: JsonAstNode): [string, string] {
  return container.type() === 'object' ? ['{', '}'] : ['[', ']'];
}

/**
 * Text of a scalar node for a new `body`: a quoted string, a number literal (with `-0`
 * kept), `true`, `false` or `null`.
 */
function scalarText(value: string | number | boolean | null): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    return Object.is(value, -0) ? '-0' : String(value);
  }
  return value ? 'true' : 'false';
}

/** Node type of a scalar value. */
function scalarType(value: string | number | boolean | null): JsonAstNodeType {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return 'string';
  }
  return typeof value === 'number' ? 'number' : 'boolean';
}

/** Build a scalar node with the text and the decoded value of the argument. */
function createScalarNode(value: string | number | boolean | null, pos: AstNodePos): JsonAstNode {
  return createNode(scalarType(value), pos, { body: scalarText(value), value });
}

/**
 * Build a node for a validated JSON value.
 *
 * @param value - validated JSON value
 * @param style - formatting context of the place the value goes to
 * @param pos - position to report from the new nodes
 * @returns a detached node with the whole subtree
 */
function buildValue(value: unknown, style: BuildStyle, pos: AstNodePos): JsonAstNode {
  if (Array.isArray(value)) {
    return buildArray(value, style, pos);
  }
  if (value !== null && typeof value === 'object') {
    return buildObject(value as Record<string, unknown>, style, pos);
  }
  return createScalarNode(value as string | number | boolean | null, pos);
}

/**
 * Build an array node.
 *
 * An empty array stays compact (`[]`); a multiline context spreads the elements over lines
 * with one indentation step, a single-line context joins them with `, `.
 */
function buildArray(values: unknown[], style: BuildStyle, pos: AstNodePos): JsonAstNode {
  if (values.length === 0) {
    return createNode('array', pos, { prolog: '[', epilog: ']' });
  }
  const children = childStyle(style);
  const separator = children.multiline ? `,${children.newline}${children.indent}` : ', ';
  const elements: JsonAstNode[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const element = buildValue(values[index], children, pos);
    if (index < values.length - 1) {
      element.set('epilog', separator);
    }
    elements.push(element);
  }
  if (!style.multiline) {
    return createNode('array', pos, { prolog: '[', epilog: ']' }, elements);
  }
  return createNode(
    'array',
    pos,
    { prolog: `[${children.newline}${children.indent}`, epilog: `${children.newline}${style.indent}]` },
    elements,
  );
}

/**
 * Build an object node.
 *
 * An empty object stays compact (`{}`); a multiline context spreads the members over lines
 * with one indentation step, a single-line context joins them with `, `. Keys use the
 * standard `": "` separator.
 */
function buildObject(value: Record<string, unknown>, style: BuildStyle, pos: AstNodePos): JsonAstNode {
  const keys = Object.keys(value);
  if (keys.length === 0) {
    return createNode('object', pos, { prolog: '{', epilog: '}' });
  }
  const children = childStyle(style);
  const separator = children.multiline ? `,${children.newline}${children.indent}` : ', ';
  const members: JsonAstNode[] = [];
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    const member = createMember(key, value[key], children, KEY_SEPARATOR, pos);
    if (index < keys.length - 1) {
      member.set('epilog', separator);
    }
    members.push(member);
  }
  if (!style.multiline) {
    return createNode('object', pos, { prolog: '{', epilog: '}' }, members);
  }
  return createNode(
    'object',
    pos,
    { prolog: `{${children.newline}${children.indent}`, epilog: `${children.newline}${style.indent}}` },
    members,
  );
}

/**
 * Build a `member` node: a string key with the requested separator in its `epilog` and a
 * value node.
 */
function createMember(key: string, value: unknown, style: BuildStyle, keySeparator: string, pos: AstNodePos): JsonAstNode {
  const name = createNode('string', pos, { body: JSON.stringify(key), value: key });
  name.set('epilog', keySeparator);
  return createNode('member', pos, undefined, [name, buildValue(value, style, pos)]);
}

/** Indentation added per nesting level inside the given build context. */
function childStyle(style: BuildStyle): BuildStyle {
  if (!style.multiline) {
    return style;
  }
  return { multiline: true, indent: style.indent + style.step, step: style.step, newline: style.newline };
}

/**
 * Formatting of a container taken from its own text.
 *
 * A container is multiline when its `prolog` or its `epilog` contains a newline; the child
 * indent is the whitespace after the last newline of the `prolog` and the separator is `,`
 * plus a newline plus that indent. A single-line container separates children with `, `.
 * The line break comes from the container text: CRLF when it appears there, LF otherwise,
 * so an inserted line never mixes the two styles.
 */
function containerStyle(container: JsonAstNode): ContainerStyle {
  const prolog = attribute(container, 'prolog');
  const epilog = attribute(container, 'epilog');
  const newline = lineBreak(prolog, epilog);
  if (!prolog.includes('\n') && !epilog.includes('\n')) {
    return { multiline: false, indent: '', separator: ', ', newline };
  }
  const indent = leadingWhitespace(lastLine(prolog));
  return { multiline: true, indent, separator: `,${newline}${indent}`, newline };
}

/**
 * Line break used by the document around a container: `'\r\n'` when the given text already
 * uses CRLF, `'\n'` otherwise.
 */
function lineBreak(prolog: string, epilog: string): string {
  return prolog.includes('\r\n') || epilog.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * Indentation of the bracket line of a container, derived from the whitespace before its
 * closing bracket.
 */
function ownIndent(container: JsonAstNode): string {
  const epilog = attribute(container, 'epilog');
  const newline = epilog.lastIndexOf('\n');
  if (newline === -1) {
    return '';
  }
  return leadingWhitespace(epilog.slice(newline + 1));
}

/**
 * Indentation added by one nesting level of a container: the difference between the indent
 * of its children and the indent of its own closing bracket (`''` for the root).
 */
function indentStep(container: JsonAstNode, style: ContainerStyle): string {
  const own = ownIndent(container);
  return style.indent.startsWith(own) ? style.indent.slice(own.length) : style.indent;
}

/** Build context for a value inserted into the given container. */
function buildStyleFor(container: JsonAstNode, style: ContainerStyle): BuildStyle {
  if (!style.multiline) {
    return { multiline: false, indent: '', step: DEFAULT_INDENT_STEP, newline: style.newline };
  }
  return { multiline: true, indent: style.indent, step: indentStep(container, style), newline: style.newline };
}

/** Last line of a text. */
function lastLine(text: string): string {
  const newline = text.lastIndexOf('\n');
  return newline === -1 ? text : text.slice(newline + 1);
}

/** Leading spaces and tabs of a text. */
function leadingWhitespace(text: string): string {
  let index = 0;
  while (index < text.length) {
    const char = text.charAt(index);
    if (char !== ' ' && char !== '\t') {
      break;
    }
    index += 1;
  }
  return text.slice(0, index);
}

/**
 * Text of a node that belongs to the document around it, before the node content: the whole
 * `prolog` of a scalar, the part of a container `prolog` before its opening bracket.
 */
function outsidePrefix(node: JsonAstNode): string {
  const prolog = attribute(node, 'prolog');
  if (!isContainer(node)) {
    return prolog;
  }
  const [open] = brackets(node);
  const index = prolog.indexOf(open);
  return index === -1 ? prolog : prolog.slice(0, index);
}

/**
 * Text of a node that belongs to the document around it, after the node content: the whole
 * `epilog` of a scalar, the part of a container `epilog` after its closing bracket.
 */
function outsideSuffix(node: JsonAstNode): string {
  const epilog = attribute(node, 'epilog');
  if (!isContainer(node)) {
    return epilog;
  }
  const [, close] = brackets(node);
  const index = epilog.indexOf(close);
  return index === -1 ? '' : epilog.slice(index + 1);
}

/**
 * Normalise an empty container to `{}` or `[]`: the inner whitespace is dropped, the
 * whitespace around the container is kept.
 */
function normalizeContainer(container: JsonAstNode): void {
  const [open, close] = brackets(container);
  const prolog = attribute(container, 'prolog');
  const epilog = attribute(container, 'epilog');
  const openIndex = prolog.indexOf(open);
  const closeIndex = epilog.indexOf(close);
  container.set('prolog', openIndex === -1 ? open : prolog.slice(0, openIndex + 1));
  container.set('epilog', closeIndex === -1 ? epilog : epilog.slice(closeIndex));
}

/**
 * Prepare a container for an insertion: an empty container becomes compact (`{}`/`[]`) so
 * the first child is added without line breaks.
 *
 * @returns the formatting the container will use for the new child
 */
function prepareContainerForInsert(container: JsonAstNode): ContainerStyle {
  if (container.childs().length === 0) {
    normalizeContainer(container);
  }
  return containerStyle(container);
}

/**
 * Insert a detached node into a container and place the separator.
 *
 * Appending puts the separator into the `epilog` of the previous child; inserting anywhere
 * else puts it into the `epilog` of the new child, so it separates the new node from the
 * following one.
 */
function insertIntoContainer(container: JsonAstNode, index: number, child: JsonAstNode, style: ContainerStyle): void {
  const children = container.childs();
  if (children.length === 0) {
    insertChild(container, 0, child);
    return;
  }
  if (index >= children.length) {
    const previous = children[children.length - 1];
    previous.set('epilog', attribute(previous, 'epilog') + style.separator);
    insertChild(container, children.length, child);
    return;
  }
  child.set('epilog', attribute(child, 'epilog') + style.separator);
  insertChild(container, index, child);
}

/**
 * Key/value separator of a new object member: the `epilog` of the first existing key, or
 * the standard `": "` when the object has no members.
 */
function keySeparator(object: JsonAstNode): string {
  const member = object.child(0);
  const key = member === null ? null : member.child(0);
  if (key === null) {
    return KEY_SEPARATOR;
  }
  const epilog = attribute(key, 'epilog');
  return epilog === '' ? KEY_SEPARATOR : epilog;
}
