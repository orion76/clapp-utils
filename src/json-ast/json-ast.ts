/*!
**  JSON-ASTy -- Lossless JSON-to-AST Parser and AST-to-JSON Generator
**  Ported from json-asty 1.3.4, src/json-asty.js
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
 * Lossless JSON to AST conversion (`JsonAst.parse`) and back (`JsonAst.unparse`).
 *
 * Every node of the tree keeps the raw text it was parsed from, so unparsing an AST
 * reproduces the original document byte by byte: whitespace, indentation, key order,
 * duplicate keys, number spelling (`42.0`, `1e+10`) and string escaping all survive the
 * round trip. The grammar is strict JSON — unlike JSONC it allows no comments and no
 * trailing commas.
 */
import { join } from 'node:path';
import ASTY from 'asty-astq';
import PEG from 'pegjs-otf';
import PEGUtil from 'pegjs-util';
import type { JsonAstNode } from './types';

/**
 * Parser compiled from the ported grammar, created once when the module is loaded.
 *
 * `import.meta.dirname` points at `src/json-ast/` in dev and at `dist/` in the bundle,
 * where the build script copies `json-ast.pegjs` next to the bundle.
 */
const pegParser = PEG.generateFromFile(join(import.meta.dirname, 'json-ast.pegjs'), {
  optimize: 'size',
  trace: false,
});

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
    const asty = new ASTY();
    const result = PEGUtil.parse<JsonAstNode>(pegParser, json, {
      startRule: 'json',
      makeAST: (line, column, offset, args) => asty.create(...args).pos(line, column, offset),
    });
    if (result.error !== null) {
      throw new Error(
        'parse: JSON parsing failure:\n' + PEGUtil.errorMessage(result.error, true).replace(/^/gm, 'ERROR: ') + '\n',
      );
    }
    // `ast` is only `null` together with a parse error, which was thrown above.
    return result.ast as JsonAstNode;
  }

  /**
   * Unparse an AST back into JSON text.
   *
   * @param ast - root node produced by {@link JsonAst.parse}
   * @returns the source text of the parsed document, byte for byte
   * @throws {Error} when the argument is not an AST node object
   */
  static unparse(ast: JsonAstNode): string {
    // Sanity check argument.
    if (typeof ast !== 'object') {
      throw new Error('generate: invalid AST argument (expected type object)');
    }

    // Walk the AST, collecting the raw text of every node.
    let json = '';
    ast.walk((node, depth, parent, when) => {
      if (when === 'downward') {
        const prolog = node.get('prolog');
        if (prolog !== undefined) {
          json += prolog as string;
        }
        const body = node.get('body');
        if (body !== undefined) {
          json += body as string;
        } else {
          const value = node.get('value');
          if (value !== undefined) {
            json += JSON.stringify(value);
          }
        }
      } else if (when === 'upward') {
        const epilog = node.get('epilog');
        if (epilog !== undefined) {
          json += epilog as string;
        }
      }
    }, 'both');
    return json;
  }
}
