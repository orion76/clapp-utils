import { type Node } from 'jsonc-parser';
/**
 * Supported data file formats, selected by the file extension.
 */
export type UDataFormat = 'json' | 'yaml';

/**
 * One segment of a data path: an object key (string) or an array index (number).
 */
export type TPathSegment = string | number;

/**
 * Parsed data path, a sequence of object keys and array indexes.
 */
export type TDataPath = readonly TPathSegment[];

/**
 * JSON-compatible value as returned by `getJsonValue`.
 */
export type JsonValue = string | number | boolean | null | IJsonObject | IJsonArray;
export interface IJsonObject {
  [key: string]: JsonValue | undefined;
}
export interface IJsonArray extends Array<JsonValue> {}


type TInsertionPointNotFound = { found: true; node: Node };
type TInsertionPointFound = { found: false; parent: Node; segment: TPathSegment; remaining: TPathSegment[] };

export type UInsertionPoint = TInsertionPointFound | TInsertionPointNotFound;
