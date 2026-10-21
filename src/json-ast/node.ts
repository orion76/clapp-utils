/**
 * Lossless JSON AST node.
 *
 * The lossless attribute model (`prolog`/`body`/`epilog`/`value`) is inspired by
 * json-asty 1.3.4 (https://github.com/rse/json-asty, MIT, Copyright (c) 2018-2026
 * Dr. Ralf S. Engelschall). The implementation below is independent: attributes live in
 * a map, children in an array, and position and parent in scalar fields; children are
 * attached only through {@link createNode}, so the tree stays consistent.
 */
import type {
  AstNodePos,
  JsonAstNode,
  JsonAstNodeType,
  JsonAstWalkCallback,
  JsonAstWalkDirection,
} from './types';

/** Position used when a node is created without one. */
const DEFAULT_POS: AstNodePos = { line: 1, column: 1, offset: 0 };

/** A node of the lossless JSON AST. */
class JsonAstNodeImpl implements JsonAstNode {
  private readonly _type: string;
  private readonly _attrs = new Map<string, unknown>();
  private readonly _childs: JsonAstNodeImpl[] = [];
  private readonly _pos: AstNodePos;
  private _parent: JsonAstNodeImpl | null = null;

  constructor(type: string, pos: AstNodePos) {
    this._type = type;
    this._pos = { line: pos.line, column: pos.column, offset: pos.offset };
  }

  type(): string {
    return this._type;
  }

  attrs(): string[] {
    return [...this._attrs.keys()];
  }

  get(name: string): unknown {
    return this._attrs.get(name);
  }

  set(name: string, value: unknown): JsonAstNode {
    if (value === undefined) {
      this._attrs.delete(name);
    } else {
      this._attrs.set(name, value);
    }
    return this;
  }

  pos(): AstNodePos {
    return { line: this._pos.line, column: this._pos.column, offset: this._pos.offset };
  }

  parent(): JsonAstNode | null {
    return this._parent;
  }

  /**
   * Get one child node by position.
   *
   * Delegates to {@link childs}, so the position is validated in one place only: it must be
   * an integer with `0 <= pos <= childCount`.
   *
   * @param pos - 0-based child position
   * @returns the child at `pos`, or `null` when `pos` equals the number of children (an
   * empty range)
   * @throws {RangeError} when `pos` is not an integer, is negative or is greater than the
   * number of children; the message carries the requested range and the child count
   */
  child(pos: number): JsonAstNode | null {
    const nodes = this.childs(pos);
    return nodes.length > 0 ? nodes[0] : null;
  }

  /**
   * Get a range of child nodes.
   *
   * Both bounds are optional: without arguments all children are returned, `begin` alone
   * selects the children from `begin` to the end, and both select `[begin, end)`. The
   * result is a copy, so changing it does not affect the tree.
   *
   * @param begin - inclusive 0-based start index (default `0`)
   * @param end - exclusive 0-based end index (default: the number of children)
   * @returns a new array holding the children in `[begin, end)`
   * @throws {RangeError} when `begin` or `end` is not an integer, or the range is not inside
   * `0 <= begin <= end <= childCount`; the message carries the requested range, the child
   * count and the allowed range
   */
  childs(begin: number = 0, end: number = this._childs.length): JsonAstNode[] {
    const childCount = this._childs.length;
    const hasIntegerBounds = Number.isInteger(begin) && Number.isInteger(end);
    const isOrdered = begin >= 0 && begin <= end && end <= childCount;
    if (!hasIntegerBounds || !isOrdered) {
      throw new RangeError(
        `childs: invalid range [${begin}, ${end}) for ${childCount} children ` +
          `(expected integers with 0 <= begin <= end <= ${childCount})`,
      );
    }
    return this._childs.slice(begin, end);
  }

  walk(callback: JsonAstWalkCallback, when: JsonAstWalkDirection = 'downward'): JsonAstNode {
    const visit = (node: JsonAstNodeImpl, depth: number): void => {
      if (when === 'downward' || when === 'both') {
        callback(node, depth, node.parent(), 'downward');
      }
      for (const child of node._childs) {
        visit(child, depth + 1);
      }
      if (when === 'upward' || when === 'both') {
        callback(node, depth, node.parent(), 'upward');
      }
    };
    visit(this, 0);
    return this;
  }

  /** Attach a child node; called by {@link createNode} only. */
  appendChild(child: JsonAstNode): void {
    const node = child as JsonAstNodeImpl;
    node._parent = this;
    this._childs.push(node);
  }

  /** Insert a detached child node at `pos`; called by the editor only. */
  insertChild(pos: number, child: JsonAstNode): void {
    if (!Number.isInteger(pos) || pos < 0 || pos > this._childs.length) {
      throw new RangeError(`insertChild: invalid position ${pos} for ${this._childs.length} children`);
    }
    const node = child as JsonAstNodeImpl;
    node._parent = this;
    this._childs.splice(pos, 0, node);
  }

  /** Detach and return the child node at `pos`; called by the editor only. */
  removeChild(pos: number): JsonAstNode {
    if (!Number.isInteger(pos) || pos < 0 || pos >= this._childs.length) {
      throw new RangeError(`removeChild: invalid position ${pos} for ${this._childs.length} children`);
    }
    const node = this._childs.splice(pos, 1)[0];
    node._parent = null;
    return node;
  }

  /** Replace the child node at `pos` with a detached node; called by the editor only. */
  replaceChild(pos: number, child: JsonAstNode): void {
    if (!Number.isInteger(pos) || pos < 0 || pos >= this._childs.length) {
      throw new RangeError(`replaceChild: invalid position ${pos} for ${this._childs.length} children`);
    }
    const node = child as JsonAstNodeImpl;
    this._childs[pos]._parent = null;
    node._parent = this;
    this._childs[pos] = node;
  }
}

/**
 * Create a node of the lossless JSON AST.
 *
 * This factory is the single entry point for building the tree: the parser uses it for
 * every node it produces and it links the given children to their parent.
 *
 * @param type - node type
 * @param pos - position of the node in the source text
 * @param attrs - attributes to set on the node (`prolog`, `body`, `epilog`, `value`, ...)
 * @param childs - child nodes, in document order
 * @returns the new node
 */
export function createNode(
  type: JsonAstNodeType,
  pos: AstNodePos = DEFAULT_POS,
  attrs?: Record<string, unknown>,
  childs?: JsonAstNode[],
): JsonAstNode {
  const node = new JsonAstNodeImpl(type, pos);
  if (attrs !== undefined) {
    for (const name of Object.keys(attrs)) {
      node.set(name, attrs[name]);
    }
  }
  if (childs !== undefined) {
    for (const child of childs) {
      node.appendChild(child);
    }
  }
  return node;
}

/**
 * Insert a detached node into `parent` at `pos`.
 *
 * Editor-internal structural mutation: `createNode` builds trees bottom-up, while
 * `JsonAstEditor` has to splice an existing tree. The position must satisfy
 * `0 <= pos <= childCount` and the child must not be attached anywhere yet.
 *
 * @internal
 */
export function insertChild(parent: JsonAstNode, pos: number, child: JsonAstNode): void {
  (parent as JsonAstNodeImpl).insertChild(pos, child);
}

/**
 * Detach the child at `pos` from `parent` and return it.
 *
 * Editor-internal structural mutation; the child is detached together with its subtree.
 *
 * @internal
 */
export function removeChild(parent: JsonAstNode, pos: number): JsonAstNode {
  return (parent as JsonAstNodeImpl).removeChild(pos);
}

/**
 * Replace the child at `pos` of `parent` with a detached node.
 *
 * Editor-internal structural mutation; the replaced child is detached together with its
 * subtree.
 *
 * @internal
 */
export function replaceChild(parent: JsonAstNode, pos: number, child: JsonAstNode): void {
  (parent as JsonAstNodeImpl).replaceChild(pos, child);
}
