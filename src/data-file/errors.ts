import { TObjectPath } from './types';

export class DataAccessError extends Error {
  readonly filePath: string;

  readonly path?: TObjectPath;

  constructor(message: string, filePath: string, dataPath?: TObjectPath) {
    super(message);
    this.name = 'DataAccessError';
    this.filePath = filePath;

    this.path = dataPath;
  }
}

export class JsonDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonDataError';
  }
}

export class YamlDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YamlDataError';
  }
}

export class DataPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataPathError';
  }
}
