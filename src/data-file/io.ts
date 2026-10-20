/**
 * Unified data access over JSON/JSONC and YAML files by path.
 *
 * `readValue`/`writeValue`/`addValue` pick the right backend by the file
 * extension, read/write the whole file with `fs` and report clear errors that
 * mention the file, the path and the format.
 */
import fs from 'fs';
import path from 'path';

import { DataAccessError } from './errors';
import { createFile } from './file-factory';
import { TDataPath, UDataFormat } from './types';

/**
 * Detect the data format for a file path from its extension.
 *
 * @param filePath - path to the data file
 * @returns detected format
 * @throws {DataAccessError} for an unsupported extension
 */
export function detectFileFormat(filePath: string): UDataFormat {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.jsonc':
    case '.json':
      return 'json';
    case '.yaml':
    case '.yml':
      return 'yaml';
    default:
      throw new DataAccessError(`Unsupported data file format "${ext}" (expected .json, .jsonc, .yaml or .yml)`, filePath);
  }
}

function readFile(filePath: string, allowMissing = false): string {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return '';
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new DataAccessError(`Cannot read data file "${filePath}": ${detail}`, filePath);
  }
}

function writeFile(filePath: string, content: string): void {
  try {
    fs.writeFileSync(filePath, content, 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new DataAccessError(`Cannot write data file "${filePath}": ${detail}`, filePath);
  }
}

function withContext(action: () => unknown, filePath: string, dataPath: TDataPath): unknown {
  try {
    return action();
  } catch (error) {
    if (error instanceof DataAccessError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new DataAccessError(`${describeTry(filePath)} at path "${stringifyDataPath(dataPath)}" : ${message}`, filePath, dataPath);
  }
}

function describeTry(filePath: string): string {
  return `Failed to access value in data file "${filePath}"`;
}

function stringifyDataPath(dataPath: TDataPath): string {
  return `[${dataPath.map(String).join(', ')}]`;
}

/**
 * Read a value from a JSON/JSONC/YAML/YML file by path.
 *
 * @param filePath - path to the data file
 * @param dataPath - data path inside the file
 * @returns the value at the path, or `undefined` when the path does not exist
 * @throws {DataAccessError} when the file is not readable, the format is
 * unsupported, the content is invalid or the path is invalid
 */
export function readValue(filePath: string, dataPath: TDataPath): unknown {
  return withContext(
    () => {
      const file = createFile(filePath);
      return file.get(dataPath);
    },
    filePath,
    dataPath,
  );
}

/**
 * Write a value to a JSON/JSONC/YAML/YML file by path, creating missing keys
 * and array slots. Existing value is overwritten.
 *
 * @param filePath - path to the data file
 * @param dataPath - data path inside the file
 * @param value - value to write (format-compatible JS value)
 * @throws {DataAccessError} when the file is not readable/writable, the format
 * is unsupported, the content is invalid or the path is invalid
 */
export function writeValue(filePath: string, dataPath: TDataPath, value: unknown): void {
  withContext(
    () => {
      const file = createFile(filePath);
      return file.set(dataPath, value);
    },
    filePath,
    dataPath,
  );
}

/**
 * Add a value to a JSON/JSONC/YAML/YML file by path, creating missing keys and
 * array slots but never overwriting an existing value.
 *
 * @param filePath - path to the data file
 * @param dataPath - data path inside the file
 * @param value - value to add (format-compatible JS value)
 * @throws {DataAccessError} when the file is not readable/writable, the format
 * is unsupported, the content is invalid or the path is invalid
 */
export function addValue(filePath: string, dataPath: TDataPath, value: unknown): void {
  withContext(
    () => {
      const file = createFile(filePath);
      return file.set(dataPath, value);
    },
    filePath,
    dataPath,
  );
}

export function deleteValue(filePath: string, dataPath: TDataPath): void {
  withContext(
    () => {
      const file = createFile(filePath);
      return file.delete(dataPath);
    },
    filePath,
    dataPath,
  );
}
