# @clapp/utils

[![npm version](https://img.shields.io/npm/v/@clapp/utils.svg)](https://www.npmjs.com/package/@clapp/utils)

Shared helpers for the `clapp` packages: filesystem and project lookup, argument parsers, JSON/YAML data files and a lossless JSON AST.

## Installation

```bash
npm install @clapp/utils
```

Every helper is re-exported from the package root.

```ts
import { JsonAst, findProjectRoot, readValue } from '@clapp/utils';
```

## Contents

| Module       | What it provides                                                                      |
| ------------ | ------------------------------------------------------------------------------------- |
| `fs.ts`      | `isProjectRoot`, `findProjectRoot`, `getProjectRoot`, `getCwd`, `isFileInside`         |
| `project.ts` | `loadPackageJson`                                                                      |
| `parse-arg/` | argument parsers and their types, e.g. `parseDateString`                               |
| `data-file/` | `readValue`, `writeValue`, `addValue`, `deleteValue`, `detectFileFormat`, `escapePath` |
| `json-ast/`  | `JsonAst.parse` / `JsonAst.unparse`, `JsonAstEditor` by path — lossless JSON AST        |

### Data files (`data-file`)

`data-file` reads and writes JSON, JSONC and YAML documents by path. The path is an array of object keys and array indexes (`TDataPath`), for example `['scripts', 'build']`. The backend is selected by the file extension: `.json`/`.jsonc` use `jsonc-parser` and keep comments and trailing commas, `.yaml`/`.yml` use the `yaml` package and keep comments and field order.

```ts
import { readValue, writeValue, addValue } from '@clapp/utils';

readValue('package.json', ['version']);
writeValue('package.json', ['version'], '1.0.0');
addValue('clapp.config.yml', ['plugins', 'PLUGIN_COMMAND'], { patterns: ['commands/**/*.plugin.{js,ts}'] });
```

## Lossless JSON AST (`json-ast`)

`json-ast` parses strict JSON into a tree that keeps the original text of the document and writes it back unchanged. It is meant for editing JSON while preserving formatting: it is not wired into `data-file` yet.

### Public API

```ts
import { JsonAst, JsonAstEditor, JsonAstPathError } from '@clapp/utils';
import type { JsonAstNode, JsonAstNodeType, AstNodePos, JsonAstPath, JsonAstPathSegment } from '@clapp/utils';

const ast: JsonAstNode = JsonAst.parse('{"a": 1}');
const text: string = JsonAst.unparse(ast);
```

- `JsonAst.parse(json: string): JsonAstNode` — parse a document; returns the root node.
- `JsonAst.unparse(ast: JsonAstNode): string` — restore the source text.
- `JsonAstEditor` — path based reads and formatting-preserving edits (`node`, `has`, `get`, `set`, `add`, `delete`; see below).
- `JsonAstPathError` — failure of a path based operation; carries `path` and `segmentIndex` (`null` for a path-wide failure).
- `JsonAstPath` / `JsonAstPathSegment` — `(string | number)[]` and `string | number`.
- `JsonAstNode` — the node interface (`packages/utils/src/json-ast/types.ts:83`).
- `JsonAstNodeType` — `'object' | 'member' | 'array' | 'string' | 'number' | 'boolean' | 'null'`.
- `AstNodePos` — `{ line: number; column: number; offset: number }`, 1-based line and column, 0-based offset.

The module is exported from the package root (`packages/utils/src/index.ts:7`); it re-exports `json-ast.ts`, `types.ts`, `editor.ts` and `errors.ts`. The parser factory `parseJsonAst` and the node factory `createNode` are internal and stay out of the package API.

### Node model

A node stores the raw source text in its attributes and the decoded JavaScript value separately:

- `prolog` — raw text before the node content;
- `body` — raw text of a literal or a quoted string, quotes included;
- `epilog` — raw text after the node content;
- `value` — the decoded JavaScript value.

| Node      | `prolog`      | `body`               | `epilog`            | `value`              |
| --------- | ------------- | -------------------- | ------------------- | -------------------- |
| `object`  | `ws? "{" ws?` | —                    | `ws? "}" ws?`       | —                    |
| `member`  | —             | —                    | —                   | —                    |
| `array`   | `ws? "[" ws?` | —                    | `ws? "]" ws?`       | —                    |
| `string`  | —             | quoted text          | —                   | decoded string       |
| `number`  | —             | raw literal          | —                   | `parseFloat(body)`   |
| `boolean` | —             | `true` / `false`     | —                   | `true` / `false`     |
| `null`    | —             | `null`               | —                   | `null`               |

A `member` node has two children, the key string and the value. The colon with the surrounding whitespace (`ws? ":" ws?`) is stored in the `epilog` of the key. In objects and arrays the separator (`ws? "," ws?`) is appended to the `epilog` of the preceding member or element.

The root of the tree is a single value node. Whitespace before the document is prefixed to its `prolog`, whitespace after it is appended to its `epilog`.

`unparse` walks the tree with `ast.walk(callback, 'both')` and concatenates `prolog`, then `body` (or `JSON.stringify(value)` when a node has no body), then `epilog` (`packages/utils/src/json-ast/json-ast.ts:63`). Because every byte of the source sits in one of these attributes, the output is identical to the input.

### Round-trip guarantees

`JsonAst.unparse(JsonAst.parse(x)) === x` byte for byte, including:

- spaces, tabs, line breaks and CRLF, leading and trailing whitespace of the document;
- key order and duplicate keys;
- the spelling of numbers: `-0`, `42.0`, `1e+10`, `42.7e-10`, long integers;
- string escaping: `\"`, `\\`, `\/`, `\b`, `\f`, `\n`, `\r`, `\t`, `\uXXXX` and surrogate pairs.

Editing does not reformat the document. The raw `body` of a scalar takes precedence over `value` when unparsing, so `node.set('value', …)` alone changes the decoded value without touching the output text. To rewrite a literal, set its `body` (and `value` to keep readers consistent); the surrounding indentation, separators and the rest of the document stay intact.

```ts
import { JsonAst } from '@clapp/utils';

const source = `{
  "name": "clapp",
  "count": 1
}
`;

const ast = JsonAst.parse(source);

ast.walk((node) => {
  if (node.type() === 'number' && node.get('body') === '1') {
    node.set('body', '2');
    node.set('value', 2);
  }
});

JsonAst.unparse(ast); // same document, only `1` is replaced with `2`
```

### Navigation and traversal

- `type(): string` — node type.
- `attrs(): string[]` — names of all attributes.
- `get(name: string): unknown` — one attribute, `undefined` when absent.
- `set(name: string, value: unknown): JsonAstNode` — set one attribute; `undefined` removes it; returns the node.
- `pos(): AstNodePos` — position in the source.
- `parent(): JsonAstNode | null` — parent node, `null` for the root.
- `child(pos: number): JsonAstNode | null` — one child; delegates to `childs(pos)`.
- `childs(begin = 0, end = childCount): JsonAstNode[]` — a copy of the child range `[begin, end)`.
- `walk(callback, when = 'downward'): JsonAstNode` — depth-first traversal; the callback receives `(node, depth, parent, when)`, where `when` is `'downward'` before the children and `'upward'` after them; `'both'` runs both phases.

`childs` accepts only integers with `0 <= begin <= end <= childCount`; any other range throws `RangeError` with the requested range, the child count and the allowed range (`packages/utils/src/json-ast/node.ts:94`). `child(pos)` is implemented through `childs(pos)`, so an invalid position throws the same `RangeError`, and `null` is returned only when `pos === childCount` (`packages/utils/src/json-ast/node.ts:75`).

```ts
const root = JsonAst.parse('{\n  "key": [1, "two"]\n}');

root.type();                       // 'object'
root.pos();                        // { line: 1, column: 1, offset: 0 }
root.parent();                     // null

const member = root.child(0);      // 'member'
member?.child(0)?.get('body');     // '"key"'
member?.child(0)?.get('epilog');   // ': '
member?.child(1)?.pos();           // { line: 2, column: 10, offset: 11 }

root.walk((node, depth, parent, when) => {
  // depth-first, source order
}, 'both');
```

### Path based editing (`JsonAstEditor`)

`JsonAstEditor` reads and edits a parsed document by path. A path is an array of segments: a string is an object key, a number is an array index and, on an object, the key `String(number)`; a canonical decimal string (`'0'`, `'1'`, ...) is also accepted as an array index. With duplicate keys the last occurrence wins, exactly as in `JSON.parse`. An empty path addresses the document root for reads and is rejected by every mutation.

```ts
import { JsonAst, JsonAstEditor } from '@clapp/utils';

const ast = JsonAst.parse('{"name": "clapp", "scripts": {"build": "rollup -c"}}');

JsonAstEditor.get(ast, ['scripts', 'build']); // 'rollup -c'
JsonAstEditor.has(ast, ['scripts', 'test']); // false

JsonAstEditor.set(ast, ['name'], 'clapp-2'); // existing value only
JsonAstEditor.add(ast, ['scripts', 'test'], 'jest'); // new key or element only
JsonAstEditor.delete(ast, ['scripts', 'build']);

JsonAst.unparse(ast); // {"name": "clapp-2", "scripts": {"test": "jest"}}
```

- `node(ast, path)` — the addressed node; `has(ast, path)` — whether the path exists (a missing key, a missing index and a path through a scalar return `false`, only invalid segments throw); `get(ast, path)` — plain JavaScript values (objects in document order, the last duplicate key wins, arrays, scalar `value`).
- `set(ast, path, value)` — replaces an existing value. A scalar replaced by a scalar of the same type only rewrites its literal; any other replacement rebuilds the node, so `type()` describes the new value. A missing path is an error.
- `add(ast, path, value)` — creates a value that must not exist yet. An object member is always appended after the existing members; an existing key is an error (use `set`). An array index must be in `0..length`, where `length` appends.
- `delete(ast, path)` — removes an object member or an array element, cleans up the surrounding separator and normalises a container that becomes empty to `{}`/`[]`.

Every untouched byte of the document stays intact. New text follows the style of the receiving container: a multiline container uses its own indentation and the line break of the document (CRLF when the container text already uses it, LF otherwise), a single-line container uses `, `, and an empty container receives the first value compactly. `pos()` is not recalculated: positions describe the original parse and `JsonAst.unparse` does not use them.

Path failures throw `JsonAstPathError` with the whole `path` and the `segmentIndex` of the failing segment (`null` when the path itself is invalid). Values that are not JSON (`undefined`, a function, a symbol, a bigint, `NaN`, `Infinity`, a non-plain object) and circular references throw a plain `Error`.

### Errors

- `parse` throws `Error` when the argument is not a string (`invalid JSON argument (expected type string)`) and on invalid JSON. A syntax error message starts with `parse: JSON parsing failure:`, carries `line`, `column` and `offset`, and includes the offending source line with a caret under the offending character (`packages/utils/src/json-ast/parse.ts:54`).
- `unparse` throws `Error` when the argument is not an AST node (`generate: invalid AST argument (expected type object)`).
- `childs`/`child` throw `RangeError` for invalid ranges and positions.

```ts
import { JsonAst } from '@clapp/utils';

try {
  JsonAst.parse('{"a":}');
} catch (error) {
  // Error: parse: JSON parsing failure: expected a JSON value but found character "}" at line 1, column 6, offset 5
  // {"a":}
  //      ^
}

const array = JsonAst.parse('[10, 20, 30]');
try {
  array.childs(2, 1);
} catch (error) {
  // RangeError: childs: invalid range [2, 1) for 3 children
  // (expected integers with 0 <= begin <= end <= 3)
}
```

### Boundaries

- The grammar is strict JSON: no comments and no trailing commas. JSONC remains the job of `jsonc-parser` in `data-file` (`packages/utils/src/data-file/formats/json/json.ts:11`).
- There is no `dump`, no coloured output, no CLI/`bin` and no AST query language. Structural edits are limited to one existing value at a time through `JsonAstEditor` (`set`/`add`/`delete`): no moves or copies between documents, no bulk edits, no patch/diff.
- The parser is an independent recursive descent implementation (`packages/utils/src/json-ast/parse.ts:78`). It uses no PEG/ASTy tooling and adds no dependencies: the runtime dependencies are still `jsonc-parser`, `object-path` and `yaml` (plus the `@orion76/logger` peer).
- The lossless attribute model is inspired by [json-asty](https://github.com/rse/json-asty) 1.3.4 (MIT, Copyright © 2018-2026 Dr. Ralf S. Engelschall); the code is an independent implementation. The attribution is repeated in the module headers (`packages/utils/src/json-ast/json-ast.ts:10`, `parse.ts:5`, `node.ts:4`, `types.ts:4`).

### Verification

```bash
npm run test:jest -w @clapp/utils -- json-ast
npx tsc --noEmit -p packages/utils/tsconfig.tests.json
npm run build:utils
```

The `json-ast` suites are `packages/utils/tests/json-ast.test.ts` (round-trip, the AST shape, the `childs`/`child` contract and parse errors) and `packages/utils/tests/json-ast-editor.test.ts` (reads, `set`/`add`/`delete`, formatting, CRLF, error paths and invariants). The other `data-*` suites are currently red for a pre-existing reason after the `data-file/formats/**` refactor (tracked separately); a full package run is not green until that is fixed.

## License

MIT
