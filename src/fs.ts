import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export function getUserProfileDirectory() {
  return os.homedir();
}

export function getCwd(): string {
  return execSync('pwd').toString().trim();
}

function isFsRoot(dir: string): boolean {
  return dir === path.dirname(dir);
}

export function isProjectRoot(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'package.json'));
}

export function getProjectRoot(startFromDir: string, searchInDir = getUserProfileDirectory()): string | null {
  return findProjectRoot(startFromDir, searchInDir, isProjectRoot);
}

export function findProjectRoot(
  startFromDir: string,
  searchInDir: string,
  checkFn: (dir: string) => boolean,
): string | null {
  let currentDir: string = startFromDir;

  if (!currentDir.startsWith(searchInDir)) {
    throw new Error(`Start directory ${startFromDir} is outside of search directory ${searchInDir}`);
  }

  while (!isFsRoot(currentDir) && currentDir !== searchInDir) {
    if (checkFn(currentDir)) {
      return currentDir;
    }

    currentDir = path.dirname(currentDir);
  }

  if (currentDir === searchInDir && checkFn(currentDir)) {
    return currentDir;
  }

  return null;
}
export function isFileInside(file: string, parentDir: string): boolean {
  if (!fs.statSync(parentDir).isDirectory()) {
    return false;
  }

  return file.startsWith(parentDir);
}
