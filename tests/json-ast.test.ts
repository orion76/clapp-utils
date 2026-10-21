import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JsonAst } from '../src/json-ast/index';
import type { JsonAstNode } from '../src/json-ast/index';

/** Find the first node matching the predicate, depth-first. */
function findNode(root: JsonAstNode, predicate: (node: JsonAstNode) => boolean): JsonAstNode | null {
  let found: JsonAstNode | null = null;
  root.walk((node) => {
    if (found === null && predicate(node)) {
      found = node;
    }
  });
  return found;
}

/** Narrow a possibly missing node or fail the current test. */
function requireNode(node: JsonAstNode | null, description: string): JsonAstNode {
  if (node === null) {
    throw new Error(`expected node not found: ${description}`);
  }
  return node;
}

/** Read `package.json` of `@clapp/utils`, wherever jest was started from. */
function readUtilsPackageJson(): { name: string; dependencies?: Record<string, string> } {
  const candidates = [join(process.cwd(), 'package.json'), join(process.cwd(), 'packages/utils/package.json')];
  for (const candidate of candidates) {
    const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: string };
    if (parsed.name === '@clapp/utils') {
      return parsed as { name: string; dependencies?: Record<string, string> };
    }
  }
  throw new Error('package.json of @clapp/utils not found');
}

describe('json-ast', () => {
  describe('unparse(parse(x)) round-trip', () => {
    const samples: string[] = [
      'true',
      'false',
      'null',
      '42',
      '-0',
      '0',
      '42.7',
      '42.7e-10',
      '1e+10',
      '1E+10',
      '-1.5e-3',
      '42.0',
      '0.0',
      '-0.0',
      '123456789012345678901234567890',
      '""',
      '  42  ',
      '\n\n  \t{"a": 1}\r\n\n\t ',
      '[]',
      '{}',
      '[ ]',
      '{ }',
      '[\n]',
      '{ \n\t }',
      '[1,2,3]',
      '[1,]',
      '{"a":1,"b":2}',
      '[1, 2,   3 ,4]',
      '{"a":1,"a":2}',
      '{"b":2,"a":1,"b":3}',
      '{"a":1,"b":[true,null,false],"c":{"d":{}}}',
      '{"x":{"y":{"z":[1,{"k":"v"},[]]}}}',
      String.raw`"quote: \" backslash: \\ solidus: \/ controls: \b \f \n \r \t"`,
      String.raw`"unicode: \u00e9 \u4e16 \uD83D\uDE00 \u0000"`,
      JSON.stringify('plain text'),
      `{
	"id"   :   1,
	"tags" : [ "a" , "b" ],

	"nested" : {
		"deep" : { "x" : true, "y" : null }
	},
	"dup"   : 1,
	"dup"   : 2
}
`,
      `[
	1,
		[ 2 , 3 ] ,
	{
		"a" : "b"
	}
]`,
    ];

    it.each(samples)('restores %j byte for byte', (sample) => {
      expect(JsonAst.unparse(JsonAst.parse(sample))).toBe(sample);
    });

    it('restores a document with leading and trailing whitespace only around an object', () => {
      const source = ' \t\n{"a": 1, "b": [2, 3]}\n\r\n  ';
      expect(JsonAst.unparse(JsonAst.parse(source))).toBe(source);
    });

    it('keeps key order and duplicate keys', () => {
      const source = '{"second": 2, "first": 1, "second": 3}';
      const lines = JsonAst.unparse(JsonAst.parse(source));
      expect(lines).toBe(source);
      expect(lines.indexOf('"second": 2')).toBeLessThan(lines.indexOf('"first": 1'));
      expect(lines.indexOf('"first": 1')).toBeLessThan(lines.indexOf('"second": 3'));
    });
  });

  describe('value change keeps the original formatting', () => {
    const source = `{
	"name" : "clapp" ,
	"count" : 1 ,
	"nested" : { "flag" : true }
}
`;

    it('rewrites a number only where it stands', () => {
      const ast = JsonAst.parse(source);
      const count = requireNode(
        findNode(ast, (node) => node.type() === 'number' && node.get('body') === '1'),
        'number 1',
      );
      count.set('body', '2');
      count.set('value', 2);

      const unparsed = JsonAst.unparse(ast);
      expect(unparsed).toBe(source.replace('"count" : 1', '"count" : 2'));
      expect(unparsed.split('\n')).toHaveLength(source.split('\n').length);
      expect(unparsed).toContain('\t"name" : "clapp" ,\n');
      expect(unparsed).toContain('\t"nested" : { "flag" : true }\n');
    });

    it('rewrites a string body without touching indentation or separators', () => {
      const ast = JsonAst.parse(source);
      const name = requireNode(
        findNode(ast, (node) => node.type() === 'string' && node.get('value') === 'clapp'),
        'string "clapp"',
      );
      name.set('body', '"clapp-2"');
      name.set('value', 'clapp-2');

      const unparsed = JsonAst.unparse(ast);
      expect(unparsed).toBe(source.replace('"clapp"', '"clapp-2"'));
      expect(unparsed).toContain('\t"count" : 1 ,\n');
    });

    it('keeps untouched parts byte-identical', () => {
      const ast = JsonAst.parse(source);
      const flag = requireNode(
        findNode(ast, (node) => node.type() === 'boolean' && node.get('body') === 'true'),
        'boolean true',
      );
      flag.set('body', 'false');
      flag.set('value', false);

      const unparsed = JsonAst.unparse(ast);
      expect(unparsed).toBe(source.replace('"flag" : true', '"flag" : false'));
    });
  });

  describe('AST shape', () => {
    const source = '{\n  "key": [1, "two"]\n}';

    it('builds object, member, array and literal nodes with 1-based positions', () => {
      const root = JsonAst.parse(source);
      expect(root.type()).toBe('object');
      expect(root.pos()).toEqual({ line: 1, column: 1, offset: 0 });
      expect(root.parent()).toBeNull();

      const member = root.child(0);
      expect(member?.type()).toBe('member');
      expect(member?.parent()).toBe(root);

      const key = member?.child(0);
      expect(key?.type()).toBe('string');
      expect(key?.get('body')).toBe('"key"');
      expect(key?.get('value')).toBe('key');
      expect(key?.get('epilog')).toBe(': ');

      const value = member?.child(1);
      expect(value?.type()).toBe('array');
      expect(value?.child(0)?.type()).toBe('number');
      expect(value?.child(1)?.get('value')).toBe('two');
      expect(value?.pos()).toEqual({ line: 2, column: 10, offset: 11 });
    });

    it('walks downward, upward and both in source order', () => {
      const root = JsonAst.parse('{"a": 1}');
      const downward: string[] = [];
      const upward: string[] = [];
      root.walk((node) => {
        downward.push(node.type());
      }, 'downward');
      root.walk((node) => {
        upward.push(node.type());
      }, 'upward');
      expect(downward).toEqual(['object', 'member', 'string', 'number']);
      expect(upward).toEqual(['string', 'number', 'member', 'object']);

      const both: string[] = [];
      root.walk((node, depth, _parent, when) => {
        both.push(`${depth}:${when}:${node.type()}`);
      }, 'both');
      expect(both[0]).toBe('0:downward:object');
      expect(both[both.length - 1]).toBe('0:upward:object');
      expect(both).toHaveLength(8);
    });
  });

  describe('childs/child contract', () => {
    let array: JsonAstNode;

    beforeEach(() => {
      array = JsonAst.parse('[10, 20, 30, 40, 50]');
    });

    it('returns the whole child list and ranges of it', () => {
      expect(array.type()).toBe('array');
      expect(array.childs()).toHaveLength(5);
      expect(array.childs(2)).toHaveLength(3);
      expect(array.childs(1, 3)).toHaveLength(2);
      expect(array.childs(0, 5)).toHaveLength(5);
      expect(array.childs(5)).toHaveLength(0);
      expect(array.childs(2, 2)).toHaveLength(0);
      expect(array.childs(1, 3).map((node) => node.get('value'))).toEqual([20, 30]);
    });

    it('returns a child by position and null only at the child count', () => {
      expect(array.child(0)?.get('value')).toBe(10);
      expect(array.child(2)?.get('value')).toBe(30);
      expect(array.child(4)?.get('value')).toBe(50);
      expect(array.child(5)).toBeNull();
    });

    it('throws RangeError for invalid ranges and positions', () => {
      const cases: Array<[string, () => unknown]> = [
        ['childs(-1)', () => array.childs(-1)],
        ['childs(1.5)', () => array.childs(1.5)],
        ['childs(0, 1.5)', () => array.childs(0, 1.5)],
        ['childs(3, 2)', () => array.childs(3, 2)],
        ['childs(0, 6)', () => array.childs(0, 6)],
        ['childs(6, 6)', () => array.childs(6, 6)],
        ['child(-1)', () => array.child(-1)],
        ['child(1.5)', () => array.child(1.5)],
        ['child(6)', () => array.child(6)],
      ];
      for (const [label, call] of cases) {
        try {
          call();
          throw new Error(`${label} did not throw`);
        } catch (error) {
          expect(error).toBeInstanceOf(RangeError);
          expect((error as RangeError).message).toContain('5 children');
          expect((error as RangeError).message).toContain('0 <= begin <= end <= 5');
        }
      }
    });

    it('returns a copy: mutating it does not change the tree', () => {
      const copy = array.childs();
      expect(copy).not.toBe(array.childs());
      copy.pop();
      expect(copy).toHaveLength(4);
      expect(array.childs()).toHaveLength(5);

      const first = requireNode(array.child(0), 'first array element');
      copy[0] = requireNode(array.child(1), 'second array element');
      expect(array.child(0)).toBe(first);
      expect(array.child(0)?.get('value')).toBe(10);
      expect(first.parent()).toBe(array);
    });
  });

  describe('errors', () => {
    it('rejects a non-string argument in parse', () => {
      const parse = JsonAst.parse as unknown as (json: unknown) => unknown;
      for (const value of [42, null, undefined, {}, [], true]) {
        expect(() => parse(value)).toThrow(new Error('invalid JSON argument (expected type string)'));
      }
    });

    it('rejects a non-node argument in unparse', () => {
      const unparse = JsonAst.unparse as unknown as (ast: unknown) => unknown;
      for (const value of [42, null, undefined, {}, [], 'x', true]) {
        expect(() => unparse(value)).toThrow(new Error('generate: invalid AST argument (expected type object)'));
      }
    });

    const invalid: Array<[string, number, number, number, string]> = [
      ['01', 1, 2, 1, '01'],
      ['1.', 1, 3, 2, '1.'],
      ['{"a":}', 1, 6, 5, '{"a":}'],
      ['tru', 1, 4, 3, 'tru'],
      ['"abc', 1, 5, 4, '"abc'],
      ['1 x', 1, 3, 2, '1 x'],
      ['[1 2]', 1, 4, 3, '[1 2]'],
      ['{"a" 1}', 1, 6, 5, '{"a" 1}'],
      ['1e', 1, 3, 2, '1e'],
      ['"\\u00zz"', 1, 6, 5, '"\\u00zz"'],
      ['{"a":1}}', 1, 8, 7, '{"a":1}}'],
      ['{\n  "a": 1,\n  "b": \n}', 4, 1, 20, '}'],
    ];

    it.each(invalid)('reports position and excerpt for %j', (text, line, column, offset, excerpt) => {
      let error: unknown = null;
      try {
        JsonAst.parse(text);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message.startsWith('parse: JSON parsing failure:')).toBe(true);
      expect(message).toContain(`at line ${line}, column ${column}, offset ${offset}`);
      expect(message).toContain(excerpt);
      expect(message).toContain('^');
    });
  });

  describe('public API surface', () => {
    it('exposes only parse/unparse on JsonAst (no dump, serialize or CLI helpers)', () => {
      expect(typeof JsonAst.parse).toBe('function');
      expect(typeof JsonAst.unparse).toBe('function');
      const surface = JsonAst as unknown as Record<string, unknown>;
      expect(surface.dump).toBeUndefined();
      expect(surface.serialize).toBeUndefined();
    });

    it('has no PEG/ASTy or CLI dependency in packages/utils/package.json', () => {
      const packageJson = readUtilsPackageJson();
      expect(Object.keys(packageJson.dependencies ?? {}).sort()).toEqual(['object-path', 'yaml']);
    });
  });
});
