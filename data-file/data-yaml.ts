/**
 * YAML data access on top of the `yaml` package (eemeli).
 *
 * The YAML module edits documents by mutating the `Document`/Node tree of the
 * `yaml` package, so comments and the order of existing fields are preserved
 * while unmodified parts of the document round-trip through the stringifier.
 */
import { isMap, isScalar, isSeq, parseDocument, type Document, type Node } from 'yaml';
import { DataPathError, parsePath, type DataPath, type DataPathInput, type PathSegment } from './data-path';

export class YamlDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YamlDataError';
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

function parseDocumentOrThrow(fileContent: string): Document {
  const doc = parseDocument(fileContent);
  if (doc.errors.length > 0) {
    const detail = doc.errors.map((error) => error.message).join('; ');
    throw new YamlDataError(`Invalid YAML content: ${detail}`);
  }
  return doc;
}

function nodeToValue(node: unknown, doc: Document): unknown {
  if (isScalar(node)) {
    return node.value;
  }
  if (isMap(node) || isSeq(node)) {
    return node.toJS(doc);
  }
  return node;
}

/**
 * Read a value located by `path` from a YAML document.
 *
 * @param fileContent - raw file content (YAML)
 * @param path - data path
 * @returns the value at the path, or `undefined` when the path does not exist
 * @throws {YamlDataError} when the content is not valid YAML
 */
export function getYamlValue(fileContent: string, path: DataPathInput): unknown {
  const doc = parseDocumentOrThrow(fileContent);
  const segments = toSegments(path);
  const node = doc.getIn(segments, true);
  return node === undefined ? node : nodeToValue(node, doc);
}

/**
 * Set a value at a path in a YAML document, creating missing keys and array
 * slots along the way. Comments and field order are preserved.
 *
 * @param fileContent - raw file content (YAML)
 * @param path - data path
 * @param value - value to set (a JS value; `undefined` is rejected)
 * @param options - set options
 * @returns the updated file content
 * @throws {YamlDataError} when the content is not valid YAML, the value is
 * `undefined`, or the path crosses a scalar value or type mismatch
 */
export function setYamlValue(
  fileContent: string,
  path: DataPathInput,
  value: unknown,
  options: { insert?: boolean } = {},
): string {
  const doc = parseDocumentOrThrow(fileContent);
  const segments = toSegments(path);

  if (options.insert && doc.hasIn(segments)) {
    return fileContent; // do not overwrite
  }

  if (value === undefined) {
    throw new YamlDataError('Value "undefined" is not a YAML value');
  }
  const node = doc.createNode(value);
  try {
    doc.setIn(segments, node);
  } catch (error) {
    if (error instanceof Error) {
      throw new YamlDataError(`Cannot set value at path "${stringifyPath(path)}": ${error.message}`);
    }
    throw error;
  }
  return doc.toString();
}

/**
 * Add a value at a path, creating the path if it does not exist but never
 * overwriting an existing value. Convenience wrapper over
 * {@link setYamlValue} with `insert: true`.
 */
export function addYamlValue(fileContent: string, path: DataPathInput, value: unknown): string {
  return setYamlValue(fileContent, path, value, { insert: true });
}

function stringifyPath(path: DataPathInput): string {
  if (typeof path === 'string') {
    return path;
  }
  return Array.isArray(path) ? `[${path.map(String).join(', ')}]` : '';
}
