/**
 * YAML data access on top of the `yaml` package (eemeli).
 *
 * The YAML module edits documents by mutating the `Document`/Node tree of the
 * `yaml` package, so comments and the order of existing fields are preserved
 * while unmodified parts of the document round-trip through the stringifier.
 */
import { isMap, isScalar, isSeq, parseDocument, type Document } from 'yaml';
import { YamlDataError } from '../../errors';
import { TDataPath } from '../../types';
import { FileBase } from '../file.base';
import { IFileFormat } from '../types';

export class YamlFile extends FileBase implements IFileFormat {
  private _doc!: Document;
  protected getDoc<T>(): T {
    if (!this._doc) {
      const doc = parseDocument(this.fileContent);
      if (doc.errors.length > 0) {
        const detail = doc.errors.map((error) => error.message).join('; ');
        throw new YamlDataError(`Invalid YAML content: ${detail}`);
      }
      this._doc = doc;
    }
    return this._doc as T;
  }
  protected getValue<T extends unknown = unknown>(dataPath: TDataPath): T | undefined {
    const doc = this.getDoc<Document>();
    const node = doc.getIn(dataPath, true);
    const value = node === undefined ? node : nodeToValue(node, doc);
    return value as T;
  }
  protected setValue(dataPath: TDataPath, value: unknown): boolean {
    const doc = this.getDoc<Document>();

    if (value === undefined) {
      throw new YamlDataError('Value "undefined" is not a YAML value');
    }
    const node = doc.createNode(value);
    try {
      doc.setIn(dataPath, node);
    } catch (error) {
      if (error instanceof Error) {
        throw new YamlDataError(`Cannot set value at path "${stringifyPath(dataPath)}": ${error.message}`);
      }
      throw error;
    }
    return true;
  }
  protected deleteValue(dataPath: TDataPath): boolean {
    const doc = this.getDoc<Document>();
    try {
      doc.deleteIn(dataPath);
    } catch (error) {
      if (error instanceof Error) {
        throw new YamlDataError(`Cannot delete value at path "${stringifyPath(dataPath)}": ${error.message}`);
      }
      throw error;
    }
    return true;
  }
  protected getFileContent(): string {
    const doc = this.getDoc<Document>();
    return doc.toString();
  }
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

function stringifyPath(path: TDataPath): string {
  return Array.isArray(path) ? `[${path.map(String).join(', ')}]` : '';
}
