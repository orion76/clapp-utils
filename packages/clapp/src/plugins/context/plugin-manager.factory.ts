import { IPluginDiscoveryConfig } from '../../types';
import { ContextPluginBuilder } from './plugin-builder';
import { PluginDiscovery } from './plugin-discovery/plugin-discovery';
import { PluginManager } from './plugin-manager';

export async function createPluginManager(projects: string[], config: IPluginDiscoveryConfig) {
  const pluginDiscovery = new PluginDiscovery(projects, config);
  const pluginBuilder = new ContextPluginBuilder();

  return new PluginManager(pluginDiscovery, pluginBuilder);
}
