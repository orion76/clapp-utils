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
    expect(JsonAstEditor.node(ast, [])).toBe(ast);
    expect(JsonAstEditor.has(ast, [])).toBe(true);
    expect(JsonAstEditor.get(ast, [])).toEqual({
      name: 'clapp',
      version: 2,
      tags: ['a', 'b'],
      nested: { flag: true, none: null },
      dup: 2,
    });
  });

  it('reads nested objects and arrays', () => {
    const ast = parse(source);
    expect(JsonAstEditor.get(ast, ['name'])).toBe('clapp');
    expect(JsonAstEditor.get(ast, ['tags', 0])).toBe('a');
    expect(JsonAstEditor.get(ast, ['tags', 1])).toBe('b');
    expect(JsonAstEditor.get(ast, ['nested', 'flag'])).toBe(true);
    expect(JsonAstEditor.get(ast, ['nested', 'none'])).toBeNull();
    expect(JsonAstEditor.node(ast, ['tags']).type()).toBe('array');
    expect(JsonAstEditor.node(ast, ['nested']).type()).toBe('object');
    expect(JsonAstEditor.node(ast, ['tags', 1]).get('value')).toBe('b');
    expect(JsonAstEditor.has(ast, ['nested', 'flag'])).toBe(true);
  });

  it('resolves duplicate keys to the last occurrence', () => {
    const ast = parse(source);
    expect(JsonAstEditor.get(ast, ['dup'])).toBe(2);
    expect(JsonAstEditor.node(ast, ['dup']).get('body')).toBe('2');
  });

  it('coerces number segments to object keys and numeric strings to array indexes', () => {
    const ast = parse('{"0": "zero", "1": "one", "list": ["a", "b"]}');
    expect(JsonAstEditor.get(ast, [0])).toBe('zero');
    expect(JsonAstEditor.get(ast, ['1'])).toBe('one');
    expect(JsonAstEditor.get(ast, ['list', '0'])).toBe('a');
    expect(JsonAstEditor.get(ast, ['list', 1])).toBe('b');
  });

  it('reads empty containers and the document root of a scalar', () => {
    expect(JsonAstEditor.get(parse('{}'), [])).toEqual({});
    expect(JsonAstEditor.get(parse('[]'), [])).toEqual([]);
    expect(JsonAstEditor.get(parse('{"a": {}, "b": []}'), ['a'])).toEqual({});
    expect(JsonAstEditor.get(parse('{"a": {}, "b": []}'), ['b'])).toEqual([]);
    expect(JsonAstEditor.has(parse('{}'), ['a'])).toBe(false);
    expect(JsonAstEditor.has(parse('[]'), [0])).toBe(false);
    expect(JsonAstEditor.get(parse('42'), [])).toBe(42);
    expect(JsonAstEditor.node(parse('42'), []).type()).toBe('number');
  });

  it('reads every scalar type', () => {
    const ast = parse('{"s": "x", "n": -1.5e-3, "t": true, "f": false, "z": null, "m": -0}');
    expect(JsonAstEditor.get(ast, ['s'])).toBe('x');
    expect(JsonAstEditor.get(ast, ['n'])).toBe(-1.5e-3);
    expect(JsonAstEditor.get(ast, ['t'])).toBe(true);
    expect(JsonAstEditor.get(ast, ['f'])).toBe(false);
    expect(JsonAstEditor.get(ast, ['z'])).toBeNull();
    expect(Object.is(JsonAstEditor.get(ast, ['m']), -0)).toBe(true);
  });

  it('reports a missing key or index', () => {
    const ast = parse(source);
    expect(JsonAstEditor.has(ast, ['missing'])).toBe(false);
    expect(JsonAstEditor.has(ast, ['tags', 2])).toBe(false);
    expect(JsonAstEditor.has(ast, ['missing', 'deeper'])).toBe(false);
    expectPathError(() => JsonAstEditor.node(ast, ['missing']), 0);
    expectPathError(() => JsonAstEditor.get(ast, ['tags', 2]), 1);
  });

  it('reports a path that runs through a scalar', () => {
    const ast = parse(source);
    expect(JsonAstEditor.has(ast, ['name', 'length'])).toBe(false);
    expectPathError(() => JsonAstEditor.get(ast, ['name', 'length']), 1);
    expectPathError(() => JsonAstEditor.node(ast, ['version', 0]), 1);
  });

  it('rejects invalid segments with their index', () => {
    const ast = parse(source);
    const invalid: Array<[unknown, number]> = [
      [[Number.NaN], 0],
      [[Number.POSITIVE_INFINITY], 0],
      [[-1], 0],
      [[1.5], 0],
      [[null], 0],
      [[{}], 0],
      [[true], 0],
      [['tags', undefined], 1],
      [['tags', 'x'], 1],
      [['tags', '01'], 1],
      [['tags', -1], 1],
    ];
    for (const [path, segmentIndex] of invalid) {
      expectPathError(() => JsonAstEditor.get(ast, path as JsonAstPath), segmentIndex);
      expectPathError(() => JsonAstEditor.has(ast, path as JsonAstPath), segmentIndex);
    }
  });

  it('rejects a path that is not an array', () => {
    const ast = parse(source);
    expectPathError(() => JsonAstEditor.get(ast, asPath('name')), null);
    expectPathError(() => JsonAstEditor.has(ast, asPath(null)), null);
    expectPathError(() => JsonAstEditor.node(ast, asPath(undefined)), null);
  });

  it('returns the node of the addressed value', () => {
    const ast = parse('{"a": [1]}');
    expect(JsonAstEditor.node(ast, [])).toBe(ast);
    const element = JsonAstEditor.node(ast, ['a', 0]);
    expect(element.type()).toBe('number');
    expect(element.get('value')).toBe(1);
    expect(element.parent()?.type()).toBe('array');
  });
});

describe('json-ast editor: set', () => {
  it('rewrites a scalar of the same type only where it stands', () => {
    const source = '{\n\t"keep" : [ 1 , 2 ] ,\n\t"value" :   "old"  ,\n\t"tail" : true\n}';
    const ast = parse(source);
    JsonAstEditor.set(ast, ['value'], 'new');
    expect(unparse(ast)).toBe(source.replace('"old"', '"new"'));
    expect(JsonAstEditor.node(ast, ['value']).type()).toBe('string');
    expect(JsonAstEditor.get(ast, ['value'])).toBe('new');
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
    JsonAstEditor.set(ast, ['v'], after);
    expect(unparse(ast)).toBe(`{"v": ${expected}}`);
    expect(JsonAstEditor.get(ast, ['v'])).toEqual(after);
  });

  it('writes -0 as -0', () => {
    const ast = parse('{"v": 0}');
    JsonAstEditor.set(ast, ['v'], -0);
    expect(unparse(ast)).toBe('{"v": -0}');
    expect(Object.is(JsonAstEditor.get(ast, ['v']), -0)).toBe(true);
    expect(Object.is((JSON.parse(unparse(ast)) as { v: number }).v, -0)).toBe(true);
  });

  it('escapes strings with JSON.stringify', () => {
    const ast = parse('{"v": "x"}');
    const value = 'quote " backslash \\ newline \n tab \t null \u0000 é';
    JsonAstEditor.set(ast, ['v'], value);
    expect(unparse(ast)).toBe(`{"v": ${JSON.stringify(value)}}`);
    expect(JsonAstEditor.get(ast, ['v'])).toBe(value);
  });

  it('rebuilds a node when the scalar type changes', () => {
    const ast = parse('{"v": 1}');
    JsonAstEditor.set(ast, ['v'], 'one');
    expect(unparse(ast)).toBe('{"v": "one"}');
    expect(JsonAstEditor.node(ast, ['v']).type()).toBe('string');
    expect(JsonAstEditor.get(ast, ['v'])).toBe('one');
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
      JsonAstEditor.set(ast, ['v'], value);
      expect(unparse(ast)).toBe(expected);
      expect(JsonAstEditor.node(ast, ['v']).type()).toBe(type);
    }
  });

  it('builds a nested object with the indentation of a multiline parent', () => {
    const source = '{\n  "id": 1,\n  "data": null\n}';
    const ast = parse(source);
    JsonAstEditor.set(ast, ['data'], { a: 1, b: [2, 3] });
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
    expect(JsonAstEditor.get(ast, ['data'])).toEqual({ a: 1, b: [2, 3] });
  });

  it('nests built containers one indentation step deeper', () => {
    const ast = parse('{\n  "a": 1,\n  "b": 2\n}');
    JsonAstEditor.set(ast, ['a'], { x: { y: [1] } });
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
    JsonAstEditor.set(object, ['a'], { x: [1, 2] });
    expect(unparse(object)).toBe('{"a": {"x": [1, 2]}, "b": 2}');

    const array = parse('[1, 2, 3]');
    JsonAstEditor.set(array, [1], [4, 5]);
    expect(unparse(array)).toBe('[1, [4, 5], 3]');
  });

  it('rebuilds a container into a scalar', () => {
    const ast = parse('{\n  "a": {\n    "x": 1\n  },\n  "b": 2\n}');
    JsonAstEditor.set(ast, ['a'], 7);
    expect(unparse(ast)).toBe('{\n  "a": 7,\n  "b": 2\n}');
    expect(JsonAstEditor.node(ast, ['a']).type()).toBe('number');
  });

  it('rebuilds an array into an object in a multiline parent', () => {
    const ast = parse('{\n  "a": [1],\n  "b": 2\n}');
    JsonAstEditor.set(ast, ['a'], { x: true });
    expect(unparse(ast)).toBe('{\n  "a": {\n    "x": true\n  },\n  "b": 2\n}');
  });

  it('keeps an array element separator when replacing the element', () => {
    const ast = parse('[ 1 , 2 , 3 ]');
    JsonAstEditor.set(ast, [1], 20);
    expect(unparse(ast)).toBe('[ 1 , 20 , 3 ]');
  });

  it('rejects an empty path', () => {
    const ast = parse('{"a": 1}');
    const error = expectPathError(() => JsonAstEditor.set(ast, [], 2), null);
    expect(error.message).toContain('root');
    expectPathError(() => JsonAstEditor.set(parse('[1]'), [], 2), null);
    expect(unparse(ast)).toBe('{"a": 1}');
  });

  it('rejects a missing path', () => {
    const ast = parse('{"a": 1, "list": [1]}');
    expectPathError(() => JsonAstEditor.set(ast, ['missing'], 2), 0);
    expectPathError(() => JsonAstEditor.set(ast, ['list', 1], 2), 1);
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
      const error = expectValueError(() => JsonAstEditor.set(ast, ['v'], value));
      expect(error.message).toContain('invalid JSON value');
      expect(unparse(ast)).toBe('{"v": 1}');
    }
  });

  it('rejects invalid nested values', () => {
    const ast = parse('{"v": 1}');
    expect(() => JsonAstEditor.set(ast, ['v'], { a: [1, () => 2] })).toThrow(/invalid JSON value/);
    expect(unparse(ast)).toBe('{"v": 1}');
  });
});

describe('json-ast editor: add', () => {
  it('appends a member to a multiline object', () => {
    const ast = parse('{\n  "a": 1,\n  "b": 2\n}');
    JsonAstEditor.add(ast, ['c'], 3);
    expect(unparse(ast)).toBe('{\n  "a": 1,\n  "b": 2,\n  "c": 3\n}');
    expect(JsonAstEditor.get(ast, ['c'])).toBe(3);
    expect(JsonAstEditor.node(ast, []).childs()).toHaveLength(3);
  });

  it('appends a member to a single-line object', () => {
    const ast = parse('{"a": 1, "b": 2}');
    JsonAstEditor.add(ast, ['c'], { x: true });
    expect(unparse(ast)).toBe('{"a": 1, "b": 2, "c": {"x": true}}');
  });

  const emptyObjects: Array<[string, string]> = [
    ['{}', '{"a": 1}'],
    ['{ }', '{"a": 1}'],
    [' {  } ', ' {"a": 1} '],
  ];

  it.each(emptyObjects)('adds the first member to %j compactly', (source, expected) => {
    const ast = parse(source);
    JsonAstEditor.add(ast, ['a'], 1);
    expect(unparse(ast)).toBe(expected);
  });

  it('adds a member to a nested object', () => {
    const ast = parse('{"a": {"b": 1}}');
    JsonAstEditor.add(ast, ['a', 'c'], 2);
    expect(unparse(ast)).toBe('{"a": {"b": 1, "c": 2}}');
  });

  it('coerces a number segment to an object key', () => {
    const ast = parse('{}');
    JsonAstEditor.add(ast, [0], 'zero');
    expect(unparse(ast)).toBe('{"0": "zero"}');
    expect(JsonAstEditor.get(ast, ['0'])).toBe('zero');
  });

  it('rejects an existing object key', () => {
    const ast = parse('{"a": 1, "a": 2}');
    const error = expectPathError(() => JsonAstEditor.add(ast, ['a'], 3), 0);
    expect(error.message).toContain('already exists');
    expect(error.message).toContain('set');
    expect(unparse(ast)).toBe('{"a": 1, "a": 2}');
  });

  it('rejects a missing or scalar parent', () => {
    const ast = parse('{"a": 1}');
    expectPathError(() => JsonAstEditor.add(ast, ['x', 'y'], 1), 0);
    expectPathError(() => JsonAstEditor.add(ast, ['a', 'b'], 1), 1);
    expect(unparse(ast)).toBe('{"a": 1}');
  });

  it('rejects an empty path', () => {
    const ast = parse('{}');
    expectPathError(() => JsonAstEditor.add(ast, [], 1), null);
    expect(unparse(ast)).toBe('{}');
  });

  it('rejects an array index out of range', () => {
    const ast = parse('[1, 2]');
    expectPathError(() => JsonAstEditor.add(ast, [3], 3), 0);
    expectPathError(() => JsonAstEditor.add(ast, ['3'], 3), 0);
    expectPathError(() => JsonAstEditor.add(ast, [-1], 3), 0);
    expect(unparse(ast)).toBe('[1, 2]');
  });

  it('rejects an invalid value', () => {
    const ast = parse('{}');
    const error = expectValueError(() => JsonAstEditor.add(ast, ['a'], undefined));
    expect(error.message).toContain('invalid JSON value');
    expect(unparse(ast)).toBe('{}');
  });

  it('appends to a multiline array', () => {
    const ast = parse('[\n  1,\n  2\n]');
    JsonAstEditor.add(ast, [2], 3);
    expect(unparse(ast)).toBe('[\n  1,\n  2,\n  3\n]');
    expect(JsonAstEditor.get(ast, [2])).toBe(3);
  });

  it('inserts at the beginning of a multiline array', () => {
    const ast = parse('[\n  1,\n  2\n]');
    JsonAstEditor.add(ast, [0], 0);
    expect(unparse(ast)).toBe('[\n  0,\n  1,\n  2\n]');
    expect(JsonAstEditor.get(ast, [0])).toBe(0);
  });

  it('inserts in the middle of a single-line array', () => {
    const ast = parse('[1, 3]');
    JsonAstEditor.add(ast, [1], 2);
    expect(unparse(ast)).toBe('[1, 2, 3]');
  });

  it('appends to a single-line array', () => {
    const ast = parse('[1]');
    JsonAstEditor.add(ast, [1], 2);
    expect(unparse(ast)).toBe('[1, 2]');
  });

  const emptyArrays: Array<[string, string]> = [
    ['[]', '[1]'],
    ['[ ]', '[1]'],
    [' [  ] ', ' [1] '],
  ];

  it.each(emptyArrays)('adds the first element to %j compactly', (source, expected) => {
    const ast = parse(source);
    JsonAstEditor.add(ast, [0], 1);
    expect(unparse(ast)).toBe(expected);
  });

  it('adds a nested value to an array', () => {
    const ast = parse('[]');
    JsonAstEditor.add(ast, [0], { a: [1, {}] });
    expect(unparse(ast)).toBe('[{"a": [1, {}]}]');
    expect(JsonAstEditor.get(ast, [0])).toEqual({ a: [1, {}] });
  });

  it('adds a nested container to a multiline array', () => {
    const ast = parse('[\n  1\n]');
    JsonAstEditor.add(ast, [1], { a: 2 });
    expect(unparse(ast)).toBe('[\n  1,\n  {\n    "a": 2\n  }\n]');
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
    JsonAstEditor.delete(ast, path);
    expect(unparse(ast)).toBe(expected);
    expect(JsonAstEditor.has(ast, path)).toBe(false);
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
    JsonAstEditor.delete(ast, path);
    expect(unparse(ast)).toBe(expected);
    expect(JsonAstEditor.has(ast, path)).toBe(false);
    expect(() => JSON.parse(unparse(ast))).not.toThrow();
  });

  it('deletes nested values', () => {
    const ast = parse('{"a": {"b": 1, "c": 2}, "list": [{"x": 1}]}');
    JsonAstEditor.delete(ast, ['a', 'b']);
    JsonAstEditor.delete(ast, ['list', 0]);
    expect(unparse(ast)).toBe('{"a": {"c": 2}, "list": []}');
  });

  it('deletes the last occurrence of a duplicate key', () => {
    const ast = parse('{"a": 1, "a": 2, "b": 3}');
    JsonAstEditor.delete(ast, ['a']);
    expect(unparse(ast)).toBe('{"a": 1, "b": 3}');
    expect(JsonAstEditor.get(ast, ['a'])).toBe(1);
  });

  it('rejects a missing path or the root', () => {
    const ast = parse('{"a": 1}');
    expectPathError(() => JsonAstEditor.delete(ast, []), null);
    expectPathError(() => JsonAstEditor.delete(ast, ['missing']), 0);
    expectPathError(() => JsonAstEditor.delete(ast, ['a', 'b']), 1);
    expectPathError(() => JsonAstEditor.delete(parse('{}'), ['a']), 0);
    expectPathError(() => JsonAstEditor.delete(parse('[]'), [0]), 0);
    expect(unparse(ast)).toBe('{"a": 1}');
  });
});

describe('json-ast editor: invariants', () => {
  it('keeps the document valid after every mutation', () => {
    const ast = parse('{\r\n  "a": 1,\r\n  "b": [1, 2],\r\n  "c": {"d": null}\r\n}');
    const mutations: Array<() => void> = [
      () => JsonAstEditor.set(ast, ['a'], 2),
      () => JsonAstEditor.set(ast, ['b', 0], 'x'),
      () => JsonAstEditor.set(ast, ['c'], [true]),
      () => JsonAstEditor.add(ast, ['d'], { e: [1] }),
      () => JsonAstEditor.add(ast, ['b', 2], 3),
      () => JsonAstEditor.delete(ast, ['b', 0]),
      () => JsonAstEditor.delete(ast, ['c']),
      () => JsonAstEditor.add(ast, ['c'], []),
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
    JsonAstEditor.add(ast, ['b'], 2);
    const added = unparse(ast);
    expect(added.startsWith('{\n  "a": 1,')).toBe(true);
    expect(added.endsWith('\n}')).toBe(true);
    JsonAstEditor.delete(ast, ['b']);
    expect(unparse(ast)).toBe(source);
  });

  it('restores the original text after adding and deleting an array element', () => {
    const source = '[\n  1,\n  3\n]';
    const ast = parse(source);
    JsonAstEditor.add(ast, [1], 2);
    expect(unparse(ast)).toBe('[\n  1,\n  2,\n  3\n]');
    JsonAstEditor.delete(ast, [1]);
    expect(unparse(ast)).toBe(source);
  });

  it('uses the line break of a CRLF document for inserts and built containers', () => {
    const object = parse('{\r\n  "a": 1\r\n}');
    JsonAstEditor.add(object, ['b'], { c: [1, 2] });
    const objectText = unparse(object);
    expect(objectText).toBe('{\r\n  "a": 1,\r\n  "b": {\r\n    "c": [\r\n      1,\r\n      2\r\n    ]\r\n  }\r\n}');
    expect(objectText.replace(/\r\n/g, '')).not.toContain('\n');

    const array = parse('[\r\n  1\r\n]');
    JsonAstEditor.add(array, [1], 2);
    expect(unparse(array)).toBe('[\r\n  1,\r\n  2\r\n]');

    const values = parse('{\r\n  "v": null\r\n}');
    JsonAstEditor.set(values, ['v'], { a: 1 });
    expect(unparse(values)).toBe('{\r\n  "v": {\r\n    "a": 1\r\n  }\r\n}');
  });

  it('keeps childs, walk and get consistent after mutations', () => {
    const ast = parse('{"a": [1]}');
    JsonAstEditor.add(ast, ['a', 1], { b: 2 });

    const array = JsonAstEditor.node(ast, ['a']);
    expect(array.childs()).toHaveLength(2);
    expect(JsonAstEditor.get(ast, ['a'])).toEqual([1, { b: 2 }]);

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

    JsonAstEditor.delete(ast, ['a', 1]);
    expect(JsonAstEditor.node(ast, ['a']).childs()).toHaveLength(1);
    expect(JsonAstEditor.get(ast, ['a'])).toEqual([1]);
    expect(JsonAstEditor.has(ast, ['a', 1])).toBe(false);
  });

  it('keeps the original position of a rebuilt node', () => {
    const ast = parse('{\n  "v": 1\n}');
    const before = JsonAstEditor.node(ast, ['v']).pos();
    JsonAstEditor.set(ast, ['v'], 'one');
    expect(JsonAstEditor.node(ast, ['v']).pos()).toEqual(before);
  });
});
