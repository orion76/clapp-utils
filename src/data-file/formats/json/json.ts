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
import { JsonAst, JsonAstEditor, JsonAstPathError } from '../../../json-ast';
import type { JsonAstNode, JsonAstPath } from '../../../json-ast';
import { JsonDataError } from '../../errors';
import { escapePath } from '../../path';
import { TDataPath } from '../../types';
import { FileBase } from '../file.base';
import { IFileFormat } from '../types';

/**
 * Copy a read-only data path into the mutable path type the AST editor accepts.
 *
 * `TDataPath` is readonly while `JsonAstPath` is mutable; copying keeps the public
 * `json-ast` API unchanged and the data path untouched.
 */
function toAstPath(dataPath: TDataPath): JsonAstPath {
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
function toDataError(dataPath: TDataPath, error: unknown): Error {
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

export class JsonFile extends FileBase implements IFileFormat {
  private _ast: JsonAstNode | undefined;

  protected getDoc<T>(): T {
    if (this._ast === undefined) {
      this._ast = parseOrThrow(this.fileContent);
    }
    return this._ast as T;
  }

  protected getValue<T extends unknown = unknown>(dataPath: TDataPath): T | undefined {
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

  protected setValue(dataPath: TDataPath, value: unknown): boolean {
    if (value === undefined) {
      throw new JsonDataError('Value "undefined" is not a JSON value');
    }
    const ast = this.getDoc<JsonAstNode>();
    const editor = new JsonAstEditor(ast);
    try {
      editor.set(toAstPath(dataPath), value);
    } catch (error) {
      throw toDataError(dataPath, error);
    }
    return true;
  }

  protected deleteValue(dataPath: TDataPath): boolean {
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
export function getJsonValue(fileContent: string, dataPath: TDataPath): unknown {
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
 * Set a value at a data path in a JSON/JSONC document, creating the addressed value when
 * it is missing. Comments and the formatting of the untouched parts are preserved.
 *
 * @param fileContent - raw file content (JSON or JSONC)
 * @param dataPath - data path; the parent of the last segment must exist
 * @param value - value to set (must be JSON-compatible)
 * @returns the updated file content
 * @throws {JsonDataError} when the content is not valid JSON/JSONC, the path is invalid or
 * crosses a scalar value, or the value is not JSON-compatible
 */
export function setJsonValue(fileContent: string, dataPath: TDataPath, value: unknown): string {
  if (value === undefined) {
    throw new JsonDataError('Value "undefined" is not a JSON value');
  }
  const ast = parseOrThrow(fileContent);
  const editor = new JsonAstEditor(ast);
  try {
    editor.set(toAstPath(dataPath), value);
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
 * @param dataPath - data path; the parent of the last segment must exist
 * @param value - value to add (must be JSON-compatible)
 * @returns the updated file content, or the original text when the path already exists
 * @throws {JsonDataError} when the content is not valid JSON/JSONC, the path is invalid or
 * crosses a scalar value, or the value is not JSON-compatible
 */
export function addJsonValue(fileContent: string, dataPath: TDataPath, value: unknown): string {
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
    editor.set(path, value);
  } catch (error) {
    throw toDataError(dataPath, error);
  }
  return JsonAst.unparse(ast);
}
