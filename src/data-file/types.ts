export interface IFileFormat {
  get<T extends unknown = unknown>(dataPath: TObjectPath): Promise<T | T[] | undefined>;
  set(dataPath: TObjectPath, value: unknown): Promise<boolean>;
  delete(dataPath: TObjectPath): Promise<boolean>;
}

/**
 * One segment of a path into a parsed JSON document.
 *
 * A string addresses an object key as is. A number addresses an array index and, on an
 * object, the key `String(number)` — the same rule the `data-file` path parser uses, so
 * paths stay structurally compatible with `TObjectPath`.
 */
export type TObjectPathSegment = string | number;
export type TObjectPath = TObjectPathSegment[];
export type UDataFormat = 'json' | 'yaml';
