/**
 * JSON/JSONC data access on top of the lossless `json-ast` module.
 *
 * The JSON module edits JSON and JSONC documents through `JsonAst.parse` /
 * `JsonAstEditor` / `JsonAst.unparse`, so comments, trailing commas and the formatting of
 * the untouched parts of the document are preserved.
 *
 * Value handling follows the JSON grammar: strings, numbers, booleans, `null`, arrays and
 * objects. `undefined` is not a JSON value and is rejected.
 */
import type { JsonAstNode, JsonAstPath, JsonAstPathSegment } from '../../../json-ast';
import { JsonAst, JsonAstEditor, JsonAstPathError } from '../../../json-ast';
import { JsonDataError } from '../../errors';
import { FileBase } from '../../format.base';
import { escapePath } from '../../path';


import { IFileFormat, TObjectPath } from '../../types';

/** Canonical non-negative decimal integer, accepted as an array index. */
const CANONICAL_INDEX = /^(0|[1-9][0-9]*)$/;

/**
 * Copy a read-only data path into the mutable path type the AST editor accepts.
 *
 * `TObjectPath` is readonly while `JsonAstPath` is mutable; copying keeps the public
 * `json-ast` API unchanged and the data path untouched.
 */
function toAstPath(dataPath: TObjectPath): JsonAstPath {
  return [...dataPath];
}

/**
 * Parse a document into the lossless AST.
 *
 * @param fileContent - raw JSON/JSONC text
 * @throws {JsonDataError} when the text is not valid JSON/JSONC
 */
function parseOrThrow(fileContent: string): JsonAstNode {
  try {
    return JsonAst.parse(fileContent);
  } catch (error) {
    throw new JsonDataError(
      `Invalid JSON/JSONC content: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Wrap an error of a path operation into `JsonDataError`.
 *
 * `JsonAstPathError` carries the path context of the failing segment; a plain error (an
 * invalid value, for example) is passed through as a `JsonDataError` with its message.
 */
function toDataError(dataPath: TObjectPath, error: unknown): Error {
  if (error instanceof JsonDataError) {
    return error;
  }
  if (error instanceof JsonAstPathError) {
    return new JsonDataError(`Cannot access data path "${escapePath(dataPath)}": ${error.message}`);
  }
  if (error instanceof Error) {
    return new JsonDataError(error.message);
  }
  return new JsonDataError(String(error));
}

/**
 * Resolve a path segment to an array index.
 *
 * @returns the index, `null` when the segment is not a canonical array index
 */
function arraySlot(segment: JsonAstPathSegment): number | null {
  if (typeof segment === 'number') {
    return segment;
  }
  return CANONICAL_INDEX.test(segment) ? Number.parseInt(segment, 10) : null;
}

/**
 * Build the subtree for the path segments that do not exist yet.
 *
 * A string segment becomes a new object key, a number segment becomes an array with `null`
 * slots up to its index and the nested value at that index; the segments are applied from
 * the last one outwards, so `['x', 1]` and a value `2` build `{ x: [null, 2] }`.
 *
 * @param segments - missing path segments, from the first missing one
 * @param value - value to place at the end of the path
 * @returns the nested value built for the first missing segment
 */
function buildNestedValue(segments: JsonAstPath, value: unknown): unknown {
  let current: unknown = value;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (typeof segment === 'number') {
      const items: unknown[] = [];
      for (let slot = 0; slot < segment; slot += 1) {
        items.push(null);
      }
      items.push(current);
      current = items;
      continue;
    }
    current = { [segment]: current };
  }
  return current;
}

/**
 * Fill the array slots before a missing target index with `null`.
 *
 * Only an array parent needs this: {@link JsonAstEditor.set} creates an element at
 * `index === length` and rejects a larger index, while a data path addresses a slot and the
 * slots before it become `null`, as in {@link buildNestedValue}.
 */
function fillArraySlots(editor: JsonAstEditor, parentPath: JsonAstPath, segment: JsonAstPathSegment): void {
  const parent = editor.node(parentPath);
  if (parent.type() !== 'array') {
    return;
  }
  const slot = arraySlot(segment);
  if (slot === null) {
    return;
  }
  const length = parent.childs().length;
  for (let index = length; index < slot; index += 1) {
    editor.set(parentPath.concat(index), null);
  }
}

/**
 * Write a value at a path, creating the missing segments of the path.
 *
 * An existing address is overwritten. For a missing one the longest existing path prefix is
 * looked up and the rest of the path is built as a subtree inserted into the deepest
 * existing container, so `['x', 'y']` in `{}` creates `{ x: { y: value } }`. Missing array
 * slots before the target index are filled with `null`. Only the last segment may be built
 * inside a scalar: a path that runs through a scalar value still fails.
 *
 * @param editor - editor over the parsed document
 * @param path - path of the value to write, never empty
 * @param value - JSON value to store
 * @throws {JsonAstPathError} when the path is empty or invalid, or runs through a scalar value
 * @throws {Error} when the value is not a JSON value
 */
function setValueAtPath(editor: JsonAstEditor, path: JsonAstPath, value: unknown): void {
  if (editor.has(path)) {
    editor.set(path, value);
    return;
  }
  let existing = path.length - 1;
  while (existing > 0 && !editor.has(path.slice(0, existing))) {
    existing -= 1;
  }
  const parentPath = path.slice(0, existing);
  const missing = path.slice(existing);
  const target = parentPath.concat(missing[0]);
  const nested = missing.length === 1 ? value : buildNestedValue(missing.slice(1), value);
  fillArraySlots(editor, parentPath, missing[0]);
  editor.set(target, nested);
}

export class JsonFile extends FileBase implements IFileFormat {
  private _ast: JsonAstNode | undefined;

  protected getDoc<T>(): T {
    if (this._ast === undefined) {
      this._ast = parseOrThrow(this.fileContent);
    }
    return this._ast as T;
  }

  protected getValue<T extends unknown = unknown>(dataPath: TObjectPath): T | undefined {
    const ast = this.getDoc<JsonAstNode>();
    const editor = new JsonAstEditor(ast);
    const path = toAstPath(dataPath);
    try {
      if (!editor.has(path)) {
        return undefined;
      }
      return editor.get(path) as T;
    } catch (error) {
      throw toDataError(dataPath, error);
    }
  }

  protected setValue(dataPath: TObjectPath, value: unknown): boolean {
    if (value === undefined) {
      throw new JsonDataError('Value "undefined" is not a JSON value');
    }
    const ast = this.getDoc<JsonAstNode>();
    const editor = new JsonAstEditor(ast);
    try {
      setValueAtPath(editor, toAstPath(dataPath), value);
    } catch (error) {
      throw toDataError(dataPath, error);
    }
    return true;
  }

  protected deleteValue(dataPath: TObjectPath): boolean {
    const ast = this.getDoc<JsonAstNode>();
    const editor = new JsonAstEditor(ast);
    try {
      editor.delete(toAstPath(dataPath));
    } catch (error) {
      throw toDataError(dataPath, error);
    }
    return true;
  }

  protected getFileContent(): string {
    return JsonAst.unparse(this.getDoc<JsonAstNode>());
  }
}

/**
 * Read a value at a data path in a JSON/JSONC document.
 *
 * @param fileContent - raw file content (JSON or JSONC)
 * @param dataPath - data path
 * @returns the value at the path, `undefined` when the path does not exist
 * @throws {JsonDataError} when the content is not valid JSON/JSONC or the path is invalid
 */
export function getJsonValue(fileContent: string, dataPath: TObjectPath): unknown {
  const ast = parseOrThrow(fileContent);
  const editor = new JsonAstEditor(ast);
  const path = toAstPath(dataPath);
  try {
    if (!editor.has(path)) {
      return undefined;
    }
    return editor.get(path);
  } catch (error) {
    throw toDataError(dataPath, error);
  }
}

/**
 * Set a value at a data path in a JSON/JSONC document, creating the missing segments of the
 * path. Comments and the formatting of the untouched parts are preserved.
 *
 * @param fileContent - raw file content (JSON or JSONC)
 * @param dataPath - data path; missing keys and array slots are created
 * @param value - value to set (must be JSON-compatible)
 * @returns the updated file content
 * @throws {JsonDataError} when the content is not valid JSON/JSONC, the path is invalid or
 * crosses a scalar value, or the value is not JSON-compatible
 */
export function setJsonValue(fileContent: string, dataPath: TObjectPath, value: unknown): string {
  if (value === undefined) {
    throw new JsonDataError('Value "undefined" is not a JSON value');
  }
  const ast = parseOrThrow(fileContent);
  const editor = new JsonAstEditor(ast);
  try {
    setValueAtPath(editor, toAstPath(dataPath), value);
  } catch (error) {
    throw toDataError(dataPath, error);
  }
  return JsonAst.unparse(ast);
}

/**
 * Add a value at a data path, creating the path if it does not exist but never
 * overwriting an existing value.
 *
 * @param fileContent - raw file content (JSON or JSONC)
 * @param dataPath - data path; missing keys and array slots are created
 * @param value - value to add (must be JSON-compatible)
 * @returns the updated file content, or the original text when the path already exists
 * @throws {JsonDataError} when the content is not valid JSON/JSONC, the path is invalid or
 * crosses a scalar value, or the value is not JSON-compatible
 */
export function addJsonValue(fileContent: string, dataPath: TObjectPath, value: unknown): string {
  if (value === undefined) {
    throw new JsonDataError('Value "undefined" is not a JSON value');
  }
  const ast = parseOrThrow(fileContent);
  const editor = new JsonAstEditor(ast);
  const path = toAstPath(dataPath);
  try {
    if (editor.has(path)) {
      return fileContent;
    }
    setValueAtPath(editor, path, value);
  } catch (error) {
    throw toDataError(dataPath, error);
  }
  return JsonAst.unparse(ast);
}
