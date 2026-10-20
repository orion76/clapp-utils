import { loadFileContent, saveFileContent } from '../load';
import { TDataPath } from '../types';
import { IFileFormat } from './types';

export abstract class FileBase implements IFileFormat {
  protected fileContent!: string;

  constructor(protected readonly filePath: string) {}
  protected abstract getDoc<T>(): T;
  protected abstract getValue<T extends unknown = unknown>(dataPath: TDataPath): T | undefined;
  protected abstract setValue(dataPath: TDataPath, value: unknown): boolean;
  protected abstract deleteValue(dataPath: TDataPath): boolean;
  protected abstract getFileContent(): string;

  protected save(): Promise<boolean> {
    const fileContent = this.getFileContent();
    return saveFileContent(this.filePath, fileContent);
  }

  async get<T>(dataPath: TDataPath): Promise<T | undefined> {
    await this.load();
    return this.getValue<T>(dataPath);
  }

  async set(dataPath: TDataPath, value: unknown): Promise<boolean> {
    await this.setValue(dataPath, value);

    return this.save();
  }

  async delete(dataPath: TDataPath): Promise<boolean> {
    await this.deleteValue(dataPath);
    return this.save();
  }

  protected async load(update = false) {
    if (this.fileContent && !update) {
      return Promise.resolve(true);
    }
    try {
      this.fileContent = await loadFileContent(this.filePath);
      return Promise.resolve(true);
    } catch (error) {
      return Promise.reject(error);
    }
  }
}
