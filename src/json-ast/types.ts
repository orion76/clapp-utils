/**
 * Types of the lossless JSON AST produced by `JsonAst.parse`.
 *
 * The lossless attribute model (`prolog`/`body`/`epilog`/`value`) is inspired by
 * json-asty 1.3.4 (https://github.com/rse/json-asty, MIT, Copyright (c) 2018-2026
 * Dr. Ralf S. Engelschall). This module and the node implementation in `./node.ts`
 * are an independent implementation: no code of that library is used.
 */

/**
 * Position of an AST node inside the parsed JSON text.
 *
 * Lines and columns are 1-based, the offset is 0-based. The column is counted from
 * the beginning of the line, the offset from the beginning of the document.
 */
export interface AstNodePos {
  /** 1-based line number. */
  line: number;
  /** 1-based column number. */
  column: number;
  /** 0-based character offset. */
  offset: number;
}

/** Type of a node of the lossless JSON AST. */
export type JsonAstNodeType = 'object' | 'member' | 'array' | 'string' | 'number' | 'boolean' | 'null';

/** Traversal phase of a node reported to a `JsonAstNode.walk` callback. */
export type JsonAstWalkWhen = 'downward' | 'upward';

/** Traversal direction requested from `JsonAstNode.walk`. */
export type JsonAstWalkDirection = JsonAstWalkWhen | 'both';

/**
 * Callback of `JsonAstNode.walk`.
 *
 * @param node - visited node
 * @param depth - depth of the node relative to the node `walk` was called on (0-based)
 * @param parent - parent of the visited node, `null` for the root
 * @param when - traversal phase: `downward` before the children, `upward` after them
 */
export type JsonAstWalkCallback = (
  node: JsonAstNode,
  depth: number,
  parent: JsonAstNode | null,
  when: JsonAstWalkWhen,
) => void;

/**
 * One segment of a path into a parsed JSON document.
 *
 * A string addresses an object key as is. A number addresses an array index and, on an
 * object, the key `String(number)` — the same rule the `data-file` path parser uses, so
 * paths stay structurally compatible with `TDataPath`.
 */
export type JsonAstPathSegment = string | number;

/**
 * Path into a parsed JSON document: an object key or an array index per level.
 *
 * Declared inside `json-ast` on purpose: the module stays self-contained and does not
 * import anything from `data-file`.
 */
export type JsonAstPath = JsonAstPathSegment[];

/**
 * A node of the lossless JSON AST.
 *
 * Nodes keep the raw text of the parsed document in their attributes, so unparsing an
 * AST reproduces the source text byte for byte:
 *
 * - `prolog` — raw text before the node content (opening bracket plus whitespace);
 * - `body` — raw text of a literal or a quoted string, quotes included;
 * - `epilog` — raw text after the node content (separator or closing bracket plus
 *   whitespace);
 * - `value` — the decoded JavaScript value of the node.
 *
 * The attribute set is intentionally open: consumers may read attributes through
 * `get`/`attrs` and set them through `set`. The methods below are the only ones this
 * interface promises: the node itself has no editing helpers and never writes to the
 * output, structural edits go through `JsonAstEditor`.
 */
export interface JsonAstNode {
  /** Get the node type (`object`, `member`, `array`, `string`, `number`, `boolean`, `null`). */
  type(): string;

  /** Get the names of all attributes of the node. */
  attrs(): string[];

  /** Get the value of one attribute (`undefined` when absent). */
  get(name: string): unknown;

  /** Set one attribute; `undefined` removes it. */
  set(name: string, value: unknown): JsonAstNode;

  /** Get the position of the node in the source text. */
  pos(): AstNodePos;

  /** Get the parent node, `null` for the root node. */
  parent(): JsonAstNode | null;

  /**
   * Get one child node by position.
   *
   * Implemented through `childs(pos)`, so the position is validated by that method: it must
   * be an integer with `0 <= pos <= childCount`. `null` is returned only when `pos` equals
   * the number of children (an empty range), never for an invalid position.
   *
   * @param pos - 0-based child position
   * @returns the child at `pos`, or `null` when `pos === childCount`
   * @throws {RangeError} when `pos` is not an integer, is negative or exceeds the number of
   * children; the message carries the requested range and the child count
   */
  child(pos: number): JsonAstNode | null;

  /**
   * Get all child nodes, or the range `[begin, end)` of them.
   *
   * Both bounds must be integers with `0 <= begin <= end <= childCount`; without arguments
   * all children are returned. The returned array is a copy: changing it does not affect
   * the tree.
   *
   * @param begin - inclusive 0-based start index (default `0`)
   * @param end - exclusive 0-based end index (default: the number of children)
   * @returns a new array with the children in `[begin, end)`
   * @throws {RangeError} when a bound is not an integer or the range leaves
   * `0 <= begin <= end <= childCount`; the message carries the requested range, the child
   * count and the allowed range
   */
  childs(begin?: number, end?: number): JsonAstNode[];

  /**
   * Traverse the subtree starting at this node in depth-first order.
   *
   * `when` selects which callback phases run: `downward` before the children of a node,
   * `upward` after them, `both` for the two of them.
   */
  walk(callback: JsonAstWalkCallback, when?: JsonAstWalkDirection): JsonAstNode;
}
