import { getJsonValue, setJsonValue, addJsonValue } from '../src/data-json';

const testJson = `{
  // This is a comment
  "name": "test",
  "nested": {
    "value": 42
  },
  "items": [1, 2, 3]
}`;

const jsonWithTrailingComma = `{
  "name": "test",
  "nested": {
    "value": 42
  },
  "items": [1, 2, 3,]
}`;

describe('data-json', () => {
  describe('getJsonValue', () => {
    it('reads top-level value', () => {
      expect(getJsonValue(testJson, 'name')).toBe('test');
    });

    it('reads nested value', () => {
      expect(getJsonValue(testJson, 'nested.value')).toBe(42);
    });

    it('reads array element', () => {
      expect(getJsonValue(testJson, 'items.0')).toBe(1);
    });

    it('returns undefined for non-existent path', () => {
      expect(getJsonValue(testJson, 'missing')).toBeUndefined();
    });
  });

  describe('setJsonValue', () => {
    it('sets top-level value preserving comments', () => {
      const result = setJsonValue(testJson, 'name', 'updated');
      expect(result).toContain('updated');
      expect(result).toContain('// This is a comment');
    });

    it('sets nested value', () => {
      const result = setJsonValue(testJson, 'nested.value', 100);
      expect(result).toContain('100');
    });

    it('sets array element', () => {
      const result = setJsonValue(testJson, 'items.1', 99);
      expect(result).toContain('99');
    });
  });

  describe('addJsonValue', () => {
    it('adds top-level value without overwriting', () => {
      const result = addJsonValue(testJson, 'newKey', 'newValue');
      expect(result).toContain('"newKey": "newValue"');
    });

    it('adds nested value', () => {
      const result = addJsonValue(testJson, 'nested.newKey', 'newNested');
      expect(result).toContain('"newNested"');
    });
  });
});