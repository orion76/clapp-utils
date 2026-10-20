/**
 * JSON/JSONC data access on top of `jsonc-parser`.
 *
 * The JSON module edits JSON and JSONC documents by mutating the parse tree
 * and re-serializing only the touched regions, so comments, trailing commas
 * and the formatting of the rest of the document are preserved.
 *
 * Value handling follows the JSON grammar: strings, numbers, booleans, `null`,
 * arrays and objects. `undefined` is not a JSON value and is rejected.
 */
import { applyEdits, parseTree, type Edit, type Node, type ParseError } from 'jsonc-parser';
import {
  DataPathError,
  escapePath,
  parsePath,
  type DataPath,
  type DataPathInput,
  type PathSegment,
} from './data-path';

/**
 * JSON-compatible value as returned by `getJsonValue`.
 */
export type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue | undefined;
}
export interface JsonArray extends Array<JsonValue> {}

export interface SetJsonValueOptions {
  /**
   * When `true`, an already existing value at the path is left untouched
   * (never overwritten); only missing keys/array slots are created.
   */
  insert?: boolean;
}

export class JsonDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonDataError';
  }
}

function toSegments(path: DataPathInput): PathSegment[] {
  if (typeof path === 'string') {
    return parsePath(path);
  }
  if (path.length === 0) {
    throw new DataPathError('Path is empty');
  }
  return Array.from(path);
}

function nodeValue(node: Node): unknown {
  switch (node.type) {
    case 'array':
      return (node.children ?? []).map((child: Node) => nodeValue(child));
    case 'object': {
      const result: Record<string, unknown> = {};
      for (const prop of node.children ?? []) {
        const keyNode = prop.children?.[0];
        const valueNode = prop.children?.[1];
        if (keyNode && typeof keyNode.value === 'string') {
          result[keyNode.value] = valueNode ? nodeValue(valueNode) : undefined;
        }
      }
      return result;
    }
    default:
      return node.value;
  }
}

/**
 * Read a value located by `path` from a JSON/JSONC document.
 *
 * @param fileContent - raw file content (JSON or JSONC)
 * @param path - data path
 * @returns the value at the path, or `undefined` when the path does not exist
 * @throws {JsonDataError} when the content is not valid JSON/JSONC
 */
export function getJsonValue(fileContent: string, path: DataPathInput): unknown {
  const node = findValueNode(fileContent, path);
  return node ? nodeValue(node) : undefined;
}

function findValueNode(fileContent: string, path: DataPathInput): Node | undefined {
  const segments = toSegments(path);
  const root = parseTreeOrThrow(fileContent);
  if (!root) {
    return undefined;
  }
  let node: Node | undefined = root;
  for (const segment of segments) {
    if (!node) {
      return undefined;
    }
    node = childNode(node, segment);
  }
  return node;
}

function childNode(node: Node, segment: PathSegment): Node | undefined {
  if (node.type === 'object') {
    if (typeof segment !== 'string') {
      // A numeric segment against an object is not an existing composite path.
      return undefined;
    }
    const prop = (node.children ?? []).find((candidate: { children?: { value?: string } }) => candidate.children?.[0]?.value === segment);
    return prop ? (prop.children?.[1] ?? undefined) : undefined;
  }
  if (node.type === 'array') {
    if (typeof segment !== 'number') {
      // A key segment against an array is not an existing composite path.
      return undefined;
    }
    return (node.children ?? [])[segment] ?? undefined;
  }
  // A scalar value is not a container; the rest of the path does not exist.
  return undefined;
}

/**
 * Set a value at a path in a JSON/JSONC document, creating missing keys and
 * array slots along the way. Comments and formatting are preserved.
 *
 * @param fileContent - raw file content (JSON or JSONC)
 * @param path - data path
 * @param value - value to set (must be JSON-compatible)
 * @param options - set options
 * @returns the updated file content
 * @throws {JsonDataError} when the content is not valid JSON/JSONC, or when the
 * path crosses a scalar value (or a type mismatch), or the value is not
 * JSON-compatible
 */
export function setJsonValue(
  fileContent: string,
  path: DataPathInput,
  value: unknown,
  options: SetJsonValueOptions = {},
): string {
  const segments = toSegments(path);
  const root = parseTreeOrThrow(fileContent);

  // Empty file → build a whole new document.
  if (!root) {
    const nested = buildNestedValue(segments, value);
    return serializeRoot(nested);
  }

  const point = findInsertionPoint(root, segments, path);
  if (point.found) {
    if (options.insert) {
      return fileContent; // do not overwrite
    }
    const edit = replaceValueEdit(fileContent, point.node, value);
    return applyEdits(fileContent, [edit]);
  }

  const nestedValue = buildNestedValue(point.remaining, value);
  const edit = insertValueEdit(fileContent, point.parent, point.segment, nestedValue);
  return applyEdits(fileContent, [edit]);
}

/**
 * Add a value at a path, creating the path if it does not exist but never
 * overwriting an existing value. Convenience wrapper over
 * {@link setJsonValue} with `insert: true`.
 */
export function addJsonValue(fileContent: string, path: DataPathInput, value: unknown): string {
  return setJsonValue(fileContent, path, value, { insert: true });
}

function parseTreeOrThrow(fileContent: string): Node | undefined {
  const errors: ParseError[] = [];
  const root = parseTree(fileContent, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const error = errors[0];
    const snippet = fileContent.slice(error.offset, error.offset + error.length) || '<eof>';
    throw new JsonDataError(`Invalid JSON/JSONC content at offset ${error.offset}: ${JSON.stringify(snippet)}`);
  }
  return root;
}

type InsertionPoint =
  | { found: true; node: Node }
  | { found: false; parent: Node; segment: PathSegment; remaining: PathSegment[] };

function findInsertionPoint(root: Node, segments: PathSegment[], path: DataPathInput): InsertionPoint {
  let node: Node | undefined = root;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!node) {
      throw new JsonDataError(`Value at path "${pathToString(path)}" is not a container`);
    }
    if (node.type === 'object') {
      if (typeof segment !== 'string') {
        throw new JsonDataError(
          `Array index "${segment}" used against an object at path "${pathToString(path)}"`,
        );
      }
      const prop = (node.children ?? []).find((candidate: { children?: { value?: string } }) => candidate.children?.[0]?.value === segment);
      if (!prop) {
        return { found: false, parent: node, segment, remaining: segments.slice(i + 1) };
      }
      node = prop.children?.[1] ?? undefined;
      continue;
    }
    if (node.type === 'array') {
      if (typeof segment !== 'number') {
        throw new JsonDataError(
          `Object key "${segment}" used against an array at path "${pathToString(path)}"`,
        );
      }
      const child = (node.children ?? [])[segment];
      if (child === undefined) {
        return { found: false, parent: node, segment, remaining: segments.slice(i + 1) };
      }
      node = child;
      continue;
    }
    // Scalar value in the middle of the path.
    throw new JsonDataError(
      `Value at path "${pathToString(path)}" is a ${node.type}, cannot descend into "${segment}"`,
    );
  }
  return node
    ? { found: true, node }
    : { found: false, parent: root, segment: segments[0], remaining: segments.slice(1) };
}

function replaceValueEdit(fileContent: string, node: Node, value: unknown): Edit {
  const unit = detectIndentUnit(fileContent);
  const lineIndent = lineIndentAt(fileContent, node.offset);
  const valueText = valueToText(value, lineIndent, unit);
  return { offset: node.offset, length: node.length, content: valueText };
}

function insertValueEdit(fileContent: string, parent: Node, segment: PathSegment, value: unknown): Edit {
  const unit = detectIndentUnit(fileContent);
  const braceIndent = lineIndentAt(fileContent, parent.offset);
  const childIndent = `${braceIndent}${unit}`;

  if (parent.type === 'object') {
    if (typeof segment !== 'string') {
      throw new JsonDataError(`Cannot insert array index "${segment}" into an object`);
    }
    const valueText = valueToText(value, childIndent, unit);
    return insertObjectPropertyEdit(fileContent, parent, segment, valueText, childIndent);
  }
  if (parent.type === 'array') {
    if (typeof segment !== 'number') {
      throw new JsonDataError(`Cannot insert object key "${segment}" into an array`);
    }
    const valueText = valueToText(value, childIndent, unit);
    return insertArrayElementEdit(fileContent, parent, segment, valueText, childIndent);
  }
  throw new JsonDataError(`Cannot insert into a ${parent.type} value`);
}

function insertObjectPropertyEdit(
  fileContent: string,
  parent: Node,
  key: string,
  valueText: string,
  childIndent: string,
): Edit {
  const closePos = parent.offset + parent.length - 1;
  const children = parent.children ?? [];
  const propLine = `${childIndent}${JSON.stringify(key)}: ${valueText}`;

  if (children.length === 0) {
    const inner = fileContent.slice(parent.offset + 1, closePos);
    const block = inner.includes('\n');
    if (block) {
      const eol = newlineFor(fileContent);
      const braceIndent = braceIndentOf(fileContent, parent);
      // Replace the whitespace between the braces with the property on its own line.
      return {
        offset: parent.offset + 1,
        length: closePos - (parent.offset + 1),
        content: `${eol}${childIndent}${JSON.stringify(key)}: ${valueText}${eol}${braceIndent}`,
      };
    }
    return insertEditAt(closePos, ` ${JSON.stringify(key)}: ${valueText}`);
  }

  const lastChild = children[children.length - 1];
  const lastEnd = lastChild.offset + lastChild.length;
  const after = fileContent.charAt(lastEnd);

  if (after === ',') {
    // Trailing comma is already present: add a new line after it.
    return insertEditAt(lastEnd + 1, `${newlineFor(fileContent)}${propLine}`);
  }
  return insertEditAt(lastEnd, `,${newlineFor(fileContent)}${propLine}`);
}

function insertArrayElementEdit(
  fileContent: string,
  parent: Node,
  index: number,
  valueText: string,
  childIndent: string,
): Edit {
  const closePos = parent.offset + parent.length - 1;
  const children = parent.children ?? [];
  const elementLine = `${childIndent}${valueText}`;

  if (children.length === 0) {
    const inner = fileContent.slice(parent.offset + 1, closePos);
    const block = inner.includes('\n');
    if (block) {
      const eol = newlineFor(fileContent);
      const braceIndent = braceIndentOf(fileContent, parent);
      // Replace the whitespace between the brackets with the element on its own line.
      return {
        offset: parent.offset + 1,
        length: closePos - (parent.offset + 1),
        content: `${eol}${elementLine}${eol}${braceIndent}`,
      };
    }
    return insertEditAt(closePos, ` ${valueText}`);
  }

  // Append at the end of the (existing) array; the element exists only when
  // `index < children.length`, which the find phase already handled.
  const lastChild = children[children.length - 1];
  const lastEnd = lastChild.offset + lastChild.length;
  const after = fileContent.charAt(lastEnd);
  if (after === ',') {
    return insertEditAt(lastEnd + 1, `${newlineFor(fileContent)}${elementLine}`);
  }
  return insertEditAt(lastEnd, `,${newlineFor(fileContent)}${elementLine}`);
}

function braceIndentOf(fileContent: string, parent: Node): string {
  return lineIndentAt(fileContent, parent.offset);
}

function insertEditAt(offset: number, content: string): Edit {
  return { offset, length: 0, content };
}

function newlineFor(fileContent: string): string {
  return fileContent.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * Serialize a JS value into JSON text, indenting nested blocks with `unit`.
 *
 * `lineIndent` is the indentation of the line on which the value starts; it is
 * used as the base for the value's closing bracket/brace and nested lines.
 */
function valueToText(value: unknown, lineIndent: string, unit: string): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    const items = value.map((item) => `${lineIndent}${unit}${valueToText(item, `${lineIndent}${unit}`, unit)}`);
    return `[\n${items.join(`,\n`)}\n${lineIndent}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    if (entries.length === 0) {
      return '{}';
    }
    const items = entries.map(
      ([key, item]) => `${lineIndent}${unit}${JSON.stringify(key)}: ${valueToText(item, `${lineIndent}${unit}`, unit)}`,
    );
    return `{\n${items.join(`,\n`)}\n${lineIndent}}`;
  }
  throw new JsonDataError(`Value of type "${typeof value}" is not JSON-compatible`);
}

function buildNestedValue(segments: PathSegment[], value: unknown): unknown {
  let current: unknown = value;
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (typeof segment === 'number') {
      const arr: unknown[] = [];
      for (let slot = 0; slot < segment; slot++) {
        arr.push(null);
      }
      arr.push(current);
      current = arr;
    } else {
      current = { [segment]: current };
    }
  }
  return current;
}

function serializeRoot(value: unknown): string {
  const unit = '  ';
  return `${valueToText(value, '', unit)}\n`;
}

function detectIndentUnit(text: string): string {
  const lines = text.split(/\r?\n/);
  let smallest: string | null = null;
  for (const line of lines) {
    const match = line.match(/^([ \t]+)\S/);
    if (match) {
      const candidate = match[1];
      if (!smallest || candidate.length < smallest.length) {
        smallest = candidate;
      }
    }
  }
  if (smallest) {
    return smallest.startsWith('\t') ? '\t' : smallest;
  }
  return '  ';
}

function lineIndentAt(text: string, offset: number): string {
  const lineStart = text.lastIndexOf('\n', offset) + 1;
  const match = /^[ \t]*/.exec(text.slice(lineStart, lineStart + 512))?.[0] ?? '';
  return match;
}

function pathToString(path: DataPathInput): string {
  if (typeof path === 'string') {
    return path;
  }
  return escapePath(path);
}
