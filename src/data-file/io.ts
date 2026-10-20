/**
 * Unified data access over JSON/JSONC and YAML files by path.
 *
 * `readValue`/`writeValue`/`addValue` pick the right backend by the file
 * extension, read/write the whole file with `fs` and report clear errors that
 * mention the file, the path and the format.
 */
import fs from 'fs';
import path from 'path';
import { addJsonValue, getJsonValue, setJsonValue } from './json';
import { parsePath, escapePath, type DataPathInput } from './path';
import { addYamlValue, getYamlValue, setYamlValue } from './yaml';

/**
 * Supported data file formats, selected by the file extension.
 */
export type DataFormat = 'json' | 'jsonc' | 'yaml' | 'yml';

export class DataAccessError extends Error {
  readonly filePath: string;
  readonly format?: DataFormat;
  readonly path?: DataPathInput;

  constructor(message: string, filePath: string, format?: DataFormat, dataPath?: DataPathInput) {
    super(message);
    this.name = 'DataAccessError';
    this.filePath = filePath;
    this.format = format;
    this.path = dataPath;
  }
}

/**
 * Detect the data format for a file path from its extension.
 *
 * @param filePath - path to the data file
 * @returns detected format
 * @throws {DataAccessError} for an unsupported extension
 */
export function detectFileFormat(filePath: string): DataFormat {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.json':
      return 'json';
    case '.jsonc':
      return 'jsonc';
    case '.yaml':
      return 'yaml';
    case '.yml':
      return 'yml';
    default:
      throw new DataAccessError(
        `Unsupported data file format "${ext}" (expected .json, .jsonc, .yaml or .yml)`,
        filePath,
      );
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

function withContext(action: () => unknown, filePath: string, format: DataFormat, dataPath: DataPathInput): unknown {
  try {
    return action();
  } catch (error) {
    if (error instanceof DataAccessError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new DataAccessError(
      `${describeTry(filePath)} at path "${stringifyDataPath(dataPath)}" (${format}): ${message}`,
      filePath,
      format,
      dataPath,
    );
  }
}

function describeTry(filePath: string): string {
  return `Failed to access value in data file "${filePath}"`;
}

function stringifyDataPath(dataPath: DataPathInput): string {
  if (typeof dataPath === 'string') {
    return dataPath;
  }
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
export function readValue(filePath: string, dataPath: DataPathInput): unknown {
  const format = detectFileFormat(filePath);
  const content = readFile(filePath);
  return withContext(() => {
    if (format === 'json' || format === 'jsonc') {
      return getJsonValue(content, dataPath);
    }
    return getYamlValue(content, dataPath);
  }, filePath, format, dataPath);
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
export function writeValue(filePath: string, dataPath: DataPathInput, value: unknown): void {
  const format = detectFileFormat(filePath);
  const content = readFile(filePath, true);
  const updated = withContext(() => {
    if (format === 'json' || format === 'jsonc') {
      return setJsonValue(content, dataPath, value);
    }
    return setYamlValue(content, dataPath, value);
  }, filePath, format, dataPath) as string;
  writeFile(filePath, updated);
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
export function addValue(filePath: string, dataPath: DataPathInput, value: unknown): void {
  const format = detectFileFormat(filePath);
  const content = readFile(filePath, true);
  const updated = withContext(() => {
    if (format === 'json' || format === 'jsonc') {
      return addJsonValue(content, dataPath, value);
    }
    return addYamlValue(content, dataPath, value);
  }, filePath, format, dataPath) as string;
  writeFile(filePath, updated);
}
