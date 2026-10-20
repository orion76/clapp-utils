import fs from 'fs';
import path from 'path';
import { addValue, detectFileFormat, readValue, writeValue } from '../src/data-file';
import { DataAccessError } from '../src/data-file/errors';

const testDir = '/tmp/clapp-utils-tests';
if (!fs.existsSync(testDir)) {
  fs.mkdirSync(testDir, { recursive: true });
}

const testJsonFile = path.join(testDir, 'test.json');
const testYamlFile = path.join(testDir, 'test.yaml');
const testJsoncFile = path.join(testDir, 'test.jsonc');

beforeAll(() => {
  // Create test JSON file
  fs.writeFileSync(testJsonFile, '{"name": "test", "nested": {"value": 42}}');
  
  // Create test YAML file
  fs.writeFileSync(testYamlFile, 'name: test\nnested:\n  value: 42\n');
  
  // Create test JSONC file with comment
  fs.writeFileSync(testJsoncFile, '// Comment\n{"name": "test"}');
});

afterAll(() => {
  // Cleanup
  if (fs.existsSync(testJsonFile)) fs.unlinkSync(testJsonFile);
  if (fs.existsSync(testYamlFile)) fs.unlinkSync(testYamlFile);
  if (fs.existsSync(testJsoncFile)) fs.unlinkSync(testJsoncFile);
});

describe('data-io', () => {
  describe('detectFileFormat', () => {
    it('detects .json format', () => {
      expect(detectFileFormat(testJsonFile)).toBe('json');
    });

    it('detects .yaml format', () => {
      expect(detectFileFormat(testYamlFile)).toBe('yaml');
    });

    it('detects .yml format', () => {
      expect(detectFileFormat(path.join(testDir, 'test.yml'))).toBe('yml');
    });
  });

  describe('readValue', () => {
    it('reads from JSON file', () => {
      expect(readValue(testJsonFile, ['name'])).toBe('test');
    });

    it('reads from YAML file', () => {
      expect(readValue(testYamlFile, ['name'])).toBe('test');
    });

    it('returns undefined for missing path', () => {
      expect(readValue(testJsonFile, ['missing'])).toBeUndefined();
    });
  });

  describe('writeValue', () => {
    it('writes to JSON file', () => {
      writeValue(testJsonFile, ['name'], 'updated');
      const content = fs.readFileSync(testJsonFile, 'utf8');
      expect(content).toContain('updated');
    });

    it('writes to YAML file', () => {
      writeValue(testYamlFile, ['name'], 'updated');
      const content = fs.readFileSync(testYamlFile, 'utf8');
      expect(content).toContain('updated');
    });
  });

  describe('addValue', () => {
    it('adds value to JSON file', () => {
      addValue(testJsonFile, ['newKey'], 'newValue');
      const content = fs.readFileSync(testJsonFile, 'utf8');
      expect(content).toContain('"newKey": "newValue"');
    });

    it('adds value to YAML file', () => {
      addValue(testYamlFile, ['newKey'], 'newValue');
      const content = fs.readFileSync(testYamlFile, 'utf8');
      expect(content).toContain('newKey: newValue');
    });
  });

  describe('DataAccessError', () => {
    it('throws for unsupported format', () => {
      expect(() => readValue(path.join(testDir, 'test.txt'), ['name'])).toThrow(DataAccessError);
    });
  });
});