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
import { applyEdits, type Edit, type Node } from 'jsonc-parser';
import { JsonDataError } from '../../errors';
import { escapePath } from '../../path';
import { TDataPath, TPathSegment, UInsertionPoint } from '../../types';
import { FileBase } from '../file.base';
import { IFileFormat } from '../types';
import { findValueNode, nodeValue, parseTreeOrThrow } from './lib';


export class JsonFile extends FileBase implements IFileFormat {
  private nodeRoot!: Node;
  private getRoot() {
    if (!this.nodeRoot) {
      const nodeRoot = parseTreeOrThrow(this.fileContent);
      if (!nodeRoot) {
        throw new Error(`File content not parsed`);
      }
      this.nodeRoot = nodeRoot;
    }
    return this.nodeRoot;
  }

  async getValue<T extends unknown = unknown>(dataPath: TDataPath): Promise<T | undefined> {
    const node = findValueNode(this.getRoot(), dataPath);
    const value = node ? nodeValue<T>(node) : undefined;
    return Promise.resolve(value);
  }

  async setValue<T>(dataPath: TDataPath, value: T): Promise<boolean> {
    const root = this.getRoot();

    // Empty file → build a whole new document.
    // if (!root) {
    //   const nested = buildNestedValue(dataPath, value);
    //   return serializeRoot(nested);
    // }

    const point = findInsertionPoint(root, dataPath);
    if (point.found) {

      const edit = replaceValueEdit(this.fileContent, point.node, value);
      applyEdits(this.fileContent, [edit]);
      return Promise.resolve(true);
    }

    const nestedValue = buildNestedValue(point.remaining, value);
    const edit = insertValueEdit(this.fileContent, point.parent, point.segment, nestedValue);
    applyEdits(this.fileContent, [edit]);

    return Promise.resolve(true);
  }
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
export function setJsonValue(fileContent: string, dataPath: TDataPath, value: unknown): string {
  const root = parseTreeOrThrow(fileContent);

  // Empty file → build a whole new document.
  if (!root) {
    const nested = buildNestedValue(dataPath, value);
    return serializeRoot(nested);
  }

  const point = findInsertionPoint(root, dataPath);
  if (point.found) {

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
export function addJsonValue(fileContent: string, path: TDataPath, value: unknown): string {
  return setJsonValue(fileContent, path, value, { insert: true });
}

function findInsertionPoint(root: Node, dataPath: TDataPath): UInsertionPoint {
  let node: Node | undefined = root;
  for (let i = 0; i < dataPath.length; i++) {
    const segment = dataPath[i];
    if (!node) {
      throw new JsonDataError(`Value at path "${pathToString(dataPath)}" is not a container`);
    }
    if (node.type === 'object') {
      if (typeof segment !== 'string') {
        throw new JsonDataError(`Array index "${segment}" used against an object at path "${pathToString(dataPath)}"`);
      }
      const prop: Node | undefined = (node.children ?? []).find((candidate: Node) => candidate.children?.[0]?.value === segment);
      if (!prop) {
        return { found: false, parent: node, segment, remaining: dataPath.slice(i + 1) };
      }
      node = prop.children?.[1] ?? undefined;
      continue;
    }
    if (node.type === 'array') {
      if (typeof segment !== 'number') {
        throw new JsonDataError(`Object key "${segment}" used against an array at path "${pathToString(dataPath)}"`);
      }
      const child = (node.children ?? [])[segment];
      if (child === undefined) {
        return { found: false, parent: node, segment, remaining: dataPath.slice(i + 1) };
      }
      node = child;
      continue;
    }
    // Scalar value in the middle of the path.
    throw new JsonDataError(`Value at path "${pathToString(dataPath)}" is a ${node.type}, cannot descend into "${segment}"`);
  }
  return node ? { found: true, node } : { found: false, parent: root, segment: dataPath[0], remaining: dataPath.slice(1) };
}

function replaceValueEdit(fileContent: string, node: Node, value: unknown): Edit {
  const unit = detectIndentUnit(fileContent);
  const lineIndent = lineIndentAt(fileContent, node.offset);
  const valueText = valueToText(value, lineIndent, unit);
  return { offset: node.offset, length: node.length, content: valueText };
}

function insertValueEdit(fileContent: string, parent: Node, segment: TPathSegment, value: unknown): Edit {
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

function insertObjectPropertyEdit(fileContent: string, parent: Node, key: string, valueText: string, childIndent: string): Edit {
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

function insertArrayElementEdit(fileContent: string, parent: Node, index: number, valueText: string, childIndent: string): Edit {
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

function buildNestedValue(segments: TDataPath, value: unknown): unknown {
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




function pathToString(path: TDataPath): string {
  if (typeof path === 'string') {
    return path;
  }
  return escapePath(path);
}
