import { TDataPath } from '../types';

export interface IFileFormat {
  get<T extends unknown = unknown>(dataPath: TDataPath): Promise<T | T[] | undefined>;
  set(dataPath: TDataPath, value: unknown): Promise<boolean>;
  delete(dataPath: TDataPath): Promise<boolean>;
}
