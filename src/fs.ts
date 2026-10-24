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

export function getProjectRoot(startFromDir: string, searchInDir: string): string | undefined {
  return findProjectRoot(startFromDir, searchInDir, isProjectRoot);
}
/**
 * Resolves the root of the project the launcher runs in: the nearest directory
 * with a `package.json` above the working directory. The lookup never throws —
 * a working directory outside the searched tree or an absent project yields
 * `null`, and the `project` source is then simply empty.
 *
 * @returns Root of the context project, or `null` when it is not found
 */
export function resolveProjectRoot(cwd: string, userHome: string): string | undefined {
  try {
    return getProjectRoot(cwd, userHome);
  } catch {}
}

export function findProjectRoot(startFromDir: string, searchInDir: string, checkFn: (dir: string) => boolean): string | undefined {
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
}
export function isFileInside(file: string, parentDir: string): boolean {
  if (!fs.statSync(parentDir).isDirectory()) {
    return false;
  }

  return file.startsWith(parentDir);
}
