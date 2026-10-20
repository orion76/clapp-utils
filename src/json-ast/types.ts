/*!
**  JSON-ASTy -- Lossless JSON-to-AST Parser and AST-to-JSON Generator
**  Ported from json-asty 1.3.4, src/json-asty.d.ts
**  Copyright (c) 2018-2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**
**  Permission is hereby granted, free of charge, to any person obtaining
**  a copy of this software and associated documentation files (the
**  "Software"), to deal in the Software without restriction, including
**  without limitation the rights to use, copy, modify, merge, publish,
**  distribute, sublicense, and/or sell copies of the Software, and to
**  permit persons to whom the Software is furnished to do so, subject to
**  the following conditions:
**
**  The above copyright notice and this permission notice shall be included
**  in all copies or substantial portions of the Software.
**
**  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
**  EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
**  MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
**  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
**  CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
**  TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
**  SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

/**
 * Position of an AST node inside the parsed JSON text.
 *
 * Lines and columns are 1-based, the offset is 0-based — exactly as reported by the
 * underlying `asty-astq` node position.
 */
export interface AstNodePos {
  line: number;
  column: number;
  offset: number;
}

/**
 * A node of the lossless JSON AST.
 *
 * Nodes are created by `JsonAst.parse` and carry the raw JSON text in their
 * attributes: `prolog` (opening bracket plus surrounding whitespace), `body` (raw
 * literal or quoted string text), `epilog` (separator plus whitespace, or closing
 * bracket plus whitespace) and `value` (the typed JavaScript value). The methods below
 * are the subset of the `asty-astq` node API the port relies on and that is useful to
 * consumers; it is not a complete replacement for that library.
 */
export interface JsonAstNode {
  /** Get the node type (`object`, `member`, `array`, `string`, `number`, `boolean`, `null`). */
  type(): string;
  /** Set the node type. */
  type(type: string): JsonAstNode;

  /** Get the names of all attributes of the node. */
  attrs(): string[];
  /** Get the value of one attribute (`undefined` when absent). */
  get(name: string): unknown;
  /** Get the values of several attributes, in the requested order. */
  get(names: string[]): unknown[];
  /** Set one attribute; `undefined` removes it. */
  set(name: string, value: unknown): JsonAstNode;
  /** Set several attributes at once; `undefined` values remove them. */
  set(attrs: Record<string, unknown>): JsonAstNode;

  /** Get the position of the node in the source text. */
  pos(): AstNodePos;
  /** Set the position of the node in the source text. */
  pos(line: number, column: number, offset: number): JsonAstNode;

  /** Create a new node of the given type; it starts out without a parent. */
  create(type: string): JsonAstNode;
  /** Append child nodes (or arrays of child nodes) to the node. */
  add(...childs: (JsonAstNode | JsonAstNode[])[]): JsonAstNode;
  /** Insert child nodes (or arrays of child nodes) at the given position. */
  ins(pos: number, ...childs: (JsonAstNode | JsonAstNode[])[]): JsonAstNode;
  /** Remove child nodes from the node. */
  del(...childs: JsonAstNode[]): JsonAstNode;
  /** Get one child node by position, `null` when out of range. */
  child(pos: number): JsonAstNode | null;
  /** Get all child nodes, or the range `[begin, end)` / `[begin, ...]` of them. */
  childs(begin?: number, end?: number): JsonAstNode[];

  /** Get the parent node, `null` for the root node. */
  parent(): JsonAstNode | null;

  /**
   * Traverse the subtree starting at this node in depth-first order.
   *
   * `when` selects which callback phases run: `downward` before the children of a node,
   * `upward` after them, `both` for the two of them.
   */
  walk(
    callback: (node: JsonAstNode, depth: number, parent: JsonAstNode | null, when: 'downward' | 'upward') => void,
    when?: 'downward' | 'upward' | 'both',
  ): JsonAstNode;

  /** Run an ASTq query against the subtree of the node. */
  query(selector: string, params?: Record<string, unknown>, trace?: boolean): JsonAstNode[];
}
