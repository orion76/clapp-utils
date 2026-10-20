import { parsePath, escapePath, DataPathError } from '../src/data-path';

describe('data-path', () => {
  describe('parsePath', () => {
    it('parses simple dot-separated path', () => {
      expect(parsePath('a.b.c')).toEqual(['a', 'b', 'c']);
    });

    it('parses path with bare array index', () => {
      expect(parsePath('a.0.c')).toEqual(['a', 0, 'c']);
    });

    it('parses path with bracketed array index', () => {
      expect(parsePath('a.[0].c')).toEqual(['a', 0, 'c']);
    });

    it('parses path with escaped key containing dot', () => {
      expect(parsePath('a.[b.c].c')).toEqual(['a', 'b.c', 'c']);
    });

    it('parses path with quoted key', () => {
      expect(parsePath('a.["0"].c')).toEqual(['a', '0', 'c']);
    });

    it('throws on empty path', () => {
      expect(() => parsePath('')).toThrow(DataPathError);
    });

    it('throws on unbalanced brackets', () => {
      expect(() => parsePath('a.[b.c')).toThrow(DataPathError);
    });

    it('throws on trailing dot', () => {
      expect(() => parsePath('a.')).toThrow(DataPathError);
    });
  });

  describe('escapePath', () => {
    it('escapes number segments', () => {
      expect(escapePath(['a', 0, 'c'])).toBe('a.[0].c');
    });

    it('emits plain identifiers as-is', () => {
      expect(escapePath(['a', 'b', 'c'])).toBe('a.b.c');
    });

    it('wraps non-identifier keys in bracket notation', () => {
      // Keys with dots are wrapped as [key] in the path string
      expect(escapePath(['a.b', 'c'])).toBe('[\"a.b\"].c');
    });
  });
});