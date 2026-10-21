import { TObjectPathSegment } from '../data-file/types';

export * from './package-json';
/**
 * Path into a parsed JSON document: an object key or an array index per level.
 *
 * Declared inside `json-ast` on purpose: the module stays self-contained and does not
 * import anything from `data-file`.
 */
export type JsonAstPath = TObjectPathSegment[];