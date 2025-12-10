import { IPluginDefinition, PluginDiscoveryBase } from '@orion76/plugin';
import * as fs from 'fs';
import * as path from 'path';

import { getProjectRoot, getUserProfileDirectory, isString, loadPackageJson } from '@orion76/clapp-utils';

import { IPluginDiscoveryConfig } from '../../../types';

import { getStartDirectories } from './utils';

/**
 * Plugin discovery for commands
 * Loads command configurations from files and converts them to plugin definitions
 */
export abstract class CommandPluginDiscoveryBase<D extends IPluginDefinition> extends PluginDiscoveryBase<D> {
  protected abstract type: string;
  protected abstract projects: string[];
  protected abstract config: IPluginDiscoveryConfig;

  protected definitions: D[] = [];

  async getDefinitions(): Promise<D[]> {
    if (!this.definitions) {
      this.definitions = await this.findDefinitions();
    }
    return this.definitions;
  }
  async findDefinitions(): Promise<D[]> {
    const definitionFiles = this.findDefinitionFileNames();

    const configPromises = definitionFiles.map((filePath) => this.loadCommandFromFile(filePath));

    const configs = await Promise.all(configPromises);

    function filterEmpty(config: D | null): config is D {
      return !!config;
    }

    // Filter out null results
    const validConfigs = configs.filter(filterEmpty) as Awaited<D>[];

    if (validConfigs.length !== configs.length) {
      throw new Error('Some command definitions failed to load');
    }

    return validConfigs;
  }

  /**
   * Load command configuration from specific file using dynamic import
   * @param filePath Path to command file
   * @returns Command configuration or null
   */
  private async loadCommandFromFile(filePath: string): Promise<D | null> {
    try {
      // Convert to file URL for dynamic import
      const fileUrl = `file://${filePath}`;

      // Use dynamic import for ESM modules
      const module = await import(fileUrl);
      const config: D = module.default || module;

      return config;
    } catch (error) {
      console.error(`[ERROR] Error loading command from ${filePath}:`, (error as Error).message);
      console.error(`[ERROR] Stack:`, (error as Error).stack);
      return null;
    }
  }

  getCommandPaths(commandsDirectory: string): string[] {
    const searchDir = getUserProfileDirectory();
    const projects = [...this.projects, process.cwd()];
    const startDirectories = getStartDirectories(projects);

    const { isAvailableProjectCheck } = this.config;
    const commandPaths = startDirectories
      .map((startDirectory) => getProjectRoot(startDirectory, searchDir))
      .filter((projectRoot) => {
        const packageJson = loadPackageJson(path.join(projectRoot));
        return packageJson ? isAvailableProjectCheck(packageJson) : false;
      })
      .map((projectRoot) => {
        const commandPath = path.join(projectRoot, commandsDirectory);
        if (!fs.existsSync(commandPath)) {
          return;
        }
        return commandPath;
      })
      .filter(isString);

    return commandPaths;
  }

  findDefinitionFileNames(): string[] {
    const { commandsDirectory, commandFindFunc } = this.config;
    const definitionPaths: string[] = [];
    const commandPaths = this.getCommandPaths(commandsDirectory);

    commandPaths.forEach((commandPath) => {
      const fileNames = fs.readdirSync(commandPath, { encoding: 'utf8', recursive: true }).filter(commandFindFunc);
      const fullPaths = fileNames.map((fileName) => path.join(commandPath, fileName));
      definitionPaths.push(...fullPaths);
    });

    return definitionPaths;
  }
}
