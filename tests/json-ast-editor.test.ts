import { JsonAst, JsonAstEditor, JsonAstPathError } from '../src/json-ast/index';
import type { JsonAstNode, JsonAstPath } from '../src/json-ast/index';

/** Parse a document and return its root node. */
function parse(text: string): JsonAstNode {
  return JsonAst.parse(text);
}

/** Render a tree back to text. */
function unparse(ast: JsonAstNode): string {
  return JsonAst.unparse(ast);
}

/** Create an editor over a freshly parsed document. */
function createEditor(text: string): JsonAstEditor {
  return new JsonAstEditor(parse(text));
}

/** Pass a deliberately mistyped value where a path is expected. */
function asPath(value: unknown): JsonAstPath {
  return value as JsonAstPath;
}

/** Run a call that must fail with `JsonAstPathError` and check the failing segment. */
function expectPathError(call: () => unknown, segmentIndex: number | null): JsonAstPathError {
  let caught: unknown = null;
  try {
    call();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(JsonAstPathError);
  const pathError = caught as JsonAstPathError;
  expect(pathError.segmentIndex).toBe(segmentIndex);
  return pathError;
}

/** Assert that a call fails with a plain `Error` that is not a path error. */
function expectValueError(call: () => unknown): Error {
  let caught: unknown = null;
  try {
    call();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  expect(caught).not.toBeInstanceOf(JsonAstPathError);
  return caught as Error;
}

/** Assert that a tree unparses into valid JSON equal to the expected value. */
function expectJson(ast: JsonAstNode, expected: unknown): void {
  expect(JSON.parse(unparse(ast))).toEqual(expected);
}

describe('json-ast editor: reading', () => {
  const source = `{
  "name": "clapp",
  "version": 2,
  "tags": ["a", "b"],
  "nested": { "flag": true, "none": null },
  "dup": 1,
  "dup": 2
}`;

  it('reads the whole document for an empty path', () => {
    const ast = parse(source);
    const editor = new JsonAstEditor(ast);
    expect(editor.node([])).toBe(ast);
    expect(editor.has([])).toBe(true);
    expect(editor.get([])).toEqual({
      name: 'clapp',
      version: 2,
      tags: ['a', 'b'],
      nested: { flag: true, none: null },
      dup: 2,
    });
  });

  it('reads nested objects and arrays', () => {
    const ast = parse(source);
    const editor = new JsonAstEditor(ast);
    expect(editor.get(['name'])).toBe('clapp');
    expect(editor.get(['tags', 0])).toBe('a');
    expect(editor.get(['tags', 1])).toBe('b');
    expect(editor.get(['nested', 'flag'])).toBe(true);
    expect(editor.get(['nested', 'none'])).toBeNull();
    expect(editor.node(['tags']).type()).toBe('array');
    expect(editor.node(['nested']).type()).toBe('object');
    expect(editor.node(['tags', 1]).get('value')).toBe('b');
    expect(editor.has(['nested', 'flag'])).toBe(true);
  });

  it('resolves duplicate keys to the last occurrence', () => {
    const ast = parse(source);
    const editor = new JsonAstEditor(ast);
    expect(editor.get(['dup'])).toBe(2);
    expect(editor.node(['dup']).get('body')).toBe('2');
  });

  it('coerces number segments to object keys and numeric strings to array indexes', () => {
    const editor = createEditor('{"0": "zero", "1": "one", "list": ["a", "b"]}');
    expect(editor.get([0])).toBe('zero');
    expect(editor.get(['1'])).toBe('one');
    expect(editor.get(['list', '0'])).toBe('a');
    expect(editor.get(['list', 1])).toBe('b');
  });

  it('reads empty containers and the document root of a scalar', () => {
    const emptyObject = createEditor('{}');
    expect(emptyObject.get([])).toEqual({});
    expect(emptyObject.has(['a'])).toBe(false);

    const emptyArray = createEditor('[]');
    expect(emptyArray.get([])).toEqual([]);
    expect(emptyArray.has([0])).toBe(false);

    const nestedEmpty = createEditor('{"a": {}, "b": []}');
    expect(nestedEmpty.get(['a'])).toEqual({});
    expect(nestedEmpty.get(['b'])).toEqual([]);

    const scalar = new JsonAstEditor(parse('42'));
    expect(scalar.get([])).toBe(42);
    expect(scalar.node([]).type()).toBe('number');
  });

  it('reads every scalar type', () => {
    const ast = parse('{"s": "x", "n": -1.5e-3, "t": true, "f": false, "z": null, "m": -0}');
    const editor = new JsonAstEditor(ast);
    expect(editor.get(['s'])).toBe('x');
    expect(editor.get(['n'])).toBe(-1.5e-3);
    expect(editor.get(['t'])).toBe(true);
    expect(editor.get(['f'])).toBe(false);
    expect(editor.get(['z'])).toBeNull();
    expect(Object.is(editor.get(['m']), -0)).toBe(true);
  });

  it('returns plain JavaScript values in document order', () => {
    const editor = createEditor(source);
    const document = editor.get([]) as Record<string, unknown>;
    expect(Object.keys(document)).toEqual(['name', 'version', 'tags', 'nested', 'dup']);
    expect(Object.getPrototypeOf(document)).toBe(Object.prototype);
    expect(Array.isArray(editor.get(['tags']))).toBe(true);
    expect(document).not.toHaveProperty('prolog');
    expect(document).not.toHaveProperty('body');
    expect(document).not.toHaveProperty('epilog');
  });

  it('reports a missing key or index', () => {
    const ast = parse(source);
    const editor = new JsonAstEditor(ast);
    expect(editor.has(['missing'])).toBe(false);
    expect(editor.has(['tags', 2])).toBe(false);
    expect(editor.has(['missing', 'deeper'])).toBe(false);
    const error = expectPathError(() => editor.node(['missing']), 0);
    expect(error.message).toContain('missing');
    expect(error.path).toEqual(['missing']);
    expectPathError(() => editor.get(['tags', 2]), 1);
  });

  it('reports a path that runs through a scalar', () => {
    const editor = createEditor(source);
    expect(editor.has(['name', 'length'])).toBe(false);
    expectPathError(() => editor.get(['name', 'length']), 1);
    expectPathError(() => editor.node(['version', 0]), 1);
  });

  it('rejects invalid segments with their index', () => {
    const editor = createEditor(source);
    const invalid: Array<[unknown, number]> = [
      [[Number.NaN], 0],
      [[Number.POSITIVE_INFINITY], 0],
      [[-1], 0],
      [[1.5], 0],
      [[null], 0],
      [[{}], 0],
      [[true], 0],
      [['tags', undefined], 1],
      [['tags', -1], 1],
    ];
    for (const [path, segmentIndex] of invalid) {
      expectPathError(() => editor.get(path as JsonAstPath), segmentIndex);
      expectPathError(() => editor.has(path as JsonAstPath), segmentIndex);
    }
  });

  it('treats non-canonical array index strings as a missing path for has', () => {
    const editor = createEditor('{"tags": ["a", "b"], "x": 1}');
    expect(editor.has(['tags', '01'])).toBe(false);
    expect(editor.has(['tags', 'x'])).toBe(false);
    expectPathError(() => editor.get(['tags', '01']), 1);
    expectPathError(() => editor.get(['tags', 'x']), 1);
  });

  it('rejects a path that is not an array', () => {
    const editor = createEditor(source);
    expectPathError(() => editor.get(asPath('name')), null);
    expectPathError(() => editor.has(asPath(null)), null);
    expectPathError(() => editor.node(asPath(undefined)), null);
  });

  it('returns the node of the addressed value', () => {
    const ast = parse('{"a": [1]}');
    const editor = new JsonAstEditor(ast);
    expect(editor.node([])).toBe(ast);
    const element = editor.node(['a', 0]);
    expect(element.type()).toBe('number');
    expect(element.get('value')).toBe(1);
    expect(element.parent()?.type()).toBe('array');
  });
});

describe('json-ast editor: set (replacing)', () => {
  it('rewrites a scalar of the same type only where it stands', () => {
    const source = '{\n\t"keep" : [ 1 , 2 ] ,\n\t"value" :   "old"  ,\n\t"tail" : true\n}';
    const ast = parse(source);
    const editor = new JsonAstEditor(ast);
    editor.set(['value'], 'new');
    expect(unparse(ast)).toBe(source.replace('"old"', '"new"'));
    expect(editor.node(['value']).type()).toBe('string');
    expect(editor.get(['value'])).toBe('new');
  });

  const pairs: Array<[string, string | number | boolean | null, string]> = [
    ['1', 2, '2'],
    ['-1.5e-3', 0, '0'],
    ['"a"', 'b', '"b"'],
    ['true', false, 'false'],
    ['false', true, 'true'],
    ['null', null, 'null'],
    ['42.7', 42.7, '42.7'],
    ['0', 1e10, '10000000000'],
  ];

  it.each(pairs)('replaces the literal %s with %p', (before, after, expected) => {
    const ast = parse(`{"v": ${before}}`);
    const editor = new JsonAstEditor(ast);
    editor.set(['v'], after);
    expect(unparse(ast)).toBe(`{"v": ${expected}}`);
    expect(editor.get(['v'])).toEqual(after);
  });

  it('writes -0 as -0', () => {
    const ast = parse('{"v": 0}');
    const editor = new JsonAstEditor(ast);
    editor.set(['v'], -0);
    expect(unparse(ast)).toBe('{"v": -0}');
    expect(Object.is(editor.get(['v']), -0)).toBe(true);
    expect(Object.is((JSON.parse(unparse(ast)) as { v: number }).v, -0)).toBe(true);
  });

  it('escapes strings with JSON.stringify', () => {
    const ast = parse('{"v": "x"}');
    const editor = new JsonAstEditor(ast);
    const value = 'quote " backslash \\ newline \n tab \t null \u0000 é';
    editor.set(['v'], value);
    expect(unparse(ast)).toBe(`{"v": ${JSON.stringify(value)}}`);
    expect(editor.get(['v'])).toBe(value);
  });

  it('rebuilds a node when the scalar type changes', () => {
    const ast = parse('{"v": 1}');
    const editor = new JsonAstEditor(ast);
    editor.set(['v'], 'one');
    expect(unparse(ast)).toBe('{"v": "one"}');
    expect(editor.node(['v']).type()).toBe('string');
    expect(editor.get(['v'])).toBe('one');
  });

  it('rebuilds a node for every other scalar type change', () => {
    const cases: Array<[string, unknown, string, string]> = [
      ['{"v": "1"}', 1, '{"v": 1}', 'number'],
      ['{"v": true}', 0, '{"v": 0}', 'number'],
      ['{"v": null}', 'x', '{"v": "x"}', 'string'],
      ['{"v": 1}', null, '{"v": null}', 'null'],
      ['{"v": 1}', false, '{"v": false}', 'boolean'],
    ];
    for (const [source, value, expected, type] of cases) {
      const ast = parse(source);
      const editor = new JsonAstEditor(ast);
      editor.set(['v'], value);
      expect(unparse(ast)).toBe(expected);
      expect(editor.node(['v']).type()).toBe(type);
    }
  });

  it('builds a nested object with the indentation of a multiline parent', () => {
    const source = '{\n  "id": 1,\n  "data": null\n}';
    const ast = parse(source);
    const editor = new JsonAstEditor(ast);
    editor.set(['data'], { a: 1, b: [2, 3] });
    const expected = `{
  "id": 1,
  "data": {
    "a": 1,
    "b": [
      2,
      3
    ]
  }
}`;
    expect(unparse(ast)).toBe(expected);
    expect(editor.get(['data'])).toEqual({ a: 1, b: [2, 3] });
  });

  it('nests built containers one indentation step deeper', () => {
    const ast = parse('{\n  "a": 1,\n  "b": 2\n}');
    const editor = new JsonAstEditor(ast);
    editor.set(['a'], { x: { y: [1] } });
    const expected = `{
  "a": {
    "x": {
      "y": [
        1
      ]
    }
  },
  "b": 2
}`;
    expect(unparse(ast)).toBe(expected);
  });

  it('builds values compactly inside a single-line parent', () => {
    const object = parse('{"a": 1, "b": 2}');
    const objectEditor = new JsonAstEditor(object);
    objectEditor.set(['a'], { x: [1, 2] });
    expect(unparse(object)).toBe('{"a": {"x": [1, 2]}, "b": 2}');

    const array = parse('[1, 2, 3]');
    const arrayEditor = new JsonAstEditor(array);
    arrayEditor.set([1], [4, 5]);
    expect(unparse(array)).toBe('[1, [4, 5], 3]');
  });

  it('rebuilds a container into a scalar', () => {
    const ast = parse('{\n  "a": {\n    "x": 1\n  },\n  "b": 2\n}');
    const editor = new JsonAstEditor(ast);
    editor.set(['a'], 7);
    expect(unparse(ast)).toBe('{\n  "a": 7,\n  "b": 2\n}');
    expect(editor.node(['a']).type()).toBe('number');
  });

  it('rebuilds an array into an object in a multiline parent', () => {
    const ast = parse('{\n  "a": [1],\n  "b": 2\n}');
    const editor = new JsonAstEditor(ast);
    editor.set(['a'], { x: true });
    expect(unparse(ast)).toBe('{\n  "a": {\n    "x": true\n  },\n  "b": 2\n}');
  });

  it('rebuilds an object into an array in a single-line parent', () => {
    const ast = parse('{"a": {"x": 1}, "b": 2}');
    const editor = new JsonAstEditor(ast);
    editor.set(['a'], [1, 2]);
    expect(unparse(ast)).toBe('{"a": [1, 2], "b": 2}');
    expect(editor.node(['a']).type()).toBe('array');
  });

  it('rebuilds an object into an array in a multiline parent', () => {
    const ast = parse('{\n  "a": {\n    "x": 1\n  },\n  "b": 2\n}');
    const editor = new JsonAstEditor(ast);
    editor.set(['a'], [1]);
    expect(unparse(ast)).toBe('{\n  "a": [\n    1\n  ],\n  "b": 2\n}');
    expect(editor.node(['a']).type()).toBe('array');
  });

  it('keeps an array element separator when replacing the element', () => {
    const ast = parse('[ 1 , 2 , 3 ]');
    const editor = new JsonAstEditor(ast);
    editor.set([1], 20);
    expect(unparse(ast)).toBe('[ 1 , 20 , 3 ]');
  });

  it('keeps the untouched bytes around a replaced value', () => {
    const ast = parse('{\n  "a": 1,\n  "b": [1, 2],\n  "c": true\n}');
    const editor = new JsonAstEditor(ast);
    editor.set(['b', 0], 10);
    expect(unparse(ast)).toBe('{\n  "a": 1,\n  "b": [10, 2],\n  "c": true\n}');
  });

  it('rejects an empty path', () => {
    const ast = parse('{"a": 1}');
    const editor = new JsonAstEditor(ast);
    const error = expectPathError(() => editor.set([], 2), null);
    expect(error.message).toContain('root');
    expectPathError(() => createEditor('[1]').set([], 2), null);
    expect(unparse(ast)).toBe('{"a": 1}');
  });

  it('rejects a missing parent or an index beyond the array', () => {
    const ast = parse('{"a": 1, "list": [1]}');
    const editor = new JsonAstEditor(ast);
    expectPathError(() => editor.set(['missing', 'deeper'], 2), 0);
    expectPathError(() => editor.set(['list', 2], 2), 1);
    expect(unparse(ast)).toBe('{"a": 1, "list": [1]}');
  });

  it('rejects values that are not JSON', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const invalid: unknown[] = [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      () => 1,
      Symbol('s'),
      10n,
      new Date(),
      new Map(),
      cyclic,
    ];
    for (const value of invalid) {
      const ast = parse('{"v": 1}');
      const editor = new JsonAstEditor(ast);
      const error = expectValueError(() => editor.set(['v'], value));
      expect(error.message).toContain('invalid JSON value');
      expect(unparse(ast)).toBe('{"v": 1}');
    }
  });

  it('rejects invalid nested values', () => {
    const ast = parse('{"v": 1}');
    const editor = new JsonAstEditor(ast);
    expect(() => editor.set(['v'], { a: [1, () => 2] })).toThrow(/invalid JSON value/);
    expect(unparse(ast)).toBe('{"v": 1}');
  });
});

describe('json-ast editor: set (creating)', () => {
  it('appends a member to a multiline object', () => {
    const ast = parse('{\n  "a": 1,\n  "b": 2\n}');
    const editor = new JsonAstEditor(ast);
    editor.set(['c'], 3);
    expect(unparse(ast)).toBe('{\n  "a": 1,\n  "b": 2,\n  "c": 3\n}');
    expect(editor.get(['c'])).toBe(3);
    expect(editor.node([]).childs()).toHaveLength(3);
  });

  it('appends a member to a single-line object', () => {
    const ast = parse('{"a": 1, "b": 2}');
    const editor = new JsonAstEditor(ast);
    editor.set(['c'], { x: true });
    expect(unparse(ast)).toBe('{"a": 1, "b": 2, "c": {"x": true}}');
  });

  const emptyObjects: Array<[string, string]> = [
    ['{}', '{"a": 1}'],
    ['{ }', '{"a": 1}'],
    [' {  } ', ' {"a": 1} '],
  ];

  it.each(emptyObjects)('adds the first member to %j compactly', (source, expected) => {
    const ast = parse(source);
    const editor = new JsonAstEditor(ast);
    editor.set(['a'], 1);
    expect(unparse(ast)).toBe(expected);
  });

  it('adds a member to a nested object', () => {
    const ast = parse('{"a": {"b": 1}}');
    const editor = new JsonAstEditor(ast);
    editor.set(['a', 'c'], 2);
    expect(unparse(ast)).toBe('{"a": {"b": 1, "c": 2}}');
  });

  it('coerces a number segment to an object key', () => {
    const ast = parse('{}');
    const editor = new JsonAstEditor(ast);
    editor.set([0], 'zero');
    expect(unparse(ast)).toBe('{"0": "zero"}');
    expect(editor.get(['0'])).toBe('zero');
  });

  it('replaces the last duplicate key instead of adding a duplicate', () => {
    const ast = parse('{"a": 1, "a": 2}');
    const editor = new JsonAstEditor(ast);
    editor.set(['a'], 3);
    expect(unparse(ast)).toBe('{"a": 1, "a": 3}');
    expect(editor.get(['a'])).toBe(3);
  });

  it('rejects a missing or scalar parent', () => {
    const ast = parse('{"a": 1}');
    const editor = new JsonAstEditor(ast);
    expectPathError(() => editor.set(['x', 'y'], 1), 0);
    expectPathError(() => editor.set(['a', 'b'], 1), 1);
    expect(unparse(ast)).toBe('{"a": 1}');
  });

  it('rejects an empty path', () => {
    const ast = parse('{}');
    const editor = new JsonAstEditor(ast);
    expectPathError(() => editor.set([], 1), null);
    expect(unparse(ast)).toBe('{}');
  });

  it('rejects an array index out of range', () => {
    const ast = parse('[1, 2]');
    const editor = new JsonAstEditor(ast);
    const error = expectPathError(() => editor.set([3], 3), 0);
    expect(error.message).toContain('push');
    expectPathError(() => editor.set(['3'], 3), 0);
    expectPathError(() => editor.set([-1], 3), 0);
    expect(unparse(ast)).toBe('[1, 2]');
  });

  it('rejects an invalid value', () => {
    const ast = parse('{}');
    const editor = new JsonAstEditor(ast);
    const error = expectValueError(() => editor.set(['a'], undefined));
    expect(error.message).toContain('invalid JSON value');
    expect(unparse(ast)).toBe('{}');
  });

  it('appends to a multiline array', () => {
    const ast = parse('[\n  1,\n  2\n]');
    const editor = new JsonAstEditor(ast);
    editor.set([2], 3);
    expect(unparse(ast)).toBe('[\n  1,\n  2,\n  3\n]');
    expect(editor.get([2])).toBe(3);
  });

  it('appends to a single-line array', () => {
    const numberIndex = parse('[1]');
    new JsonAstEditor(numberIndex).set([1], 2);
    expect(unparse(numberIndex)).toBe('[1, 2]');

    const stringIndex = parse('[1]');
    new JsonAstEditor(stringIndex).set(['1'], 2);
    expect(unparse(stringIndex)).toBe('[1, 2]');
  });

  const emptyArrays: Array<[string, string]> = [
    ['[]', '[1]'],
    ['[ ]', '[1]'],
    [' [  ] ', ' [1] '],
  ];

  it.each(emptyArrays)('adds the first element to %j compactly', (source, expected) => {
    const ast = parse(source);
    const editor = new JsonAstEditor(ast);
    editor.set([0], 1);
    expect(unparse(ast)).toBe(expected);
  });

  it('adds a nested value to an array', () => {
    const ast = parse('[]');
    const editor = new JsonAstEditor(ast);
    editor.set([0], { a: [1, {}] });
    expect(unparse(ast)).toBe('[{"a": [1, {}]}]');
    expect(editor.get([0])).toEqual({ a: [1, {}] });
  });

  it('adds a nested container to a multiline array', () => {
    const ast = parse('[\n  1\n]');
    const editor = new JsonAstEditor(ast);
    editor.set([1], { a: 2 });
    expect(unparse(ast)).toBe('[\n  1,\n  {\n    "a": 2\n  }\n]');
  });

  it('appends a member after a container neighbour', () => {
    const ast = parse('{\n  "a": {\n    "x": 1\n  }\n}');
    const editor = new JsonAstEditor(ast);
    editor.set(['b'], 2);
    expect(unparse(ast)).toBe('{\n  "a": {\n    "x": 1\n  },\n  "b": 2\n}');
  });
});

describe('json-ast editor: push', () => {
  it('appends to a multiline array', () => {
    const ast = parse('[\n  1,\n  2\n]');
    const editor = new JsonAstEditor(ast);
    editor.push([], 3);
    expect(unparse(ast)).toBe('[\n  1,\n  2,\n  3\n]');
    expect(editor.get([2])).toBe(3);
  });

  it('appends to a single-line array', () => {
    const single = parse('[1]');
    new JsonAstEditor(single).push([], 2);
    expect(unparse(single)).toBe('[1, 2]');

    const longer = parse('[1, 3]');
    new JsonAstEditor(longer).push([], 4);
    expect(unparse(longer)).toBe('[1, 3, 4]');
  });

  const emptyArrays: Array<[string, string]> = [
    ['[]', '[1]'],
    ['[ ]', '[1]'],
    [' [  ] ', ' [1] '],
  ];

  it.each(emptyArrays)('adds the first element to %j compactly', (source, expected) => {
    const ast = parse(source);
    const editor = new JsonAstEditor(ast);
    editor.push([], 1);
    expect(unparse(ast)).toBe(expected);
  });

  it('appends a nested container to a multiline array', () => {
    const ast = parse('[\n  1\n]');
    const editor = new JsonAstEditor(ast);
    editor.push([], { a: 2 });
    expect(unparse(ast)).toBe('[\n  1,\n  {\n    "a": 2\n  }\n]');
  });

  it('appends to an array addressed by a non-empty path', () => {
    const ast = parse('{"tags": []}');
    const editor = new JsonAstEditor(ast);
    editor.push(['tags'], 'a');
    expect(unparse(ast)).toBe('{"tags": ["a"]}');
    expect(editor.get(['tags'])).toEqual(['a']);
  });

  it('keeps chained appends in place after a container element', () => {
    const ast = parse('[\n  [1]\n]');
    const editor = new JsonAstEditor(ast);
    editor.push([], 2);
    editor.push([], 3);
    expect(unparse(ast)).toBe('[\n  [1],\n  2,\n  3\n]');
    expectJson(ast, [[1], 2, 3]);
  });

  it('rejects a path that does not address an array', () => {
    const ast = parse('{"a": 1, "b": {}}');
    const editor = new JsonAstEditor(ast);
    expectPathError(() => editor.push(['a'], 2), 0);
    expectPathError(() => editor.push(['b'], 2), 0);
    expectPathError(() => editor.push(['missing'], 2), 0);
    expect(unparse(ast)).toBe('{"a": 1, "b": {}}');
  });

  it('rejects an empty path when the root is not an array', () => {
    const ast = parse('{"a": 1}');
    const editor = new JsonAstEditor(ast);
    expectPathError(() => editor.push([], 2), null);

    const scalar = parse('1');
    expectPathError(() => new JsonAstEditor(scalar).push([], 2), null);
  });

  it('rejects an invalid segment or value', () => {
    const ast = parse('[1]');
    const editor = new JsonAstEditor(ast);
    expectPathError(() => editor.push(['x'], 2), 0);
    expectPathError(() => editor.push([1.5], 2), 0);
    const error = expectValueError(() => editor.push([], undefined));
    expect(error.message).toContain('invalid JSON value');
    expect(unparse(ast)).toBe('[1]');
  });
});

describe('json-ast editor: delete', () => {
  const objectCases: Array<[string, JsonAstPath, string]> = [
    ['{"a": 1, "b": 2, "c": 3}', ['a'], '{"b": 2, "c": 3}'],
    ['{"a": 1, "b": 2, "c": 3}', ['b'], '{"a": 1, "c": 3}'],
    ['{"a": 1, "b": 2, "c": 3}', ['c'], '{"a": 1, "b": 2}'],
    ['{"a": 1}', ['a'], '{}'],
    ['{\n  "a": 1,\n  "b": 2,\n  "c": 3\n}', ['b'], '{\n  "a": 1,\n  "c": 3\n}'],
    ['{\n  "a": 1,\n  "b": 2\n}', ['b'], '{\n  "a": 1\n}'],
    ['{\n  "a": 1\n}', ['a'], '{}'],
    [' {\n  "a": 1\n} ', ['a'], ' {} '],
  ];

  it.each(objectCases)('deletes %j at %j', (source, path, expected) => {
    const ast = parse(source);
    const editor = new JsonAstEditor(ast);
    editor.delete(path);
    expect(unparse(ast)).toBe(expected);
    expect(editor.has(path)).toBe(false);
    expect(() => JSON.parse(unparse(ast))).not.toThrow();
  });

  const arrayCases: Array<[string, JsonAstPath, string]> = [
    ['[1, 2, 3]', [0], '[2, 3]'],
    ['[1, 2, 3]', [1], '[1, 3]'],
    ['[1, 2, 3]', [2], '[1, 2]'],
    ['[1]', [0], '[]'],
    ['[\n  1,\n  2,\n  3\n]', [1], '[\n  1,\n  3\n]'],
    ['[\n  1,\n  2\n]', [1], '[\n  1\n]'],
    ['[\n  1\n]', [0], '[]'],
    [' [ 1 ] ', [0], ' [] '],
    ['["only"]', ['0'], '[]'],
  ];

  it.each(arrayCases)('deletes the element at %j of %j', (source, path, expected) => {
    const ast = parse(source);
    const editor = new JsonAstEditor(ast);
    editor.delete(path);
    expect(unparse(ast)).toBe(expected);

    // Deleting the last element shrinks the array; deleting an earlier one shifts the
    // following elements left, so the deleted index is only truly gone when it was the
    // last one. The index one past the resulting length is always out of bounds.
    const remaining = JSON.parse(unparse(ast)) as unknown[];
    expect(Array.isArray(remaining)).toBe(true);
    expect(editor.has([remaining.length])).toBe(false);
    expect(() => JSON.parse(unparse(ast))).not.toThrow();
  });

  it('deletes nested values', () => {
    const ast = parse('{"a": {"b": 1, "c": 2}, "list": [{"x": 1}]}');
    const editor = new JsonAstEditor(ast);
    editor.delete(['a', 'b']);
    editor.delete(['list', 0]);
    expect(unparse(ast)).toBe('{"a": {"c": 2}, "list": []}');
  });

  it('deletes the last occurrence of a duplicate key', () => {
    const ast = parse('{"a": 1, "a": 2, "b": 3}');
    const editor = new JsonAstEditor(ast);
    editor.delete(['a']);
    expect(unparse(ast)).toBe('{"a": 1, "b": 3}');
    expect(editor.get(['a'])).toBe(1);
  });

  it('keeps the closing bracket of a container neighbour in an array', () => {
    const ast = parse('[{"a": 1}, 2]');
    const editor = new JsonAstEditor(ast);
    editor.delete([1]);
    expect(unparse(ast)).toBe('[{"a": 1}]');
    expectJson(ast, [{ a: 1 }]);

    const multiline = parse('[\n  {"a": 1},\n  2\n]');
    new JsonAstEditor(multiline).delete([1]);
    expect(unparse(multiline)).toBe('[\n  {"a": 1}\n]');
  });

  it('keeps the closing bracket of a container neighbour in an object', () => {
    const ast = parse('{"a": {"b": 1}, "c": 2}');
    const editor = new JsonAstEditor(ast);
    editor.delete(['c']);
    expect(unparse(ast)).toBe('{"a": {"b": 1}}');
    expectJson(ast, { a: { b: 1 } });
  });

  it('normalises a container that becomes empty', () => {
    const object = parse('{"a": {"b": 1}}');
    new JsonAstEditor(object).delete(['a', 'b']);
    expect(unparse(object)).toBe('{"a": {}}');

    const array = parse('[[1]]');
    new JsonAstEditor(array).delete([0, 0]);
    expect(unparse(array)).toBe('[[]]');
  });

  it('rejects a missing path or the root', () => {
    const ast = parse('{"a": 1}');
    const editor = new JsonAstEditor(ast);
    expectPathError(() => editor.delete([]), null);
    expectPathError(() => editor.delete(['missing']), 0);
    expectPathError(() => editor.delete(['a', 'b']), 1);
    expectPathError(() => editor.delete([Number.NaN]), 0);
    expectPathError(() => createEditor('{}').delete(['a']), 0);
    expectPathError(() => createEditor('[]').delete([0]), 0);
    expect(unparse(ast)).toBe('{"a": 1}');
  });
});

describe('json-ast editor: invariants', () => {
  it('keeps the document valid after every mutation', () => {
    const ast = parse('{\r\n  "a": 1,\r\n  "b": [1, 2],\r\n  "c": {"d": null}\r\n}');
    const editor = new JsonAstEditor(ast);
    const mutations: Array<() => void> = [
      () => editor.set(['a'], 2),
      () => editor.set(['b', 0], 'x'),
      () => editor.set(['c'], [true]),
      () => editor.set(['d'], { e: [1] }),
      () => editor.set(['b', 2], 3),
      () => editor.delete(['b', 0]),
      () => editor.delete(['c']),
      () => editor.set(['c'], []),
    ];
    for (const mutate of mutations) {
      mutate();
      const text = unparse(ast);
      expect(() => JSON.parse(text)).not.toThrow();
      expect(text.replace(/\r\n/g, '')).not.toContain('\n');
    }
  });

  it('keeps untouched bytes around an appended and a removed member', () => {
    const source = '{\n  "a": 1\n}';
    const ast = parse(source);
    const editor = new JsonAstEditor(ast);
    editor.set(['b'], 2);
    const added = unparse(ast);
    expect(added.startsWith('{\n  "a": 1,')).toBe(true);
    expect(added.endsWith('\n}')).toBe(true);
    editor.delete(['b']);
    expect(unparse(ast)).toBe(source);
  });

  it('restores the original text after appending and deleting an array element', () => {
    const source = '[\n  1,\n  3\n]';
    const ast = parse(source);
    const editor = new JsonAstEditor(ast);
    editor.push([], 2);
    expect(unparse(ast)).toBe('[\n  1,\n  3,\n  2\n]');
    editor.delete([2]);
    expect(unparse(ast)).toBe(source);
  });

  it('uses the line break of a CRLF document for inserts and built containers', () => {
    const object = parse('{\r\n  "a": 1\r\n}');
    new JsonAstEditor(object).set(['b'], { c: [1, 2] });
    const objectText = unparse(object);
    expect(objectText).toBe('{\r\n  "a": 1,\r\n  "b": {\r\n    "c": [\r\n      1,\r\n      2\r\n    ]\r\n  }\r\n}');
    expect(objectText.replace(/\r\n/g, '')).not.toContain('\n');

    const array = parse('[\r\n  1\r\n]');
    new JsonAstEditor(array).push([], 2);
    expect(unparse(array)).toBe('[\r\n  1,\r\n  2\r\n]');

    const values = parse('{\r\n  "v": null\r\n}');
    new JsonAstEditor(values).set(['v'], { a: 1 });
    expect(unparse(values)).toBe('{\r\n  "v": {\r\n    "a": 1\r\n  }\r\n}');
  });

  it('keeps childs, walk and get consistent after mutations', () => {
    const ast = parse('{"a": [1]}');
    const editor = new JsonAstEditor(ast);
    editor.set(['a', 1], { b: 2 });

    const array = editor.node(['a']);
    expect(array.childs()).toHaveLength(2);
    expect(editor.get(['a'])).toEqual([1, { b: 2 }]);

    const types: string[] = [];
    ast.walk((node) => {
      types.push(node.type());
    });
    expect(types).toEqual(['object', 'member', 'string', 'array', 'number', 'object', 'member', 'string', 'number']);

    const visit = (node: JsonAstNode): void => {
      for (const child of node.childs()) {
        expect(child.parent()).toBe(node);
        visit(child);
      }
    };
    visit(ast);

    editor.delete(['a', 1]);
    expect(editor.node(['a']).childs()).toHaveLength(1);
    expect(editor.get(['a'])).toEqual([1]);
    expect(editor.has(['a', 1])).toBe(false);
  });

  it('keeps the original position of a rebuilt node', () => {
    const ast = parse('{\n  "v": 1\n}');
    const editor = new JsonAstEditor(ast);
    const before = editor.node(['v']).pos();
    editor.set(['v'], 'one');
    expect(editor.node(['v']).pos()).toEqual(before);
  });

  it('decodes __proto__ as an own key, exactly like JSON.parse', () => {
    const editor = createEditor('{"__proto__": {"polluted": true}, "a": 1}');
    const decoded = editor.get([]) as Record<string, unknown>;
    expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);
    expect(Object.keys(decoded)).toEqual(['__proto__', 'a']);
    expect(Object.prototype.hasOwnProperty.call(decoded, '__proto__')).toBe(true);
    expect(decoded['__proto__']).toEqual({ polluted: true });
    expect(editor.get(['__proto__'])).toEqual({ polluted: true });
    expect(JSON.stringify(decoded)).toBe('{"__proto__":{"polluted":true},"a":1}');
  });

  it('builds nested containers into valid JSON', () => {
    const ast = parse('{"a": 1}');
    const editor = new JsonAstEditor(ast);
    editor.set(['x'], [[1], 2]);
    expect(unparse(ast)).toBe('{"a": 1, "x": [[1], 2]}');
    expectJson(ast, { a: 1, x: [[1], 2] });

    const nested = parse('{\n  "a": 1\n}');
    new JsonAstEditor(nested).set(['x'], [[1], 2]);
    expect(unparse(nested)).toBe('{\n  "a": 1,\n  "x": [\n    [\n      1\n    ],\n    2\n  ]\n}');
    expectJson(nested, { a: 1, x: [[1], 2] });
  });
});
