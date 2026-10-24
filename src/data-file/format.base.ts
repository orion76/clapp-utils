import { loadFileContent, saveFileContent } from "./load";
import { IFileFormat, TObjectPath } from "./types";

export abstract class FileBase implements IFileFormat {
  protected fileContent!: string;

  constructor(protected readonly filePath: string) {}
  protected abstract getDoc<T>(): T;
  protected abstract getValue<T extends unknown = unknown>(dataPath: TObjectPath): T | undefined;
  protected abstract setValue(dataPath: TObjectPath, value: unknown): boolean;
  protected abstract deleteValue(dataPath: TObjectPath): boolean;
  protected abstract getFileContent(): string;

  protected save(): Promise<boolean> {
    const fileContent = this.getFileContent();
    return saveFileContent(this.filePath, fileContent);
  }

  async get<T>(dataPath: TObjectPath): Promise<T | undefined> {
    await this.load();
    return this.getValue<T>(dataPath);
  }

  async set(dataPath: TObjectPath, value: unknown): Promise<boolean> {
    await this.setValue(dataPath, value);

    return this.save();
  }

  async delete(dataPath: TObjectPath): Promise<boolean> {
    await this.deleteValue(dataPath);
    return this.save();
  }

  protected async load(update = false) {
    if (this.fileContent && !update) {
      return true;
    }
    try {
      this.fileContent = await loadFileContent(this.filePath);
      return true;
    } catch (error) {
      return Promise.reject(error);
    }
  }
}
