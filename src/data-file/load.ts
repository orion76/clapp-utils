import { readFile, writeFile } from 'node:fs/promises';

export async function loadFileContent(filePath: string): Promise<string> {
  try {
    const content = await readFile(filePath, { encoding: 'utf8' });
    return content;
  } catch (error) {
    console.error('Ошибка при чтении файла:', error);
    throw error;
  }
}

export async function saveFileContent(filePath: string, fileContent: string): Promise<boolean> {
  try {
    await writeFile(filePath, fileContent, { encoding: 'utf8' });
    return Promise.resolve(true);
  } catch (error) {
    console.error('Ошибка при чтении файла:', error);
    throw error;
  }
}
