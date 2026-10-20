import { JsonFile, YamlFile } from '../public-api';
import { detectFileFormat } from './io';

export function createFile(filePath: string) {
  const format = detectFileFormat(filePath);
  switch (format) {
    case 'json':
      return new JsonFile(filePath);
    case 'yaml':
      return new YamlFile(filePath);
  }
}
