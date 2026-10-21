/**
 * Decoding of AST nodes into plain JavaScript values and validation of values to store.
 *
 * Reads drop all raw text of the tree, writes reject anything that JSON cannot represent
 * before the tree is touched.
 */
import type { JsonAstNode } from '../types';

/**
 * Decode a node into a plain JavaScript value, dropping all raw text.
 *
 * @param node - node to decode
 * @returns a plain object (document order, last duplicate key wins), an array, or the
 * decoded scalar value
 */
export function decodeValue(node: JsonAstNode): unknown {
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
 * @param value - value passed to `set` or `push`
 * @throws {Error} for `undefined`, a function, a symbol, a bigint, `NaN`, `Infinity`, a
 * non-plain object (a class instance, `Date`, `Map`, ...) or a circular reference; the
 * message names the offending location inside the value
 */
export function assertJsonValue(value: unknown): void {
  assertJsonValueAt(value, '$', new Set<object>());
}

/**
 * Recursive part of {@link assertJsonValue}.
 *
 * @param value - value to check
 * @param where - location of the value inside the argument, used in the error
 * @param ancestors - objects on the current recursion path, used to detect cycles
 */
export function assertJsonValueAt(value: unknown, where: string, ancestors: Set<object>): void {
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
export function isContainerValue(value: unknown): boolean {
  return Array.isArray(value) || (value !== null && typeof value === 'object');
}
