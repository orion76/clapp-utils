/**
 * Lossless JSON to AST conversion (`JsonAst.parse`) and back (`JsonAst.unparse`).
 *
 * Every node of the tree keeps the raw text it was parsed from, so unparsing an AST
 * reproduces the original document byte by byte: whitespace, indentation, key order,
 * duplicate keys, number spelling (`42.0`, `1e+10`) and string escaping all survive the
 * round trip. The grammar is strict JSON — unlike JSONC it allows no comments and no
 * trailing commas.
 *
 * The lossless attribute model is inspired by json-asty 1.3.4
 * (https://github.com/rse/json-asty, MIT, Copyright (c) 2018-2026 Dr. Ralf S. Engelschall);
 * the parser in `./parse.ts` and the node in `./node.ts` are independent implementations.
 */
import { parseJsonAst } from './parse';
import type { JsonAstNode } from './types';

/**
 * Lossless JSON to AST parser and AST to JSON generator.
 *
 * The AST node surface is described by `JsonAstNode`; `unparse` restores the exact
 * source text of the document `parse` was given.
 */
export class JsonAst {
  /**
   * Parse JSON text into an AST.
   *
   * @param json - JSON document
   * @returns the root node of the lossless AST
   * @throws {Error} when the argument is not a string, or when the text is not valid JSON
   * (the message carries the position and a source excerpt of the failure)
   */
  static parse(json: string): JsonAstNode {
    // Sanity check argument.
    if (typeof json !== 'string') {
      throw new Error('invalid JSON argument (expected type string)');
    }

    // Parse the document into an Abstract Syntax Tree.
    return parseJsonAst(json);
  }

  /**
   * Unparse an AST back into JSON text.
   *
   * @param ast - root node produced by {@link JsonAst.parse}
   * @returns the source text of the parsed document, byte for byte
   * @throws {Error} when the argument is not an AST node object
   */
  static unparse(ast: JsonAstNode): string {
    // Sanity check argument: `null` also has the type `object` and is caught here.
    const candidate: unknown = ast;
    const isNode =
      typeof candidate === 'object' &&
      candidate !== null &&
      typeof (candidate as JsonAstNode).walk === 'function';
    if (!isNode) {
      throw new Error('generate: invalid AST argument (expected type object)');
    }

    // Walk the AST in source order, collecting the raw text of every node: `prolog`,
    // then `body` (or the JSON text of `value`), then `epilog` after the children.
    let json = '';
    ast.walk((node, _depth, _parent, when) => {
      if (when === 'downward') {
        const prolog = node.get('prolog');
        if (typeof prolog === 'string') {
          json += prolog;
        }
        const body = node.get('body');
        if (typeof body === 'string') {
          json += body;
          return;
        }
        const value = node.get('value');
        if (value !== undefined) {
          json += `${JSON.stringify(value)}`;
        }
      } else {
        const epilog = node.get('epilog');
        if (typeof epilog === 'string') {
          json += epilog;
        }
      }
    }, 'both');
    return json;
  }
}
