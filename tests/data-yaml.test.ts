import { getYamlValue, setYamlValue, addYamlValue } from '../src/data-file';

const testYaml = `# Main config
name: test
nested:
  value: 42
items:
  - item1
  - item2
# Another comment`;

const yamlWithCommentAfter: string = `name: test
# comment
nested:
  value: 42`;

describe('data-yaml', () => {
  describe('getYamlValue', () => {
    it('reads top-level value', () => {
      expect(getYamlValue(testYaml, 'name')).toBe('test');
    });

    it('reads nested value', () => {
      expect(getYamlValue(testYaml, 'nested.value')).toBe(42);
    });

    it('reads array element', () => {
      expect(getYamlValue(testYaml, 'items.0')).toBe('item1');
    });

    it('returns undefined for non-existent path', () => {
      expect(getYamlValue(testYaml, 'missing')).toBeUndefined();
    });
  });

  describe('setYamlValue', () => {
    it('sets top-level value preserving comments and order', () => {
      const result = setYamlValue(testYaml, 'name', 'updated');
      expect(result).toContain('updated');
      // Comment should be preserved
      expect(result).toContain('# Main config');
    });

    it('sets nested value', () => {
      const result = setYamlValue(testYaml, 'nested.value', 100);
      expect(result).toContain('100');
    });

    it('sets array element', () => {
      const result = setYamlValue(testYaml, 'items.0', 'item0');
      expect(result).toContain('item0');
    });
  });

  describe('addYamlValue', () => {
    it('adds top-level value without overwriting', () => {
      const result = addYamlValue(testYaml, 'newKey', 'newValue');
      expect(result).toContain('newKey: newValue');
    });

    it('adds nested value', () => {
      const result = addYamlValue(testYaml, 'nested.newKey', 'newNested');
      expect(result).toContain('newNested');
    });
  });
});